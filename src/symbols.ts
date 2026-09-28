import * as vscode from 'vscode';
import { parse } from './parser';

export class FanucSymbolProvider implements vscode.DocumentSymbolProvider {
	provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
		const program = parse(document.getText());
		const symbols: vscode.DocumentSymbol[] = [];

		const sectionSymbol = (name: string, kind: vscode.SymbolKind): vscode.DocumentSymbol | undefined => {
			const s = program.sections.get(name);
			if (!s) {
				return undefined;
			}
			const endLine = Math.max(s.line, Math.min(s.end - 1, document.lineCount - 1));
			const range = new vscode.Range(s.line, 0, endLine, document.lineAt(endLine).text.length);
			const sym = new vscode.DocumentSymbol(
				'/' + name,
				'',
				kind,
				range,
				new vscode.Range(s.line, 0, s.line, document.lineAt(s.line).text.length)
			);
			symbols.push(sym);
			return sym;
		};

		const prog = sectionSymbol('PROG', vscode.SymbolKind.Module);
		if (prog && program.progName) {
			prog.name = program.progName;
			prog.detail = program.attrs.get('COMMENT')?.value ?? '';
		}
		sectionSymbol('ATTR', vscode.SymbolKind.Namespace);
		const mn = sectionSymbol('MN', vscode.SymbolKind.Function);
		const pos = sectionSymbol('POS', vscode.SymbolKind.Array);

		if (mn) {
			for (const tp of program.tpLines) {
				const m = /^LBL\s*\[\s*(\d+)\s*(?::\s*([^\]]*))?\]/.exec(tp.text.trim());
				if (m) {
					const range = new vscode.Range(tp.line, 0, tp.line, tp.raw.length);
					mn.children.push(
						new vscode.DocumentSymbol(
							`LBL[${m[1]}]`,
							(m[2] ?? '').trim(),
							vscode.SymbolKind.Key,
							range,
							range
						)
					);
				}
			}
		}

		if (pos) {
			for (const p of program.positions) {
				const raw = document.lineAt(p.line).text;
				const comment = /\[\s*\d+\s*:\s*([^\]]*)\]/.exec(raw);
				const range = new vscode.Range(p.line, 0, p.line, raw.length);
				pos.children.push(
					new vscode.DocumentSymbol(
						`${p.kind}[${p.id}]`,
						(comment?.[1] ?? '').replace(/"/g, '').trim(),
						vscode.SymbolKind.Variable,
						range,
						range
					)
				);
			}
		}

		return symbols;
	}
}
