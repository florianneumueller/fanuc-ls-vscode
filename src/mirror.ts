/**
 * Spiegeln einer einzelnen Bewegungsgruppe in allen Positionen eines Programms -
 * ohne VS-Code-Abhängigkeit, damit testbar. Andere Gruppen bleiben unverändert.
 */
import { parse, parseMotion, withoutCommentsAndStrings } from './parser';
import { AxisValue, PosData, formatAxis, parsePositions } from './posData';
import { TextChange } from './textChange';

export type MirrorPlane = 'XZ' | 'YZ';

export interface MirrorOptions {
	group: number;
	/** kartesische Positionen: Spiegelebene im Benutzerkoordinatensystem der Position */
	plane?: MirrorPlane;
	/** Lage der Ebene: Y = offset (XZ) bzw. X = offset (YZ) */
	offset?: number;
	/** Achswerte/externe Achsen: Name -> Mittelwert, um den gespiegelt wird (v' = 2*Mitte - v) */
	axes?: Record<string, number>;
}

export interface MirrorReport {
	/** gespiegelte Positionen */
	mirrored: number[];
	/** Positionen ohne Daten der Gruppe */
	withoutGroup: number[];
	/** Positionen der Gruppe in Achswerten, obwohl eine Ebene gewählt wurde (nicht gespiegelt) */
	jointSkipped: number[];
	/** kartesische Positionen, obwohl nur Achsen gewählt wurden (nicht gespiegelt) */
	cartesianSkipped: number[];
	/** Positionen mit Offset relativ (INC) - ohne Versatz gespiegelt */
	incremental: number[];
	/** verschiedene Benutzerkoordinatensysteme der gespiegelten Positionen */
	userFrames: number[];
	/** Hinweise zu Zeilen, die von Hand geprüft werden müssen */
	notes: string[];
}

export interface MirrorGroupInfo {
	group: number;
	kind: 'cartesian' | 'joint' | 'mixed';
	/** Achsnamen der Gruppe (J1.. bzw. X..R) und externe Achsen */
	axes: { name: string; unit: string }[];
	extAxes: { name: string; unit: string }[];
	positions: number;
}

/** Gruppen, die im Programm vorkommen, mit Darstellung und Achsen. */
export function mirrorGroups(data: PosData): MirrorGroupInfo[] {
	const map = new Map<number, MirrorGroupInfo>();
	for (const b of data.blocks) {
		if (b.kind !== 'P') {
			continue;
		}
		for (const g of b.groups) {
			let info = map.get(g.group);
			if (!info) {
				info = { group: g.group, kind: g.kind, axes: [], extAxes: [], positions: 0 };
				map.set(g.group, info);
			} else if (info.kind !== g.kind) {
				info.kind = 'mixed';
			}
			info.positions++;
			for (const a of g.axes) {
				if (!info.axes.some((x) => x.name === a.name)) {
					info.axes.push({ name: a.name, unit: a.unit });
				}
			}
			for (const a of g.extAxes) {
				if (!info.extAxes.some((x) => x.name === a.name)) {
					info.extAxes.push({ name: a.name, unit: a.unit });
				}
			}
		}
	}
	return [...map.values()].sort((a, b) => a.group - b.group);
}

/** Gespiegelte Werte der kartesischen Komponenten (Orientierung als Konjugation mit der Spiegelmatrix). */
export function mirrorCartesian(
	v: Record<string, number>,
	plane: MirrorPlane,
	offset: number
): Record<string, number> {
	const out = { ...v };
	const neg = (k: string) => {
		if (k in out) {
			out[k] = normAngle(-out[k]);
		}
	};
	if (plane === 'XZ') {
		if ('Y' in out) {
			out.Y = 2 * offset - out.Y;
		}
		neg('W');
		neg('R');
	} else {
		if ('X' in out) {
			out.X = 2 * offset - out.X;
		}
		neg('P');
		neg('R');
	}
	return out;
}

function normAngle(a: number): number {
	let x = a;
	while (x > 180) {
		x -= 360;
	}
	while (x <= -180) {
		x += 360;
	}
	return Object.is(x, -0) ? 0 : x;
}

function replaceAxis(a: AxisValue, value: number): TextChange {
	const clean = Math.abs(value) < 0.0005 ? 0 : value;
	return { line: a.line, start: a.start, end: a.end, text: formatAxis(a.name, clean, a.unit) };
}

/** Positionen, die in inkrementellen Bewegungen (INC) verwendet werden. */
function incrementalPositions(text: string): Set<number> {
	const ids = new Set<number>();
	for (const tp of parse(text).tpLines) {
		const clean = withoutCommentsAndStrings(tp.text);
		if (parseMotion(tp.text) && /\bINC\b/.test(clean)) {
			for (const m of clean.matchAll(/(?<![A-Za-z])P\[\s*(\d+)/g)) {
				ids.add(parseInt(m[1], 10));
			}
		}
	}
	return ids;
}

/** Hinweise auf Stellen, die die Spiegelung nicht erfasst. */
function manualNotes(text: string): string[] {
	const notes: string[] = [];
	for (const tp of parse(text).tpLines) {
		const clean = withoutCommentsAndStrings(tp.text);
		if (!parseMotion(tp.text)) {
			if (/\bPR\[\s*\d+/.test(clean) && /=/.test(clean)) {
				notes.push(`Zeile ${tp.num}: Positionsregister-Zuweisung – Werte im PR ggf. von Hand spiegeln`);
			}
			if (/\bOFFSET\s+CONDITION\b/i.test(clean)) {
				notes.push(`Zeile ${tp.num}: OFFSET CONDITION – Versatz im PR ggf. spiegeln`);
			}
			continue;
		}
		if (/(?<![A-Za-z_])PR\[/.test(clean.split(/\b(?:Offset|Tool_Offset)\b/i)[0])) {
			notes.push(`Zeile ${tp.num}: Bewegung auf ein Positionsregister – liegt auf der Steuerung, nicht gespiegelt`);
		}
		if (/\b(?:Tool_Offset|Offset)\s*,\s*PR\[/i.test(clean)) {
			notes.push(`Zeile ${tp.num}: Offset über Positionsregister – Versatz ggf. spiegeln`);
		}
	}
	return notes;
}

/**
 * Textänderungen für die Spiegelung einer Gruppe.
 * Kartesische Positionen werden an der Ebene gespiegelt (plane), Achswerte und
 * externe Achsen um die angegebenen Mittelwerte (axes).
 */
export function mirrorChanges(text: string, opts: MirrorOptions): { changes: TextChange[]; report: MirrorReport } {
	const data = parsePositions(text);
	const report: MirrorReport = {
		mirrored: [],
		withoutGroup: [],
		jointSkipped: [],
		cartesianSkipped: [],
		incremental: [],
		userFrames: [],
		notes: manualNotes(text)
	};
	const changes: TextChange[] = [];
	const inc = incrementalPositions(text);
	const axisCenters = opts.axes ?? {};
	const frames = new Set<number>();

	for (const b of data.blocks) {
		if (b.kind !== 'P') {
			continue;
		}
		const g = b.groups.find((x) => x.group === opts.group);
		if (!g) {
			report.withoutGroup.push(b.id);
			continue;
		}
		const isInc = inc.has(b.id);
		let touched = false;

		if (g.kind === 'cartesian') {
			if (opts.plane) {
				const values: Record<string, number> = {};
				g.axes.forEach((a) => (values[a.name] = a.value));
				// inkrementelle Positionen sind Verschiebungen: ohne Versatz spiegeln
				const mirrored = mirrorCartesian(values, opts.plane, isInc ? 0 : opts.offset ?? 0);
				for (const a of g.axes) {
					if (mirrored[a.name] !== a.value) {
						changes.push(replaceAxis(a, mirrored[a.name]));
					}
				}
				touched = true;
				const uf = /\bUF\s*:\s*(\d+)/.exec(g.frameLine ?? '');
				if (uf) {
					frames.add(parseInt(uf[1], 10));
				}
			} else if (Object.keys(axisCenters).some((k) => /^J\d+$/.test(k))) {
				report.cartesianSkipped.push(b.id);
			}
		} else {
			for (const a of g.axes) {
				if (a.name in axisCenters) {
					const c = isInc ? 0 : axisCenters[a.name];
					changes.push(replaceAxis(a, 2 * c - a.value));
					touched = true;
				}
			}
			if (opts.plane && !Object.keys(axisCenters).some((k) => /^J\d+$/.test(k))) {
				report.jointSkipped.push(b.id);
			}
		}

		for (const a of g.extAxes) {
			if (a.name in axisCenters) {
				const c = isInc ? 0 : axisCenters[a.name];
				changes.push(replaceAxis(a, 2 * c - a.value));
				touched = true;
			}
		}

		if (touched) {
			report.mirrored.push(b.id);
			if (isInc) {
				report.incremental.push(b.id);
			}
		}
	}
	report.userFrames = [...frames].sort((a, b) => a - b);
	return { changes, report };
}

/** Änderungen für eine gespiegelte Kopie: neuer Programmname und Kommentar. */
export function renameProgramChanges(text: string, newName: string, commentSuffix: string): TextChange[] {
	const program = parse(text);
	const changes: TextChange[] = [];
	if (program.progNameLine >= 0 && program.progName) {
		changes.push({
			line: program.progNameLine,
			start: program.progNameCol,
			end: program.progNameCol + program.progNameLength,
			text: newName
		});
	}
	const comment = program.attrs.get('COMMENT');
	if (comment) {
		const inner = /^"(.*)"$/.exec(comment.value)?.[1] ?? comment.value;
		// Programmkommentare sind auf 16 Zeichen begrenzt - Zusatz nur, wenn er passt
		if ((inner + commentSuffix).length <= 16) {
			changes.push({ line: comment.line, start: comment.valueStart, end: comment.valueEnd, text: `"${inner}${commentSuffix}"` });
		}
	}
	return changes;
}
