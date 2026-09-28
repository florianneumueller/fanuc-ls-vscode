/**
 * E/A-Signale: Kommentare, Import, Bereiche, Statusanzeige - ohne VS-Code-Abhängigkeit, damit testbar.
 */
import { TextChange } from './textChange';

export const IO_TYPES = ['DI', 'DO', 'RI', 'RO', 'GI', 'GO', 'AI', 'AO', 'UI', 'UO', 'SI', 'SO', 'WI', 'WO', 'F', 'M'] as const;
export type IoType = (typeof IO_TYPES)[number];

export const IO_TYPE_NAMES: Record<IoType, string> = {
	DI: 'Digitale Eingänge',
	DO: 'Digitale Ausgänge',
	RI: 'Roboter-Eingänge',
	RO: 'Roboter-Ausgänge',
	GI: 'Gruppeneingänge',
	GO: 'Gruppenausgänge',
	AI: 'Analoge Eingänge',
	AO: 'Analoge Ausgänge',
	UI: 'Peripherie-Eingänge (UOP)',
	UO: 'Peripherie-Ausgänge (UOP)',
	SI: 'Bedienfeld-Eingänge',
	SO: 'Bedienfeld-Ausgänge',
	WI: 'Schweiß-Eingänge',
	WO: 'Schweiß-Ausgänge',
	F: 'Flags',
	M: 'Merker'
};

/** Schreibweisen in Diagnose- und Exportdateien -> Typ im TP-Programm */
const TYPE_ALIASES: Record<string, IoType> = {
	DI: 'DI', DIN: 'DI',
	DO: 'DO', DOUT: 'DO',
	RI: 'RI', RDI: 'RI',
	RO: 'RO', RDO: 'RO',
	GI: 'GI', GIN: 'GI',
	GO: 'GO', GOUT: 'GO',
	AI: 'AI', AIN: 'AI',
	AO: 'AO', AOUT: 'AO',
	UI: 'UI', UIN: 'UI',
	UO: 'UO', UOUT: 'UO',
	SI: 'SI', SIN: 'SI',
	SO: 'SO', SOUT: 'SO',
	WI: 'WI', WO: 'WO',
	F: 'F', FLG: 'F',
	M: 'M'
};

export function normalizeIoType(t: string): IoType | undefined {
	return TYPE_ALIASES[t.toUpperCase()];
}

export interface IoEntry {
	type: IoType;
	index: number;
	comment: string;
}

export function ioKey(type: string, index: number): string {
	return `${type}[${index}]`;
}

// --- Referenzen mit Kommentar und Status im Programm --------------------------

export interface IoRefSpan {
	type: IoType;
	index: number;
	/** Kommentar ohne Status */
	comment?: string;
	/** Status (ON/OFF bzw. Wert), falls im Text enthalten */
	status?: string;
	line: number;
	/** Spalte von "TYPE[" */
	start: number;
	/** Spalte hinter "]" */
	end: number;
	/** Bereich des Status inkl. Trenner, z. B. "ON :" in "DO[6338:ON :PrePos]" */
	statusStart?: number;
	statusEnd?: number;
}

const TP_REF_RE = /(?<![A-Za-z0-9_$])(DI|DO|RI|RO|GI|GO|AI|AO|UI|UO|SI|SO|WI|WO|F|M)\[\s*(\d+)\s*(?::([^\]]*))?\]/g;
// Status am Anfang des Kommentars: "ON :", "OFF:", "*ON :", "  12:" (Gruppenwert)
const STATUS_RE = /^(\s*\*?(?:ON|OFF|-?\d+(?:\.\d+)?)\s*:)/;

/** Findet E/A-Referenzen in einer Zeile (Bemerkungen ab "!" werden ausgelassen). */
export function findIoRefs(lineText: string, line: number): IoRefSpan[] {
	const out: IoRefSpan[] = [];
	const body = /^\s*\d+:\s*!/.test(lineText) ? '' : lineText;
	TP_REF_RE.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = TP_REF_RE.exec(body)) !== null) {
		const ref: IoRefSpan = {
			type: m[1] as IoType,
			index: parseInt(m[2], 10),
			line,
			start: m.index,
			end: m.index + m[0].length
		};
		if (m[3] !== undefined) {
			const innerStart = m.index + m[0].indexOf(':') + 1;
			const st = STATUS_RE.exec(m[3]);
			if (st) {
				ref.status = st[1].replace(/[\s:*]/g, '');
				ref.statusStart = innerStart;
				ref.statusEnd = innerStart + st[1].length;
				ref.comment = m[3].slice(st[1].length).trim() || undefined;
			} else {
				ref.comment = m[3].trim() || undefined;
			}
		}
		out.push(ref);
	}
	return out;
}

/** Kommentare aus einem Programmtext sammeln (für die E/A-Liste). */
export function commentsFromProgram(text: string): IoEntry[] {
	const out = new Map<string, IoEntry>();
	text.split(/\r?\n/).forEach((l, i) => {
		for (const r of findIoRefs(l, i)) {
			if (r.comment) {
				out.set(ioKey(r.type, r.index), { type: r.type, index: r.index, comment: r.comment });
			}
		}
	});
	return [...out.values()];
}

/** Änderungen, die den Status aus allen Referenzen entfernen: DO[6338:ON :PrePos] -> DO[6338:PrePos]. */
export function stripStatusChanges(text: string): TextChange[] {
	const changes: TextChange[] = [];
	text.split(/\r?\n/).forEach((l, i) => {
		for (const r of findIoRefs(l, i)) {
			if (r.statusStart !== undefined && r.statusEnd !== undefined) {
				// ohne Kommentar auch den Doppelpunkt davor entfernen: DO[1:ON :] -> DO[1]
				const start = r.comment ? r.statusStart : r.statusStart - 1;
				const end = r.comment ? r.statusEnd : r.end - 1;
				changes.push({ line: i, start, end, text: '' });
			}
		}
	});
	return changes;
}

// --- Import aus Dateien der Steuerung -----------------------------------------

const LISTING_RE =
	/(?<![A-Za-z0-9_$])(DIN|DOUT|RDI|RDO|GIN|GOUT|AIN|AOUT|UIN|UOUT|SIN|SOUT|FLG|DI|DO|RI|RO|GI|GO|AI|AO|UI|UO|SI|SO|WI|WO|F|M)\s*\[\s*(\d+)\s*(?::([^\]]*))?\]/gi;

/**
 * Tolerantes Einlesen einer E/A-Liste (z. B. IOSTATE.DG oder ein Ausdruck vom Teach Pendant).
 * Erkennt "DIN[  12] ON  Kommentar", "DO[12:Kommentar]", auch mehrere Signale je Zeile.
 * Der Status (ON/OFF/Wert, Simulationskennung) wird bewusst nicht übernommen.
 */
export function parseIoListing(text: string): IoEntry[] {
	const out = new Map<string, IoEntry>();
	for (const line of text.split(/\r?\n/)) {
		const matches = [...line.matchAll(LISTING_RE)];
		matches.forEach((m, k) => {
			const type = normalizeIoType(m[1]);
			if (!type) {
				return;
			}
			const index = parseInt(m[2], 10);
			let comment = (m[3] ?? '').replace(STATUS_RE, '').trim();
			if (!comment) {
				const restEnd = k + 1 < matches.length ? matches[k + 1].index : line.length;
				comment = line
					.slice(m.index! + m[0].length, restEnd)
					.replace(/^\s*[=:]?\s*/, '')
					// Status, Simulationskennung (S/U/*), Rack/Slot-Angaben am Anfang entfernen
					.replace(/^(\*?\s*(?:ON|OFF)\b|\*?\s*-?\d+(?:\.\d+)?\b)\s*/i, '')
					.replace(/^[SU*]\s+/, '')
					.trim();
			}
			const key = ioKey(type, index);
			const prev = out.get(key);
			if (!prev || (!prev.comment && comment)) {
				out.set(key, { type, index, comment });
			}
		});
	}
	return [...out.values()].sort(compareEntries);
}

/** CSV/TSV: "DO;12;Kommentar", "DO,12,Kommentar" oder "DO[12];Kommentar". Kopfzeile wird übersprungen. */
export function parseIoCsv(text: string): IoEntry[] {
	const out = new Map<string, IoEntry>();
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line) {
			continue;
		}
		const cells = line.split(/[;\t,]/).map((c) => c.trim().replace(/^"|"$/g, ''));
		let type: IoType | undefined;
		let index: number | undefined;
		let rest: string[];
		const combined = /^([A-Za-z]+)\s*\[\s*(\d+)\s*\]$/.exec(cells[0] ?? '');
		if (combined) {
			type = normalizeIoType(combined[1]);
			index = parseInt(combined[2], 10);
			rest = cells.slice(1);
		} else {
			type = normalizeIoType(cells[0] ?? '');
			index = /^\d+$/.test(cells[1] ?? '') ? parseInt(cells[1], 10) : undefined;
			rest = cells.slice(2);
		}
		if (!type || index === undefined) {
			continue;
		}
		out.set(ioKey(type, index), { type, index, comment: rest.join(', ').trim() });
	}
	return [...out.values()].sort(compareEntries);
}

export function compareEntries(a: IoEntry, b: IoEntry): number {
	return IO_TYPES.indexOf(a.type) - IO_TYPES.indexOf(b.type) || a.index - b.index;
}

// --- Bereiche -----------------------------------------------------------------

export interface Range {
	from: number;
	to: number;
}

/**
 * Grenzwert aus der Einstellung: Zahl n = 1..n (0 = keine Prüfung),
 * Text = Bereiche "1-512, 6000-6999, 7001".
 * Liefert undefined, wenn nicht geprüft werden soll.
 */
export function parseRanges(limit: number | string | undefined): Range[] | undefined {
	if (limit === undefined || limit === null) {
		return undefined;
	}
	if (typeof limit === 'number') {
		return limit > 0 ? [{ from: 1, to: limit }] : undefined;
	}
	const ranges: Range[] = [];
	for (const part of String(limit).split(/[,;\s]+/)) {
		if (!part) {
			continue;
		}
		const m = /^(\d+)(?:-(\d+))?$/.exec(part);
		if (!m) {
			continue;
		}
		const from = parseInt(m[1], 10);
		const to = m[2] ? parseInt(m[2], 10) : from;
		ranges.push({ from: Math.min(from, to), to: Math.max(from, to) });
	}
	return ranges.length ? ranges : undefined;
}

export function inRanges(ranges: Range[], n: number): boolean {
	return ranges.some((r) => n >= r.from && n <= r.to);
}

export function formatRanges(ranges: Range[]): string {
	return mergeRanges(ranges)
		.map((r) => (r.from === r.to ? String(r.from) : `${r.from}-${r.to}`))
		.join(', ');
}

export function mergeRanges(ranges: Range[]): Range[] {
	const sorted = [...ranges].sort((a, b) => a.from - b.from);
	const out: Range[] = [];
	for (const r of sorted) {
		const last = out[out.length - 1];
		if (last && r.from <= last.to + 1) {
			last.to = Math.max(last.to, r.to);
		} else {
			out.push({ ...r });
		}
	}
	return out;
}

/** Vorschlag für einen Bereich, der n enthält: der Tausenderblock (6338 -> 6001-7000) bzw. 1-1000. */
export function suggestRange(n: number): Range {
	const block = Math.floor((n - 1) / 1000);
	return { from: block * 1000 + 1, to: (block + 1) * 1000 };
}
