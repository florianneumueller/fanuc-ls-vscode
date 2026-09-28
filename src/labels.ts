/**
 * Sprungmarken (LBL) eines TP-Programms: Definitionen und Verweise mit exakten
 * Positionen im Dokument. Ohne VS-Code-Abhängigkeit, damit testbar.
 */
import { parse } from './parser';

export type LabelRefKind = 'JMP' | 'SKIP' | 'TIMEOUT' | 'OTHER';

export interface LabelSpan {
	/** nullbasierte Dokumentzeile */
	line: number;
	/** Spalte von "LBL" */
	start: number;
	/** Spalte hinter "]" */
	end: number;
	/** Spalte und Ende der Nummer */
	idStart: number;
	idEnd: number;
	/** Kommentar innerhalb der Klammer (ohne ":"), falls vorhanden */
	comment?: string;
	/** Spalte des ":" bzw. der "]" wenn kein Kommentar */
	commentStart: number;
	commentEnd: number;
	/** Zeilennummer im /MN-Block */
	tpNum: number;
	/** Anweisungstext (ohne Nummer), für die Anzeige */
	statement: string;
}

export interface LabelDef extends LabelSpan {
	id: number;
}

export interface LabelRef extends LabelSpan {
	id: number;
	kind: LabelRefKind;
}

export interface LabelInfo {
	id: number;
	/** erste Definition */
	def?: LabelDef;
	/** weitere Definitionen derselben Nummer (Fehler) */
	duplicates: LabelDef[];
	refs: LabelRef[];
}

export interface LabelAnalysis {
	labels: LabelInfo[];
	/** Zeile des /MN-Headers und exklusives Ende, falls vorhanden */
	mnStart?: number;
	mnEnd?: number;
}

const LBL_RE = /\bLBL\s*\[\s*(\d+)\s*(?::([^\]]*))?\]/g;
const NUM_PREFIX_RE = /^\s*\d+:\s*/;

/** Blendet Zeichenketten und Meldungstexte aus, damit LBL in Texten nicht mitgezählt wird. */
function maskStrings(s: string): string {
	return s
		.replace(/"[^"]*"|'[^']*'/g, (m) => ' '.repeat(m.length))
		.replace(/(\bMESSAGE\s*\[)(.*)(\])/i, (_m, a: string, body: string, b: string) => a + ' '.repeat(body.length) + b);
}

export function analyzeLabels(text: string): LabelAnalysis {
	const program = parse(text);
	const mn = program.sections.get('MN');
	const byId = new Map<number, LabelInfo>();
	const info = (id: number): LabelInfo => {
		let i = byId.get(id);
		if (!i) {
			i = { id, duplicates: [], refs: [] };
			byId.set(id, i);
		}
		return i;
	};

	for (const tp of program.tpLines) {
		const physical = [tp.line, ...tp.continuation.map((_, k) => tp.line + k + 1)];
		const statement = tp.text.trim();
		// reine Bemerkungszeilen überspringen
		if (statement.startsWith('!') || statement.startsWith('--')) {
			continue;
		}
		const isDef = /^LBL\s*\[/.test(statement);
		physical.forEach((lineNo, k) => {
			const raw = program.lines[lineNo] ?? '';
			const prefix = k === 0 ? (NUM_PREFIX_RE.exec(raw)?.[0].length ?? 0) : 0;
			const masked = ' '.repeat(prefix) + maskStrings(raw.slice(prefix));
			LBL_RE.lastIndex = 0;
			let m: RegExpExecArray | null;
			let first = true;
			while ((m = LBL_RE.exec(masked)) !== null) {
				const id = parseInt(m[1], 10);
				const start = m.index;
				const end = start + m[0].length;
				const idStart = masked.indexOf(m[1], masked.indexOf('[', start));
				const colon = m[2] !== undefined ? masked.indexOf(':', idStart) : -1;
				const span: LabelSpan = {
					line: lineNo,
					start,
					end,
					idStart,
					idEnd: idStart + m[1].length,
					comment: m[2] !== undefined ? raw.slice(colon + 1, end - 1) : undefined,
					commentStart: colon >= 0 ? colon : end - 1,
					commentEnd: end - 1,
					tpNum: tp.num,
					statement
				};
				if (isDef && k === 0 && first) {
					const i = info(id);
					const def: LabelDef = { ...span, id };
					if (i.def) {
						i.duplicates.push(def);
					} else {
						i.def = def;
					}
				} else {
					const before = masked.slice(0, start).toUpperCase();
					const kind: LabelRefKind = /\bJMP\s*$/.test(before)
						? 'JMP'
						: /\bSKIP\s*,\s*$/.test(before)
						? 'SKIP'
						: /\bTIMEOUT\s*,\s*$/.test(before)
						? 'TIMEOUT'
						: 'OTHER';
					info(id).refs.push({ ...span, id, kind });
				}
				first = false;
			}
		});
	}

	const labels = [...byId.values()].sort((a, b) => {
		const la = a.def?.line ?? Number.MAX_SAFE_INTEGER;
		const lb = b.def?.line ?? Number.MAX_SAFE_INTEGER;
		return la - lb || a.id - b.id;
	});
	return { labels, mnStart: mn?.line, mnEnd: mn?.end };
}

/** Kleinste freie Labelnummer >= start. */
export function nextFreeLabel(analysis: LabelAnalysis, start = 1): number {
	const used = new Set(analysis.labels.map((l) => l.id));
	let n = Math.max(1, start);
	while (used.has(n)) {
		n++;
	}
	return n;
}

/** Findet das Label an einer Dokumentposition (Definition oder Verweis). */
export function labelAt(
	analysis: LabelAnalysis,
	line: number,
	character: number
): { label: LabelInfo; span: LabelSpan } | undefined {
	for (const l of analysis.labels) {
		for (const span of [...(l.def ? [l.def] : []), ...l.duplicates, ...l.refs]) {
			if (span.line === line && character >= span.start && character <= span.end) {
				return { label: l, span };
			}
		}
	}
	return undefined;
}

export interface TextChange {
	line: number;
	start: number;
	end: number;
	text: string;
}

/** Änderungen, um die Nummer eines Labels überall zu ersetzen. */
export function renameLabelChanges(analysis: LabelAnalysis, from: number, to: number): TextChange[] {
	const l = analysis.labels.find((x) => x.id === from);
	if (!l) {
		return [];
	}
	return [...(l.def ? [l.def] : []), ...l.duplicates, ...l.refs].map((s) => ({
		line: s.line,
		start: s.idStart,
		end: s.idEnd,
		text: String(to)
	}));
}

/** Änderung, um den Kommentar einer Label-Definition zu setzen (leer = entfernen). */
export function setCommentChange(def: LabelSpan, comment: string): TextChange {
	const clean = comment.replace(/[\]\r\n]/g, '').trim();
	return {
		line: def.line,
		start: def.idEnd,
		end: def.end - 1,
		text: clean ? `:${clean}` : ''
	};
}

/**
 * Nummeriert alle definierten Labels in Reihenfolge ihres Auftretens neu
 * (start, start+step, ...). Verweise auf nicht definierte Labels bleiben unverändert.
 */
export function renumberAllChanges(analysis: LabelAnalysis, start = 1, step = 1): TextChange[] {
	const defined = analysis.labels.filter((l) => l.def);
	const mapping = new Map<number, number>();
	defined.forEach((l, i) => mapping.set(l.id, start + i * step));
	const changes: TextChange[] = [];
	for (const l of defined) {
		const to = mapping.get(l.id)!;
		if (to !== l.id) {
			changes.push(...renameLabelChanges(analysis, l.id, to));
		}
	}
	return changes;
}

/** Wendet Textänderungen auf einen Text an (für Tests und Vorschau). */
export function applyChanges(text: string, changes: TextChange[]): string {
	const lines = text.split(/\r?\n/);
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const sorted = [...changes].sort((a, b) => b.line - a.line || b.start - a.start);
	for (const c of sorted) {
		const l = lines[c.line];
		lines[c.line] = l.slice(0, c.start) + c.text + l.slice(c.end);
	}
	return lines.join(eol);
}
