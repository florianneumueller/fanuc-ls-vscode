import * as vscode from 'vscode';
import * as path from 'path';
import { ControllerConfig, getControllers } from './config';
import { ControllerProgramIndex, PROGRAM_DEVICE } from './controllerPrograms';
import { checkGroups, parsePositions } from './posData';
import { formatRanges, inRanges, parseRanges } from './ioCore';
import { DtProgram, checkCallArguments, splitCallArgs } from './dtCore';
import {
	isValidProgramName,
	parse,
	ParsedProgram,
	TpLine,
	findReferences,
	parseMotion,
	withoutCommentsAndStrings
} from './parser';

export const DIAG_SOURCE = 'fanuc-ls';

export const enum Code {
	MissingSection = 'missing-section',
	LineSequence = 'line-sequence',
	MissingSemicolon = 'missing-semicolon',
	LineCount = 'line-count',
	UndefinedPosition = 'undefined-position',
	UnusedPosition = 'unused-position',
	DuplicatePosition = 'duplicate-position',
	UndefinedLabel = 'undefined-label',
	DuplicateLabel = 'duplicate-label',
	UnusedLabel = 'unused-label',
	ProgramName = 'program-name',
	InvalidProgramName = 'invalid-program-name',
	SpeedUnit = 'speed-unit',
	SpeedRange = 'speed-range',
	Termination = 'termination',
	Block = 'block',
	Brackets = 'brackets',
	IndexRange = 'index-range',
	CallTarget = 'call-target',
	CallTargetController = 'call-target-controller',
	CallArguments = 'call-arguments',
	LineFormat = 'line-format',
	GroupNone = 'group-none',
	GroupMissing = 'group-missing',
	GroupExtra = 'group-extra',
	ExtAxisMismatch = 'ext-axis-mismatch'
}

const MOTION_TYPES = new Set(['J', 'L', 'C', 'A', 'S']);

let programCache: { names: Set<string>; stamp: number } | undefined;

async function workspacePrograms(): Promise<Set<string>> {
	const now = Date.now();
	if (programCache && now - programCache.stamp < 15000) {
		return programCache.names;
	}
	const names = new Set<string>();
	try {
		const files = await vscode.workspace.findFiles('**/*.{ls,LS,tp,TP,pc,PC}', '**/node_modules/**', 5000);
		for (const f of files) {
			names.add(path.basename(f.fsPath).replace(/\.[^.]+$/, '').toUpperCase());
		}
	} catch {
		/* Workspace nicht verfügbar */
	}
	programCache = { names, stamp: now };
	return names;
}

/** Quelle für die Prüfung der CALL-Ziele gegen die Steuerung (wird beim Aktivieren gesetzt). */
export interface CallTargetSource {
	index: ControllerProgramIndex;
	/** Name des Controllers, von dem die lokale Datei stammt */
	originOf(fsPath: string): Promise<string | undefined>;
}

let callSource: CallTargetSource | undefined;

export function setCallTargetSource(source: CallTargetSource): void {
	callSource = source;
}

/** Ist ein Signal in einer importierten E/A-Liste enthalten? Dann gilt es als gültig konfiguriert. */
/** Argumentbeschreibungen aus ARGDISP-Dateien (Wizard to input arguments). */
let dtLookup: ((name: string) => DtProgram | undefined) | undefined;

export function setDtLookup(fn: (name: string) => DtProgram | undefined): void {
	dtLookup = fn;
}

let ioConfigured: ((type: string, index: number) => boolean) | undefined;

export function setIoLookup(fn: (type: string, index: number) => boolean): void {
	ioConfigured = fn;
}

export function invalidateProgramCache(): void {
	programCache = undefined;
}

export async function validate(doc: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
	const cfg = vscode.workspace.getConfiguration('fanucLs', doc.uri);
	if (!cfg.get<boolean>('validation.enable', true)) {
		return [];
	}

	const program = parse(doc.getText());
	const out: vscode.Diagnostic[] = [];
	const push = (
		range: vscode.Range,
		message: string,
		severity: vscode.DiagnosticSeverity,
		code: Code,
		tags?: vscode.DiagnosticTag[]
	) => {
		const d = new vscode.Diagnostic(range, message, severity);
		d.source = DIAG_SOURCE;
		d.code = code;
		if (tags) {
			d.tags = tags;
		}
		out.push(d);
	};

	checkSections(program, push);
	checkProgramName(program, doc, cfg, push);
	checkTpLines(program, cfg, push);
	checkLineCount(program, cfg, push);
	checkPositions(program, cfg, push);
	checkLabels(program, cfg, push);
	checkBlocks(program, push);

	if (cfg.get<boolean>('validation.checkGroups', true)) {
		for (const issue of checkGroups(parsePositions(doc.getText()))) {
			push(
				new vscode.Range(issue.line, issue.start, issue.line, Math.max(issue.end, issue.start + 1)),
				issue.message,
				issue.severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
				issue.code as Code
			);
		}
	}

	await checkCalls(program, doc, cfg, push);
	if (dtLookup && cfg.get<boolean>('validation.checkCallArguments', true)) {
		checkCallArgs(program, push);
	}

	return out;
}

type Push = (
	range: vscode.Range,
	message: string,
	severity: vscode.DiagnosticSeverity,
	code: Code,
	tags?: vscode.DiagnosticTag[]
) => void;

// ---------------------------------------------------------------------------

function lineRange(program: ParsedProgram, line: number): vscode.Range {
	const len = (program.lines[line] ?? '').length;
	return new vscode.Range(line, 0, line, Math.max(len, 1));
}

/** Bildet einen Index innerhalb des Anweisungstextes auf einen Dokumentbereich ab. */
function mapRange(program: ParsedProgram, tp: TpLine, index: number, length: number): vscode.Range {
	if (tp.continuation.length === 0) {
		const start = tp.col + index;
		if (start <= tp.raw.length) {
			return new vscode.Range(tp.line, start, tp.line, Math.min(start + length, tp.raw.length));
		}
	}
	return lineRange(program, tp.line);
}

function checkSections(program: ParsedProgram, push: Push): void {
	const required: [string, vscode.DiagnosticSeverity][] = [
		['PROG', vscode.DiagnosticSeverity.Error],
		['ATTR', vscode.DiagnosticSeverity.Warning],
		['MN', vscode.DiagnosticSeverity.Error],
		['END', vscode.DiagnosticSeverity.Warning]
	];
	const missing = required.filter(([name]) => !program.sections.has(name));
	if (missing.length === required.length && program.lines.every((l) => l.trim() === '')) {
		return; // leere Datei nicht bemängeln
	}
	for (const [name, sev] of missing) {
		push(
			new vscode.Range(0, 0, 0, Math.max((program.lines[0] ?? '').length, 1)),
			`Abschnitt /${name} fehlt. Ein vollständiges LS-Listing besteht aus /PROG, /ATTR, /MN, /POS und /END.`,
			sev,
			Code.MissingSection
		);
	}
}

function checkProgramName(
	program: ParsedProgram,
	doc: vscode.TextDocument,
	cfg: vscode.WorkspaceConfiguration,
	push: Push
): void {
	if (!program.sections.has('PROG')) {
		return;
	}
	const range =
		program.progNameLine >= 0
			? new vscode.Range(
					program.progNameLine,
					program.progNameCol,
					program.progNameLine,
					program.progNameCol + Math.max(program.progNameLength, 1)
			  )
			: new vscode.Range(0, 0, 0, 1);

	if (!program.progName) {
		push(range, 'Nach /PROG fehlt der Programmname.', vscode.DiagnosticSeverity.Error, Code.InvalidProgramName);
		return;
	}
	if (!isValidProgramName(program.progName)) {
		push(
			range,
			`Ungültiger Programmname "${program.progName}". Erlaubt sind Buchstaben, Ziffern und Unterstrich.`,
			vscode.DiagnosticSeverity.Error,
			Code.InvalidProgramName
		);
	} else if (program.progName.length > 36) {
		push(
			range,
			`Programmname ist ${program.progName.length} Zeichen lang. Die Steuerung akzeptiert maximal 36 Zeichen.`,
			vscode.DiagnosticSeverity.Warning,
			Code.InvalidProgramName
		);
	}

	if (cfg.get<boolean>('validation.checkProgramName', true) && doc.uri.scheme !== 'untitled') {
		const base = path.basename(doc.uri.fsPath).replace(/\.[^.]+$/, '');
		if (base && base.toUpperCase() !== program.progName.toUpperCase()) {
			push(
				range,
				`Programmname "${program.progName}" weicht vom Dateinamen "${base}" ab. Beim Laden auf die Steuerung zählt der Name im /PROG-Header.`,
				vscode.DiagnosticSeverity.Warning,
				Code.ProgramName
			);
		}
	}
}

function checkTpLines(program: ParsedProgram, cfg: vscode.WorkspaceConfiguration, push: Push): void {
	const checkNumbers = cfg.get<boolean>('validation.checkLineNumbers', true);
	const checkMotion = cfg.get<boolean>('validation.checkMotion', true);
	const checkFormat = cfg.get<boolean>('validation.checkLineFormat', false);
	const maxLinear = cfg.get<number>('validation.maxLinearSpeed', 2000);
	const limits = cfg.get<Record<string, number | string>>('validation.limits', {});

	program.tpLines.forEach((tp, idx) => {
		// Zeilennummern
		if (checkNumbers && tp.num !== idx + 1) {
			const col = tp.raw.indexOf(String(tp.num));
			push(
				new vscode.Range(tp.line, Math.max(col, 0), tp.line, Math.max(col, 0) + String(tp.num).length),
				`Zeilennummer ${tp.num} erwartet wurde ${idx + 1}. Die Steuerung erwartet eine lücken- und sprungfreie Nummerierung.`,
				vscode.DiagnosticSeverity.Warning,
				Code.LineSequence
			);
		}

		// Semikolon
		if (!tp.terminated) {
			push(
				lineRange(program, tp.line + tp.continuation.length),
				'Anweisung ist nicht mit ";" abgeschlossen.',
				vscode.DiagnosticSeverity.Error,
				Code.MissingSemicolon
			);
		}

		// Klammern
		const clean = withoutCommentsAndStrings(tp.text);
		if (count(clean, '[') !== count(clean, ']') || count(clean, '(') !== count(clean, ')')) {
			push(
				lineRange(program, tp.line),
				'Klammern sind nicht ausgeglichen.',
				vscode.DiagnosticSeverity.Error,
				Code.Brackets
			);
		}

		// Indexbereiche
		for (const ref of findReferences(tp.text)) {
			const ranges = parseRanges(limits[ref.type]);
			if (ranges && ref.id > 0 && !inRanges(ranges, ref.id) && !ioConfigured?.(ref.type, ref.id)) {
				push(
					mapRange(program, tp, ref.index, ref.length),
					`${ref.type}[${ref.id}] liegt außerhalb der konfigurierten Bereiche (${formatRanges(ranges)}). Bereiche unter "fanucLs.validation.limits" anpassen oder die E/A-Liste vom Controller importieren.`,
					vscode.DiagnosticSeverity.Warning,
					Code.IndexRange
				);
			}
			if (ref.id === 0 && ref.type !== 'LBL' && ref.type !== 'UFRAME') {
				push(
					mapRange(program, tp, ref.index, ref.length),
					`${ref.type}[0] ist kein gültiger Index; die Zählung beginnt bei 1.`,
					vscode.DiagnosticSeverity.Error,
					Code.IndexRange
				);
			}
		}

		// UTOOL_NUM / UFRAME_NUM
		checkFrameNumber(program, tp, clean, 'UTOOL_NUM', 1, maxOf(limits['UTOOL'], 10), push);
		checkFrameNumber(program, tp, clean, 'UFRAME_NUM', 0, maxOf(limits['UFRAME'], 10), push);

		// Bewegungsbefehle
		const motion = checkMotion ? parseMotion(tp.text) : undefined;
		if (motion) {
			checkMotionLine(program, tp, motion, maxLinear, push);
		}

		// Zeilenformat
		if (checkFormat) {
			const expected =
				String(tp.num).padStart(4, ' ') + ':' + (motion || MOTION_TYPES.has(tp.text.charAt(0)) ? '' : '  ');
			const actual = tp.raw.slice(0, expected.length);
			if (actual !== expected) {
				push(
					new vscode.Range(tp.line, 0, tp.line, Math.max(expected.length, 1)),
					`Abweichendes Zeilenformat. Erwartet: "${expected.replace(/ /g, '\u00b7')}".`,
					vscode.DiagnosticSeverity.Information,
					Code.LineFormat
				);
			}
		}
	});
}

function checkFrameNumber(
	program: ParsedProgram,
	tp: TpLine,
	clean: string,
	keyword: string,
	min: number,
	max: number,
	push: Push
): void {
	const re = new RegExp(keyword + '\\s*=\\s*(\\d+)');
	const m = re.exec(clean);
	if (!m || max <= 0) {
		return;
	}
	const value = parseInt(m[1], 10);
	if (value < min || value > max) {
		push(
			mapRange(program, tp, m.index, m[0].length),
			`${keyword}=${value} liegt außerhalb des gültigen Bereichs ${min}..${max}.`,
			vscode.DiagnosticSeverity.Warning,
			Code.IndexRange
		);
	}
}

function checkMotionLine(
	program: ParsedProgram,
	tp: TpLine,
	motion: ReturnType<typeof parseMotion>,
	maxLinear: number,
	push: Push
): void {
	if (!motion) {
		return;
	}
	const isJoint = motion.type === 'J';

	if (!motion.speedUnit) {
		push(
			lineRange(program, tp.line),
			'Bewegungsbefehl ohne Geschwindigkeitsangabe.',
			vscode.DiagnosticSeverity.Error,
			Code.SpeedUnit
		);
	} else if (motion.speedUnit !== 'max_speed') {
		const range = mapRange(program, tp, motion.speedIndex ?? 0, motion.speedLength ?? 1);
		if (isJoint && motion.speedUnit !== '%') {
			push(
				range,
				`Achsbewegung J wird in Prozent programmiert, nicht in ${motion.speedUnit}.`,
				vscode.DiagnosticSeverity.Error,
				Code.SpeedUnit
			);
		} else if (!isJoint && motion.speedUnit === '%') {
			push(
				range,
				`Bahnbewegung ${motion.type} benötigt eine Bahngeschwindigkeit (mm/sec, cm/min, inch/min, sec oder msec), kein Prozent.`,
				vscode.DiagnosticSeverity.Error,
				Code.SpeedUnit
			);
		} else if (isJoint && (motion.speedValue ?? 0) > 100) {
			push(
				range,
				`Achsgeschwindigkeit ${motion.speedValue}% ist größer als 100%.`,
				vscode.DiagnosticSeverity.Error,
				Code.SpeedRange
			);
		} else if (
			!isJoint &&
			motion.speedUnit === 'mm/sec' &&
			maxLinear > 0 &&
			(motion.speedValue ?? 0) > maxLinear
		) {
			push(
				range,
				`Bahngeschwindigkeit ${motion.speedValue}mm/sec liegt über der Warnschwelle von ${maxLinear}mm/sec.`,
				vscode.DiagnosticSeverity.Warning,
				Code.SpeedRange
			);
		}
	}

	if (!motion.termination) {
		push(
			lineRange(program, tp.line),
			'Bewegungsbefehl ohne Überschleifart (FINE oder CNTn).',
			vscode.DiagnosticSeverity.Error,
			Code.Termination
		);
	} else {
		const cnt = /^CNT(\d+)$/.exec(motion.termination);
		if (cnt && parseInt(cnt[1], 10) > 100) {
			push(
				mapRange(program, tp, motion.terminationIndex ?? 0, motion.terminationLength ?? 1),
				`CNT${cnt[1]} ist ungültig; zulässig ist CNT0 bis CNT100.`,
				vscode.DiagnosticSeverity.Error,
				Code.Termination
			);
		}
	}
}

function checkLineCount(program: ParsedProgram, cfg: vscode.WorkspaceConfiguration, push: Push): void {
	if (!cfg.get<boolean>('validation.checkLineCount', true)) {
		return;
	}
	const attr = program.attrs.get('LINE_COUNT');
	if (!attr) {
		return;
	}
	const declared = parseInt(attr.value, 10);
	const actual = program.tpLines.length;
	if (!isNaN(declared) && declared !== actual) {
		push(
			new vscode.Range(attr.line, attr.valueStart, attr.line, attr.valueEnd),
			`LINE_COUNT = ${declared}, der /MN-Abschnitt enthält aber ${actual} Zeilen.`,
			vscode.DiagnosticSeverity.Warning,
			Code.LineCount
		);
	}
}

function checkPositions(program: ParsedProgram, cfg: vscode.WorkspaceConfiguration, push: Push): void {
	if (!cfg.get<boolean>('validation.checkPositions', true) || !program.sections.has('POS')) {
		return;
	}

	const defined = new Map<number, number>(); // id -> Anzahl
	for (const p of program.positions) {
		if (p.kind !== 'P') {
			continue;
		}
		const seen = defined.get(p.id) ?? 0;
		defined.set(p.id, seen + 1);
		if (seen > 0) {
			push(
				new vscode.Range(p.line, p.col, p.line, p.col + Math.max(p.length, 1)),
				`P[${p.id}] ist im /POS-Abschnitt mehrfach definiert.`,
				vscode.DiagnosticSeverity.Error,
				Code.DuplicatePosition
			);
		}
	}

	const used = new Set<number>();
	for (const tp of program.tpLines) {
		for (const ref of findReferences(tp.text)) {
			if (ref.type !== 'P') {
				continue;
			}
			used.add(ref.id);
			if (!defined.has(ref.id)) {
				push(
					mapRange(program, tp, ref.index, ref.length),
					`P[${ref.id}] wird verwendet, ist im /POS-Abschnitt aber nicht definiert.`,
					vscode.DiagnosticSeverity.Error,
					Code.UndefinedPosition
				);
			}
		}
	}

	if (cfg.get<boolean>('validation.reportUnusedPositions', true)) {
		for (const p of program.positions) {
			if (p.kind === 'P' && !used.has(p.id)) {
				push(
					new vscode.Range(p.line, p.col, p.line, p.col + Math.max(p.length, 1)),
					`P[${p.id}] ist definiert, wird im Programm aber nicht verwendet.`,
					vscode.DiagnosticSeverity.Information,
					Code.UnusedPosition,
					[vscode.DiagnosticTag.Unnecessary]
				);
			}
		}
	}
}

function checkLabels(program: ParsedProgram, cfg: vscode.WorkspaceConfiguration, push: Push): void {
	if (!cfg.get<boolean>('validation.checkLabels', true)) {
		return;
	}
	const defined = new Map<number, TpLine>();
	const used = new Set<number>();

	for (const tp of program.tpLines) {
		const text = tp.text.trim();
		const def = /^LBL\s*\[\s*(\d+)/.exec(text);
		if (def) {
			const id = parseInt(def[1], 10);
			if (defined.has(id)) {
				push(
					lineRange(program, tp.line),
					`LBL[${id}] ist mehrfach definiert (zuerst in Zeile ${defined.get(id)!.num}).`,
					vscode.DiagnosticSeverity.Error,
					Code.DuplicateLabel
				);
			} else {
				defined.set(id, tp);
			}
			continue;
		}
		for (const ref of findReferences(tp.text)) {
			if (ref.type === 'LBL') {
				used.add(ref.id);
			}
		}
	}

	for (const tp of program.tpLines) {
		if (/^LBL\s*\[/.test(tp.text.trim())) {
			continue;
		}
		for (const ref of findReferences(tp.text)) {
			if (ref.type === 'LBL' && !defined.has(ref.id)) {
				push(
					mapRange(program, tp, ref.index, ref.length),
					`Sprungziel LBL[${ref.id}] ist im Programm nicht definiert.`,
					vscode.DiagnosticSeverity.Error,
					Code.UndefinedLabel
				);
			}
		}
	}

	for (const [id, tp] of defined) {
		if (!used.has(id)) {
			push(
				lineRange(program, tp.line),
				`LBL[${id}] wird nie angesprungen.`,
				vscode.DiagnosticSeverity.Information,
				Code.UnusedLabel,
				[vscode.DiagnosticTag.Unnecessary]
			);
		}
	}
}

function checkBlocks(program: ParsedProgram, push: Push): void {
	const stack: { kind: 'IF' | 'FOR'; tp: TpLine }[] = [];

	for (const tp of program.tpLines) {
		const t = withoutCommentsAndStrings(tp.text).trim().toUpperCase();
		if (/^IF\b/.test(t) && /\bTHEN\b/.test(t)) {
			stack.push({ kind: 'IF', tp });
		} else if (/^FOR\b/.test(t)) {
			stack.push({ kind: 'FOR', tp });
		} else if (/^ENDIF\b/.test(t)) {
			const top = stack.pop();
			if (!top || top.kind !== 'IF') {
				push(lineRange(program, tp.line), 'ENDIF ohne zugehöriges IF ... THEN.', vscode.DiagnosticSeverity.Error, Code.Block);
				if (top) {
					stack.push(top);
				}
			}
		} else if (/^ENDFOR\b/.test(t)) {
			const top = stack.pop();
			if (!top || top.kind !== 'FOR') {
				push(lineRange(program, tp.line), 'ENDFOR ohne zugehöriges FOR.', vscode.DiagnosticSeverity.Error, Code.Block);
				if (top) {
					stack.push(top);
				}
			}
		} else if (/^ELSE\b/.test(t)) {
			if (!stack.some((s) => s.kind === 'IF')) {
				push(lineRange(program, tp.line), 'ELSE ohne zugehöriges IF ... THEN.', vscode.DiagnosticSeverity.Error, Code.Block);
			}
		}
	}

	for (const open of stack) {
		push(
			lineRange(program, open.tp.line),
			open.kind === 'IF' ? 'IF ... THEN wird nicht mit ENDIF abgeschlossen.' : 'FOR wird nicht mit ENDFOR abgeschlossen.',
			vscode.DiagnosticSeverity.Error,
			Code.Block
		);
	}
}

/** Controller, gegen die die CALL-Ziele dieser Datei geprüft werden. */
async function callControllers(doc: vscode.TextDocument, cfg: vscode.WorkspaceConfiguration): Promise<ControllerConfig[]> {
	const mode = cfg.get<string>('validation.checkCallTargetsOnController', 'origin');
	if (!callSource || mode === 'off' || doc.uri.scheme !== 'file') {
		return [];
	}
	const all = getControllers();
	if (mode === 'all') {
		return all;
	}
	const origin = await callSource.originOf(doc.uri.fsPath);
	return all.filter((c) => c.name === origin);
}

async function checkCalls(
	program: ParsedProgram,
	doc: vscode.TextDocument,
	cfg: vscode.WorkspaceConfiguration,
	push: Push
): Promise<void> {
	const checkWorkspace = cfg.get<boolean>('validation.checkCallTargets', true);
	const calls: { tp: TpLine; name: string; index: number }[] = [];
	for (const tp of program.tpLines) {
		const clean = withoutCommentsAndStrings(tp.text);
		const re = /\b(?:CALL|RUN)\s+([A-Za-z0-9_]+)/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(clean)) !== null) {
			calls.push({ tp, name: m[1], index: m.index + m[0].length - m[1].length });
		}
	}
	if (calls.length === 0) {
		return;
	}

	// Programmlisten der Steuerungen - nur die bereits geladenen, das Laden läuft im Hintergrund
	const controllers = await callControllers(doc, cfg);
	const lists = controllers
		.map((c) => ({ controller: c, names: callSource!.index.lookup(c).names }))
		.filter((l): l is { controller: ControllerConfig; names: Set<string> } => !!l.names);

	const known = checkWorkspace ? await workspacePrograms() : new Set<string>();
	const self = (program.progName ?? path.basename(doc.uri.fsPath).replace(/\.[^.]+$/, '')).toUpperCase();
	for (const call of calls) {
		const name = call.name.toUpperCase();
		if (name === self) {
			continue;
		}
		if (lists.length > 0) {
			if (!lists.some((l) => l.names.has(name))) {
				const where = lists.map((l) => l.controller.name).join(', ');
				push(
					mapRange(program, call.tp, call.index, call.name.length),
					`"${call.name}" ist auf ${where} (${PROGRAM_DEVICE}) nicht vorhanden.` +
						(known.has(name) ? ' Im Workspace gibt es eine Datei dazu - noch nicht übertragen?' : ''),
					vscode.DiagnosticSeverity.Warning,
					Code.CallTargetController
				);
			}
			continue;
		}
		if (!checkWorkspace || known.size === 0 || known.has(name)) {
			continue;
		}
		push(
			mapRange(program, call.tp, call.index, call.name.length),
			`Zu "${call.name}" wurde im Workspace keine Programmdatei gefunden. Auf der Steuerung kann das Programm trotzdem vorhanden sein.`,
			vscode.DiagnosticSeverity.Information,
			Code.CallTarget
		);
	}
}

/** CALL-Argumente gegen die Beschreibung in einer ARGDISP-Datei prüfen. */
function checkCallArgs(program: ParsedProgram, push: Push): void {
	for (const tp of program.tpLines) {
		const re = /\b(?:CALL|RUN)\s+([A-Za-z0-9_]+)\s*\(/g;
		let m: RegExpExecArray | null;
		while ((m = re.exec(tp.text)) !== null) {
			const def = dtLookup!(m[1]);
			if (!def) {
				continue;
			}
			const open = m.index + m[0].length;
			let depth = 1;
			let quote: string | undefined;
			let close = -1;
			for (let i = open; i < tp.text.length; i++) {
				const c = tp.text[i];
				if (quote) {
					if (c === quote) {
						quote = undefined;
					}
				} else if (c === "'" || c === '"') {
					quote = c;
				} else if (c === '(') {
					depth++;
				} else if (c === ')' && --depth === 0) {
					close = i;
					break;
				}
			}
			if (close < 0) {
				continue;
			}
			const args = splitCallArgs(tp.text.slice(open, close), open);
			for (const issue of checkCallArguments(def, args)) {
				const a = issue.argIndex >= 0 ? args[issue.argIndex] : undefined;
				push(
					a ? mapRange(program, tp, a.start, a.end - a.start) : mapRange(program, tp, m.index, close + 1 - m.index),
					issue.message,
					issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information,
					Code.CallArguments
				);
			}
		}
	}
}

/** Obergrenze aus einem Grenzwert (Zahl oder Bereiche); 0 = keine Prüfung. */
function maxOf(limit: number | string | undefined, fallback: number): number {
	if (limit === undefined) {
		return fallback;
	}
	const ranges = parseRanges(limit);
	return ranges ? Math.max(...ranges.map((r) => r.to)) : 0;
}

function count(s: string, ch: string): number {
	let n = 0;
	for (let i = 0; i < s.length; i++) {
		if (s[i] === ch) {
			n++;
		}
	}
	return n;
}
