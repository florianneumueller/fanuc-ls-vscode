import * as vscode from 'vscode';
import { parse } from './parser';

const NUM_WIDTH = 4;
const MOTION_RE = /^(J|L|C|A|S)\s+(P|PR)\s*\[/;

/** Bewegungsbefehle stehen direkt hinter dem Doppelpunkt, alles andere mit zwei Leerzeichen Abstand. */
export function isMotionInstruction(body: string): boolean {
	return MOTION_RE.test(body.trim());
}

function numberPrefix(n: number, body: string): string {
	return String(n).padStart(NUM_WIDTH, ' ') + ':' + (isMotionInstruction(body) ? '' : '  ');
}

export interface RenumberOptions {
	/** Index einer leeren Zeile, die eine neue Nummer bekommen soll (Eingabe von Enter). */
	numberBlankLine?: number;
	/** Abstand hinter dem Doppelpunkt auf das FANUC-Format vereinheitlichen. */
	normalizeSpacing?: boolean;
	/** LINE_COUNT im /ATTR-Block mitziehen. */
	updateLineCount?: boolean;
}

/**
 * Nummeriert den /MN-Block lückenlos durch.
 *
 * - vorhandene Nummern werden korrigiert
 * - Zeilen ohne Nummer (z. B. aus mehrzeiligen Snippets) bekommen eine
 * - Fortsetzungszeilen einer noch nicht mit ";" abgeschlossenen Anweisung
 *   bleiben unnummeriert, wie es die Steuerung bei Kreisbewegungen erwartet
 */
export function renumberEdits(doc: vscode.TextDocument, options: RenumberOptions = {}): vscode.TextEdit[] {
	const { numberBlankLine, normalizeSpacing = false, updateLineCount = true } = options;
	const program = parse(doc.getText());
	const mn = program.sections.get('MN');
	if (!mn) {
		return [];
	}

	const edits: vscode.TextEdit[] = [];
	let n = 0;
	let open = false; // vorherige Anweisung ohne abschließendes ";"

	for (let i = mn.start; i < Math.min(mn.end, doc.lineCount); i++) {
		const raw = program.lines[i] ?? '';

		if (raw.trim() === '') {
			if (i === numberBlankLine) {
				n++;
				edits.push(vscode.TextEdit.replace(new vscode.Range(i, 0, i, raw.length), numberPrefix(n, '')));
				open = false;
			}
			continue;
		}

		const m = /^([ \t]*)(\d+)(:)([ \t]*)/.exec(raw);
		if (m) {
			n++;
			const body = raw.slice(m[0].length);
			const spacing = normalizeSpacing ? (isMotionInstruction(body) ? '' : '  ') : m[4];
			const want = String(n).padStart(NUM_WIDTH, ' ') + ':' + spacing;
			if (want !== m[0]) {
				edits.push(vscode.TextEdit.replace(new vscode.Range(i, 0, i, m[0].length), want));
			}
		} else if (open) {
			// Fortsetzungszeile einer Kreisbewegung o. ä. - bleibt ohne Nummer
			open = !isTerminated(raw);
			continue;
		} else {
			n++;
			const lead = /^[ \t]*/.exec(raw)![0];
			const body = raw.slice(lead.length);
			edits.push(vscode.TextEdit.replace(new vscode.Range(i, 0, i, lead.length), numberPrefix(n, body)));
		}
		open = !isTerminated(raw);
	}

	if (updateLineCount) {
		const attr = program.attrs.get('LINE_COUNT');
		if (attr && attr.value.trim() !== String(n)) {
			edits.push(
				vscode.TextEdit.replace(
					new vscode.Range(attr.line, attr.valueStart, attr.line, attr.valueEnd),
					String(n)
				)
			);
		}
	}

	return edits;
}

function isTerminated(raw: string): boolean {
	return /;\s*$/.test(raw);
}

/** Setzt LINE_COUNT im /ATTR-Block auf die tatsächliche Zeilenzahl. */
export function fixLineCountEdit(doc: vscode.TextDocument): vscode.TextEdit | undefined {
	const program = parse(doc.getText());
	const attr = program.attrs.get('LINE_COUNT');
	if (!attr) {
		return undefined;
	}
	const actual = String(program.tpLines.length);
	if (attr.value.trim() === actual) {
		return undefined;
	}
	return vscode.TextEdit.replace(new vscode.Range(attr.line, attr.valueStart, attr.line, attr.valueEnd), actual);
}

/** Hängt ein fehlendes Semikolon an. */
export function addSemicolonEdit(doc: vscode.TextDocument, line: number): vscode.TextEdit {
	const text = doc.lineAt(line).text;
	return vscode.TextEdit.insert(new vscode.Position(line, text.replace(/\s+$/, '').length), ' ;');
}

/** Aktualisiert das MODIFIED-Datum im /ATTR-Block. */
export function touchModifiedEdit(doc: vscode.TextDocument): vscode.TextEdit | undefined {
	const program = parse(doc.getText());
	const attr = program.attrs.get('MODIFIED');
	if (!attr) {
		return undefined;
	}
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, '0');
	const value = `DATE ${p(d.getFullYear() % 100)}-${p(d.getMonth() + 1)}-${p(d.getDate())}  TIME ${p(
		d.getHours()
	)}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
	return vscode.TextEdit.replace(new vscode.Range(attr.line, attr.valueStart, attr.line, attr.valueEnd), value);
}
