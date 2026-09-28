import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import {
	ControllerConfig,
	DEFAULT_DEVICES,
	devicesOf,
	getControllers,
	getFtpOptions,
	saveControllers,
	setPassword
} from './config';
import {
	ControllerNode,
	ControllerTreeProvider,
	DeviceNode,
	DirNode,
	FanucNode,
	FileNode
} from './controllerTree';
import * as ftp from './ftp';
import { fixLineCountEdit, renumberEdits, touchModifiedEdit } from './edits';

const ORIGIN_KEY = 'fanucLs.origins';

interface Origin {
	controller: string;
	remotePath: string;
}

export function registerCommands(
	context: vscode.ExtensionContext,
	tree: ControllerTreeProvider,
	diagnostics: vscode.DiagnosticCollection,
	runValidation: (doc: vscode.TextDocument) => Promise<void>
): void {
	const secrets = context.secrets;
	const reg = (id: string, fn: (...args: any[]) => any) =>
		context.subscriptions.push(vscode.commands.registerCommand(id, fn));

	// --- Controllerverwaltung ------------------------------------------------

	reg('fanucLs.addController', async () => {
		const cfg = await promptController();
		if (!cfg) {
			return;
		}
		const list = getControllers();
		if (list.some((c) => c.name === cfg.name)) {
			vscode.window.showErrorMessage(`Ein Controller mit dem Namen "${cfg.name}" existiert bereits.`);
			return;
		}
		await saveControllers([...list, cfg]);
		const pw = await vscode.window.showInputBox({
			prompt: `FTP-Passwort für ${cfg.name} (leer lassen, wenn keines nötig ist)`,
			password: true,
			ignoreFocusOut: true
		});
		if (pw) {
			await setPassword(secrets, cfg, pw);
		}
		tree.refresh();
	});

	reg('fanucLs.editController', async (node?: ControllerNode) => {
		const current = node?.controller ?? (await pickController());
		if (!current) {
			return;
		}
		const updated = await promptController(current);
		if (!updated) {
			return;
		}
		await saveControllers(getControllers().map((c) => (c.name === current.name ? updated : c)));
		tree.refresh();
	});

	reg('fanucLs.removeController', async (node?: ControllerNode) => {
		const current = node?.controller ?? (await pickController());
		if (!current) {
			return;
		}
		const yes = await vscode.window.showWarningMessage(
			`Controller "${current.name}" aus der Liste entfernen?`,
			{ modal: true },
			'Entfernen'
		);
		if (yes !== 'Entfernen') {
			return;
		}
		await saveControllers(getControllers().filter((c) => c.name !== current.name));
		await setPassword(secrets, current, '');
		tree.refresh();
	});

	reg('fanucLs.setPassword', async (node?: ControllerNode) => {
		const current = node?.controller ?? (await pickController());
		if (!current) {
			return;
		}
		const pw = await vscode.window.showInputBox({
			prompt: `FTP-Passwort für ${current.name} (leer = löschen)`,
			password: true,
			ignoreFocusOut: true
		});
		if (pw === undefined) {
			return;
		}
		await setPassword(secrets, current, pw);
		vscode.window.showInformationMessage(pw ? 'Passwort gespeichert.' : 'Passwort gelöscht.');
		tree.refresh();
	});

	reg('fanucLs.refresh', (node?: FanucNode) => tree.refresh(node));

	// --- Dateitransfer -------------------------------------------------------

	reg('fanucLs.downloadFile', async (node?: FileNode) => {
		const target = node ?? (await pickRemoteFile());
		if (!target) {
			return;
		}
		const dir = await resolveDownloadDir();
		if (!dir) {
			return;
		}
		const local = path.join(dir, target.entry.name);
		await withProgress(`${target.entry.name} wird geladen`, async () => {
			await fs.mkdir(dir, { recursive: true });
			await ftp.downloadToFile(target.controller, secrets, target.remotePath, local);
		});
		rememberOrigin(context, local, { controller: target.controller.name, remotePath: target.remotePath });
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(local));
		await vscode.window.showTextDocument(doc, { preview: false });
	});

	reg('fanucLs.openRemoteFile', async (node?: FileNode) => {
		const target = node ?? (await pickRemoteFile());
		if (!target) {
			return;
		}
		const dir = path.join(os.tmpdir(), 'fanuc-ls', sanitize(target.controller.name));
		const local = path.join(dir, target.entry.name);
		await withProgress(`${target.entry.name} wird geladen`, async () => {
			await fs.mkdir(dir, { recursive: true });
			await ftp.downloadToFile(target.controller, secrets, target.remotePath, local);
		});
		rememberOrigin(context, local, { controller: target.controller.name, remotePath: target.remotePath });
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(local));
		await vscode.window.showTextDocument(doc, { preview: false });
	});

	reg('fanucLs.downloadDevice', async (node?: DeviceNode | DirNode) => {
		if (!node) {
			return;
		}
		const remoteBase = node instanceof DeviceNode ? node.remotePath : node.remotePath;
		const baseDir = await resolveDownloadDir();
		if (!baseDir) {
			return;
		}
		const dir = path.join(baseDir, sanitize(node.controller.name), sanitize(remoteBase));
		await withProgress(`Sicherung von ${remoteBase}`, async (progress) => {
			const entries = await ftp.list(node.controller, secrets, remoteBase);
			const files = entries.filter((e) => !e.isDirectory);
			await fs.mkdir(dir, { recursive: true });
			let i = 0;
			for (const e of files) {
				i++;
				progress.report({ message: `${i}/${files.length}  ${e.name}` });
				await ftp.downloadToFile(
					node.controller,
					secrets,
					ftp.joinRemote(remoteBase, e.name),
					path.join(dir, e.name)
				);
			}
		});
		const open = await vscode.window.showInformationMessage(`Sicherung abgelegt in ${dir}`, 'Ordner öffnen');
		if (open) {
			await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
		}
	});

	reg('fanucLs.uploadToDevice', async (node?: DeviceNode | DirNode) => {
		if (!node) {
			return;
		}
		const picked = await vscode.window.showOpenDialog({
			canSelectMany: true,
			openLabel: 'Auf Controller laden',
			filters: { 'FANUC-Dateien': ['ls', 'LS', 'tp', 'TP', 'vr', 'va', 'sv', 'dt'], Alle: ['*'] }
		});
		if (!picked || picked.length === 0) {
			return;
		}
		for (const uri of picked) {
			await uploadLocalFile(uri.fsPath, node.controller, node.remotePath);
		}
		tree.refresh(node);
	});

	reg('fanucLs.uploadCurrentFile', async (uri?: vscode.Uri) => {
		const doc = uri
			? await vscode.workspace.openTextDocument(uri)
			: vscode.window.activeTextEditor?.document;
		if (!doc) {
			vscode.window.showWarningMessage('Keine Datei aktiv.');
			return;
		}
		if (doc.isUntitled) {
			vscode.window.showWarningMessage('Bitte die Datei zuerst speichern.');
			return;
		}
		if (doc.isDirty) {
			await doc.save();
		}

		const opts = getFtpOptions();
		if (opts.validateBeforeUpload && doc.languageId === 'fanuc-ls') {
			await runValidation(doc);
			const errors = diagnostics.get(doc.uri)?.filter((d) => d.severity === vscode.DiagnosticSeverity.Error) ?? [];
			if (errors.length > 0) {
				const go = await vscode.window.showWarningMessage(
					`Die Syntaxprüfung meldet ${errors.length} Fehler. Trotzdem auf die Steuerung laden?`,
					{ modal: true },
					'Trotzdem laden'
				);
				if (go !== 'Trotzdem laden') {
					return;
				}
			}
		}

		const origin = getOrigin(context, doc.uri.fsPath);
		const controllers = getControllers();
		let controller = origin ? controllers.find((c) => c.name === origin.controller) : undefined;
		let remotePath = origin?.remotePath;

		if (controller && remotePath) {
			const choice = await vscode.window.showQuickPick(
				[
					{ label: `$(cloud-upload) Zurück nach ${controller.name}`, detail: remotePath, value: 'origin' },
					{ label: '$(list-selection) Anderes Ziel wählen', value: 'other' }
				],
				{ placeHolder: 'Ziel für den Upload' }
			);
			if (!choice) {
				return;
			}
			if (choice.value === 'other') {
				controller = undefined;
				remotePath = undefined;
			}
		}

		if (!controller) {
			controller = await pickController();
			if (!controller) {
				return;
			}
			const device = await pickDevice(controller);
			if (!device) {
				return;
			}
			remotePath = ftp.joinRemote(device, path.basename(doc.uri.fsPath));
		}

		await uploadLocalFile(doc.uri.fsPath, controller, undefined, remotePath);
		rememberOrigin(context, doc.uri.fsPath, { controller: controller.name, remotePath: remotePath! });
		tree.refresh();
	});

	reg('fanucLs.deleteRemoteFile', async (node?: FileNode) => {
		const target = node ?? (await pickRemoteFile());
		if (!target) {
			return;
		}
		const yes = await vscode.window.showWarningMessage(
			`${target.remotePath} auf ${target.controller.name} löschen?`,
			{ modal: true },
			'Löschen'
		);
		if (yes !== 'Löschen') {
			return;
		}
		await withProgress('Löschen', () => ftp.remove(target.controller, secrets, target.remotePath));
		tree.refresh();
	});

	// --- Editorbefehle -------------------------------------------------------

	reg('fanucLs.validate', async () => {
		const doc = vscode.window.activeTextEditor?.document;
		if (!doc) {
			return;
		}
		await runValidation(doc);
		const found = diagnostics.get(doc.uri) ?? [];
		if (found.length === 0) {
			vscode.window.showInformationMessage('Syntaxprüfung: keine Auffälligkeiten.');
		} else {
			await vscode.commands.executeCommand('workbench.actions.view.problems');
		}
	});

	reg('fanucLs.renumber', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'fanuc-ls') {
			return;
		}
		const edits = [...renumberEdits(editor.document)];
		const touched = touchModifiedEdit(editor.document);
		if (touched) {
			edits.push(touched);
		}
		if (edits.length === 0) {
			vscode.window.showInformationMessage('Die Nummerierung ist bereits fortlaufend.');
			return;
		}
		const wsEdit = new vscode.WorkspaceEdit();
		wsEdit.set(editor.document.uri, edits);
		await vscode.workspace.applyEdit(wsEdit);
	});

	reg('fanucLs.fixLineCount', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'fanuc-ls') {
			return;
		}
		const edit = fixLineCountEdit(editor.document);
		if (!edit) {
			vscode.window.showInformationMessage('LINE_COUNT ist bereits korrekt.');
			return;
		}
		const wsEdit = new vscode.WorkspaceEdit();
		wsEdit.set(editor.document.uri, [edit]);
		await vscode.workspace.applyEdit(wsEdit);
	});

	reg('fanucLs.newProgram', async () => {
		const name = await vscode.window.showInputBox({
			prompt: 'Programmname',
			validateInput: (v) =>
				/^[A-Za-z][A-Za-z0-9_]{0,35}$/.test(v)
					? undefined
					: 'Buchstabe am Anfang, danach Buchstaben, Ziffern oder Unterstrich (max. 36 Zeichen).'
		});
		if (!name) {
			return;
		}
		const doc = await vscode.workspace.openTextDocument({
			language: 'fanuc-ls',
			content: skeleton(name.toUpperCase())
		});
		await vscode.window.showTextDocument(doc);
	});

	reg('fanucLs.showLog', () => ftp.showLog());

	// --- Hilfsfunktionen -----------------------------------------------------

	async function uploadLocalFile(
		localPath: string,
		controller: ControllerConfig,
		remoteDir?: string,
		remotePathIn?: string
	): Promise<void> {
		const remotePath = remotePathIn ?? ftp.joinRemote(remoteDir!, path.basename(localPath));
		const opts = getFtpOptions();

		if (opts.confirmUpload) {
			const dir = remotePath.replace(/[^/:]*$/, '') || remoteDir || '';
			let exists = false;
			try {
				const entries = await ftp.list(controller, secrets, dir);
				exists = entries.some((e) => e.name.toLowerCase() === path.basename(remotePath).toLowerCase());
			} catch {
				/* Verzeichnis nicht lesbar - dann eben ohne Vorabprüfung */
			}
			const question = exists
				? `${remotePath} auf ${controller.name} überschreiben?`
				: `${path.basename(localPath)} nach ${remotePath} auf ${controller.name} laden?`;
			const go = await vscode.window.showWarningMessage(question, { modal: true }, 'Laden');
			if (go !== 'Laden') {
				return;
			}
		}

		await withProgress(`${path.basename(localPath)} -> ${controller.name}`, () =>
			ftp.uploadFile(controller, secrets, localPath, remotePath)
		);
		vscode.window.showInformationMessage(`${path.basename(localPath)} wurde nach ${remotePath} geladen.`);
	}

	async function pickController(): Promise<ControllerConfig | undefined> {
		const list = getControllers();
		if (list.length === 0) {
			const add = await vscode.window.showInformationMessage(
				'Es ist noch kein Controller konfiguriert.',
				'Hinzufügen'
			);
			if (add) {
				await vscode.commands.executeCommand('fanucLs.addController');
			}
			return undefined;
		}
		if (list.length === 1) {
			return list[0];
		}
		const picked = await vscode.window.showQuickPick(
			list.map((c) => ({ label: c.name, description: c.host, value: c })),
			{ placeHolder: 'Controller wählen' }
		);
		return picked?.value;
	}

	async function pickDevice(controller: ControllerConfig): Promise<string | undefined> {
		const devices = devicesOf(controller);
		const picked = await vscode.window.showQuickPick([...devices, '$(edit) Anderer Pfad ...'], {
			placeHolder: 'Zielgerät auf der Steuerung'
		});
		if (!picked) {
			return undefined;
		}
		if (picked.startsWith('$(edit)')) {
			return vscode.window.showInputBox({ prompt: 'Zielpfad auf der Steuerung', value: 'md:' });
		}
		return picked;
	}

	async function pickRemoteFile(): Promise<FileNode | undefined> {
		vscode.window.showInformationMessage('Bitte die Datei im FANUC-Sidepanel auswählen.');
		return undefined;
	}
}

// ---------------------------------------------------------------------------

async function promptController(current?: ControllerConfig): Promise<ControllerConfig | undefined> {
	const name = await vscode.window.showInputBox({
		prompt: 'Anzeigename',
		value: current?.name ?? '',
		placeHolder: 'z. B. R1 Schweißzelle',
		ignoreFocusOut: true,
		validateInput: (v) => (v.trim() ? undefined : 'Name darf nicht leer sein.')
	});
	if (!name) {
		return undefined;
	}
	const host = await vscode.window.showInputBox({
		prompt: 'IP-Adresse oder Hostname der Steuerung',
		value: current?.host ?? '',
		placeHolder: '192.168.0.10',
		ignoreFocusOut: true,
		validateInput: (v) => (v.trim() ? undefined : 'Host darf nicht leer sein.')
	});
	if (!host) {
		return undefined;
	}
	const portRaw = await vscode.window.showInputBox({
		prompt: 'FTP-Port',
		value: String(current?.port ?? 21),
		ignoreFocusOut: true,
		validateInput: (v) => (/^\d+$/.test(v) ? undefined : 'Nur Ziffern.')
	});
	if (portRaw === undefined) {
		return undefined;
	}
	const user = await vscode.window.showInputBox({
		prompt: 'FTP-Benutzer',
		value: current?.user ?? 'anonymous',
		ignoreFocusOut: true
	});
	if (user === undefined) {
		return undefined;
	}
	const devicesRaw = await vscode.window.showInputBox({
		prompt: 'Geräte (kommagetrennt)',
		value: (current?.devices ?? DEFAULT_DEVICES).join(', '),
		ignoreFocusOut: true
	});
	if (devicesRaw === undefined) {
		return undefined;
	}
	return {
		name: name.trim(),
		host: host.trim(),
		port: parseInt(portRaw, 10) || 21,
		user: user.trim() || 'anonymous',
		devices: devicesRaw
			.split(',')
			.map((d) => d.trim())
			.filter(Boolean)
	};
}

async function resolveDownloadDir(): Promise<string | undefined> {
	const configured = getFtpOptions().downloadDirectory;
	if (configured) {
		return configured;
	}
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (folder) {
		return path.join(folder.uri.fsPath, 'fanuc');
	}
	const picked = await vscode.window.showOpenDialog({
		canSelectFolders: true,
		canSelectFiles: false,
		openLabel: 'Zielordner wählen'
	});
	return picked?.[0]?.fsPath;
}

function withProgress<T>(
	title: string,
	fn: (progress: vscode.Progress<{ message?: string }>) => Promise<T>
): Thenable<T> {
	return vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `FANUC: ${title}`, cancellable: false },
		async (progress) => {
			try {
				return await fn(progress);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				vscode.window.showErrorMessage(`FANUC FTP: ${msg}`, 'Protokoll anzeigen').then((a) => {
					if (a) {
						ftp.showLog();
					}
				});
				throw err;
			}
		}
	);
}

function rememberOrigin(context: vscode.ExtensionContext, localPath: string, origin: Origin): void {
	const map = context.workspaceState.get<Record<string, Origin>>(ORIGIN_KEY, {});
	map[localPath] = origin;
	void context.workspaceState.update(ORIGIN_KEY, map);
}

function getOrigin(context: vscode.ExtensionContext, localPath: string): Origin | undefined {
	return context.workspaceState.get<Record<string, Origin>>(ORIGIN_KEY, {})[localPath];
}

function sanitize(s: string): string {
	return s.replace(/[^A-Za-z0-9_.-]+/g, '_');
}

function skeleton(name: string): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, '0');
	const stamp = `DATE ${p(d.getFullYear() % 100)}-${p(d.getMonth() + 1)}-${p(d.getDate())}  TIME ${p(
		d.getHours()
	)}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
	return [
		`/PROG  ${name}`,
		'/ATTR',
		'OWNER\t\t= MNEDITOR;',
		'COMMENT\t\t= "";',
		'PROG_SIZE\t= 0;',
		`CREATE\t\t= ${stamp};`,
		`MODIFIED\t= ${stamp};`,
		'FILE_NAME\t= ;',
		'VERSION\t\t= 0;',
		'LINE_COUNT\t= 1;',
		'MEMORY_SIZE\t= 0;',
		'PROTECT\t\t= READ_WRITE;',
		'TCD:  STACK_SIZE\t= 0,',
		'      TASK_PRIORITY\t= 50,',
		'      TIME_SLICE\t= 0,',
		'      BUSY_LAMP_OFF\t= 0,',
		'      ABORT_REQUEST\t= 0,',
		'      PAUSE_REQUEST\t= 0;',
		'DEFAULT_GROUP\t= 1,*,*,*,*;',
		'CONTROL_CODE\t= 00000000 00000000;',
		'/APPL',
		'/MN',
		'   1:  !--- ' + name + ' --- ;',
		'/POS',
		'/END',
		''
	].join('\r\n');
}
