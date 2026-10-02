/**
 * Schweißnähte in TP-Programmen erkennen und Schweißgeschwindigkeiten ändern -
 * ohne VS-Code-Abhängigkeit, damit testbar.
 *
 * Eine Naht beginnt mit "Arc Start[...]" bzw. "Weld Start[...]" und endet mit
 * "Arc End[...]" bzw. "Weld End[...]". Die Bewegungen dazwischen sind die Schweißbahn.
 */
import { TpLine, parse, parseMotion, withoutCommentsAndStrings } from './parser';
import { TextChange } from './textChange';

export interface WeldMove {
	/** Zeilennummer im /MN-Block */
	tpNum: number;
	/** Dokumentzeile */
	line: number;
	/** Bewegungsart (L, C, A, J) */
	type: string;
	/** Geschwindigkeit, falls als Zahl angegeben */
	speed?: number;
	unit?: string;
	/** Position der Zahl im Dokument (nur bei Zahl) */
	speedStart?: number;
	speedEnd?: number;
	/** z. B. "WELD_SPEED" oder "R[5]mm/sec" - nicht direkt änderbar */
	speedText: string;
}

export interface WeldSeam {
	/** laufende Nummer ab 1 */
	number: number;
	startTpNum: number;
	endTpNum?: number;
	/** z. B. "Arc Start[1]" */
	startText: string;
	endText?: string;
	/** Schweißprozedur bzw. -plan aus Arc Start[n] / Weld Start[n,m] */
	schedule?: string;
	moves: WeldMove[];
	/** Pendeln innerhalb der Naht */
	weave?: string;
}

const START_RE = /\b(Arc|Weld)\s+Start\s*\[([^\]]*)\]/i;
const END_RE = /\b(Arc|Weld)\s+End\s*\[([^\]]*)\]/i;
const WEAVE_RE = /\bWeave\s+([A-Za-z0-9 ]+?)\s*\[([^\]]*)\]/i;
const LINEAR_UNITS = ['mm/sec', 'cm/min', 'inch/min'];
const NUM_SPEED_RE = /(?<![\[\w.])(\d+(?:\.\d+)?)(\s*)(mm\/sec|cm\/min|inch\/min)/;

export function findSeams(text: string): WeldSeam[] {
	const program = parse(text);
	const seams: WeldSeam[] = [];
	let current: WeldSeam | undefined;

	for (const tp of program.tpLines) {
		const clean = withoutCommentsAndStrings(tp.text);
		const motion = parseMotion(tp.text);
		const start = START_RE.exec(clean);
		const end = END_RE.exec(clean);

		// "L P[2] ... Arc Start[1]": Anfahrt gehört nicht zur Naht; "L P[3] ... Arc End[1]": letzte Nahtbewegung
		if (motion && current) {
			current.moves.push(weldMove(tp));
		}
		if (start) {
			current = {
				number: seams.length + 1,
				startTpNum: tp.num,
				startText: start[0],
				schedule: start[2].trim(),
				moves: []
			};
			seams.push(current);
		}
		const weave = WEAVE_RE.exec(clean);
		if (weave && current && !/^End$/i.test(weave[1].trim())) {
			current.weave = weave[0];
		}
		if (end && current) {
			current.endTpNum = tp.num;
			current.endText = end[0];
			current = undefined;
		}
	}
	return seams;
}

function weldMove(tp: TpLine): WeldMove {
	const motion = parseMotion(tp.text)!;
	const move: WeldMove = {
		tpNum: tp.num,
		line: tp.line,
		type: motion.type,
		speedText: describeSpeed(tp.text)
	};
	const unit = motion.speedUnit;
	if (motion.speedValue !== undefined && motion.speedIndex !== undefined && unit && LINEAR_UNITS.includes(unit)) {
		const num = /^\d+(?:\.\d+)?/.exec(tp.text.slice(motion.speedIndex))![0];
		move.speed = motion.speedValue;
		move.unit = unit;
		move.speedStart = tp.col + motion.speedIndex;
		move.speedEnd = move.speedStart + num.length;
	}
	return move;
}

function describeSpeed(text: string): string {
	const clean = withoutCommentsAndStrings(text);
	const num = NUM_SPEED_RE.exec(clean);
	if (num) {
		return `${num[1]} ${num[3]}`;
	}
	const ws = /\bWELD_SPEED\b/i.exec(clean);
	if (ws) {
		return 'WELD_SPEED';
	}
	const reg = /\b(R\[\s*\d+\s*(?::[^\]]*)?\])\s*(mm\/sec|cm\/min|inch\/min|%|sec)/.exec(clean);
	if (reg) {
		return `${reg[1]} ${reg[2]}`;
	}
	const pct = /(\d+)\s*%/.exec(clean);
	return pct ? `${pct[1]} %` : '?';
}

/** Ändert die Geschwindigkeit aller änderbaren Bewegungen der gewählten Nähte. */
export function setSeamSpeedChanges(seams: WeldSeam[], numbers: number[], speed: number): TextChange[] {
	const text = formatSpeed(speed);
	const changes: TextChange[] = [];
	for (const s of seams) {
		if (!numbers.includes(s.number)) {
			continue;
		}
		for (const m of s.moves) {
			if (m.speedStart !== undefined && m.speedEnd !== undefined && m.type !== 'J') {
				changes.push({ line: m.line, start: m.speedStart, end: m.speedEnd, text });
			}
		}
	}
	return changes;
}

/** Ändert alle Schweißgeschwindigkeiten um einen Prozentsatz (z. B. +10 %). */
export function scaleSeamSpeedChanges(seams: WeldSeam[], numbers: number[], percent: number): TextChange[] {
	const changes: TextChange[] = [];
	for (const s of seams) {
		if (!numbers.includes(s.number)) {
			continue;
		}
		for (const m of s.moves) {
			if (m.speed !== undefined && m.speedStart !== undefined && m.speedEnd !== undefined && m.type !== 'J') {
				changes.push({ line: m.line, start: m.speedStart, end: m.speedEnd, text: formatSpeed(m.speed * (1 + percent / 100)) });
			}
		}
	}
	return changes;
}

/** Ganzzahl ohne Nachkommastellen, sonst höchstens eine Nachkommastelle. */
export function formatSpeed(v: number): string {
	const r = Math.round(v * 10) / 10;
	return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Kurzbeschreibung einer Naht für die Anzeige. */
export function seamSummary(s: WeldSeam): string {
	const speeds = [...new Set(s.moves.map((m) => m.speedText))];
	return `Zeile ${s.startTpNum}${s.endTpNum ? '–' + s.endTpNum : ''} · ${s.moves.length} Bewegung(en) · ${speeds.join(', ') || 'keine Bewegung'}`;
}

/** Geschwindigkeit in mm/sec (für Plausibilitätsprüfungen). */
export function toMmPerSec(v: number, unit: string): number {
	switch (unit) {
		case 'cm/min':
			return (v * 10) / 60;
		case 'inch/min':
			return (v * 25.4) / 60;
		default:
			return v;
	}
}

/** Typischer Bereich für Lichtbogen-Schweißgeschwindigkeiten (mm/sec) - außerhalb wird gewarnt. */
export const WELD_SPEED_RANGE = { min: 1, max: 40 };
