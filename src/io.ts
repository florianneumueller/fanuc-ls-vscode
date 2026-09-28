import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ControllerConfig, getControllers } from './config';
import { ControllerNode } from './controllerTree';
import * as ftp from './ftp';
import {
	IO_TYPES,
	IO_TYPE_NAMES,
	IoEntry,
	IoType,
	commentsFromProgram,
	compareEntries,
	findIoRefs,
	formatRanges,
	ioKey,
	mergeRanges,
	parseIoCsv,
	parseIoListing,
	parseRanges,
	stripStatusChanges,
	suggestRange
} from './ioCore';

const SELECTOR: vscode.DocumentSelector = { language: 'fanuc-ls' };
const IO_DIR = path.join('.fanuc', 'io');

interface IoListFile {
	version: 1;
	/** Controllername oder leer für eine allgemeine Liste */
	controller?: string;
	source: string;
	imported: string;
	entries: IoEntry[];
}

interface Known {
	comment: string;
	source: string;
}

/** Gesammelte E/A-Informationen: importierte Listen (.fanuc/io/*.json) und Kommentare aus Programmen. */
export class IoStore implements vscode.Disposable {
	private lists: { file: string; data: IoListFile }[] = [];
	private fromPrograms = new Map<string, Known>();
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.emitter.event;

	async reload(): Promise<void> {
		const lists: { file: string; data: IoListFile }[] = [];
		for (const uri of await vscode.workspace.findFiles('.fanuc/io/*.json', undefined, 100)) {
			try {
				const data = JSON.parse(await fs.readFile(uri.fsPath, 'utf8')) as IoListFile;
				if (data && Array.isArray(data.entries)) {
					lists.push({ file: uri.fsPath, data });
				}
			} catch {
				/* defekte Datei überspringen */
			}
		}
		this.lists = lists;

		const fromPrograms = new Map<string, Known>();
		for (const uri of await vscode.workspace.findFiles('**/*.{ls,LS}', '**/node_modules/**', 3000)) {
			try {
				const text = await fs.readFile(uri.fsPath, 'latin1');
				for (const e of commentsFromProgram(text)) {
					fromPrograms.set(ioKey(e.type, e.index), { comment: e.comment, source: path.basename(uri.fsPath) });
				}
			} catch {
				/* nicht lesbar */
			}
		}
		this.fromPrograms = fromPrograms;
		this.emitter.fire();
	}

	/** Kommentare eines Programms aktualisieren (beim Speichern). */
	updateProgram(doc: vscode.TextDocument): void {
		let changed = false;
		for (const e of commentsFromProgram(doc.getText())) {
			const key = ioKey(e.type, e.index);
			if (this.fromPrograms.get(key)?.comment !== e.comment) {
				this.fromPrograms.set(key, { comment: e.comment, source: path.basename(doc.uri.fsPath) });
				changed = true;
			}
		}
		if (changed) {
			this.emitter.fire();
		}
	}

	/** Bekannte Information zu einem Signal; Listen des Controllers haben Vorrang. */
	lookup(type: string, index: number, controller?: string): Known | undefined {
		const key = ioKey(type, index);
		const ordered = [
			...this.lists.filter((l) => controller && l.data.controller === controller),
			...this.lists.filter((l) => !controller || l.data.controller !== controller)
		];
		for (const l of ordered) {
			const e = l.data.entries.find((x) => ioKey(x.type, x.index) === key);
			if (e) {
				return { comment: e.comment, source: `${l.data.source}${l.data.controller ? ' (' + l.data.controller + ')' : ''}` };
			}
		}
		return this.fromPrograms.get(key);
	}

	/** Ist das Signal in einer importierten Liste enthalten (gilt dann als konfiguriert)? */
	isConfigured(type: string, index: number): boolean {
		const key = ioKey(type, index);
		return this.lists.some((l) => l.data.entries.some((e) => ioKey(e.type, e.index) === key));
	}

	/** Alle bekannten Signale (zusammengeführt). */
	all(): (IoEntry & { source: string })[] {
		const out = new Map<string, IoEntry & { source: string }>();
		for (const [key, k] of this.fromPrograms) {
			const m = /^(\w+)\[(\d+)\]$/.exec(key)!;
			out.set(key, { type: m[1] as IoType, index: parseInt(m[2], 10), comment: k.comment, source: k.source });
		}
		for (const l of this.lists) {
			for (const e of l.data.entries) {
				const key = ioKey(e.type, e.index);
				const prev = out.get(key);
				if (!prev || e.comment) {
					out.set(key, { ...e, source: l.data.source + (l.data.controller ? ` (${l.data.controller})` : '') });
				}
			}
		}
		return [...out.values()].sort(compareEntries);
	}

	listFiles(): { file: string; data: IoListFile }[] {
		return this.lists;
	}

	dispose(): void {
		this.emitter.dispose();
	}
}

// --- Baumansicht --------------------------------------------------------------

class TypeNode extends vscode.TreeItem {
	constructor(public readonly type: IoType, public readonly entries: (IoEntry & { source: string })[]) {
		super(type, vscode.TreeItemCollapsibleState.Collapsed);
		const limit = vscode.workspace.getConfiguration('fanucLs').get<Record<string, number | string>>('validation.limits', {})[type];
		const ranges = parseRanges(limit);
		this.description = `${IO_TYPE_NAMES[type]} · ${entries.length}` + (ranges ? ` · Bereich ${formatRanges(ranges)}` : '');
		this.iconPath = new vscode.ThemeIcon(type.endsWith('I') ? 'arrow-small-right' : type.endsWith('O') ? 'arrow-small-left' : 'symbol-boolean');
		this.contextValue = 'ioType';
	}
}

class EntryNode extends vscode.TreeItem {
	constructor(public readonly entry: IoEntry & { source: string }) {
		super(`${entry.type}[${entry.index}]`, vscode.TreeItemCollapsibleState.None);
		this.description = entry.comment || '(ohne Kommentar)';
		this.tooltip = new vscode.MarkdownString(
			`**${entry.type}[${entry.index}]** ${entry.comment}\n\nQuelle: ${entry.source}`
		);
		this.contextValue = 'ioEntry';
		this.command = {
			command: 'workbench.action.findInFiles',
			title: 'Verwendungen suchen',
			arguments: [{ query: `${entry.type}\\[${entry.index}[\\]:]`, isRegex: true, filesToInclude: '*.ls,*.LS' }]
		};
	}
}

class IoTreeProvider implements vscode.TreeDataProvider<TypeNode | EntryNode> {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.emitter.event;
	constructor(private readonly store: IoStore) {
		store.onDidChange(() => this.emitter.fire());
	}
	refresh(): void {
		this.emitter.fire();
	}
	getTreeItem(n: TypeNode | EntryNode): vscode.TreeItem {
		return n;
	}
	getChildren(n?: TypeNode | EntryNode): (TypeNode | EntryNode)[] {
		if (!n) {
			const all = this.store.all();
			return IO_TYPES.filter((t) => all.some((e) => e.type === t)).map(
				(t) => new TypeNode(t, all.filter((e) => e.type === t))
			);
		}
		if (n instanceof TypeNode) {
			return n.entries.map((e) => new EntryNode(e));
		}
		return [];
	}
}

// --- Registrierung ------------------------------------------------------------

export interface IoDeps {
	secrets: vscode.SecretStorage;
	originOf(fsPath: string): Promise<{ controller: string; remotePath: string } | undefined>;
	pickController(): Promise<ControllerConfig | undefined>;
	withProgress<T>(title: string, fn: (progress: vscode.Progress<{ message?: string }>) => Promise<T>): Thenable<T>;
}

export function registerIoFeatures(context: vscode.ExtensionContext, store: IoStore, deps: IoDeps): void {
	const provider = new IoTreeProvider(store);
	const view = vscode.window.createTreeView('fanucLs.io', { treeDataProvider: provider, showCollapseAll: true });
	const reg = (id: string, fn: (...args: any[]) => any) =>
		context.subscriptions.push(vscode.commands.registerCommand(id, fn));

	const updateMessage = () => {
		view.message = store.all().length
			? undefined
			: 'Noch keine E/A-Kommentare bekannt. Liste vom Controller importieren (Wolken-Symbol), CSV importieren oder Programme mit kommentierten Signalen öffnen.';
	};
	store.onDidChange(updateMessage);

	context.subscriptions.push(
		view,
		vscode.workspace.onDidSaveTextDocument((d) => {
			if (d.languageId === 'fanuc-ls') {
				store.updateProgram(d);
			}
		}),
		vscode.languages.registerHoverProvider(SELECTOR, {
			provideHover: async (doc, pos) => {
				const ref = findIoRefs(doc.lineAt(pos.line).text, pos.line).find(
					(r) => pos.character >= r.start && pos.character <= r.end
				);
				if (!ref) {
					return undefined;
				}
				const origin = doc.uri.scheme === 'file' ? await deps.originOf(doc.uri.fsPath) : undefined;
				const known = store.lookup(ref.type, ref.index, origin?.controller);
				const md = new vscode.MarkdownString(`**${ref.type}[${ref.index}]**`);
				const comment = ref.comment ?? known?.comment;
				if (comment) {
					md.appendMarkdown(` – ${comment}`);
				}
				md.appendMarkdown(`\n\n${IO_TYPE_NAMES[ref.type]}`);
				if (known && known.comment !== ref.comment) {
					md.appendMarkdown(`\n\nE/A-Liste: ${known.comment || '(ohne Kommentar)'} · Quelle ${known.source}`);
				}
				if (ref.status) {
					md.appendMarkdown(`\n\nIm Text gespeicherter Status: \`${ref.status}\` (Stand beim Export, nicht aktuell)`);
				}
				return new vscode.Hover(md, new vscode.Range(pos.line, ref.start, pos.line, ref.end));
			}
		}),
		vscode.languages.registerCompletionItemProvider(
			SELECTOR,
			{
				provideCompletionItems: (doc, pos) => {
					const before = doc.lineAt(pos.line).text.slice(0, pos.character);
					const m = /(?<![A-Za-z0-9_$])(DI|DO|RI|RO|GI|GO|AI|AO|UI|UO|SI|SO|WI|WO|F|M)\[\s*\d*$/.exec(before);
					if (!m) {
						return undefined;
					}
					return store
						.all()
						.filter((e) => e.type === m[1])
						.map((e) => {
							const item = new vscode.CompletionItem(String(e.index), vscode.CompletionItemKind.Variable);
							item.detail = e.comment || '(ohne Kommentar)';
							item.documentation = `Quelle: ${e.source}`;
							item.filterText = `${e.index} ${e.comment}`;
							item.sortText = String(e.index).padStart(6, '0');
							return item;
						});
				}
			},
			'['
		)
	);

	registerStatusDecorations(context);
	updateMessage();

	// --- Befehle ------------------------------------------------------------

	reg('fanucLs.io.refresh', () => store.reload());

	reg('fanucLs.io.importFromController', async (node?: ControllerNode) => {
		const controller = node?.controller ?? (await deps.pickController());
		if (!controller) {
			return;
		}
		const root = await workspaceRoot();
		if (!root) {
			return;
		}
		let files: string[] = [];
		try {
			files = (await ftp.list(controller, deps.secrets, 'md:'))
				.filter((e) => !e.isDirectory && /\.(dg|va|txt|csv|ls|dt)$/i.test(e.name))
				.map((e) => e.name);
		} catch {
			/* Liste nicht lesbar - Pfad kann trotzdem eingegeben werden */
		}
		const preferred = ['IOSTATE.DG'];
		const items = [
			...preferred.map((f) => ({ label: `md:${f}`, description: 'E/A-Status mit Kommentaren (empfohlen)' })),
			...files.filter((f) => !preferred.includes(f.toUpperCase())).map((f) => ({ label: `md:${f}`, description: '' })),
			{ label: '$(edit) Anderer Pfad …', description: '' }
		];
		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: `Aus welcher Datei von ${controller.name} sollen die E/A gelesen werden?`
		});
		if (!picked) {
			return;
		}
		const remotePath = picked.label.startsWith('$(edit)')
			? await vscode.window.showInputBox({ prompt: 'Pfad auf der Steuerung', value: 'md:IOSTATE.DG' })
			: picked.label;
		if (!remotePath) {
			return;
		}
		const tmp = path.join(os.tmpdir(), 'fanuc-ls', 'io', sanitize(controller.name) + '_' + sanitize(remotePath));
		await deps.withProgress(`${remotePath} wird geladen`, async () => {
			await fs.mkdir(path.dirname(tmp), { recursive: true });
			await ftp.downloadToFile(controller, deps.secrets, remotePath, tmp);
		});
		const entries = parseIoListing(await fs.readFile(tmp, 'latin1'));
		await saveList(root, controller.name, remotePath, entries, tmp);
	});

	reg('fanucLs.io.importCsv', async () => {
		const root = await workspaceRoot();
		if (!root) {
			return;
		}
		const picked = await vscode.window.showOpenDialog({
			canSelectMany: false,
			filters: { 'CSV/Text': ['csv', 'txt', 'tsv'], Alle: ['*'] },
			openLabel: 'E/A-Liste importieren'
		});
		if (!picked?.[0]) {
			return;
		}
		const target = await vscode.window.showQuickPick(
			[{ label: 'Allgemein (alle Controller)', value: '' }, ...getControllers().map((c) => ({ label: c.name, value: c.name }))],
			{ placeHolder: 'Für welchen Controller gilt die Liste?' }
		);
		if (!target) {
			return;
		}
		const text = await fs.readFile(picked[0].fsPath, 'latin1');
		const csv = parseIoCsv(text);
		const entries = csv.length ? csv : parseIoListing(text);
		await saveList(root, target.value || undefined, path.basename(picked[0].fsPath), entries, picked[0].fsPath);
	});

	reg('fanucLs.io.exportCsv', async () => {
		const all = store.all();
		if (all.length === 0) {
			vscode.window.showInformationMessage('Es sind noch keine E/A-Signale bekannt.');
			return;
		}
		const target = await vscode.window.showSaveDialog({
			filters: { CSV: ['csv'] },
			defaultUri: vscode.workspace.workspaceFolders?.[0]
				? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, 'io-liste.csv')
				: undefined
		});
		if (!target) {
			return;
		}
		const lines = ['Typ;Nummer;Kommentar;Quelle', ...all.map((e) => `${e.type};${e.index};${e.comment.replace(/;/g, ',')};${e.source}`)];
		await fs.writeFile(target.fsPath, lines.join('\r\n') + '\r\n', 'utf8');
		vscode.window.showInformationMessage(`${all.length} Signale nach ${path.basename(target.fsPath)} exportiert.`);
	});

	reg('fanucLs.io.stripStatus', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'fanuc-ls') {
			return;
		}
		const changes = stripStatusChanges(editor.document.getText());
		if (changes.length === 0) {
			vscode.window.showInformationMessage('Die Datei enthält keine gespeicherten E/A-Zustände.');
			return;
		}
		const edit = new vscode.WorkspaceEdit();
		edit.set(
			editor.document.uri,
			changes.map((c) => vscode.TextEdit.delete(new vscode.Range(c.line, c.start, c.line, c.end)))
		);
		await vscode.workspace.applyEdit(edit);
		vscode.window.showInformationMessage(`Status aus ${changes.length} Referenz(en) entfernt.`);
	});

	reg('fanucLs.io.toggleStatus', async () => {
		const cfg = vscode.workspace.getConfiguration('fanucLs');
		await cfg.update('io.hideStatus', !cfg.get<boolean>('io.hideStatus', true), vscode.ConfigurationTarget.Global);
	});

	reg('fanucLs.io.editRanges', async (arg?: TypeNode | string, index?: number) => {
		const type = typeof arg === 'string' ? arg : arg instanceof TypeNode ? arg.type : undefined;
		const picked =
			type ??
			(await vscode.window.showQuickPick([...IO_TYPES, 'R', 'PR', 'AR', 'SR'], { placeHolder: 'Für welchen Typ?' }));
		if (!picked) {
			return;
		}
		const cfg = vscode.workspace.getConfiguration('fanucLs');
		const limits = { ...(cfg.get<Record<string, number | string>>('validation.limits', {}) ?? {}) };
		const current = parseRanges(limits[picked]) ?? [];
		const proposal = index !== undefined ? formatRanges([...current, suggestRange(index)]) : formatRanges(current);
		const value = await vscode.window.showInputBox({
			prompt: `Gültige Bereiche für ${picked}, z. B. "1-512, 6001-7000". Leer oder 0 = keine Prüfung.`,
			value: proposal,
			validateInput: (v) =>
				v.trim() === '' || v.trim() === '0' || parseRanges(v) ? undefined : 'Format: 1-512, 6001-7000, 7500'
		});
		if (value === undefined) {
			return;
		}
		const ranges = parseRanges(value);
		limits[picked] = !ranges ? 0 : ranges.length === 1 && ranges[0].from === 1 ? ranges[0].to : formatRanges(mergeRanges(ranges));
		const target = vscode.workspace.workspaceFolders?.length
			? vscode.ConfigurationTarget.Workspace
			: vscode.ConfigurationTarget.Global;
		await cfg.update('validation.limits', limits, target);
		provider.refresh();
	});

	async function saveList(
		root: string,
		controller: string | undefined,
		source: string,
		entries: IoEntry[],
		rawFile: string
	): Promise<void> {
		if (entries.length === 0) {
			const action = await vscode.window.showErrorMessage(
				`In ${source} wurden keine E/A-Signale erkannt. Das Dateiformat ist vermutlich anders als erwartet.`,
				'Datei öffnen'
			);
			if (action) {
				await vscode.window.showTextDocument(vscode.Uri.file(rawFile));
			}
			return;
		}
		const counts = IO_TYPES.map((t) => [t, entries.filter((e) => e.type === t).length] as const)
			.filter(([, n]) => n > 0)
			.map(([t, n]) => `${t}: ${n}`)
			.join(', ');
		const withComment = entries.filter((e) => e.comment).length;
		const go = await vscode.window.showInformationMessage(
			`${entries.length} Signale erkannt (${counts}), davon ${withComment} mit Kommentar. Der aktuelle Status wird nicht übernommen. Speichern?`,
			{ modal: true },
			'Speichern'
		);
		if (go !== 'Speichern') {
			return;
		}
		const dir = path.join(root, IO_DIR);
		await fs.mkdir(dir, { recursive: true });
		const file = path.join(dir, `${sanitize(controller ?? 'allgemein')}.json`);
		const data: IoListFile = { version: 1, controller, source, imported: new Date().toISOString(), entries };
		await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
		await store.reload();
		vscode.window.showInformationMessage(`E/A-Liste gespeichert: ${vscode.workspace.asRelativePath(file)}`);
	}
}

async function workspaceRoot(): Promise<string | undefined> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		vscode.window.showWarningMessage('Bitte zuerst einen Ordner öffnen - die E/A-Liste wird im Workspace gespeichert.');
		return undefined;
	}
	return folder.uri.fsPath;
}

function sanitize(s: string): string {
	return s.replace(/[^A-Za-z0-9_.-]+/g, '_');
}

// --- Status ausblenden ----------------------------------------------------------

function registerStatusDecorations(context: vscode.ExtensionContext): void {
	// "display: none" über textDecoration - blendet den Status aus, ohne den Text zu ändern
	const hidden = vscode.window.createTextEditorDecorationType({
		textDecoration: 'none; display: none;'
	});
	const marker = vscode.window.createTextEditorDecorationType({
		before: { contentText: '·', color: new vscode.ThemeColor('editorCodeLens.foreground') }
	});
	context.subscriptions.push(hidden, marker);

	const update = (editor: vscode.TextEditor | undefined) => {
		if (!editor || editor.document.languageId !== 'fanuc-ls') {
			return;
		}
		const enabled = vscode.workspace.getConfiguration('fanucLs').get<boolean>('io.hideStatus', true);
		const cursorLines = new Set(editor.selections.map((s) => s.active.line));
		const ranges: vscode.Range[] = [];
		const markers: vscode.Range[] = [];
		if (enabled) {
			const doc = editor.document;
			const first = Math.max(0, (editor.visibleRanges[0]?.start.line ?? 0) - 50);
			const last = Math.min(doc.lineCount - 1, (editor.visibleRanges[editor.visibleRanges.length - 1]?.end.line ?? doc.lineCount) + 50);
			for (let i = first; i <= last; i++) {
				if (cursorLines.has(i)) {
					continue; // in der Cursorzeile den echten Text zeigen
				}
				for (const r of findIoRefs(doc.lineAt(i).text, i)) {
					if (r.statusStart !== undefined && r.statusEnd !== undefined) {
						ranges.push(new vscode.Range(i, r.statusStart, i, r.statusEnd));
						markers.push(new vscode.Range(i, r.statusStart, i, r.statusStart));
					}
				}
			}
		}
		editor.setDecorations(hidden, ranges);
		editor.setDecorations(marker, markers);
	};

	context.subscriptions.push(
		vscode.window.onDidChangeActiveTextEditor(update),
		vscode.window.onDidChangeTextEditorSelection((e) => update(e.textEditor)),
		vscode.window.onDidChangeTextEditorVisibleRanges((e) => update(e.textEditor)),
		vscode.workspace.onDidChangeTextDocument((e) => {
			vscode.window.visibleTextEditors.filter((ed) => ed.document === e.document).forEach(update);
		}),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('fanucLs.io.hideStatus')) {
				vscode.window.visibleTextEditors.forEach(update);
			}
		})
	);
	vscode.window.visibleTextEditors.forEach(update);
}
