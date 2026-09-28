import * as vscode from 'vscode';
import { TextChange } from './textChange';
import {
	activeGroups,
	addExtAxisChanges,
	addGroupChanges,
	extAxesOf,
	groupTemplate,
	newPositionChanges,
	nextExtAxisName,
	nonZeroExtAxis,
	parsePositions,
	removeExtAxisChanges,
	removeGroupChanges
} from './posData';

/** Befehle für Bewegungsgruppen, externe Achsen und neue Positionen (#4, #5). */
export function registerGroupCommands(context: vscode.ExtensionContext): void {
	const reg = (id: string, fn: (...args: any[]) => any) =>
		context.subscriptions.push(vscode.commands.registerCommand(id, fn));

	reg('fanucLs.groups.addExtAxis', async (uri?: vscode.Uri, groupArg?: number) => {
		const doc = await targetDoc(uri);
		if (!doc) {
			return;
		}
		const data = parsePositions(doc.getText());
		const group = groupArg ?? (await pickGroup(data.defaultGroup?.mask, 'Externe Achse zu welcher Gruppe hinzufügen?'));
		if (!group) {
			return;
		}
		const name = nextExtAxisName(data, group);
		if (name === 'E4') {
			vscode.window.showWarningMessage(`GP${group} hat bereits drei externe Achsen (E1–E3).`);
			return;
		}
		const unit = await vscode.window.showQuickPick(
			[
				{ label: 'mm', description: 'Linearachse (z. B. Fahrschiene)', value: 'mm' as const },
				{ label: 'deg', description: 'Drehachse (z. B. Drehtisch)', value: 'deg' as const }
			],
			{ placeHolder: `${name} in GP${group}: Einheit` }
		);
		if (!unit) {
			return;
		}
		const changes = addExtAxisChanges(data, group, name, unit.value, 0, eolOf(doc));
		if (changes.length === 0) {
			vscode.window.showInformationMessage(`Keine Position mit GP${group} gefunden.`);
			return;
		}
		if (await apply(doc, changes)) {
			vscode.window.showInformationMessage(
				`${name} (${unit.value}) in ${changes.length} Position(en) von GP${group} ergänzt, Wert 0 - bitte teachen.`
			);
		}
	});

	reg('fanucLs.groups.removeExtAxis', async (uri?: vscode.Uri) => {
		const doc = await targetDoc(uri);
		if (!doc) {
			return;
		}
		const data = parsePositions(doc.getText());
		const options = activeGroups(data.defaultGroup?.mask ?? [true]).flatMap((g) =>
			extAxesOf(data, g).map((a) => ({ label: `GP${g}: ${a.name}`, description: a.unit, group: g, name: a.name }))
		);
		if (options.length === 0) {
			vscode.window.showInformationMessage('Das Programm hat keine externen Achsen.');
			return;
		}
		const picked = await vscode.window.showQuickPick(options, { placeHolder: 'Welche externe Achse entfernen?' });
		if (!picked) {
			return;
		}
		const nonZero = nonZeroExtAxis(data, picked.group, picked.name);
		if (nonZero.length) {
			const go = await vscode.window.showWarningMessage(
				`${picked.name} hat in ${nonZero.map((id) => `P[${id}]`).join(', ')} Werte ungleich 0. Diese gehen verloren. Trotzdem entfernen?`,
				{ modal: true },
				'Entfernen'
			);
			if (go !== 'Entfernen') {
				return;
			}
		}
		await apply(doc, removeExtAxisChanges(data, picked.group, picked.name));
	});

	reg('fanucLs.groups.addGroup', async (uri?: vscode.Uri, groupArg?: number) => {
		const doc = await targetDoc(uri);
		if (!doc) {
			return;
		}
		const data = parsePositions(doc.getText());
		if (!data.defaultGroup) {
			vscode.window.showWarningMessage('Im /ATTR-Block fehlt DEFAULT_GROUP.');
			return;
		}
		let group = groupArg;
		if (!group) {
			const free = data.defaultGroup.mask.map((m, i) => (m ? 0 : i + 1)).filter((g) => g > 1);
			const picked = await vscode.window.showQuickPick(
				free.map((g) => ({ label: `GP${g}`, value: g })),
				{ placeHolder: 'Welche Bewegungsgruppe hinzufügen?' }
			);
			group = picked?.value;
		}
		if (!group) {
			return;
		}
		let spec: { axes: number; unit: 'mm' | 'deg' } | undefined;
		if (!groupTemplate(data, group)) {
			const count = await vscode.window.showInputBox({
				prompt: `Anzahl Achsen von GP${group} (z. B. 2 für einen Dreh-Kipp-Tisch)`,
				value: '2',
				validateInput: (v) => (/^[1-9]$/.test(v) ? undefined : 'Zahl von 1 bis 9')
			});
			if (!count) {
				return;
			}
			const unit = await vscode.window.showQuickPick(
				[
					{ label: 'deg', description: 'Drehachsen', value: 'deg' as const },
					{ label: 'mm', description: 'Linearachsen', value: 'mm' as const }
				],
				{ placeHolder: `Einheit der Achsen von GP${group}` }
			);
			if (!unit) {
				return;
			}
			spec = { axes: parseInt(count, 10), unit: unit.value };
		}
		const changes = addGroupChanges(data, group, spec, eolOf(doc));
		if (await apply(doc, changes)) {
			vscode.window.showInformationMessage(
				`GP${group} ist in DEFAULT_GROUP aktiv und in allen Positionen ergänzt (Werte 0 - bitte teachen).`
			);
		}
	});

	reg('fanucLs.groups.removeGroup', async (uri?: vscode.Uri, groupArg?: number) => {
		const doc = await targetDoc(uri);
		if (!doc) {
			return;
		}
		const data = parsePositions(doc.getText());
		let group = groupArg;
		if (!group) {
			const present = new Set<number>(activeGroups(data.defaultGroup?.mask ?? []));
			data.blocks.forEach((b) => b.groups.forEach((g) => present.add(g.group)));
			const picked = await vscode.window.showQuickPick(
				[...present].sort().map((g) => ({ label: `GP${g}`, value: g })),
				{ placeHolder: 'Welche Bewegungsgruppe entfernen?' }
			);
			group = picked?.value;
		}
		if (!group) {
			return;
		}
		const affected = data.blocks.filter((b) => b.groups.some((g) => g.group === group)).length;
		const go = await vscode.window.showWarningMessage(
			`GP${group} in DEFAULT_GROUP deaktivieren und aus ${affected} Position(en) entfernen? Die Positionsdaten der Gruppe gehen verloren.`,
			{ modal: true },
			'Entfernen'
		);
		if (go !== 'Entfernen') {
			return;
		}
		await apply(doc, removeGroupChanges(data, group));
	});

	reg('fanucLs.positions.create', async (uri?: vscode.Uri, idArg?: number) => {
		const doc = await targetDoc(uri);
		if (!doc) {
			return;
		}
		const data = parsePositions(doc.getText());
		if (!data.pos) {
			vscode.window.showWarningMessage('Die Datei hat keinen /POS-Block.');
			return;
		}
		let id = idArg;
		if (!id) {
			const used = new Set(data.blocks.filter((b) => b.kind === 'P').map((b) => b.id));
			let next = 1;
			while (used.has(next)) {
				next++;
			}
			const v = await vscode.window.showInputBox({
				prompt: 'Nummer der neuen Position',
				value: String(next),
				validateInput: (s) =>
					!/^\d+$/.test(s) || parseInt(s, 10) < 1
						? 'Positive Ganzzahl'
						: used.has(parseInt(s, 10))
						? `P[${s}] existiert bereits.`
						: undefined
			});
			id = v ? parseInt(v, 10) : undefined;
		}
		if (!id) {
			return;
		}
		const changes = newPositionChanges(data, id, 'TEACH', eolOf(doc));
		if (changes.length && (await apply(doc, changes))) {
			const created = parsePositions(doc.getText()).blocks.find((b) => b.kind === 'P' && b.id === id);
			const editor = vscode.window.visibleTextEditors.find((e) => e.document === doc);
			if (created && editor) {
				editor.revealRange(new vscode.Range(created.line, 0, created.closeLine, 0));
			}
		}
	});
}

async function targetDoc(uri?: vscode.Uri): Promise<vscode.TextDocument | undefined> {
	const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
	if (!doc || doc.languageId !== 'fanuc-ls') {
		vscode.window.showWarningMessage('Bitte zuerst eine FANUC-TP-Datei (.ls) öffnen.');
		return undefined;
	}
	return doc;
}

async function pickGroup(mask: boolean[] | undefined, placeHolder: string): Promise<number | undefined> {
	const groups = activeGroups(mask ?? [true]);
	if (groups.length === 1) {
		return groups[0];
	}
	const picked = await vscode.window.showQuickPick(
		groups.map((g) => ({ label: `GP${g}`, value: g })),
		{ placeHolder }
	);
	return picked?.value;
}

function eolOf(doc: vscode.TextDocument): string {
	return doc.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
}

async function apply(doc: vscode.TextDocument, changes: TextChange[]): Promise<boolean> {
	if (changes.length === 0) {
		return false;
	}
	const edit = new vscode.WorkspaceEdit();
	edit.set(
		doc.uri,
		changes.map((c) => vscode.TextEdit.replace(new vscode.Range(c.line, c.start, c.endLine ?? c.line, c.end), c.text))
	);
	return vscode.workspace.applyEdit(edit);
}
