import * as vscode from 'vscode';
import * as path from 'path';
import { KarelSymbol, parseKarel } from './karelCore';

const SELECTOR: vscode.DocumentSelector = { language: 'fanuc-karel' };

const KINDS: Record<KarelSymbol['kind'], vscode.SymbolKind> = {
	program: vscode.SymbolKind.Module,
	routine: vscode.SymbolKind.Function,
	external: vscode.SymbolKind.Interface,
	const: vscode.SymbolKind.Constant,
	var: vscode.SymbolKind.Variable,
	type: vscode.SymbolKind.Struct
};

function toSymbol(doc: vscode.TextDocument, s: KarelSymbol): vscode.DocumentSymbol {
	const end = Math.min(s.endLine, doc.lineCount - 1);
	const range = new vscode.Range(s.line, 0, end, doc.lineAt(end).text.length);
	const selection = new vscode.Range(s.line, s.nameStart, s.line, s.nameStart + s.name.length);
	const sym = new vscode.DocumentSymbol(s.name, s.detail, KINDS[s.kind], range, selection);
	sym.children = s.children.map((c) => toSymbol(doc, c));
	return sym;
}

export function registerKarelFeatures(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.languages.registerDocumentSymbolProvider(SELECTOR, {
			provideDocumentSymbols: (doc) => parseKarel(doc.getText()).map((s) => toSymbol(doc, s))
		}),
		vscode.commands.registerCommand('fanucLs.karel.compile', async (uri?: vscode.Uri) => {
			const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
			if (!doc || doc.languageId !== 'fanuc-karel' || doc.uri.scheme !== 'file') {
				vscode.window.showWarningMessage('Bitte eine gespeicherte KAREL-Datei (.kl) öffnen.');
				return;
			}
			if (doc.isDirty) {
				await doc.save();
			}
			const cfg = vscode.workspace.getConfiguration('fanucLs', doc.uri);
			const ktrans = cfg.get<string>('karel.ktransPath', '').trim();
			if (!ktrans) {
				const action = await vscode.window.showWarningMessage(
					'Zum Kompilieren wird ktrans.exe aus ROBOGUIDE benötigt (nur Windows). Bitte den Pfad in "fanucLs.karel.ktransPath" eintragen.',
					'Einstellung öffnen'
				);
				if (action) {
					await vscode.commands.executeCommand('workbench.action.openSettings', 'fanucLs.karel');
				}
				return;
			}
			const file = doc.uri.fsPath;
			const out = file.replace(/\.kl$/i, '.pc');
			const args = cfg.get<string>('karel.ktransArgs', '').trim();
			const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
			const terminal =
				vscode.window.terminals.find((t) => t.name === 'FANUC KAREL') ??
				vscode.window.createTerminal({ name: 'FANUC KAREL', cwd: path.dirname(file) });
			terminal.show(true);
			// PowerShell braucht "&" vor einem Programmpfad in Anführungszeichen
			const prefix = process.platform === 'win32' && /\s/.test(ktrans) ? '& ' : '';
			terminal.sendText(`${prefix}${quote(ktrans)} ${quote(path.basename(file))} ${quote(path.basename(out))}${args ? ' ' + args : ''}`);
		})
	);
}
