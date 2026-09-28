import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ControllerConfig, devicesOf, getControllers } from './config';
import { ControllerNode, ControllerTreeProvider } from './controllerTree';
import * as ftp from './ftp';
import {
	CloneChange,
	CloneManifest,
	MANIFEST_NAME,
	computeChanges,
	deviceFolder,
	findCloneRoot,
	matchesTypes,
	readManifest,
	sha1File,
	writeManifest
} from './cloneCore';

export interface CloneDeps {
	withProgress<T>(title: string, fn: (progress: vscode.Progress<{ message?: string }>) => Promise<T>): Thenable<T>;
	rememberOrigin(localPath: string, origin: { controller: string; remotePath: string }): void;
	showDiff(controller: ControllerConfig, remotePath: string, localPath: string): Promise<void>;
	pickController(): Promise<ControllerConfig | undefined>;
	resolveDownloadDir(): Promise<string | undefined>;
	/** Nach Uploads: Programmliste des Controllers neu laden. */
	programsChanged(controllerName: string): void;
	/** Anzahl der Syntaxfehler einer Datei (0 für Nicht-LS-Dateien). */
	countErrors(file: string): Promise<number>;
}

const MAX_DEPTH = 3;

export function registerCloneCommands(
	context: vscode.ExtensionContext,
	tree: ControllerTreeProvider,
	deps: CloneDeps
): void {
	const secrets = context.secrets;
	const reg = (id: string, fn: (...args: any[]) => any) =>
		context.subscriptions.push(vscode.commands.registerCommand(id, fn));

	// --- Klonen / Klon aktualisieren -------------------------------------------

	reg('fanucLs.clone.create', async (node?: ControllerNode) => {
		const controller = node?.controller ?? (await deps.pickController());
		if (!controller) {
			return;
		}
		const devices = await vscode.window.showQuickPick(
			devicesOf(controller).map((d) => ({ label: d, picked: d.toLowerCase() === 'md:' })),
			{ canPickMany: true, placeHolder: `Welche Geräte von ${controller.name} klonen?` }
		);
		if (!devices || devices.length === 0) {
			return;
		}
		const base = await deps.resolveDownloadDir();
		if (!base) {
			return;
		}
		const root = path.join(base, sanitize(controller.name));
		const types = vscode.workspace.getConfiguration('fanucLs').get<string[]>('clone.fileTypes', []) ?? [];

		const existing = await readManifest(root);
		if (existing && existing.controller !== controller.name) {
			vscode.window.showErrorMessage(`${root} ist bereits ein Klon von "${existing.controller}".`);
			return;
		}
		const localChanges = existing ? await computeChanges(root, existing) : [];
		const protectedFiles = new Set(localChanges.filter((c) => c.kind !== 'deleted').map((c) => c.relPath));
		if (protectedFiles.size > 0) {
			const go = await vscode.window.showWarningMessage(
				`Im Klon gibt es ${protectedFiles.size} lokal geänderte oder neue Dateien. Diese werden beim Aktualisieren nicht überschrieben. Fortfahren?`,
				{ modal: true },
				'Aktualisieren'
			);
			if (go !== 'Aktualisieren') {
				return;
			}
		}

		const manifest: CloneManifest = existing ?? {
			version: 1,
			controller: controller.name,
			host: controller.host,
			created: new Date().toISOString(),
			updated: '',
			devices: {},
			files: {}
		};

		let loaded = 0;
		let skipped = 0;
		await deps.withProgress(`${controller.name} wird geklont`, async (progress) => {
			await fs.mkdir(root, { recursive: true });
			for (const { label: device } of devices) {
				const folder = deviceFolder(device);
				manifest.devices[folder] = device;
				const remoteFiles: { remotePath: string; inDevice: string }[] = [];
				progress.report({ message: `${device} wird gelesen` });
				await collect(controller, device, '', 0, types, remoteFiles);
				let i = 0;
				for (const f of remoteFiles) {
					i++;
					const rel = `${folder}/${f.inDevice}`;
					if (protectedFiles.has(rel)) {
						skipped++;
						continue;
					}
					progress.report({ message: `${device} ${i}/${remoteFiles.length}  ${f.inDevice}` });
					const local = path.join(root, folder, ...f.inDevice.split('/'));
					await fs.mkdir(path.dirname(local), { recursive: true });
					await ftp.downloadToFile(controller, secrets, f.remotePath, local);
					const stat = await fs.stat(local);
					manifest.files[rel] = { remotePath: f.remotePath, sha1: await sha1File(local), size: stat.size };
					deps.rememberOrigin(local, { controller: controller.name, remotePath: f.remotePath });
					loaded++;
				}
			}
			await writeManifest(root, manifest);
		});

		const note = skipped ? ` ${skipped} lokal geänderte Datei(en) wurden nicht überschrieben.` : '';
		const action = await vscode.window.showInformationMessage(
			`${controller.name}: ${loaded} Dateien nach ${root} geklont.${note}`,
			'Im Explorer zeigen',
			'Änderungen anzeigen'
		);
		if (action === 'Im Explorer zeigen') {
			await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(path.join(root, MANIFEST_NAME)));
		} else if (action === 'Änderungen anzeigen') {
			await vscode.commands.executeCommand('fanucLs.clone.showChanges', vscode.Uri.file(root));
		}
	});

	// --- Änderungen anzeigen --------------------------------------------------

	reg('fanucLs.clone.showChanges', async (uri?: vscode.Uri) => {
		const clone = await pickClone(uri);
		if (!clone) {
			return;
		}
		const changes = await computeChanges(clone.root, clone.manifest);
		if (changes.length === 0) {
			vscode.window.showInformationMessage(`Klon von ${clone.manifest.controller}: keine lokalen Änderungen.`);
			return;
		}
		const pushItem = {
			label: `$(cloud-upload) Änderungen auf ${clone.manifest.controller} übertragen …`,
			change: undefined as CloneChange | undefined
		};
		const picked = await vscode.window.showQuickPick(
			[pushItem, ...changes.map((c) => ({ ...changeItem(c), change: c as CloneChange | undefined }))],
			{
				placeHolder: `${changes.length} Änderungen im Klon von ${clone.manifest.controller} - Datei wählen für den Vergleich`,
				matchOnDescription: true
			}
		);
		if (!picked) {
			return;
		}
		if (!picked.change) {
			await vscode.commands.executeCommand('fanucLs.clone.pushChanges', vscode.Uri.file(clone.root));
			return;
		}
		const c = picked.change;
		const local = path.join(clone.root, ...c.relPath.split('/'));
		if (c.kind === 'modified') {
			const controller = findController(clone.manifest);
			if (controller) {
				await deps.showDiff(controller, c.remotePath, local);
			}
		} else if (c.kind === 'added') {
			await vscode.window.showTextDocument(vscode.Uri.file(local));
		} else {
			vscode.window.showInformationMessage(
				`${c.relPath} wurde lokal gelöscht. Auf der Steuerung bleibt die Datei erhalten; Löschen nur über die Controller-Ansicht.`
			);
		}
	});

	// --- Änderungen übertragen ------------------------------------------------

	reg('fanucLs.clone.pushChanges', async (uri?: vscode.Uri) => {
		const clone = await pickClone(uri);
		if (!clone) {
			return;
		}
		const controller = findController(clone.manifest);
		if (!controller) {
			return;
		}
		const changes = (await computeChanges(clone.root, clone.manifest)).filter((c) => c.kind !== 'deleted');
		if (changes.length === 0) {
			vscode.window.showInformationMessage('Keine geänderten oder neuen Dateien zum Übertragen.');
			return;
		}
		const picked = await vscode.window.showQuickPick(
			changes.map((c) => ({ ...changeItem(c), picked: true, change: c })),
			{ canPickMany: true, placeHolder: `Dateien auswählen, die auf ${controller.name} übertragen werden` }
		);
		if (!picked || picked.length === 0) {
			return;
		}

		const withErrors: string[] = [];
		for (const p of picked) {
			if ((await deps.countErrors(path.join(clone.root, ...p.change.relPath.split('/')))) > 0) {
				withErrors.push(p.change.relPath);
			}
		}
		const question =
			`${picked.length} Datei(en) auf ${controller.name} übertragen?` +
			(withErrors.length ? `\n\nDie Syntaxprüfung meldet Fehler in: ${withErrors.join(', ')}` : '');
		const go = await vscode.window.showWarningMessage(question, { modal: true }, 'Übertragen');
		if (go !== 'Übertragen') {
			return;
		}

		const uploaded: string[] = [];
		const conflicts: CloneChange[] = [];
		await deps.withProgress(`Übertragung nach ${controller.name}`, async (progress) => {
			const tmp = path.join(os.tmpdir(), 'fanuc-ls', 'clone-check');
			await fs.mkdir(tmp, { recursive: true });
			let i = 0;
			for (const { change } of picked) {
				i++;
				progress.report({ message: `${i}/${picked.length}  ${change.relPath}` });
				const local = path.join(clone.root, ...change.relPath.split('/'));
				if (await changedOnController(controller, change, clone.manifest, tmp)) {
					conflicts.push(change);
					continue;
				}
				await ftp.uploadFile(controller, secrets, local, change.remotePath);
				const stat = await fs.stat(local);
				clone.manifest.files[change.relPath] = {
					remotePath: change.remotePath,
					sha1: await sha1File(local),
					size: stat.size
				};
				deps.rememberOrigin(local, { controller: controller.name, remotePath: change.remotePath });
				uploaded.push(change.relPath);
			}
			await writeManifest(clone.root, clone.manifest);
		});
		tree.refresh();
		deps.programsChanged(controller.name);

		if (conflicts.length === 0) {
			vscode.window.showInformationMessage(`${uploaded.length} Datei(en) auf ${controller.name} übertragen.`);
			return;
		}
		const names = conflicts.map((c) => c.relPath).join(', ');
		const action = await vscode.window.showWarningMessage(
			`${uploaded.length} übertragen. Nicht übertragen, weil auf ${controller.name} seit dem Klonen geändert: ${names}. ` +
				'Bitte vergleichen und die Datei danach neu klonen oder einzeln hochladen.',
			'Ersten Konflikt vergleichen'
		);
		if (action) {
			const c = conflicts[0];
			await deps.showDiff(controller, c.remotePath, path.join(clone.root, ...c.relPath.split('/')));
		}
	});

	// --- Hilfsfunktionen ------------------------------------------------------

	async function collect(
		controller: ControllerConfig,
		remoteDir: string,
		relDir: string,
		depth: number,
		types: string[],
		out: { remotePath: string; inDevice: string }[]
	): Promise<void> {
		const entries = await ftp.list(controller, secrets, remoteDir);
		for (const e of entries) {
			const remotePath = ftp.joinRemote(remoteDir, e.name);
			const inDevice = relDir ? `${relDir}/${e.name}` : e.name;
			if (e.isDirectory) {
				if (depth < MAX_DEPTH) {
					await collect(controller, remotePath, inDevice, depth + 1, types, out);
				}
			} else if (matchesTypes(e.name, types)) {
				out.push({ remotePath, inDevice });
			}
		}
	}

	/**
	 * Prüft vor dem Upload, ob die Datei auf der Steuerung seit dem letzten Abgleich
	 * verändert wurde (bzw. bei neuen Dateien: bereits existiert).
	 */
	async function changedOnController(
		controller: ControllerConfig,
		change: CloneChange,
		manifest: CloneManifest,
		tmpDir: string
	): Promise<boolean> {
		const known = manifest.files[change.relPath];
		const probe = path.join(tmpDir, sanitize(change.remotePath));
		try {
			await ftp.downloadToFile(controller, secrets, change.remotePath, probe);
		} catch {
			// nicht vorhanden: bei neuen Dateien in Ordnung, bei bekannten ein Konflikt
			return !!known;
		}
		if (!known) {
			return true;
		}
		return (await sha1File(probe)) !== known.sha1;
	}

	function findController(manifest: CloneManifest): ControllerConfig | undefined {
		const c = getControllers().find((x) => x.name === manifest.controller);
		if (!c) {
			vscode.window.showErrorMessage(
				`Controller "${manifest.controller}" ist nicht mehr konfiguriert. Bitte unter diesem Namen wieder anlegen.`
			);
		}
		return c;
	}

	async function pickClone(uri?: vscode.Uri): Promise<{ root: string; manifest: CloneManifest } | undefined> {
		const start = uri?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
		if (start) {
			const found = await findCloneRoot(start);
			if (found) {
				return found;
			}
		}
		const files = await vscode.workspace.findFiles(`**/${MANIFEST_NAME}`, '**/node_modules/**', 50);
		const clones: { root: string; manifest: CloneManifest }[] = [];
		for (const f of files) {
			const root = path.dirname(f.fsPath);
			const manifest = await readManifest(root);
			if (manifest) {
				clones.push({ root, manifest });
			}
		}
		if (clones.length === 1) {
			return clones[0];
		}
		if (clones.length > 1) {
			const picked = await vscode.window.showQuickPick(
				clones.map((c) => ({
					label: c.manifest.controller,
					description: vscode.workspace.asRelativePath(c.root),
					value: c
				})),
				{ placeHolder: 'Klon wählen' }
			);
			return picked?.value;
		}
		const action = await vscode.window.showInformationMessage(
			'Im Workspace wurde kein Controller-Klon gefunden.',
			'Controller klonen'
		);
		if (action) {
			await vscode.commands.executeCommand('fanucLs.clone.create');
		}
		return undefined;
	}
}

function changeItem(c: CloneChange): vscode.QuickPickItem {
	const icon = c.kind === 'modified' ? '$(diff-modified)' : c.kind === 'added' ? '$(diff-added)' : '$(diff-removed)';
	const what = c.kind === 'modified' ? 'geändert' : c.kind === 'added' ? 'neu' : 'lokal gelöscht';
	return { label: `${icon} ${c.relPath}`, description: `${what}  →  ${c.remotePath}` };
}

function sanitize(s: string): string {
	return s.replace(/[^A-Za-z0-9_.-]+/g, '_');
}
