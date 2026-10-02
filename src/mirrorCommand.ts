import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { MirrorOptions, MirrorReport, mirrorChanges, mirrorGroups, renameProgramChanges } from './mirror';
import { isValidProgramName, parse } from './parser';
import { parsePositions } from './posData';
import { TextChange, applyChanges } from './textChange';

let output: vscode.OutputChannel | undefined;

/** Befehl "Bewegungsgruppe spiegeln": eine Gruppe isoliert spiegeln, alle anderen bleiben unverändert. */
export function registerMirrorCommand(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('fanucLs.mirrorGroup', async (uri?: vscode.Uri) => {
			const doc = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
			if (!doc || doc.languageId !== 'fanuc-ls') {
				vscode.window.showWarningMessage('Bitte zuerst eine FANUC-TP-Datei (.ls) öffnen.');
				return;
			}
			const text = doc.getText();
			const groups = mirrorGroups(parsePositions(text));
			if (groups.length === 0) {
				vscode.window.showInformationMessage('Das Programm enthält keine Positionen im /POS-Block.');
				return;
			}

			// 1. Gruppe
			const g = (
				await vscode.window.showQuickPick(
					groups.map((x) => ({
						label: `GP${x.group}`,
						description:
							(x.kind === 'cartesian' ? 'kartesisch' : x.kind === 'joint' ? 'Achswerte' : 'gemischt') +
							` · ${x.axes.map((a) => a.name).join(', ')}` +
							(x.extAxes.length ? ` · ext. ${x.extAxes.map((a) => a.name).join(', ')}` : ''),
						detail: `${x.positions} Position(en)`,
						info: x
					})),
					{ placeHolder: 'Welche Bewegungsgruppe soll gespiegelt werden? Alle anderen Gruppen bleiben unverändert.' }
				)
			)?.info;
			if (!g) {
				return;
			}

			const opts: MirrorOptions = { group: g.group };

			// 2a. kartesisch: Ebene und Versatz
			if (g.kind !== 'joint') {
				const plane = await vscode.window.showQuickPick(
					[
						{ label: 'XZ-Ebene', description: 'Y wird gespiegelt (W, R werden angepasst)', value: 'XZ' as const },
						{ label: 'YZ-Ebene', description: 'X wird gespiegelt (P, R werden angepasst)', value: 'YZ' as const }
					],
					{ placeHolder: `GP${g.group}: Spiegelebene im Benutzerkoordinatensystem (UF) der Positionen` }
				);
				if (!plane) {
					return;
				}
				const axisName = plane.value === 'XZ' ? 'Y' : 'X';
				const off = await vscode.window.showInputBox({
					prompt: `Lage der Ebene: ${axisName} = … mm (0 = Ebene durch den Ursprung des UF)`,
					value: '0',
					validateInput: (v) => (isFinite(Number(v.replace(',', '.'))) && v.trim() !== '' ? undefined : 'Zahl eingeben')
				});
				if (off === undefined) {
					return;
				}
				opts.plane = plane.value;
				opts.offset = Number(off.replace(',', '.'));
			}

			// 2b. Achswerte (bzw. externe Achsen): Auswahl und Mittelwerte
			const candidates = [...(g.kind !== 'cartesian' ? g.axes.filter((a) => /^J\d+$/.test(a.name)) : []), ...g.extAxes];
			if (candidates.length) {
				const required = g.kind === 'joint';
				const picked = await vscode.window.showQuickPick(
					candidates.map((a) => ({ label: a.name, description: a.unit, picked: required && a.name === 'J1' })),
					{
						canPickMany: true,
						placeHolder: required
							? `GP${g.group}: Welche Achsen spiegeln (Wert wird um einen Mittelwert gespiegelt)?`
							: `GP${g.group}: Externe Achsen zusätzlich spiegeln? (leer lassen = unverändert)`
					}
				);
				if (!picked) {
					return;
				}
				if (required && picked.length === 0) {
					vscode.window.showWarningMessage('Keine Achse gewählt - nichts zu spiegeln.');
					return;
				}
				if (picked.length) {
					const centers = await vscode.window.showInputBox({
						prompt: 'Mittelwerte, um die gespiegelt wird (neuer Wert = 2 × Mitte − alter Wert)',
						value: picked.map((p) => `${p.label}=0`).join(', '),
						validateInput: (v) => (parseCenters(v, picked.map((p) => p.label)) ? undefined : 'Format: J1=0, E1=500')
					});
					if (centers === undefined) {
						return;
					}
					opts.axes = parseCenters(centers, picked.map((p) => p.label))!;
				}
			}

			// 3. Ziel
			const progName = parse(text).progName ?? path.basename(doc.uri.fsPath).replace(/\.[^.]+$/, '');
			const target = await vscode.window.showQuickPick(
				[
					{ label: '$(new-file) Als neues Programm speichern', description: `${progName}_M`, value: 'copy' },
					{ label: '$(edit) In dieser Datei spiegeln', description: 'rückgängig mit Strg+Z', value: 'inplace' }
				],
				{ placeHolder: 'Wohin soll das Ergebnis?' }
			);
			if (!target) {
				return;
			}

			if (mirrorChanges(text, opts).report.mirrored.length === 0) {
				vscode.window.showWarningMessage(`In GP${g.group} wurde keine Position gespiegelt.`);
				showReport(doc, opts, mirrorChanges(text, opts).report);
				return;
			}

			if (target.value === 'inplace') {
				const report = await mirrorInPlace(doc, opts);
				summarize(doc, opts, report, doc.uri);
				return;
			}

			const newName = await vscode.window.showInputBox({
				prompt: 'Name des gespiegelten Programms',
				value: `${progName}_M`.slice(0, 36),
				validateInput: (v) => (isValidProgramName(v) && v.length <= 36 ? undefined : 'Nur Buchstaben, Ziffern, Unterstrich (max. 36)')
			});
			if (!newName) {
				return;
			}
			const file = copyPathFor(doc, newName);
			if (file && (await exists(file))) {
				const go = await vscode.window.showWarningMessage(`${path.basename(file)} existiert bereits. Überschreiben?`, { modal: true }, 'Überschreiben');
				if (go !== 'Überschreiben') {
					return;
				}
			}
			const result = await writeMirroredCopy(doc, opts, newName);
			await vscode.window.showTextDocument(result.uri, { preview: false });
			summarize(doc, opts, result.report, result.uri);
		})
	);
}

/** Zielpfad der gespiegelten Kopie neben dem Original (undefined bei ungespeicherten Dateien). */
export function copyPathFor(doc: vscode.TextDocument, newName: string): string | undefined {
	if (doc.uri.scheme !== 'file') {
		return undefined;
	}
	const ext = path.extname(doc.uri.fsPath) || '.LS';
	return path.join(path.dirname(doc.uri.fsPath), newName.toUpperCase() + ext);
}

/** Spiegelt die Gruppe direkt im Dokument (rückgängig mit Strg+Z). */
export async function mirrorInPlace(doc: vscode.TextDocument, opts: MirrorOptions): Promise<MirrorReport> {
	const { changes, report } = mirrorChanges(doc.getText(), opts);
	await applyToDocument(doc, changes);
	return report;
}

/** Schreibt eine gespiegelte Kopie mit neuem Programmnamen (überschreibt eine vorhandene Datei). */
export async function writeMirroredCopy(
	doc: vscode.TextDocument,
	opts: MirrorOptions,
	newName: string
): Promise<{ uri: vscode.Uri; report: MirrorReport }> {
	const text = doc.getText();
	const upper = newName.toUpperCase();
	const { changes, report } = mirrorChanges(text, opts);
	const mirroredText = applyChanges(text, [...changes, ...renameProgramChanges(text, upper, ' gesp.')]);
	const file = copyPathFor(doc, upper);
	if (file) {
		await fs.writeFile(file, mirroredText, 'utf8');
		return { uri: vscode.Uri.file(file), report };
	}
	return { uri: (await vscode.workspace.openTextDocument({ language: 'fanuc-ls', content: mirroredText })).uri, report };
}

function parseCenters(v: string, names: string[]): Record<string, number> | undefined {
	const out: Record<string, number> = {};
	for (const part of v.split(/[,;]\s*/).filter((p) => p.trim())) {
		const m = /^\s*([A-Za-z]+\d*)\s*=\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(part);
		if (!m || !names.includes(m[1].toUpperCase())) {
			return undefined;
		}
		out[m[1].toUpperCase()] = Number(m[2].replace(',', '.'));
	}
	return names.every((n) => n in out) ? out : undefined;
}

async function applyToDocument(doc: vscode.TextDocument, changes: TextChange[]): Promise<void> {
	const edit = new vscode.WorkspaceEdit();
	edit.set(
		doc.uri,
		changes.map((c) => vscode.TextEdit.replace(new vscode.Range(c.line, c.start, c.endLine ?? c.line, c.end), c.text))
	);
	await vscode.workspace.applyEdit(edit);
}

async function exists(file: string): Promise<boolean> {
	try {
		await fs.access(file);
		return true;
	} catch {
		return false;
	}
}

export function describe(opts: MirrorOptions): string {
	const parts: string[] = [];
	if (opts.plane) {
		parts.push(`${opts.plane}-Ebene bei ${opts.plane === 'XZ' ? 'Y' : 'X'} = ${opts.offset ?? 0} mm`);
	}
	if (opts.axes) {
		parts.push(Object.entries(opts.axes).map(([k, v]) => `${k} um ${v}`).join(', '));
	}
	return `GP${opts.group}: ${parts.join('; ')}`;
}

/** Bericht in verständlichen Sätzen (für Ausgabekanal und Assistent). */
export function reportLines(opts: MirrorOptions, r: MirrorReport): string[] {
	const ids = (a: number[]) => a.map((i) => `P[${i}]`).join(', ');
	const out: string[] = [describe(opts), `Gespiegelt: ${ids(r.mirrored) || 'keine'}`, 'Andere Bewegungsgruppen: unverändert.'];
	if (r.userFrames.length > 1) {
		out.push(`ACHTUNG: Positionen in verschiedenen Benutzerkoordinatensystemen (UF ${r.userFrames.join(', ')}) – die Ebene liegt jeweils im UF der Position.`);
	} else if (r.userFrames.length === 1) {
		out.push(`Spiegelebene liegt in UF ${r.userFrames[0]}.`);
	}
	if (r.incremental.length) {
		out.push(`Inkrementelle Positionen (INC) ohne Versatz gespiegelt: ${ids(r.incremental)}`);
	}
	if (r.withoutGroup.length) {
		out.push(`Ohne Daten für GP${opts.group}: ${ids(r.withoutGroup)}`);
	}
	if (r.jointSkipped.length) {
		out.push(`In Achswerten gespeichert, NICHT gespiegelt (Ebene gilt nur für kartesische Werte): ${ids(r.jointSkipped)}`);
	}
	if (r.cartesianSkipped.length) {
		out.push(`Kartesisch gespeichert, NICHT gespiegelt: ${ids(r.cartesianSkipped)}`);
	}
	if (opts.plane) {
		out.push('CONFIG (Handgelenk/Ellbogen/Umdrehungen) wurde nicht verändert – am Roboter prüfen.');
	}
	out.push(...r.notes);
	out.push('Alle gespiegelten Positionen vor dem Einsatz in T1 mit reduziertem Override prüfen.');
	return out;
}

function showReport(doc: vscode.TextDocument, opts: MirrorOptions, r: MirrorReport, result?: vscode.Uri): void {
	if (!output) {
		output = vscode.window.createOutputChannel('FANUC Spiegeln');
	}
	output.appendLine(`=== ${path.basename(doc.uri.fsPath)} → ${result ? path.basename(result.fsPath) : '-'}  (${new Date().toLocaleString()})`);
	reportLines(opts, r).forEach((l) => output!.appendLine(l));
	output.appendLine('');
}

/** Anzahl der Hinweise, die von Hand geprüft werden sollten. */
export function warningCount(r: MirrorReport): number {
	return r.jointSkipped.length + r.cartesianSkipped.length + r.notes.length + (r.userFrames.length > 1 ? 1 : 0);
}

function summarize(doc: vscode.TextDocument, opts: MirrorOptions, r: MirrorReport, result: vscode.Uri): void {
	showReport(doc, opts, r, result);
	const warn = warningCount(r);
	const msg =
		`${describe(opts)} – ${r.mirrored.length} Position(en) gespiegelt, andere Gruppen unverändert.` +
		(warn ? ` ${warn} Hinweis(e) zur Prüfung.` : '');
	void vscode.window.showInformationMessage(msg, 'Bericht anzeigen').then((a) => {
		if (a) {
			output?.show(true);
		}
	});
}
