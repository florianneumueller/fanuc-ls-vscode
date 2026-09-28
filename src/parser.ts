/**
 * Minimaler, fehlertoleranter Parser für FANUC-TP-Listings (.ls).
 *
 * Aufbau einer LS-Datei:
 *   /PROG  NAME
 *   /ATTR      Schlüssel = Wert;
 *   /APPL      applikationsspezifische Daten (Arc Tool, ...)
 *   /MN        nummerierte TP-Zeilen
 *   /POS       Positionsdatensätze
 *   /END
 */

export interface AttrEntry {
	key: string;
	value: string;
	line: number;
	valueStart: number;
	valueEnd: number;
}

export interface TpLine {
	/** Im Listing eingetragene Zeilennummer */
	num: number;
	/** Nullbasierter Index im Dokument */
	line: number;
	/** Kompletter Rohtext der Dokumentzeile */
	raw: string;
	/** Anweisungstext ohne Nummer und ohne abschließendes Semikolon */
	text: string;
	/** Spalte, an der `text` in `raw` beginnt */
	col: number;
	/** Zeile endet mit ';' */
	terminated: boolean;
	/** Fortsetzungszeilen (z. B. zweiter Punkt einer Kreisbewegung) */
	continuation: string[];
}

export interface PositionDef {
	kind: 'P' | 'PR';
	id: number;
	line: number;
	col: number;
	length: number;
}

export interface Section {
	name: string;
	line: number;
	/** erste Zeile nach dem Header */
	start: number;
	/** exklusives Ende */
	end: number;
}

export interface ParsedProgram {
	progName?: string;
	progNameLine: number;
	progNameCol: number;
	progNameLength: number;
	sections: Map<string, Section>;
	attrs: Map<string, AttrEntry>;
	tpLines: TpLine[];
	positions: PositionDef[];
	lines: string[];
}

const SECTION_RE = /^\s*\/([A-Z_]+)\b/;
const TP_LINE_RE = /^(\s*)(\d+)(:)(.*)$/;
const ATTR_RE = /^\s*([A-Z_]+)\s*=\s*([^;]*);?/;
const POS_DEF_RE = /^\s*(PR|P)\s*\[\s*(\d+)\s*(?::[^\]]*)?\]\s*\{/;

export function parse(text: string): ParsedProgram {
	const lines = text.split(/\r?\n/);
	const sections = new Map<string, Section>();
	const attrs = new Map<string, AttrEntry>();
	const tpLines: TpLine[] = [];
	const positions: PositionDef[] = [];

	const result: ParsedProgram = {
		progNameLine: -1,
		progNameCol: 0,
		progNameLength: 0,
		sections,
		attrs,
		tpLines,
		positions,
		lines
	};

	// --- Sektionsgrenzen bestimmen ------------------------------------------
	const headers: { name: string; line: number }[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = SECTION_RE.exec(lines[i]);
		if (m) {
			headers.push({ name: m[1], line: i });
		}
	}
	for (let h = 0; h < headers.length; h++) {
		const { name, line } = headers[h];
		const end = h + 1 < headers.length ? headers[h + 1].line : lines.length;
		if (!sections.has(name)) {
			sections.set(name, { name, line, start: line + 1, end });
		}
	}

	// --- /PROG --------------------------------------------------------------
	const progSection = sections.get('PROG');
	if (progSection) {
		const raw = lines[progSection.line];
		const m = /^\s*\/PROG\s+(\S+)/.exec(raw);
		if (m) {
			result.progName = m[1];
			result.progNameLine = progSection.line;
			result.progNameCol = raw.indexOf(m[1], raw.indexOf('/PROG') + 5);
			result.progNameLength = m[1].length;
		} else {
			result.progNameLine = progSection.line;
			result.progNameCol = raw.length;
		}
	}

	// --- /ATTR --------------------------------------------------------------
	const attrSection = sections.get('ATTR');
	if (attrSection) {
		for (let i = attrSection.start; i < attrSection.end; i++) {
			const raw = lines[i];
			const m = ATTR_RE.exec(raw);
			if (!m) {
				continue;
			}
			const value = m[2].trim();
			const valueStart = raw.indexOf(m[2]);
			attrs.set(m[1], {
				key: m[1],
				value,
				line: i,
				valueStart: valueStart < 0 ? 0 : valueStart,
				valueEnd: (valueStart < 0 ? 0 : valueStart) + m[2].length
			});
		}
	}

	// --- /MN ----------------------------------------------------------------
	const mn = sections.get('MN');
	if (mn) {
		let current: TpLine | undefined;
		for (let i = mn.start; i < mn.end; i++) {
			const raw = lines[i];
			if (raw.trim() === '') {
				continue;
			}
			const m = TP_LINE_RE.exec(raw);
			if (m) {
				const rest = m[4];
				const col = m[1].length + m[2].length + 1;
				current = {
					num: parseInt(m[2], 10),
					line: i,
					raw,
					text: stripTerminator(rest).trim(),
					col: col + leadingWhitespace(rest),
					terminated: /;\s*$/.test(rest),
					continuation: []
				};
				tpLines.push(current);
			} else if (current && !current.terminated) {
				// Fortsetzungszeile, z. B. zweiter Punkt einer Kreisbewegung
				current.continuation.push(raw);
				current.text = (current.text + ' ' + stripTerminator(raw).trim()).trim();
				current.terminated = /;\s*$/.test(raw);
			}
		}
	}

	// --- /POS ---------------------------------------------------------------
	const pos = sections.get('POS');
	if (pos) {
		for (let i = pos.start; i < pos.end; i++) {
			const raw = lines[i];
			const m = POS_DEF_RE.exec(raw);
			if (m) {
				const col = raw.indexOf(m[1]);
				positions.push({
					kind: m[1] as 'P' | 'PR',
					id: parseInt(m[2], 10),
					line: i,
					col,
					length: raw.indexOf(']', col) - col + 1
				});
			}
		}
	}

	return result;
}

function stripTerminator(s: string): string {
	return s.replace(/;\s*$/, '');
}

function leadingWhitespace(s: string): number {
	const m = /^\s*/.exec(s);
	return m ? m[0].length : 0;
}

/** Entfernt Kommentare (`!... `) und Zeichenketten, damit Regex-Treffer nicht aus Text stammen. */
export function withoutCommentsAndStrings(text: string): string {
	let out = text.replace(/"[^"]*"/g, (m) => ' '.repeat(m.length));
	out = out.replace(/'[^']*'/g, (m) => ' '.repeat(m.length));
	const bang = out.indexOf('!');
	if (bang >= 0) {
		out = out.slice(0, bang) + ' '.repeat(out.length - bang);
	}
	return out;
}

export interface Reference {
	type: string;
	id: number;
	index: number;
	length: number;
}

const REF_RE =
	/(?<![A-Za-z0-9_])(PR|P|R|AR|SR|VR|DI|DO|RI|RO|AI|AO|GI|GO|SI|SO|UI|UO|WI|WO|F|M|LBL|TIMER|UTOOL|UFRAME|PAYLOAD)\s*\[\s*(\d+)/g;

/** Findet alle direkt indizierten Referenzen in einer Anweisung. */
export function findReferences(text: string): Reference[] {
	const clean = withoutCommentsAndStrings(text);
	const refs: Reference[] = [];
	let m: RegExpExecArray | null;
	REF_RE.lastIndex = 0;
	while ((m = REF_RE.exec(clean)) !== null) {
		refs.push({
			type: m[1],
			id: parseInt(m[2], 10),
			index: m.index,
			length: m[0].length
		});
	}
	return refs;
}

export interface MotionInfo {
	type: string;
	typeIndex: number;
	speedValue?: number;
	speedUnit?: string;
	speedIndex?: number;
	speedLength?: number;
	termination?: string;
	terminationIndex?: number;
	terminationLength?: number;
}

const MOTION_START_RE = /^(J|L|C|A|S)\s+(P|PR)\s*\[/;
const SPEED_RE = /(\d+(?:\.\d+)?)\s*(mm\/sec|cm\/min|inch\/min|deg\/sec|msec|sec|%)/;
const TERM_RE = /(?<![A-Za-z0-9_])(FINE|CNT\s*\d{1,3}|CD|CR\s*\d+(?:\.\d+)?)(?![A-Za-z0-9_])/;

/** Erkennt Bewegungsbefehle und liest Geschwindigkeit und Überschleifart aus. */
export function parseMotion(text: string): MotionInfo | undefined {
	const clean = withoutCommentsAndStrings(text);
	const head = MOTION_START_RE.exec(clean.trim());
	if (!head) {
		return undefined;
	}
	const info: MotionInfo = {
		type: head[1],
		typeIndex: clean.indexOf(head[1])
	};

	const speed = SPEED_RE.exec(clean);
	if (speed) {
		info.speedValue = parseFloat(speed[1]);
		info.speedUnit = speed[2];
		info.speedIndex = speed.index;
		info.speedLength = speed[0].length;
	} else if (/max_speed/i.test(clean)) {
		info.speedUnit = 'max_speed';
	}

	const term = TERM_RE.exec(clean);
	if (term) {
		info.termination = term[1].replace(/\s+/g, '');
		info.terminationIndex = term.index;
		info.terminationLength = term[0].length;
	}
	return info;
}
