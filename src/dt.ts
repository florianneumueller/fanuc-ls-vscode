import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
	DT_KIND_NAMES,
	DT_LIMITS,
	DtArgument,
	DtFile,
	DtProgram,
	argumentsUsedInProgram,
	checkDtFileName,
	cleanLabel,
	fixArgumentCountChange,
	fixProgramKeyChange,
	fixUnclosedChange,
	parseDt,
	programBlock
} from './dtCore';
import { parse } from './parser';
import { TextChange } from './textChange';

const DT_SELECTOR: vscode.DocumentSelector = { language: 'fanuc-dt' };
const LS_SELECTOR: vscode.DocumentSelector = { language: 'fanuc-ls' };
const SOURCE = 'fanuc-dt';

// --- Index aller ARGDISP-Dateien im Workspace -----------------------------------

export interface DtDefinition {
	program: DtProgram;
	uri: vscode.Uri;
}

export class DtIndex implements vscode.Disposable {
	private files = new Map<string, DtFile>();
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.emitter.event;

	async reload(): Promise<void> {
		const files = new Map<string, DtFile>();
		for (const uri of await vscode.workspace.findFiles('**/[Aa][Rr][Gg][Dd][Ii][Ss][Pp]*.[Dd][Tt]', '**/node_modules/**', 200)) {
			try {
				files.set(uri.toString(), parseDt(await fs.readFile(uri.fsPath, 'latin1')));
			} catch {
				/* nicht lesbar */
			}
		}
		for (const doc of vscode.workspace.textDocuments) {
			if (doc.languageId === 'fanuc-dt') {
				files.set(doc.uri.toString(), parseDt(doc.getText()));
			}
		}
		this.files = files;
		this.emitter.fire();
	}

	update(doc: vscode.TextDocument): void {
		this.files.set(doc.uri.toString(), parseDt(doc.getText()));
		this.emitter.fire();
	}

	/** Definition eines Programms; bei mehreren Dateien gewinnt die erste (sortiert nach Pfad). */
	find(name: string): DtDefinition | undefined {
		const key = name.toUpperCase();
		for (const [uri, f] of [...this.files.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
			const p = f.programs.find((x) => x.name?.toUpperCase() === key);
			if (p) {
				return { program: p, uri: vscode.Uri.parse(uri) };
			}
		}
		return undefined;
	}

	fileUris(): vscode.Uri[] {
		return [...this.files.keys()].map((u) => vscode.Uri.parse(u));
	}

	dispose(): void {
		this.emitter.dispose();
	}
}

// --- Darstellung ------------------------------------------------------------------

/** So zeigt das Teach Pendant den CALL nach dem automatischen Einlernen ($ARGDISPMODE = 1). */
export function previewCall(p: DtProgram): string {
	const highest = Math.max(0, ...p.args.map((a) => a.index), p.argumentCount ?? 0);
	const parts: string[] = [];
	for (let n = 1; n <= highest; n++) {
		const a = p.args.find((x) => x.index === n);
		if (!a) {
			parts.push('0');
		} else if (a.kind === 'N') {
			const d = a.defaultValue;
			parts.push(`${a.label}=${!d ? '0' : d === '(R)' ? 'R[...]' : d === '(AR)' ? 'AR[...]' : d}`);
		} else if (a.kind === 'S') {
			const d = a.defaultValue;
			parts.push(`${a.label}=${!d ? "'...'" : d === '(SR)' ? 'SR[...]' : d === '(AR)' ? 'AR[...]' : `'${d}'`}`);
		} else {
			parts.push(a.kind === 'W' ? `'${a.choices[0]?.label ?? ''}'` : a.choices[0]?.label ?? '');
		}
	}
	return `CALL ${p.name}(${parts.join(',')})`;
}

function argLine(a: DtArgument): string {
	if (a.kind === 'V') {
		return `| ${a.index} | V – Makro | ${a.choices.map((c) => `\`${c.label}\`=${c.value}`).join(', ')} |`;
	}
	if (a.kind === 'W') {
		return `| ${a.index} | W – String-Liste | ${a.choices.map((c) => `\`${c.label}\``).join(', ')} |`;
	}
	return `| ${a.index} | ${a.kind} – ${DT_KIND_NAMES[a.kind]} | ${a.label}${a.defaultValue ? ` (Vorgabe ${a.defaultValue})` : ''} |`;
}

export function programMarkdown(p: DtProgram, source?: vscode.Uri): vscode.MarkdownString {
	const md = new vscode.MarkdownString();
	md.appendMarkdown(`**${p.name}** – Argumente für den Wizard\n\n`);
	md.appendCodeblock(previewCall(p), 'fanuc-ls');
	if (p.args.length) {
		md.appendMarkdown('\n| AR | Typ | Bedeutung |\n|---|---|---|\n');
		md.appendMarkdown([...p.args].sort((a, b) => a.index - b.index).map(argLine).join('\n'));
	}
	if (source) {
		md.appendMarkdown(`\n\nQuelle: ${vscode.workspace.asRelativePath(source)}`);
	}
	return md;
}

const KIND_HELP: Record<string, string> = {
	N: `**N – Zahl.** \`N01 = "Bedeutung"\`, optional Vorgabewert \`:'10'\` (Ganzzahl ±2^24 oder Dezimalzahl, 6 signifikante Stellen), \`:(R)\` oder \`:(AR)\`. Am TP wählbar: Konstante, R[ ], AR[ ].`,
	S: `**S – Zeichenkette.** \`S01 = "Bedeutung"\`, optional Vorgabe \`:"Text"\`, \`:(SR)\` oder \`:(AR)\`. Am TP wählbar: String, SR[ ], AR[ ].`,
	V: `**V – Makro-Auswahl.** \`V01 = "NAME":'Wert', ...\` – im Programm wird der Name angezeigt, übergeben wird die Ganzzahl. Max. ${DT_LIMITS.maxListItems} Einträge, Namen max. ${DT_LIMITS.macroNameLength} Zeichen, keine Dezimalzahlen, Name und Wert eindeutig.`,
	W: `**W – String-Auswahl.** \`W01 = "TEXT1", "TEXT2"\` – der gewählte Text wird übergeben. Max. ${DT_LIMITS.maxListItems} Einträge, je max. ${DT_LIMITS.stringItemLength} Zeichen (im Menü ${DT_LIMITS.labelLength} sichtbar).`
};

// --- Registrierung --------------------------------------------------------------

export function registerDtFeatures(context: vscode.ExtensionContext, index: DtIndex, revalidateLs: () => void): void {
	const diagnostics = vscode.languages.createDiagnosticCollection(SOURCE);
	context.subscriptions.push(diagnostics);

	const validate = (doc: vscode.TextDocument) => {
		if (doc.languageId !== 'fanuc-dt') {
			return;
		}
		const f = parseDt(doc.getText());
		const out = f.issues.map((i) => {
			const d = new vscode.Diagnostic(
				new vscode.Range(i.line, i.start, i.line, i.end),
				i.message,
				i.severity === 'error' ? vscode.DiagnosticSeverity.Error : i.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information
			);
			d.source = SOURCE;
			d.code = i.code;
			return d;
		});
		if (doc.uri.scheme === 'file') {
			const nameIssue = checkDtFileName(path.basename(doc.uri.fsPath));
			if (nameIssue) {
				const d = new vscode.Diagnostic(new vscode.Range(0, 0, 0, Math.max(doc.lineAt(0).text.length, 1)), nameIssue, vscode.DiagnosticSeverity.Information);
				d.source = SOURCE;
				d.code = 'dt-filename';
				out.push(d);
			}
		}
		diagnostics.set(doc.uri, out);
		index.update(doc);
	};

	let timer: NodeJS.Timeout | undefined;
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument(validate),
		vscode.workspace.onDidChangeTextDocument((e) => {
			if (e.document.languageId !== 'fanuc-dt') {
				return;
			}
			if (timer) {
				clearTimeout(timer);
			}
			timer = setTimeout(() => validate(e.document), 250);
		}),
		vscode.workspace.onDidCloseTextDocument((d) => diagnostics.delete(d.uri)),
		vscode.workspace.onDidSaveTextDocument((d) => {
			if (d.languageId === 'fanuc-dt') {
				revalidateLs();
			}
		}),
		index.onDidChange(() => revalidateLs())
	);
	vscode.workspace.textDocuments.forEach(validate);

	// Quick Fixes
	context.subscriptions.push(
		vscode.languages.registerCodeActionsProvider(
			DT_SELECTOR,
			{
				provideCodeActions(doc, _range, ctx) {
					const actions: vscode.CodeAction[] = [];
					const f = parseDt(doc.getText());
					const lines = doc.getText().split(/\r?\n/);
					const eol = doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
					const programAt = (line: number) => f.programs.find((p) => line >= p.line && line <= p.endLine);
					const make = (title: string, change: TextChange | undefined, diag: vscode.Diagnostic) => {
						if (!change) {
							return;
						}
						const a = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
						a.edit = new vscode.WorkspaceEdit();
						a.edit.replace(doc.uri, new vscode.Range(change.line, change.start, change.endLine ?? change.line, change.end), change.text);
						a.diagnostics = [diag];
						a.isPreferred = true;
						actions.push(a);
					};
					for (const d of ctx.diagnostics.filter((x) => x.source === SOURCE)) {
						const line = d.range.start.line;
						if (d.code === 'dt-program-key' && /PROGRAM/.test(d.message) && /NAME/.test(d.message)) {
							make('PROGRAM durch NAME ersetzen', fixProgramKeyChange(lines, line), d);
						} else if (d.code === 'dt-arg-count') {
							const p = programAt(line);
							if (p) {
								make(`ARGUMENT auf '${Math.max(0, ...p.args.map((a) => a.index))}' setzen`, fixArgumentCountChange(p, eol), d);
							}
						} else if (d.code === 'dt-unclosed') {
							const p = f.programs.find((x) => x.line === line);
							if (p) {
								make('[ENDPROGRAM] einfügen', fixUnclosedChange(p, lines, eol), d);
							}
						}
					}
					return actions;
				}
			},
			{ providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
		)
	);

	// Outline
	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(DT_SELECTOR, {
			provideDocumentSymbols(doc) {
				return parseDt(doc.getText()).programs.map((p) => {
					const end = Math.min(p.endLine, doc.lineCount - 1);
					const range = new vscode.Range(p.line, 0, end, doc.lineAt(end).text.length);
					const sel = p.nameSpan ? new vscode.Range(p.nameSpan.line, p.nameSpan.start, p.nameSpan.line, p.nameSpan.end) : new vscode.Range(p.line, 0, p.line, 9);
					const sym = new vscode.DocumentSymbol(p.name ?? '(ohne NAME)', `${p.args.length} Argument(e)`, vscode.SymbolKind.Function, range, sel);
					sym.children = p.args.map((a) => {
						const r = new vscode.Range(a.span.line, a.span.start, a.span.line, a.span.end);
						const kind = a.kind === 'N' ? vscode.SymbolKind.Number : a.kind === 'S' ? vscode.SymbolKind.String : vscode.SymbolKind.Enum;
						return new vscode.DocumentSymbol(`${a.key}  ${a.kind === 'V' || a.kind === 'W' ? DT_KIND_NAMES[a.kind] : a.label}`, a.kind === 'V' || a.kind === 'W' ? a.label : a.defaultValue ?? '', kind, r, r);
					});
					return sym;
				});
			}
		})
	);

	// Hover in DT-Dateien: Programmvorschau und Typerklärung
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(DT_SELECTOR, {
			provideHover(doc, pos) {
				const f = parseDt(doc.getText());
				const p = f.programs.find((x) => pos.line >= x.line && pos.line <= x.endLine);
				if (!p) {
					return undefined;
				}
				const arg = p.args.find((a) => a.keySpan.line === pos.line && pos.character >= a.keySpan.start && pos.character <= a.keySpan.end);
				if (arg) {
					return new vscode.Hover(new vscode.MarkdownString(`${KIND_HELP[arg.kind]}\n\nArgument ${arg.index} = \`AR[${arg.index}]\` im aufgerufenen Programm.`));
				}
				if (pos.line === p.line || pos.line === p.nameSpan?.line || pos.line === p.argumentSpan?.line) {
					return new vscode.Hover(programMarkdown(p));
				}
				return undefined;
			}
		})
	);

	// Hover in TP-Programmen: CALL mit Wizard-Beschreibung
	context.subscriptions.push(
		vscode.languages.registerHoverProvider(LS_SELECTOR, {
			provideHover(doc, pos) {
				const line = doc.lineAt(pos.line).text;
				const re = /\b(?:CALL|RUN)\s+([A-Za-z0-9_]+)/g;
				let m: RegExpExecArray | null;
				while ((m = re.exec(line)) !== null) {
					const nameStart = m.index + m[0].length - m[1].length;
					if (pos.character >= nameStart && pos.character <= nameStart + m[1].length) {
						const def = index.find(m[1]);
						return def ? new vscode.Hover(programMarkdown(def.program, def.uri)) : undefined;
					}
				}
				return undefined;
			}
		})
	);

	// --- Befehle --------------------------------------------------------------

	context.subscriptions.push(
		vscode.commands.registerCommand('fanucLs.dt.fromProgram', async (uri?: vscode.Uri) => {
			const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
			if (!doc || doc.languageId !== 'fanuc-ls') {
				vscode.window.showWarningMessage('Bitte zuerst das TP-Programm (.ls) öffnen, für das die Argumente beschrieben werden sollen.');
				return;
			}
			const progName = (parse(doc.getText()).progName ?? path.basename(doc.uri.fsPath).replace(/\.[^.]+$/, '')).toUpperCase();
			const existing = index.find(progName);
			if (existing) {
				const go = await vscode.window.showInformationMessage(`Für ${progName} gibt es bereits einen Block in ${vscode.workspace.asRelativePath(existing.uri)}.`, 'Anzeigen');
				if (go) {
					const ed = await vscode.window.showTextDocument(existing.uri);
					const r = new vscode.Range(existing.program.line, 0, existing.program.endLine, 0);
					ed.revealRange(r, vscode.TextEditorRevealType.InCenter);
					ed.selection = new vscode.Selection(r.start, r.start);
				}
				return;
			}
			const used = argumentsUsedInProgram(doc.getText());
			if (used.size === 0) {
				const go = await vscode.window.showWarningMessage(`${progName} verwendet keine Argumentregister AR[n]. Trotzdem einen leeren Block anlegen?`, 'Anlegen');
				if (!go) {
					return;
				}
			}
			const target = await pickDtFile(doc);
			if (!target) {
				return;
			}
			const tdoc = await vscode.workspace.openTextDocument(target);
			const editor = await vscode.window.showTextDocument(tdoc);
			const eol = tdoc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
			// Snippet: Bedeutungen als Platzhalter zum Überschreiben
			const highest = Math.max(0, ...used.keys());
			const snippet = new vscode.SnippetString();
			const prefix = tdoc.getText().trim() ? eol : '';
			snippet.appendText(`${prefix}[PROGRAM]${eol}NAME = "${progName}"${eol}ARGUMENT = '${highest}'${eol}[ARGUMENT]${eol}`);
			let tab = 1;
			for (let n = 1; n <= highest; n++) {
				const key = `N${String(n).padStart(2, '0')}`;
				snippet.appendText(`${key} = "`);
				snippet.appendPlaceholder(cleanLabel(used.has(n) ? `AR${n}` : `FREI${n}`), tab++);
				snippet.appendText(`"${eol}`);
			}
			snippet.appendText(`[ENDPROGRAM]${eol}`);
			const endPos = tdoc.lineAt(tdoc.lineCount - 1).range.end;
			await editor.insertSnippet(snippet, endPos);
			const hint = [...used.entries()].map(([n, s]) => `AR[${n}]: ${s}`).join(' · ');
			vscode.window.showInformationMessage(
				`Block für ${progName} angelegt. Bitte die Bedeutungen eintragen (max. ${DT_LIMITS.labelLength} Zeichen) und bei Bedarf N durch V/S/W ersetzen. ${hint}`.slice(0, 600)
			);
		}),

		vscode.commands.registerCommand('fanucLs.dt.newFile', async () => {
			const folder = vscode.workspace.workspaceFolders?.[0];
			const lang = await vscode.window.showQuickPick(
				[
					{ label: 'EG', description: 'Englisch' },
					{ label: 'GR', description: 'Deutsch' },
					{ label: 'KN', description: 'Japanisch (Kanji)' },
					{ label: 'FR', description: 'Französisch' },
					{ label: 'SP', description: 'Spanisch' },
					{ label: 'CH', description: 'Chinesisch' },
					{ label: 'TW', description: 'Taiwanesisch' },
					{ label: 'CS', description: 'Tschechisch' },
					{ label: 'OT', description: 'Andere' }
				],
				{ placeHolder: 'Sprache der Steuerung - die Datei wird nur in dieser Sprache gelesen' }
			);
			if (!lang) {
				return;
			}
			const nr = await vscode.window.showInputBox({ prompt: 'Seriennummer (01-99)', value: '01', validateInput: (v) => (/^(0[1-9]|[1-9]\d)$/.test(v) ? undefined : '01 bis 99') });
			if (!nr) {
				return;
			}
			const name = `ARGDISP${lang.label}${nr}.DT`;
			const content = programBlock('PROGRAMM', [{ index: 1, kind: 'N', label: 'Bedeutung' }], '\r\n', 'Beispiel');
			if (folder) {
				const file = vscode.Uri.joinPath(folder.uri, name);
				try {
					await fs.access(file.fsPath);
					vscode.window.showWarningMessage(`${name} existiert bereits.`);
					await vscode.window.showTextDocument(file);
					return;
				} catch {
					await fs.writeFile(file.fsPath, content, 'latin1');
				}
				await vscode.window.showTextDocument(file);
			} else {
				const d = await vscode.workspace.openTextDocument({ language: 'fanuc-dt', content });
				await vscode.window.showTextDocument(d);
			}
			await index.reload();
		})
	);

	async function pickDtFile(lsDoc: vscode.TextDocument): Promise<vscode.Uri | undefined> {
		const files = index.fileUris().filter((u) => u.scheme === 'file');
		const items: (vscode.QuickPickItem & { uri?: vscode.Uri })[] = files.map((u) => ({
			label: path.basename(u.fsPath),
			description: vscode.workspace.asRelativePath(u),
			uri: u
		}));
		items.push({ label: '$(new-file) Neue Datei ARGDISPEG01.DT …', description: 'im Ordner des Programms' });
		const picked = items.length === 1 ? items[0] : await vscode.window.showQuickPick(items, { placeHolder: 'In welche ARGDISP-Datei soll der Block?' });
		if (!picked) {
			return undefined;
		}
		if (picked.uri) {
			return picked.uri;
		}
		const dir = lsDoc.uri.scheme === 'file' ? path.dirname(lsDoc.uri.fsPath) : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!dir) {
			vscode.window.showWarningMessage('Bitte zuerst einen Ordner öffnen.');
			return undefined;
		}
		let n = 1;
		let file = path.join(dir, 'ARGDISPEG01.DT');
		for (;;) {
			try {
				await fs.access(file);
				n++;
				file = path.join(dir, `ARGDISPEG${String(n).padStart(2, '0')}.DT`);
			} catch {
				break;
			}
		}
		await fs.writeFile(file, '', 'latin1');
		return vscode.Uri.file(file);
	}
}
