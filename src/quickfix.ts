import * as vscode from 'vscode';
import { Code, DIAG_SOURCE } from './diagnostics';
import { addSemicolonEdit, fixLineCountEdit, renumberEdits } from './edits';
import { checkGroups, parsePositions } from './posData';

export class FanucCodeActionProvider implements vscode.CodeActionProvider {
	public static readonly metadata: vscode.CodeActionProviderMetadata = {
		providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
	};

	provideCodeActions(
		document: vscode.TextDocument,
		_range: vscode.Range | vscode.Selection,
		context: vscode.CodeActionContext
	): vscode.CodeAction[] {
		const actions: vscode.CodeAction[] = [];
		const seen = new Set<string>();

		for (const diag of context.diagnostics) {
			if (diag.source !== DIAG_SOURCE) {
				continue;
			}
			const code = String(diag.code);

			if (code === Code.LineSequence && !seen.has(code)) {
				seen.add(code);
				const edits = renumberEdits(document);
				if (edits.length) {
					actions.push(this.make('Zeilennummern neu nummerieren', document, edits, diag, true));
				}
			}

			if (code === Code.LineCount && !seen.has(code)) {
				seen.add(code);
				const edit = fixLineCountEdit(document);
				if (edit) {
					actions.push(this.make('LINE_COUNT korrigieren', document, [edit], diag, true));
				}
			}

			if (code === Code.GroupMissing || code === Code.GroupExtra) {
				const issue = checkGroups(parsePositions(document.getText())).find(
					(i) => i.code === code && i.line === diag.range.start.line
				);
				const g = issue?.group;
				if (g && !seen.has(code + g)) {
					seen.add(code + g);
					if (code === Code.GroupMissing) {
						actions.push(this.command(`GP${g} in allen Positionen ergänzen`, 'fanucLs.groups.addGroup', [document.uri, g], diag, true));
						actions.push(this.command(`GP${g} in DEFAULT_GROUP deaktivieren`, 'fanucLs.groups.removeGroup', [document.uri, g], diag, false));
					} else {
						actions.push(this.command(`GP${g} aus allen Positionen entfernen`, 'fanucLs.groups.removeGroup', [document.uri, g], diag, false));
						actions.push(this.command(`GP${g} in DEFAULT_GROUP aktivieren`, 'fanucLs.groups.addGroup', [document.uri, g], diag, true));
					}
				}
			}

			if (code === Code.UndefinedPosition) {
				const m = /^P\[(\d+)\]/.exec(diag.message);
				if (m && !seen.has(code + m[1])) {
					seen.add(code + m[1]);
					actions.push(
						this.command(`P[${m[1]}] im /POS-Block anlegen (zum Teachen)`, 'fanucLs.positions.create', [document.uri, parseInt(m[1], 10)], diag, true)
					);
				}
			}

			if (code === Code.MissingSemicolon) {
				const key = code + diag.range.start.line;
				if (!seen.has(key)) {
					seen.add(key);
					actions.push(
						this.make(
							'Semikolon anfügen',
							document,
							[addSemicolonEdit(document, diag.range.start.line)],
							diag,
							false
						)
					);
				}
			}
		}
		return actions;
	}

	private command(
		title: string,
		command: string,
		args: unknown[],
		diag: vscode.Diagnostic,
		preferred: boolean
	): vscode.CodeAction {
		const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
		action.command = { command, title, arguments: args };
		action.diagnostics = [diag];
		action.isPreferred = preferred;
		return action;
	}

	private make(
		title: string,
		document: vscode.TextDocument,
		edits: vscode.TextEdit[],
		diag: vscode.Diagnostic,
		preferred: boolean
	): vscode.CodeAction {
		const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
		const wsEdit = new vscode.WorkspaceEdit();
		wsEdit.set(document.uri, edits);
		action.edit = wsEdit;
		action.diagnostics = [diag];
		action.isPreferred = preferred;
		return action;
	}
}
