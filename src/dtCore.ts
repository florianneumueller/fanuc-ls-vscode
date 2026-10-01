/**
 * ARGDISP-Dateien (.DT) für "Wizard to input arguments" - ohne VS-Code-Abhängigkeit, damit testbar.
 * Grundlage: FANUC MAROUHT9307191E REV B, Kap. 7.9.5.
 *
 *   [PROGRAM]          {Kommentar in geschweiften Klammern}
 *   NAME = "TRACKING"
 *   ARGUMENT = '6'
 *   [ARGUMENT]
 *   S01 = "Area Name"
 *   N02 = "VR num":'10'          Vorgabewert, auch :(R) oder :(AR)
 *   V05 = "NOT-CONSEC":'1', "CONSECUTIVE":'2'
 *   W06 = "NO_WELD", "WELD001"
 *   [ENDPROGRAM]
 *
 * Dateiname: ARGDISP + Sprache (EG, KN, GR, ...) + 01..99 + .DT; laden von MC: mit F3 [LOAD], danach Neustart.
 */
import { TextChange } from './textChange';

export type DtArgKind = 'N' | 'S' | 'V' | 'W';

export const DT_LIMITS = {
	nameLength: 36,
	maxArguments: 30,
	labelLength: 15,
	macroNameLength: 15,
	maxListItems: 35,
	stringItemLength: 34,
	maxPrograms: 1000,
	intMin: -16777216,
	intMax: 16777216,
	significantDigits: 6
};

export const DT_LANGUAGES: Record<string, string> = {
	EG: 'Englisch',
	KN: 'Japanisch (Kanji)',
	JP: 'Japanisch (Katakana, alte Software)',
	GR: 'Deutsch',
	FR: 'Französisch',
	SP: 'Spanisch',
	CH: 'Chinesisch',
	TW: 'Taiwanesisch',
	CS: 'Tschechisch',
	OT: 'Andere'
};

export const DT_KIND_NAMES: Record<DtArgKind, string> = {
	N: 'Zahl',
	S: 'Zeichenkette',
	V: 'Makro-Auswahl',
	W: 'String-Auswahl'
};

export interface DtSpan {
	line: number;
	start: number;
	end: number;
}

export interface DtChoice {
	label: string;
	/** Wert bei V; bei W identisch mit label */
	value: string;
	span: DtSpan;
}

export interface DtArgument {
	kind: DtArgKind;
	/** Argumentnummer (1 = AR[1]) */
	index: number;
	key: string;
	/** Bedeutung (N, S) bzw. zusammengefasste Auswahl (V, W) */
	label: string;
	/** Vorgabewert bei N/S: '10', "Booth1", (R), (AR), (SR) */
	defaultValue?: string;
	choices: DtChoice[];
	keySpan: DtSpan;
	span: DtSpan;
}

export interface DtProgram {
	name?: string;
	nameSpan?: DtSpan;
	argumentCount?: number;
	argumentSpan?: DtSpan;
	/** Zeile von [PROGRAM] */
	line: number;
	/** Zeile von [ENDPROGRAM] bzw. letzte Zeile des Blocks */
	endLine: number;
	closed: boolean;
	args: DtArgument[];
}

export type DtIssueCode =
	| 'dt-section'
	| 'dt-structure'
	| 'dt-name'
	| 'dt-program-key'
	| 'dt-syntax'
	| 'dt-arg-key'
	| 'dt-arg-duplicate'
	| 'dt-arg-range'
	| 'dt-arg-count'
	| 'dt-arg-gap'
	| 'dt-length'
	| 'dt-value'
	| 'dt-char'
	| 'dt-limit'
	| 'dt-duplicate-program'
	| 'dt-unclosed'
	| 'dt-trailing';

export interface DtIssue extends DtSpan {
	code: DtIssueCode;
	severity: 'error' | 'warning' | 'info';
	message: string;
}

export interface DtFile {
	programs: DtProgram[];
	issues: DtIssue[];
	/** Kommentarbereiche { ... } */
	comments: DtSpan[];
}

interface Token {
	type: 'dq' | 'sq' | 'colon' | 'comma' | 'paren' | 'word';
	text: string;
	line: number;
	start: number;
	end: number;
}

const FORBIDDEN = /[,;:'"\t]/;

/** Ersetzt Kommentare { ... } durch Leerzeichen (auch über mehrere Zeilen), Zeichenketten bleiben unberührt. */
export function stripDtComments(lines: string[]): { lines: string[]; comments: DtSpan[] } {
	const out: string[] = [];
	const comments: DtSpan[] = [];
	let inComment = false;
	let commentStart = 0;
	for (let li = 0; li < lines.length; li++) {
		const l = lines[li];
		let res = '';
		let quote: string | undefined;
		if (inComment) {
			commentStart = 0;
		}
		for (let i = 0; i < l.length; i++) {
			const c = l[i];
			if (inComment) {
				res += ' ';
				if (c === '}') {
					inComment = false;
					comments.push({ line: li, start: commentStart, end: i + 1 });
				}
				continue;
			}
			if (quote) {
				res += c;
				if (c === quote) {
					quote = undefined;
				}
				continue;
			}
			if (c === '"' || c === "'") {
				quote = c;
				res += c;
			} else if (c === '{') {
				inComment = true;
				commentStart = i;
				res += ' ';
			} else {
				res += c;
			}
		}
		if (inComment) {
			comments.push({ line: li, start: commentStart, end: l.length });
		}
		out.push(res);
	}
	return { lines: out, comments };
}

function tokenize(s: string, offset: number, line: number): { tokens: Token[]; error?: { pos: number; message: string } } {
	const tokens: Token[] = [];
	let i = 0;
	while (i < s.length) {
		const c = s[i];
		if (c === ' ' || c === '\t') {
			i++;
		} else if (c === '"' || c === "'") {
			const close = s.indexOf(c, i + 1);
			if (close < 0) {
				return { tokens, error: { pos: offset + i, message: `Zeichenkette ohne schließendes ${c}` } };
			}
			tokens.push({ type: c === '"' ? 'dq' : 'sq', text: s.slice(i + 1, close), line, start: offset + i, end: offset + close + 1 });
			i = close + 1;
		} else if (c === '(') {
			const close = s.indexOf(')', i + 1);
			if (close < 0) {
				return { tokens, error: { pos: offset + i, message: 'Klammer ohne schließendes )' } };
			}
			tokens.push({ type: 'paren', text: s.slice(i + 1, close).trim(), line, start: offset + i, end: offset + close + 1 });
			i = close + 1;
		} else if (c === ':' || c === ',') {
			tokens.push({ type: c === ':' ? 'colon' : 'comma', text: c, line, start: offset + i, end: offset + i + 1 });
			i++;
		} else {
			const m = /^[^\s"':,()]+/.exec(s.slice(i))!;
			tokens.push({ type: 'word', text: m[0], line, start: offset + i, end: offset + i + m[0].length });
			i += m[0].length;
		}
	}
	return { tokens };
}

/** Liste "a":'1', "b":'2' bzw. "a", "b" in Gruppen zerlegen. */
function splitList(tokens: Token[]): Token[][] | undefined {
	const groups: Token[][] = [[]];
	for (const t of tokens) {
		if (t.type === 'comma') {
			groups.push([]);
		} else {
			groups[groups.length - 1].push(t);
		}
	}
	return groups.some((g) => g.length === 0) ? undefined : groups;
}

function significantDigits(v: string): number {
	return v.replace(/^[-+]?0*/, '').replace('.', '').replace(/^0+/, '').length;
}

export function parseDt(text: string): DtFile {
	const rawLines = text.split(/\r?\n/);
	const { lines, comments } = stripDtComments(rawLines);
	const programs: DtProgram[] = [];
	const issues: DtIssue[] = [];
	let current: DtProgram | undefined;
	let inArgs = false;
	let sawArgSection = false;
	let lastEnd = -1;

	const issue = (code: DtIssueCode, severity: DtIssue['severity'], line: number, start: number, end: number, message: string) =>
		issues.push({ code, severity, line, start, end: Math.max(end, start + 1), message });
	const checkString = (t: Token, _line: number, what: string, max: number) => {
		const line = t.line;
		if (FORBIDDEN.test(t.text)) {
			issue('dt-char', 'error', line, t.start, t.end, `${what} darf keine der Zeichen , ; : ' " oder Tabulator enthalten (FILE-100).`);
		}
		if (t.text.length > max) {
			issue('dt-length', 'warning', line, t.start, t.end, `${what} "${t.text}" hat ${t.text.length} Zeichen, erlaubt sind ${max}.`);
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i];
		const trimmed = raw.trim();
		if (!trimmed) {
			continue;
		}
		const lead = raw.length - raw.trimStart().length;

		const sec = /^\[\s*([A-Za-z_]+)\s*\]$/.exec(trimmed);
		if (sec) {
			const name = sec[1].toUpperCase();
			if (name === 'PROGRAM') {
				if (current && !current.closed) {
					issue('dt-unclosed', 'error', current.line, 0, rawLines[current.line].length, 'Block wird nicht mit [ENDPROGRAM] abgeschlossen, bevor der nächste [PROGRAM]-Block beginnt.');
					current.endLine = i - 1;
				}
				current = { line: i, endLine: i, closed: false, args: [] };
				programs.push(current);
				inArgs = false;
				sawArgSection = false;
			} else if (name === 'ARGUMENT') {
				if (!current || current.closed) {
					issue('dt-structure', 'error', i, lead, raw.length, '[ARGUMENT] steht außerhalb eines [PROGRAM]-Blocks (FILE-100).');
				} else if (sawArgSection) {
					issue('dt-structure', 'error', i, lead, raw.length, '[ARGUMENT] ist in diesem Block doppelt.');
				}
				inArgs = true;
				sawArgSection = true;
			} else if (name === 'ENDPROGRAM') {
				if (!current || current.closed) {
					issue('dt-structure', 'error', i, lead, raw.length, '[ENDPROGRAM] ohne zugehöriges [PROGRAM].');
				} else {
					current.closed = true;
					current.endLine = i;
					if (!sawArgSection) {
						issue('dt-structure', 'warning', current.line, 0, rawLines[current.line].length, 'Der Block hat keinen Abschnitt [ARGUMENT].');
					}
				}
				lastEnd = i;
				inArgs = false;
			} else {
				issue('dt-section', 'error', i, lead, raw.length, `Unbekannter Abschnitt [${sec[1]}]. Erlaubt sind [PROGRAM], [ARGUMENT] und [ENDPROGRAM] (FILE-100).`);
			}
			continue;
		}

		// Zuweisung; im Kopf toleriert FANUC laut Handbuchbeispiel auch "ARGUMENT : '4'"
		const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*(=|:)\s*(.*)$/.exec(trimmed);
		if (!kv) {
			issue('dt-syntax', 'error', i, lead, raw.length, 'Unerwartete Zeile. Erwartet wird ein Abschnitt wie [PROGRAM] oder SCHLÜSSEL = Wert (FILE-096).');
			continue;
		}
		const key = kv[1].toUpperCase();
		const keyStart = lead;
		const keyEnd = lead + kv[1].length;
		const opPos = raw.indexOf(kv[2], keyEnd);
		const valueOffset = kv[3] ? raw.indexOf(kv[3], opPos + 1) : raw.length;
		const { tokens, error } = tokenize(kv[3], valueOffset, i);
		if (error) {
			issue('dt-syntax', 'error', i, error.pos, raw.length, error.message + ' (FILE-096).');
			continue;
		}
		// Listen dürfen nach einem Komma in der nächsten Zeile weitergehen
		let contError = false;
		while (tokens.length && tokens[tokens.length - 1].type === 'comma' && i + 1 < lines.length) {
			const next = lines[i + 1];
			if (/^\s*\[/.test(next) || /^\s*[A-Za-z_][A-Za-z0-9_]*\s*[=:]/.test(next) || !next.trim()) {
				break;
			}
			i++;
			const more = tokenize(next, 0, i);
			if (more.error) {
				issue('dt-syntax', 'error', i, more.error.pos, next.length, more.error.message + ' (FILE-096).');
				contError = true;
				break;
			}
			tokens.push(...more.tokens);
		}
		if (contError) {
			continue;
		}
		if (!current || current.closed) {
			issue('dt-structure', 'error', i, keyStart, raw.length, `${kv[1]} steht außerhalb eines [PROGRAM]-Blocks (FILE-100).`);
			continue;
		}

		if (!inArgs) {
			if (key === 'NAME') {
				if (current.name !== undefined) {
					issue('dt-program-key', 'error', i, keyStart, raw.length, 'NAME ist in diesem Block doppelt.');
				}
				if (tokens.length !== 1 || tokens[0].type !== 'dq') {
					issue('dt-name', 'error', i, keyStart, raw.length, 'NAME muss in doppelten Anführungszeichen stehen, z. B. NAME = "MAIN".');
					continue;
				}
				const t = tokens[0];
				current.name = t.text;
				current.nameSpan = { line: i, start: t.start, end: t.end };
				if (!t.text) {
					issue('dt-name', 'error', i, t.start, t.end, 'NAME ist leer.');
				} else if (!/^[A-Za-z0-9_]+$/.test(t.text)) {
					issue('dt-name', 'warning', i, t.start, t.end, `"${t.text}" ist kein gültiger Programmname (Buchstaben, Ziffern, Unterstrich).`);
				} else if (t.text.length > DT_LIMITS.nameLength) {
					issue('dt-length', 'error', i, t.start, t.end, `NAME hat ${t.text.length} Zeichen, erlaubt sind ${DT_LIMITS.nameLength}.`);
				}
			} else if (key === 'ARGUMENT') {
				const t = tokens[0];
				const n = t && t.type !== 'colon' && t.type !== 'comma' ? Number(t.text) : NaN;
				if (tokens.length !== 1 || !Number.isInteger(n) || n < 0) {
					issue('dt-program-key', 'error', i, keyStart, raw.length, "ARGUMENT erwartet die Anzahl der Argumente, z. B. ARGUMENT = '2'.");
					continue;
				}
				if (t.type !== 'sq') {
					issue('dt-program-key', 'warning', i, t.start, t.end, "Die Anzahl steht in einfachen Anführungszeichen: ARGUMENT = '2'.");
				}
				if (n > DT_LIMITS.maxArguments) {
					issue('dt-limit', 'error', i, t.start, t.end, `Höchstens ${DT_LIMITS.maxArguments} Argumente möglich.`);
				}
				current.argumentCount = n;
				current.argumentSpan = { line: i, start: t.start, end: t.end };
			} else if (key === 'PROGRAM') {
				issue('dt-program-key', 'error', i, keyStart, keyEnd, 'Der Programmname wird mit NAME = "..." angegeben, nicht mit PROGRAM. So wird der Block vom Wizard ignoriert.');
			} else if (/^[NSVW]\d+$/.test(key)) {
				issue('dt-structure', 'error', i, keyStart, keyEnd, `${kv[1]} gehört in den Abschnitt [ARGUMENT].`);
			} else {
				issue('dt-program-key', 'error', i, keyStart, keyEnd, `Unbekannter Schlüssel ${kv[1]}. Im [PROGRAM]-Abschnitt gibt es nur NAME und ARGUMENT (FILE-100).`);
			}
			continue;
		}

		// --- [ARGUMENT] -----------------------------------------------------
		const am = /^([NSVW])(\d+)$/.exec(key);
		if (!am) {
			issue('dt-arg-key', 'error', i, keyStart, keyEnd, `Unbekannter Argumentschlüssel ${kv[1]}. Erlaubt: Nxx (Zahl), Sxx (Zeichenkette), Vxx (Makro-Auswahl), Wxx (String-Auswahl), xx = 01..30 (FILE-100).`);
			continue;
		}
		if (kv[2] !== '=') {
			issue('dt-syntax', 'error', i, keyEnd, keyEnd + 2, 'Im Abschnitt [ARGUMENT] ist das Gleichheitszeichen Pflicht.');
			continue;
		}
		const kind = am[1] as DtArgKind;
		const index = parseInt(am[2], 10);
		const arg: DtArgument = {
			kind,
			index,
			key: kv[1],
			label: '',
			choices: [],
			keySpan: { line: i, start: keyStart, end: keyEnd },
			span: { line: i, start: keyStart, end: raw.trimEnd().length }
		};
		if (am[2].length !== 2) {
			issue('dt-arg-key', 'warning', i, keyStart, keyEnd, `Argumentnummern werden zweistellig geschrieben, z. B. ${kind}${String(index).padStart(2, '0')}.`);
		}

		if (kind === 'N' || kind === 'S') {
			const [l, c, d] = tokens;
			const okShape = l?.type === 'dq' && (tokens.length === 1 || (tokens.length === 3 && c.type === 'colon'));
			if (!okShape) {
				issue('dt-syntax', 'error', i, keyStart, raw.length, kind === 'N'
					? `${kv[1]} erwartet "Bedeutung" und optional einen Vorgabewert: ${kv[1]} = "X-OFFSET":'10' oder :(R) / :(AR) (FILE-096).`
					: `${kv[1]} erwartet "Bedeutung" und optional einen Vorgabewert: ${kv[1]} = "Area Name":"Booth1" oder :(SR) / :(AR) (FILE-096).`);
				continue;
			}
			arg.label = l.text;
			checkString(l, i, 'Die Bedeutung', DT_LIMITS.labelLength);
			if (d) {
				if (kind === 'N') {
					if (d.type === 'paren') {
						if (!/^(R|AR)$/i.test(d.text)) {
							issue('dt-value', 'error', d.line, d.start, d.end, 'Als Vorgabe-Register sind bei N nur (R) und (AR) möglich.');
						}
						arg.defaultValue = `(${d.text.toUpperCase()})`;
					} else if (d.type === 'sq' && /^[-+]?(\d+\.?\d*|\.\d+)$/.test(d.text)) {
						const v = Number(d.text);
						if (Number.isInteger(v) && !d.text.includes('.')) {
							if (v < DT_LIMITS.intMin || v > DT_LIMITS.intMax) {
								issue('dt-value', 'error', d.line, d.start, d.end, `Vorgabewert außerhalb ${DT_LIMITS.intMin} … ${DT_LIMITS.intMax} (FILE-102).`);
							}
						} else if (significantDigits(d.text) > DT_LIMITS.significantDigits) {
							issue('dt-value', 'info', d.line, d.start, d.end, `Dezimalzahlen haben ${DT_LIMITS.significantDigits} signifikante Stellen; ${d.text} wird abgeschnitten.`);
						}
						arg.defaultValue = d.text;
					} else {
						issue('dt-value', 'error', d.line, d.start, d.end, "Vorgabewert bei N: Zahl in einfachen Anführungszeichen ('10', '1.5') oder (R) / (AR).");
					}
				} else {
					if (d.type === 'paren') {
						if (!/^(SR|AR)$/i.test(d.text)) {
							issue('dt-value', 'error', d.line, d.start, d.end, 'Als Vorgabe-Register sind bei S nur (SR) und (AR) möglich.');
						}
						arg.defaultValue = `(${d.text.toUpperCase()})`;
					} else if (d.type === 'dq') {
						checkString(d, i, 'Der Vorgabe-String', DT_LIMITS.stringItemLength);
						arg.defaultValue = d.text;
					} else {
						issue('dt-value', 'error', d.line, d.start, d.end, 'Vorgabewert bei S: Text in doppelten Anführungszeichen ("Booth1") oder (SR) / (AR).');
					}
				}
			}
		} else {
			const groups = splitList(tokens);
			const shapeOk =
				!!groups &&
				groups.every((g) =>
					kind === 'V'
						? g.length === 3 && g[0].type === 'dq' && g[1].type === 'colon' && (g[2].type === 'sq' || g[2].type === 'word')
						: g.length === 1 && g[0].type === 'dq'
				);
			if (!shapeOk) {
				issue('dt-syntax', 'error', i, keyStart, raw.length, kind === 'V'
					? `${kv[1]} erwartet Makros "NAME":'Wert', getrennt durch Komma, z. B. ${kv[1]} = "SLOW":'1', "FAST":'2' (FILE-096).`
					: `${kv[1]} erwartet Strings in doppelten Anführungszeichen, getrennt durch Komma, z. B. ${kv[1]} = "NO_WELD", "WELD001" (FILE-096).`);
				continue;
			}
			const names = new Set<string>();
			const values = new Set<string>();
			for (const g of groups!) {
				const l = g[0];
				const v = kind === 'V' ? g[2] : g[0];
				const choice: DtChoice = { label: l.text, value: v.text, span: { line: l.line, start: l.start, end: v.line === l.line ? v.end : l.end } };
				if (kind === 'V') {
					checkString(l, i, 'Der Makroname', DT_LIMITS.macroNameLength);
					if (!/^[-+]?\d+$/.test(v.text)) {
						issue('dt-value', 'error', v.line, v.start, v.end, `Makrowerte müssen Ganzzahlen sein, '${v.text}' ist ungültig (FILE-096).`);
					} else if (Number(v.text) < DT_LIMITS.intMin || Number(v.text) > DT_LIMITS.intMax) {
						issue('dt-value', 'error', v.line, v.start, v.end, `Makrowert außerhalb ${DT_LIMITS.intMin} … ${DT_LIMITS.intMax} (FILE-102).`);
					}
					if (values.has(String(Number(v.text)))) {
						issue('dt-value', 'error', v.line, v.start, v.end, `Wert '${v.text}' ist in diesem Argument bereits vergeben.`);
					}
					values.add(String(Number(v.text)));
				} else {
					checkString(l, i, 'Der String', DT_LIMITS.stringItemLength);
					if (l.text.length > DT_LIMITS.labelLength && l.text.length <= DT_LIMITS.stringItemLength) {
						issue('dt-length', 'info', l.line, l.start, l.end, `Im Auswahlmenü werden nur ${DT_LIMITS.labelLength} Zeichen gezeigt ("${l.text.slice(0, 13)}..").`);
					}
				}
				if (names.has(l.text.toUpperCase())) {
					issue('dt-value', 'error', l.line, l.start, l.end, `"${l.text}" kommt in diesem Argument mehrfach vor.`);
				}
				names.add(l.text.toUpperCase());
				arg.choices.push(choice);
			}
			if (arg.choices.length > DT_LIMITS.maxListItems) {
				issue('dt-limit', 'error', i, keyStart, keyEnd, `${arg.choices.length} Einträge - höchstens ${DT_LIMITS.maxListItems} je Argument (FILE-101).`);
			}
			arg.label = arg.choices.map((c) => c.label).join(' | ');
		}
		current.args.push(arg);
	}

	if (current && !current.closed) {
		issue('dt-unclosed', 'error', current.line, 0, rawLines[current.line].length, 'Block wird nicht mit [ENDPROGRAM] abgeschlossen (FILE-099).');
		current.endLine = lines.length - 1;
	}
	for (let i = lastEnd + 1; i < lines.length && lastEnd >= 0 && current?.closed; i++) {
		if (lines[i].trim()) {
			issue('dt-trailing', 'error', i, 0, rawLines[i].length, 'Nach dem letzten [ENDPROGRAM] darf nichts mehr folgen (FILE-099).');
			break;
		}
	}
	if (programs.length > DT_LIMITS.maxPrograms) {
		issue('dt-limit', 'error', programs[DT_LIMITS.maxPrograms].line, 0, 1, `Mehr als ${DT_LIMITS.maxPrograms} Programme in einer Datei (FILE-098).`);
	}
	checkPrograms(programs, rawLines, issue);
	issues.sort((a, b) => a.line - b.line || a.start - b.start);
	return { programs, issues, comments };
}

function checkPrograms(
	programs: DtProgram[],
	lines: string[],
	issue: (code: DtIssueCode, severity: DtIssue['severity'], line: number, start: number, end: number, message: string) => void
): void {
	const names = new Map<string, DtProgram>();
	for (const p of programs) {
		if (p.name === undefined) {
			issue('dt-name', 'error', p.line, 0, lines[p.line].length, 'Im [PROGRAM]-Abschnitt fehlt NAME = "PROGRAMMNAME".');
		} else if (p.name) {
			const key = p.name.toUpperCase();
			const first = names.get(key);
			if (first) {
				issue('dt-duplicate-program', 'warning', p.nameSpan!.line, p.nameSpan!.start, p.nameSpan!.end, `Für ${p.name} gibt es bereits einen Block (Zeile ${first.line + 1}).`);
			} else {
				names.set(key, p);
			}
		}
		const byIndex = new Map<number, DtArgument>();
		for (const a of p.args) {
			if (a.index < 1 || a.index > DT_LIMITS.maxArguments) {
				issue('dt-arg-range', 'error', a.keySpan.line, a.keySpan.start, a.keySpan.end, `Argumentnummer muss zwischen 01 und ${DT_LIMITS.maxArguments} liegen.`);
				continue;
			}
			const prev = byIndex.get(a.index);
			if (prev) {
				issue('dt-arg-duplicate', 'error', a.keySpan.line, a.keySpan.start, a.keySpan.end, `Argument ${a.index} ist bereits als ${prev.key} definiert (Zeile ${prev.keySpan.line + 1}).`);
			} else {
				byIndex.set(a.index, a);
			}
		}
		const highest = Math.max(0, ...byIndex.keys());
		if (p.argumentCount === undefined && p.args.length) {
			issue('dt-arg-count', 'warning', p.line, 0, lines[p.line].length, `ARGUMENT fehlt; definiert sind Argumente bis Nummer ${highest}.`);
		} else if (p.argumentCount !== undefined && p.argumentSpan && p.argumentCount !== highest && p.args.length) {
			issue('dt-arg-count', 'warning', p.argumentSpan.line, p.argumentSpan.start, p.argumentSpan.end, `ARGUMENT = '${p.argumentCount}', definiert sind Argumente bis Nummer ${highest}.`);
		}
		for (let n = 1; n < highest; n++) {
			if (!byIndex.has(n)) {
				const next = [...byIndex.values()].sort((a, b) => a.index - b.index).find((a) => a.index > n)!;
				issue('dt-arg-gap', 'info', next.keySpan.line, next.keySpan.start, next.keySpan.end, `Argument ${n} ist nicht beschrieben.`);
			}
		}
	}
}

/** Prüft den Dateinamen: ARGDISP + Sprache + 01..99 + .DT */
export function checkDtFileName(fileName: string): string | undefined {
	const m = /^ARGDISP([A-Z]{2})(\d{2})\.DT$/i.exec(fileName);
	if (!m) {
		return `Die Steuerung lädt nur Dateien mit dem Namen ARGDISP<Sprache><Nr>.DT, z. B. ARGDISPEG01.DT (Sprache: ${Object.keys(DT_LANGUAGES).join(', ')}; Nr. 01–99).`;
	}
	if (!(m[1].toUpperCase() in DT_LANGUAGES)) {
		return `Unbekanntes Sprachkürzel ${m[1]}. Üblich: ${Object.entries(DT_LANGUAGES).map(([k, v]) => `${k} = ${v}`).join(', ')}.`;
	}
	if (m[2] === '00') {
		return 'Die Seriennummer läuft von 01 bis 99.';
	}
	return undefined;
}

// --- Quick Fixes / Erzeugung ----------------------------------------------------

export function fixProgramKeyChange(lines: string[], line: number): TextChange | undefined {
	const m = /^(\s*)(PROGRAM)(\s*[=:])/i.exec(lines[line] ?? '');
	return m ? { line, start: m[1].length, end: m[1].length + m[2].length, text: 'NAME' } : undefined;
}

export function fixArgumentCountChange(p: DtProgram, eol: string): TextChange | undefined {
	const highest = Math.max(0, ...p.args.map((a) => a.index));
	if (p.argumentSpan) {
		return { line: p.argumentSpan.line, start: p.argumentSpan.start, end: p.argumentSpan.end, text: `'${highest}'` };
	}
	const after = p.nameSpan?.line ?? p.line;
	return { line: after, start: Number.MAX_SAFE_INTEGER, end: Number.MAX_SAFE_INTEGER, text: `${eol}ARGUMENT = '${highest}'` };
}

export function fixUnclosedChange(p: DtProgram, lines: string[], eol: string): TextChange {
	let last = p.endLine;
	while (last > p.line && !(lines[last] ?? '').trim()) {
		last--;
	}
	const len = (lines[last] ?? '').length;
	return { line: last, start: len, end: len, text: `${eol}[ENDPROGRAM]` };
}

export interface ArgSpec {
	index: number;
	kind: DtArgKind;
	label: string;
	choices?: { label: string; value: string }[];
	defaultValue?: string;
}

/** Bedeutung auf ein gültiges Format bringen (max. 15 Zeichen, keine verbotenen Zeichen). */
export function cleanLabel(s: string, max = DT_LIMITS.labelLength): string {
	return s.replace(/[,;:'"\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim() || 'ARG';
}

export function programBlock(name: string, args: ArgSpec[], eol: string, comment?: string): string {
	const sorted = [...args].sort((a, b) => a.index - b.index);
	const highest = Math.max(0, ...sorted.map((a) => a.index));
	const out = [`[PROGRAM]${comment ? `   {${comment.replace(/[{}]/g, '')}}` : ''}`, `NAME = "${name}"`, `ARGUMENT = '${highest}'`, '[ARGUMENT]'];
	for (const a of sorted) {
		const key = `${a.kind}${String(a.index).padStart(2, '0')}`;
		if (a.kind === 'V') {
			const c = a.choices?.length ? a.choices : [{ label: 'OFF', value: '0' }, { label: 'ON', value: '1' }];
			out.push(`${key} = ${c.map((x) => `"${cleanLabel(x.label)}":'${x.value}'`).join(', ')}`);
		} else if (a.kind === 'W') {
			const c = a.choices?.length ? a.choices : [{ label: 'TEXT1', value: 'TEXT1' }];
			out.push(`${key} = ${c.map((x) => `"${cleanLabel(x.label, DT_LIMITS.stringItemLength)}"`).join(', ')}`);
		} else {
			const def = a.defaultValue ? `:${/^\(.*\)$/.test(a.defaultValue) ? a.defaultValue : a.kind === 'N' ? `'${a.defaultValue}'` : `"${a.defaultValue}"`}` : '';
			out.push(`${key} = "${cleanLabel(a.label)}"${def}`);
		}
	}
	out.push('[ENDPROGRAM]');
	return out.join(eol) + eol;
}

/** Verwendete Argumentregister eines TP-Programms: Nummer -> erste Anweisung, die es nutzt. */
export function argumentsUsedInProgram(lsText: string): Map<number, string> {
	const used = new Map<number, string>();
	let inMn = false;
	for (const line of lsText.split(/\r?\n/)) {
		if (/^\s*\/MN\b/.test(line)) {
			inMn = true;
			continue;
		}
		if (/^\s*\/(POS|END)\b/.test(line)) {
			inMn = false;
		}
		if (!inMn) {
			continue;
		}
		const stmt = line.replace(/^\s*\d+:\s*/, '');
		if (stmt.startsWith('!')) {
			continue;
		}
		for (const m of stmt.matchAll(/\bAR\[\s*(\d+)\s*\]/g)) {
			const n = parseInt(m[1], 10);
			if (!used.has(n)) {
				used.set(n, stmt.replace(/\s*;\s*$/, '').trim());
			}
		}
	}
	return new Map([...used.entries()].sort((a, b) => a[0] - b[0]));
}

// --- CALL in TP-Programmen ------------------------------------------------------

export interface CallArg {
	/** Argument ohne Beschriftung, z. B. 2, R[3], 'TEXT', SLOW */
	value: string;
	/** Beschriftung, wie sie die Steuerung beim Speichern als LS schreibt: "VR num"=2 */
	label?: string;
	start: number;
	end: number;
}

/** Zerlegt die Argumentliste eines CALL, auch in der LS-Form mit "Bedeutung"=Wert. */
export function splitCallArgs(s: string, offset = 0): CallArg[] {
	const out: CallArg[] = [];
	let depth = 0;
	let quote: string | undefined;
	let start = 0;
	const push = (from: number, to: number) => {
		const raw = s.slice(from, to);
		const lead = raw.length - raw.trimStart().length;
		const text = raw.trim();
		const m = /^"([^"]*)"\s*=\s*(.*)$/.exec(text);
		out.push({
			value: m ? m[2].trim() : text,
			label: m ? m[1] : undefined,
			start: offset + from + lead,
			end: offset + from + lead + text.length
		});
	};
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (quote) {
			if (c === quote) {
				quote = undefined;
			}
		} else if (c === "'" || c === '"') {
			quote = c;
		} else if (c === '[' || c === '(') {
			depth++;
		} else if (c === ']' || c === ')') {
			depth--;
		} else if (c === ',' && depth === 0) {
			push(start, i);
			start = i + 1;
		}
	}
	if (s.trim() || out.length) {
		push(start, s.length);
	}
	return out;
}

export interface CallArgIssue {
	/** Index des Arguments (0-basiert), -1 = ganzer Aufruf */
	argIndex: number;
	severity: 'warning' | 'info';
	message: string;
}

const REGISTER_ARG = /^(R|AR|SR|PR)\[/i;

export function checkCallArguments(def: DtProgram, args: CallArg[]): CallArgIssue[] {
	const out: CallArgIssue[] = [];
	const highest = Math.max(0, ...def.args.map((a) => a.index), def.argumentCount ?? 0);
	if (args.length > highest) {
		out.push({ argIndex: -1, severity: 'warning', message: `${def.name} ist mit ${highest} Argument(en) beschrieben, übergeben werden ${args.length}.` });
	}
	args.forEach((arg, i) => {
		const a = def.args.find((x) => x.index === i + 1);
		const v = arg.value.replace(/^\((.*)\)$/, '$1').trim();
		if (!a || REGISTER_ARG.test(v)) {
			return;
		}
		const where = `Argument ${i + 1} (${a.key}${a.kind === 'N' || a.kind === 'S' ? ` "${a.label}"` : ''})`;
		if (a.kind === 'V') {
			const known = a.choices.some((c) => c.label.toUpperCase() === v.toUpperCase() || (/^-?\d+$/.test(v) && Number(c.value) === Number(v)));
			if (!known) {
				out.push({ argIndex: i, severity: 'warning', message: `${where}: ${v} ist keiner der Werte ${a.choices.map((c) => `${c.label}=${c.value}`).join(', ')}.` });
			}
		} else if (a.kind === 'W') {
			const s = /^'(.*)'$/.exec(v)?.[1];
			if (s !== undefined && !a.choices.some((c) => c.label === s)) {
				out.push({ argIndex: i, severity: 'warning', message: `${where}: '${s}' ist nicht in der Liste ${a.choices.map((c) => c.label).join(', ')}.` });
			}
		} else if (a.kind === 'S' && /^-?\d+(\.\d+)?$/.test(v)) {
			out.push({ argIndex: i, severity: 'info', message: `${where} erwartet eine Zeichenkette.` });
		} else if (a.kind === 'N' && /^'.*'$/.test(v)) {
			out.push({ argIndex: i, severity: 'info', message: `${where} erwartet eine Zahl.` });
		}
	});
	return out;
}
