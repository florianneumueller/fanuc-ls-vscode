/**
 * Positionsdaten (/POS) mit Bewegungsgruppen und externen Achsen - ohne
 * VS-Code-Abhängigkeit, damit testbar.
 *
 *   P[1:"Kommentar"]{
 *      GP1:
 *   	UF : 1, UT : 1,		CONFIG : 'N U T, 0, 0, 0',
 *   	X =   100.000  mm,	Y =     0.000  mm,	Z =   300.000  mm,
 *   	W =   180.000 deg,	P =     0.000 deg,	R =     0.000 deg,
 *   	E1=   500.000  mm
 *      GP2:
 *   	UF : 1, UT : 1,
 *   	J1=     0.000 deg,	J2=    90.000 deg
 *   };
 */
import { parse, parseMotion } from './parser';
import { TextChange } from './textChange';

export const MAX_GROUPS = 5;

export interface AxisValue {
	name: string;
	value: number;
	unit: string;
	line: number;
	/** Spalte des Achsnamens */
	start: number;
	/** Spalte hinter der Einheit */
	end: number;
}

export interface GroupBlock {
	group: number;
	headerLine: number;
	/** exklusives Ende (nächster GP-Header oder "};") */
	endLine: number;
	kind: 'cartesian' | 'joint';
	/** Zeile mit "UF : .., UT : .." (roh), falls vorhanden */
	frameLine?: string;
	/** X..R bzw. J1..Jn */
	axes: AxisValue[];
	/** E1..En */
	extAxes: AxisValue[];
}

export interface PosBlock {
	kind: 'P' | 'PR';
	id: number;
	comment?: string;
	line: number;
	/** Spalte und Länge von "P[..]" für Meldungen */
	col: number;
	length: number;
	/** Zeile mit "};" */
	closeLine: number;
	groups: GroupBlock[];
}

export interface DefaultGroup {
	line: number;
	valueStart: number;
	valueEnd: number;
	/** true = Gruppe aktiv, Index 0 = GP1 */
	mask: boolean[];
}

export interface PosData {
	blocks: PosBlock[];
	/** /POS-Header und exklusives Ende */
	pos?: { line: number; end: number };
	defaultGroup?: DefaultGroup;
	hasMotion: boolean;
	lines: string[];
}

const BLOCK_RE = /^\s*(PR|P)\s*\[\s*(\d+)\s*(?::\s*"?([^"\]]*)"?)?\s*\]\s*\{/;
const GROUP_RE = /^\s*GP(\d+)\s*:/;
const AXIS_RE = /\b([XYZWPR]|J\d+|E\d+)\s*=\s*(-?\d+(?:\.\d+)?)\s*(mm|deg)\b/g;

export function parseDefaultGroup(value: string): boolean[] {
	const parts = value.split(',').map((p) => p.trim());
	const mask: boolean[] = [];
	for (let i = 0; i < MAX_GROUPS; i++) {
		mask.push(parts[i] === '1');
	}
	return mask;
}

export function formatDefaultGroup(mask: boolean[]): string {
	return mask.map((m) => (m ? '1' : '*')).join(',');
}

export function activeGroups(mask: boolean[]): number[] {
	return mask.map((m, i) => (m ? i + 1 : 0)).filter((g) => g > 0);
}

export function parsePositions(text: string): PosData {
	const program = parse(text);
	const lines = program.lines;
	const data: PosData = {
		blocks: [],
		lines,
		hasMotion: program.tpLines.some((tp) => !!parseMotion(tp.text))
	};

	const attr = program.attrs.get('DEFAULT_GROUP');
	if (attr) {
		data.defaultGroup = {
			line: attr.line,
			valueStart: attr.valueStart,
			valueEnd: attr.valueEnd,
			mask: parseDefaultGroup(attr.value)
		};
	}

	const pos = program.sections.get('POS');
	if (!pos) {
		return data;
	}
	data.pos = { line: pos.line, end: pos.end };

	let block: PosBlock | undefined;
	let group: GroupBlock | undefined;
	const closeGroup = (at: number) => {
		if (group) {
			group.endLine = at;
			group = undefined;
		}
	};

	for (let i = pos.start; i < pos.end; i++) {
		const raw = lines[i];
		const b = BLOCK_RE.exec(raw);
		if (b) {
			const col = raw.indexOf(b[1]);
			block = {
				kind: b[1] as 'P' | 'PR',
				id: parseInt(b[2], 10),
				comment: b[3]?.trim() || undefined,
				line: i,
				col,
				length: raw.indexOf(']', col) - col + 1,
				closeLine: i,
				groups: []
			};
			data.blocks.push(block);
			continue;
		}
		if (!block) {
			continue;
		}
		if (/^\s*\}\s*;/.test(raw)) {
			closeGroup(i);
			block.closeLine = i;
			block = undefined;
			continue;
		}
		const g = GROUP_RE.exec(raw);
		if (g) {
			closeGroup(i);
			group = {
				group: parseInt(g[1], 10),
				headerLine: i,
				endLine: i + 1,
				kind: 'cartesian',
				axes: [],
				extAxes: []
			};
			block.groups.push(group);
			continue;
		}
		if (!group) {
			continue;
		}
		if (/\bUF\s*:/.test(raw)) {
			group.frameLine = raw;
		}
		AXIS_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = AXIS_RE.exec(raw)) !== null) {
			const axis: AxisValue = {
				name: m[1],
				value: parseFloat(m[2]),
				unit: m[3],
				line: i,
				start: m.index,
				end: m.index + m[0].length
			};
			if (/^E\d+$/.test(axis.name)) {
				group.extAxes.push(axis);
			} else {
				group.axes.push(axis);
				if (/^J\d+$/.test(axis.name)) {
					group.kind = 'joint';
				}
			}
		}
	}
	return data;
}

// --- Prüfung ------------------------------------------------------------------

export type GroupIssueCode = 'group-none' | 'group-missing' | 'group-extra' | 'ext-axis-mismatch';

export interface GroupIssue {
	code: GroupIssueCode;
	severity: 'error' | 'warning';
	line: number;
	start: number;
	end: number;
	message: string;
	/** betroffene Gruppe */
	group?: number;
}

function extSignature(g: GroupBlock): string {
	return g.extAxes
		.map((a) => `${a.name}(${a.unit})`)
		.sort()
		.join(',');
}

export function checkGroups(data: PosData): GroupIssue[] {
	const issues: GroupIssue[] = [];
	const dg = data.defaultGroup;
	if (!dg) {
		return issues;
	}
	const active = activeGroups(dg.mask);
	if (active.length === 0) {
		if (data.hasMotion) {
			issues.push({
				code: 'group-none',
				severity: 'error',
				line: dg.line,
				start: dg.valueStart,
				end: dg.valueEnd,
				message: 'Das Programm enthält Bewegungsbefehle, aber DEFAULT_GROUP aktiviert keine Bewegungsgruppe.'
			});
		}
		return issues;
	}

	const dgText = formatDefaultGroup(dg.mask);
	for (const b of data.blocks) {
		if (b.kind !== 'P') {
			continue;
		}
		const present = new Set(b.groups.map((g) => g.group));
		for (const g of active) {
			if (!present.has(g)) {
				issues.push({
					code: 'group-missing',
					severity: 'error',
					line: b.line,
					start: b.col,
					end: b.col + b.length,
					group: g,
					message: `P[${b.id}] enthält keine Daten für GP${g}, obwohl DEFAULT_GROUP = ${dgText} die Gruppe aktiviert.`
				});
			}
		}
		for (const g of b.groups) {
			if (!dg.mask[g.group - 1]) {
				issues.push({
					code: 'group-extra',
					severity: 'error',
					line: g.headerLine,
					start: 0,
					end: (data.lines[g.headerLine] ?? '').length,
					group: g.group,
					message: `P[${b.id}] enthält GP${g.group}, die laut DEFAULT_GROUP = ${dgText} nicht aktiv ist.`
				});
			}
		}
	}

	// externe Achsen je Gruppe: häufigste Belegung gilt als Soll
	for (const g of active) {
		const withGroup = data.blocks
			.filter((b) => b.kind === 'P')
			.map((b) => ({ b, gb: b.groups.find((x) => x.group === g) }))
			.filter((x): x is { b: PosBlock; gb: GroupBlock } => !!x.gb);
		const counts = new Map<string, number>();
		for (const { gb } of withGroup) {
			const sig = extSignature(gb);
			counts.set(sig, (counts.get(sig) ?? 0) + 1);
		}
		if (counts.size <= 1) {
			continue;
		}
		const expected = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
		for (const { b, gb } of withGroup) {
			const sig = extSignature(gb);
			if (sig !== expected) {
				issues.push({
					code: 'ext-axis-mismatch',
					severity: 'warning',
					line: gb.headerLine,
					start: 0,
					end: (data.lines[gb.headerLine] ?? '').length,
					group: g,
					message: `P[${b.id}] GP${g}: externe Achsen ${sig || 'keine'}, die übrigen Positionen haben ${expected || 'keine'}.`
				});
			}
		}
	}
	return issues;
}

// --- Formatierung -------------------------------------------------------------

export function formatAxis(name: string, value: number, unit: string): string {
	const v = value.toFixed(3).padStart(10, ' ');
	const u = unit === 'mm' ? '  mm' : ' deg';
	return /^[XYZWPR]$/.test(name) ? `${name} =${v}${u}` : `${name}=${v}${u}`;
}

/** Achszeilen: je Zeile bis zu drei Werte, getrennt mit ",\t", Zeilen enden mit ",". */
function axisLines(axes: { name: string; value: number; unit: string }[], eol: string): string {
	const out: string[] = [];
	for (let i = 0; i < axes.length; i += 3) {
		out.push('\t' + axes.slice(i, i + 3).map((a) => formatAxis(a.name, a.value, a.unit)).join(',\t'));
	}
	return out.join(',' + eol);
}

function groupBlockText(
	group: number,
	frameLine: string,
	axes: { name: string; value: number; unit: string }[],
	ext: { name: string; value: number; unit: string }[],
	eol: string
): string {
	let text = `   GP${group}:${eol}${frameLine}${eol}${axisLines(axes, eol)}`;
	if (ext.length) {
		text += ',' + eol + '\t' + ext.map((a) => formatAxis(a.name, a.value, a.unit)).join(',\t');
	}
	return text;
}

// --- Änderungen: externe Achsen ----------------------------------------------

/** Nächster freier Name einer externen Achse in der Gruppe (E1, E2, E3). */
export function nextExtAxisName(data: PosData, group: number): string {
	const used = new Set<string>();
	for (const b of data.blocks) {
		for (const g of b.groups) {
			if (g.group === group) {
				g.extAxes.forEach((a) => used.add(a.name));
			}
		}
	}
	let n = 1;
	while (used.has(`E${n}`)) {
		n++;
	}
	return `E${n}`;
}

/** Externe Achsen, die in der Gruppe vorkommen (mit Einheit). */
export function extAxesOf(data: PosData, group: number): { name: string; unit: string }[] {
	const seen = new Map<string, string>();
	for (const b of data.blocks) {
		for (const g of b.groups) {
			if (g.group === group) {
				g.extAxes.forEach((a) => seen.set(a.name, a.unit));
			}
		}
	}
	return [...seen.entries()].map(([name, unit]) => ({ name, unit })).sort((a, b) => a.name.localeCompare(b.name));
}

export function addExtAxisChanges(
	data: PosData,
	group: number,
	name: string,
	unit: 'mm' | 'deg',
	value: number,
	eol: string
): TextChange[] {
	const changes: TextChange[] = [];
	const text = formatAxis(name, value, unit);
	for (const b of data.blocks) {
		const g = b.groups.find((x) => x.group === group);
		if (!g || g.extAxes.some((a) => a.name === name)) {
			continue;
		}
		const last = g.extAxes.length ? g.extAxes[g.extAxes.length - 1] : g.axes[g.axes.length - 1];
		if (!last) {
			continue;
		}
		const insert = g.extAxes.length ? `,\t${text}` : `,${eol}\t${text}`;
		changes.push({ line: last.line, start: last.end, end: last.end, text: insert });
	}
	return changes;
}

/** Positionen, in denen die externe Achse einen Wert ungleich 0 hat. */
export function nonZeroExtAxis(data: PosData, group: number, name: string): number[] {
	const ids: number[] = [];
	for (const b of data.blocks) {
		const a = b.groups.find((x) => x.group === group)?.extAxes.find((x) => x.name === name);
		if (a && Math.abs(a.value) > 1e-9) {
			ids.push(b.id);
		}
	}
	return ids;
}

export function removeExtAxisChanges(data: PosData, group: number, name: string): TextChange[] {
	const changes: TextChange[] = [];
	for (const b of data.blocks) {
		const g = b.groups.find((x) => x.group === group);
		if (!g || !g.extAxes.some((a) => a.name === name)) {
			continue;
		}
		const first = g.extAxes[0];
		const last = g.extAxes[g.extAxes.length - 1];
		const remaining = g.extAxes.filter((a) => a.name !== name);
		if (remaining.length === 0) {
			// Komma hinter der letzten Achse und die E-Zeile(n) entfernen
			const prev = g.axes[g.axes.length - 1];
			if (!prev) {
				continue;
			}
			changes.push({
				line: prev.line,
				start: prev.end,
				endLine: last.line,
				end: (data.lines[last.line] ?? '').length,
				text: ''
			});
		} else {
			changes.push({
				line: first.line,
				start: first.start,
				endLine: last.line,
				end: last.end,
				text: remaining.map((a) => formatAxis(a.name, a.value, a.unit)).join(',\t')
			});
		}
	}
	return changes;
}

// --- Änderungen: Bewegungsgruppen --------------------------------------------

function setMaskChange(data: PosData, group: number, on: boolean): TextChange[] {
	const dg = data.defaultGroup;
	if (!dg || dg.mask[group - 1] === on) {
		return [];
	}
	const mask = [...dg.mask];
	mask[group - 1] = on;
	return [{ line: dg.line, start: dg.valueStart, end: dg.valueEnd, text: formatDefaultGroup(mask) }];
}

/** Achsaufbau einer Gruppe aus einer vorhandenen Position übernehmen. */
export function groupTemplate(data: PosData, group: number): GroupBlock | undefined {
	for (const b of data.blocks) {
		const g = b.groups.find((x) => x.group === group);
		if (g && g.axes.length) {
			return g;
		}
	}
	return undefined;
}

export interface NewGroupSpec {
	/** Anzahl Achsen, Darstellung in Achswerten J1..Jn */
	axes: number;
	unit: 'mm' | 'deg';
}

/**
 * Aktiviert eine Gruppe in DEFAULT_GROUP und ergänzt sie in allen Positionen, denen sie fehlt.
 * Aufbau aus einer vorhandenen Position der Gruppe, sonst nach `spec`.
 */
export function addGroupChanges(data: PosData, group: number, spec: NewGroupSpec | undefined, eol: string): TextChange[] {
	const changes = setMaskChange(data, group, true);
	const tpl = groupTemplate(data, group);
	const axes = tpl
		? tpl.axes.map((a) => ({ name: a.name, value: 0, unit: a.unit }))
		: Array.from({ length: spec?.axes ?? 1 }, (_, i) => ({ name: `J${i + 1}`, value: 0, unit: spec?.unit ?? 'deg' }));
	const ext = tpl ? tpl.extAxes.map((a) => ({ name: a.name, value: 0, unit: a.unit })) : [];
	const frame = tpl?.frameLine ?? '\tUF : 0, UT : 1,';
	for (const b of data.blocks) {
		if (b.kind !== 'P' || b.groups.some((g) => g.group === group)) {
			continue;
		}
		changes.push({
			line: b.closeLine,
			start: 0,
			end: 0,
			text: groupBlockText(group, frame, axes, ext, eol) + eol
		});
	}
	return changes;
}

/** Deaktiviert eine Gruppe in DEFAULT_GROUP und entfernt ihre Daten aus allen Positionen. */
export function removeGroupChanges(data: PosData, group: number): TextChange[] {
	const changes = setMaskChange(data, group, false);
	for (const b of data.blocks) {
		for (const g of b.groups) {
			if (g.group === group) {
				changes.push({ line: g.headerLine, start: 0, endLine: g.endLine, end: 0, text: '' });
			}
		}
	}
	return changes;
}

// --- Änderungen: neue Position ------------------------------------------------

/**
 * Legt P[id] im /POS-Block an - mit allen aktiven Gruppen und externen Achsen,
 * Werte 0, Kommentar zum Teachen.
 */
export function newPositionChanges(data: PosData, id: number, comment: string, eol: string): TextChange[] {
	if (!data.pos || data.blocks.some((b) => b.kind === 'P' && b.id === id)) {
		return [];
	}
	const groups = data.defaultGroup ? activeGroups(data.defaultGroup.mask) : [1];
	const parts: string[] = [];
	for (const g of groups.length ? groups : [1]) {
		const tpl = groupTemplate(data, g);
		if (tpl) {
			parts.push(
				groupBlockText(
					g,
					tpl.frameLine ?? '\tUF : 0, UT : 1,',
					tpl.axes.map((a) => ({ name: a.name, value: 0, unit: a.unit })),
					tpl.extAxes.map((a) => ({ name: a.name, value: 0, unit: a.unit })),
					eol
				)
			);
		} else if (g === 1) {
			parts.push(
				groupBlockText(
					1,
					"\tUF : 0, UT : 1,\t\tCONFIG : 'N U T, 0, 0, 0',",
					['X', 'Y', 'Z'].map((n) => ({ name: n, value: 0, unit: 'mm' })).concat(
						['W', 'P', 'R'].map((n) => ({ name: n, value: 0, unit: 'deg' }))
					),
					[],
					eol
				)
			);
		} else {
			parts.push(groupBlockText(g, '\tUF : 0, UT : 1,', [{ name: 'J1', value: 0, unit: 'deg' }], [], eol));
		}
	}
	const head = comment ? `P[${id}:"${comment.replace(/["\]]/g, '')}"]{` : `P[${id}]{`;
	const text = [head, ...parts, '};'].join(eol) + eol;
	const next = data.blocks.find((b) => b.kind === 'P' && b.id > id);
	const line = next ? next.line : data.pos.end;
	return [{ line, start: 0, end: 0, text }];
}
