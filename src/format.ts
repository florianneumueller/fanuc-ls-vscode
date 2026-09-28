import * as vscode from 'vscode';
import { parse } from './parser';
import { renumberEdits } from './edits';

/**
 * Ergänzt die Zeilennummer, sobald im /MN-Block eine neue Zeile begonnen wird.
 * Greift über `editor.formatOnType`, ist also Teil des normalen Undo-Schritts.
 */
export class FanucOnTypeFormatter implements vscode.OnTypeFormattingEditProvider {
	provideOnTypeFormattingEdits(
		document: vscode.TextDocument,
		position: vscode.Position,
		ch: string
	): vscode.TextEdit[] {
		const cfg = vscode.workspace.getConfiguration('fanucLs', document.uri);
		if (ch !== '\n' || !cfg.get<boolean>('format.autoNumber', true)) {
			return [];
		}

		const program = parse(document.getText());
		const mn = program.sections.get('MN');
		if (!mn || position.line < mn.start || position.line >= mn.end) {
			return [];
		}
		// Nur auf einer frisch entstandenen, leeren Zeile eingreifen.
		if (document.lineAt(position.line).text.trim() !== '') {
			return [];
		}
		// Steht die vorherige Anweisung noch offen (Kreisbewegung), gehört hierher
		// eine Fortsetzungszeile ohne Nummer.
		for (let i = position.line - 1; i >= mn.start; i--) {
			const prev = document.lineAt(i).text;
			if (prev.trim() === '') {
				continue;
			}
			if (!/;\s*$/.test(prev)) {
				return [];
			}
			break;
		}

		return renumberEdits(document, {
			numberBlankLine: position.line,
			normalizeSpacing: cfg.get<boolean>('format.normalizeSpacing', false)
		});
	}
}

/** "Dokument formatieren" nummeriert den /MN-Block durch und zieht LINE_COUNT nach. */
export class FanucDocumentFormatter implements vscode.DocumentFormattingEditProvider {
	provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
		const cfg = vscode.workspace.getConfiguration('fanucLs', document.uri);
		return renumberEdits(document, {
			normalizeSpacing: cfg.get<boolean>('format.normalizeSpacing', false)
		});
	}
}
