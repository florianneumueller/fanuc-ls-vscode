import * as vscode from 'vscode';
import {
	LabelAnalysis,
	LabelInfo,
	LabelRef,
	LabelSpan,
	TextChange,
	analyzeLabels,
	labelAt,
	nextFreeLabel,
	renameLabelChanges,
	renumberAllChanges,
	setCommentChange
} from './labels';
import { renumberEdits } from './edits';

const SELECTOR: vscode.DocumentSelector = { language: 'fanuc-ls' };

// --- Analyse je Dokumentversion zwischenspeichern ----------------------------

const cache = new WeakMap<vscode.TextDocument, { version: number; analysis: LabelAnalysis }>();

function analysisOf(doc: vscode.TextDocument): LabelAnalysis {
	const hit = cache.get(doc);
	if (hit && hit.version === doc.version) {
		return hit.analysis;
	}
	const analysis = analyzeLabels(doc.getText());
	cache.set(doc, { version: doc.version, analysis });
	return analysis;
}

function spanRange(s: LabelSpan): vscode.Range {
	return new vscode.Range(s.line, s.start, s.line, s.end);
}

function allSpans(l: LabelInfo): LabelSpan[] {
	return [...(l.def ? [l.def] : []), ...l.duplicates, ...l.refs];
}

function toEdits(changes: TextChange[]): vscode.TextEdit[] {
	return changes.map((c) => vscode.TextEdit.replace(new vscode.Range(c.line, c.start, c.line, c.end), c.text));
}

async function applyChanges(doc: vscode.TextDocument, changes: TextChange[]): Promise<boolean> {
	const edit = new vscode.WorkspaceEdit();
	edit.set(doc.uri, toEdits(changes));
	return vscode.workspace.applyEdit(edit);
}

function jumpWord(n: number): string {
	return n === 1 ? '1 Sprung' : `${n} Sprünge`;
}

// --- Baumansicht --------------------------------------------------------------

class LabelNode extends vscode.TreeItem {
	constructor(public readonly doc: vscode.TextDocument, public readonly label_: LabelInfo) {
		super(
			label_.def?.comment ? `LBL[${label_.id}:${label_.def.comment}]` : `LBL[${label_.id}]`,
			label_.refs.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);
		const def = label_.def;
		if (!def) {
			this.description = `nicht definiert · ${jumpWord(label_.refs.length)}`;
			this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.errorForeground'));
			this.contextValue = 'labelUndefined';
		} else {
			const parts = [`Zeile ${def.tpNum}`, label_.refs.length ? jumpWord(label_.refs.length) : 'nicht angesprungen'];
			if (label_.duplicates.length) {
				parts.push(`${label_.duplicates.length + 1}× definiert`);
			}
			this.description = parts.join(' · ');
			this.iconPath = new vscode.ThemeIcon(
				label_.duplicates.length ? 'warning' : 'tag',
				label_.refs.length && !label_.duplicates.length ? undefined : new vscode.ThemeColor('list.warningForeground')
			);
			this.contextValue = 'label';
		}
		const target = def ?? label_.refs[0];
		this.command = { command: 'fanucLs.labels.reveal', title: 'Anzeigen', arguments: [doc.uri, target] };
		this.tooltip = new vscode.MarkdownString(
			`**LBL[${label_.id}]**${def?.comment ? ' – ' + def.comment : ''}\n\n` +
				(def ? `Definiert in Zeile ${def.tpNum}` : 'Nicht definiert') +
				(label_.refs.length ? `\n\nSprünge aus Zeile ${label_.refs.map((r) => r.tpNum).join(', ')}` : '')
		);
	}
}

class RefNode extends vscode.TreeItem {
	constructor(public readonly doc: vscode.TextDocument, public readonly ref: LabelRef) {
		super(`Zeile ${ref.tpNum}`, vscode.TreeItemCollapsibleState.None);
		this.description = ref.statement;
		this.iconPath = new vscode.ThemeIcon(
			ref.kind === 'JMP' ? 'arrow-right' : ref.kind === 'TIMEOUT' ? 'watch' : ref.kind === 'SKIP' ? 'debug-step-over' : 'link'
		);
		this.contextValue = 'labelRef';
		this.command = { command: 'fanucLs.labels.reveal', title: 'Anzeigen', arguments: [doc.uri, ref] };
	}
}

type Node = LabelNode | RefNode;

class LabelTreeProvider implements vscode.TreeDataProvider<Node> {
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.emitter.event;
	doc: vscode.TextDocument | undefined;

	refresh(): void {
		this.emitter.fire();
	}

	getTreeItem(n: Node): vscode.TreeItem {
		return n;
	}

	getChildren(n?: Node): Node[] {
		if (!this.doc) {
			return [];
		}
		if (!n) {
			return analysisOf(this.doc).labels.map((l) => new LabelNode(this.doc!, l));
		}
		if (n instanceof LabelNode) {
			return n.label_.refs.map((r) => new RefNode(n.doc, r));
		}
		return [];
	}
}

// --- Sprachfunktionen ---------------------------------------------------------

class LabelLanguageFeatures
	implements
		vscode.DefinitionProvider,
		vscode.ReferenceProvider,
		vscode.DocumentHighlightProvider,
		vscode.RenameProvider,
		vscode.HoverProvider,
		vscode.CompletionItemProvider
{
	provideDefinition(doc: vscode.TextDocument, pos: vscode.Position): vscode.Location | undefined {
		const hit = labelAt(analysisOf(doc), pos.line, pos.character);
		return hit?.label.def ? new vscode.Location(doc.uri, spanRange(hit.label.def)) : undefined;
	}

	provideReferences(
		doc: vscode.TextDocument,
		pos: vscode.Position,
		ctx: vscode.ReferenceContext
	): vscode.Location[] | undefined {
		const hit = labelAt(analysisOf(doc), pos.line, pos.character);
		if (!hit) {
			return undefined;
		}
		const spans = ctx.includeDeclaration ? allSpans(hit.label) : hit.label.refs;
		return spans.map((s) => new vscode.Location(doc.uri, spanRange(s)));
	}

	provideDocumentHighlights(doc: vscode.TextDocument, pos: vscode.Position): vscode.DocumentHighlight[] | undefined {
		const hit = labelAt(analysisOf(doc), pos.line, pos.character);
		if (!hit) {
			return undefined;
		}
		return [
			...(hit.label.def ? [new vscode.DocumentHighlight(spanRange(hit.label.def), vscode.DocumentHighlightKind.Write)] : []),
			...hit.label.refs.map((r) => new vscode.DocumentHighlight(spanRange(r), vscode.DocumentHighlightKind.Read))
		];
	}

	prepareRename(doc: vscode.TextDocument, pos: vscode.Position): vscode.Range | { range: vscode.Range; placeholder: string } {
		const hit = labelAt(analysisOf(doc), pos.line, pos.character);
		if (!hit) {
			throw new Error('Umbenennen geht hier nur für Sprungmarken (LBL-Nummer).');
		}
		const s = hit.span;
		return { range: new vscode.Range(s.line, s.idStart, s.line, s.idEnd), placeholder: String(hit.label.id) };
	}

	provideRenameEdits(doc: vscode.TextDocument, pos: vscode.Position, newName: string): vscode.WorkspaceEdit {
		const analysis = analysisOf(doc);
		const hit = labelAt(analysis, pos.line, pos.character);
		if (!hit) {
			throw new Error('Keine Sprungmarke an dieser Stelle.');
		}
		const to = parseLabelNumber(newName);
		if (to === undefined) {
			throw new Error('Die Labelnummer muss eine positive Ganzzahl sein.');
		}
		if (to !== hit.label.id && analysis.labels.some((l) => l.id === to)) {
			throw new Error(`LBL[${to}] wird bereits verwendet.`);
		}
		const edit = new vscode.WorkspaceEdit();
		edit.set(doc.uri, toEdits(renameLabelChanges(analysis, hit.label.id, to)));
		return edit;
	}

	provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
		const hit = labelAt(analysisOf(doc), pos.line, pos.character);
		if (!hit) {
			return undefined;
		}
		const l = hit.label;
		const md = new vscode.MarkdownString(`**LBL[${l.id}]**${l.def?.comment ? ' – ' + l.def.comment : ''}\n\n`);
		if (!l.def) {
			md.appendMarkdown('$(warning) Nicht definiert');
		} else if (hit.span === l.def) {
			md.appendMarkdown(
				l.refs.length ? `${jumpWord(l.refs.length)} aus Zeile ${l.refs.map((r) => r.tpNum).join(', ')}` : 'Wird nie angesprungen'
			);
		} else {
			md.appendMarkdown(`Definiert in Zeile ${l.def.tpNum}: \`${l.def.statement}\``);
		}
		md.supportThemeIcons = true;
		return new vscode.Hover(md, spanRange(hit.span));
	}

	provideCompletionItems(doc: vscode.TextDocument, pos: vscode.Position): vscode.CompletionItem[] | undefined {
		const before = doc.lineAt(pos.line).text.slice(0, pos.character);
		if (!/\bLBL\s*\[\s*\d*$/.test(before)) {
			return undefined;
		}
		const analysis = analysisOf(doc);
		const isDefinition = /^\s*\d+:\s*LBL\s*\[\s*\d*$/.test(before);
		if (isDefinition) {
			const n = nextFreeLabel(analysis);
			const item = new vscode.CompletionItem(String(n), vscode.CompletionItemKind.Value);
			item.detail = 'nächste freie Labelnummer';
			return [item];
		}
		return analysis.labels
			.filter((l) => l.def)
			.map((l) => {
				const item = new vscode.CompletionItem(String(l.id), vscode.CompletionItemKind.Reference);
				item.detail = l.def!.comment ? l.def!.comment : `Zeile ${l.def!.tpNum}`;
				item.documentation = `Definiert in Zeile ${l.def!.tpNum}`;
				item.sortText = String(l.id).padStart(6, '0');
				return item;
			});
	}
}

function parseLabelNumber(s: string): number | undefined {
	const t = s.trim();
	if (!/^\d+$/.test(t)) {
		return undefined;
	}
	const n = parseInt(t, 10);
	return n > 0 ? n : undefined;
}

// --- Registrierung ------------------------------------------------------------

export function registerLabelFeatures(context: vscode.ExtensionContext): void {
	const provider = new LabelTreeProvider();
	const view = vscode.window.createTreeView('fanucLs.labels', { treeDataProvider: provider, showCollapseAll: true });
	const features = new LabelLanguageFeatures();

	const update = () => {
		const editor = vscode.window.activeTextEditor;
		provider.doc = editor?.document.languageId === 'fanuc-ls' ? editor.document : undefined;
		view.message = provider.doc ? undefined : 'Keine FANUC-TP-Datei (.ls) aktiv.';
		view.description = provider.doc ? vscode.workspace.asRelativePath(provider.doc.uri) : undefined;
		provider.refresh();
	};
	let timer: NodeJS.Timeout | undefined;

	context.subscriptions.push(
		view,
		vscode.languages.registerDefinitionProvider(SELECTOR, features),
		vscode.languages.registerReferenceProvider(SELECTOR, features),
		vscode.languages.registerDocumentHighlightProvider(SELECTOR, features),
		vscode.languages.registerRenameProvider(SELECTOR, features),
		vscode.languages.registerHoverProvider(SELECTOR, features),
		vscode.languages.registerCompletionItemProvider(SELECTOR, features, '['),
		vscode.window.onDidChangeActiveTextEditor(update),
		vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.document === provider.doc) {
				if (timer) {
					clearTimeout(timer);
				}
				timer = setTimeout(() => provider.refresh(), 300);
			}
		})
	);
	update();

	const reg = (id: string, fn: (...args: any[]) => any) =>
		context.subscriptions.push(vscode.commands.registerCommand(id, fn));

	reg('fanucLs.labels.reveal', async (uri: vscode.Uri, span: LabelSpan) => {
		const editor = await vscode.window.showTextDocument(uri, { preserveFocus: false });
		const range = spanRange(span);
		editor.selection = new vscode.Selection(range.start, range.end);
		editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	});

	reg('fanucLs.labels.editComment', async (node?: LabelNode) => {
		const target = node ?? (await labelAtCursor());
		if (!target?.label_.def) {
			return;
		}
		const comment = await vscode.window.showInputBox({
			prompt: `Kommentar für LBL[${target.label_.id}] (leer = entfernen)`,
			value: target.label_.def.comment ?? '',
			validateInput: (v) => (/[\]]/.test(v) ? 'Das Zeichen "]" ist im Kommentar nicht erlaubt.' : undefined)
		});
		if (comment === undefined) {
			return;
		}
		await applyChanges(target.doc, [setCommentChange(target.label_.def, comment)]);
	});

	reg('fanucLs.labels.changeNumber', async (node?: LabelNode) => {
		const target = node ?? (await labelAtCursor());
		if (!target) {
			return;
		}
		const analysis = analysisOf(target.doc);
		const value = await vscode.window.showInputBox({
			prompt: `Neue Nummer für LBL[${target.label_.id}] - alle Sprünge werden mitgeändert`,
			value: String(target.label_.id),
			validateInput: (v) => {
				const n = parseLabelNumber(v);
				if (n === undefined) {
					return 'Positive Ganzzahl eingeben.';
				}
				if (n !== target.label_.id && analysis.labels.some((l) => l.id === n)) {
					return `LBL[${n}] wird bereits verwendet.`;
				}
				return undefined;
			}
		});
		const to = value === undefined ? undefined : parseLabelNumber(value);
		if (to === undefined || to === target.label_.id) {
			return;
		}
		await applyChanges(target.doc, renameLabelChanges(analysis, target.label_.id, to));
	});

	reg('fanucLs.labels.insert', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'fanuc-ls') {
			vscode.window.showWarningMessage('Bitte zuerst eine FANUC-TP-Datei öffnen.');
			return;
		}
		const doc = editor.document;
		const analysis = analysisOf(doc);
		if (analysis.mnStart === undefined || analysis.mnEnd === undefined) {
			vscode.window.showWarningMessage('Die Datei hat keinen /MN-Block.');
			return;
		}
		const suggested = nextFreeLabel(analysis);
		const value = await vscode.window.showInputBox({
			prompt: 'Nummer und optional Kommentar, z. B. "10" oder "10:Warten auf Teil"',
			value: String(suggested),
			valueSelection: [String(suggested).length, String(suggested).length],
			validateInput: (v) => {
				const m = /^\s*(\d+)\s*(?::(.*))?$/.exec(v);
				if (!m || parseInt(m[1], 10) <= 0) {
					return 'Format: Nummer[:Kommentar]';
				}
				if (analysis.labels.some((l) => l.id === parseInt(m[1], 10) && l.def)) {
					return `LBL[${m[1]}] ist bereits definiert.`;
				}
				if (m[2] && m[2].includes(']')) {
					return 'Das Zeichen "]" ist im Kommentar nicht erlaubt.';
				}
				return undefined;
			}
		});
		const m = value === undefined ? null : /^\s*(\d+)\s*(?::(.*))?$/.exec(value);
		if (!m) {
			return;
		}
		const comment = m[2]?.trim();
		const text = `LBL[${parseInt(m[1], 10)}${comment ? ':' + comment : ''}] ;`;
		// nach der aktuellen Zeile einfügen, aber innerhalb des /MN-Blocks
		const cur = editor.selection.active.line;
		const after = Math.min(Math.max(cur, analysis.mnStart), analysis.mnEnd - 1);
		const insertAt = new vscode.Position(after + 1, 0);
		const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
		const ok = await editor.edit((b) => b.insert(insertAt, `  ${text}${eol}`));
		if (!ok) {
			return;
		}
		const renumber = renumberEdits(editor.document);
		if (renumber.length) {
			const edit = new vscode.WorkspaceEdit();
			edit.set(editor.document.uri, renumber);
			await vscode.workspace.applyEdit(edit);
		}
		const pos = new vscode.Position(after + 1, editor.document.lineAt(after + 1).text.length);
		editor.selection = new vscode.Selection(pos, pos);
	});

	reg('fanucLs.labels.renumberAll', async () => {
		const doc = provider.doc ?? vscode.window.activeTextEditor?.document;
		if (!doc || doc.languageId !== 'fanuc-ls') {
			return;
		}
		const analysis = analysisOf(doc);
		const pick = await vscode.window.showQuickPick(
			[
				{ label: '1, 2, 3, …', start: 1, step: 1 },
				{ label: '10, 20, 30, …', start: 10, step: 10 },
				{ label: '100, 110, 120, …', start: 100, step: 10 }
			],
			{ placeHolder: 'Alle Sprungmarken in Reihenfolge ihres Auftretens neu nummerieren' }
		);
		if (!pick) {
			return;
		}
		const changes = renumberAllChanges(analysis, pick.start, pick.step);
		if (changes.length === 0) {
			vscode.window.showInformationMessage('Die Labels sind bereits so nummeriert.');
			return;
		}
		const undefinedRefs = analysis.labels.filter((l) => !l.def && l.refs.length);
		if (undefinedRefs.length) {
			const go = await vscode.window.showWarningMessage(
				`Sprünge auf nicht definierte Labels (${undefinedRefs.map((l) => l.id).join(', ')}) bleiben unverändert und können danach auf ein anderes Label zeigen. Trotzdem neu nummerieren?`,
				{ modal: true },
				'Neu nummerieren'
			);
			if (go !== 'Neu nummerieren') {
				return;
			}
		}
		await applyChanges(doc, changes);
	});

	async function labelAtCursor(): Promise<LabelNode | undefined> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.languageId !== 'fanuc-ls') {
			return undefined;
		}
		const pos = editor.selection.active;
		const hit = labelAt(analysisOf(editor.document), pos.line, pos.character);
		if (!hit) {
			vscode.window.showInformationMessage('Cursor steht nicht auf einer Sprungmarke.');
			return undefined;
		}
		return new LabelNode(editor.document, hit.label);
	}
}
