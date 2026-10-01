const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const D = require('../out/dtCore');
const { applyChanges } = require('../out/textChange');

const codes = (text) => D.parseDt(text).issues.map((i) => [i.code, i.severity, i.line]);

test('Beispieldatei AUTO_SEARCH (Anwender) ist fehlerfrei', () => {
	const text = fs.readFileSync(path.join(__dirname, '..', 'examples', 'ARGDISPEG01.DT'), 'latin1');
	const f = D.parseDt(text);
	assert.deepStrictEqual(f.issues, []);
	assert.strictEqual(f.programs.length, 1);
	const p = f.programs[0];
	assert.deepStrictEqual([p.name, p.argumentCount, p.closed], ['AUTO_SEARCH', 5, true]);
	assert.deepStrictEqual(p.args.map((a) => [a.key, a.kind, a.index, a.choices.length]), [
		['V01', 'V', 1, 2], ['V02', 'V', 2, 2], ['V03', 'V', 3, 16], ['N04', 'N', 4, 0], ['N05', 'N', 5, 0]
	]);
	assert.deepStrictEqual(p.args[2].choices[15], { label: 'Y_MINUS_Z_MINUS', value: '16', span: p.args[2].choices[15].span });
});

// Beispiele aus dem Handbuch (MAROUHT9307191E, 7.9.5)
const MANUAL = [
	'[PROGRAM]          {Sample format}',
	'NAME = "TRACKING"',
	"ARGUMENT = '6'",
	'[ARGUMENT]',
	'S01 = "Area Name"',
	'N02 = "VR num"',
	'N03 = "Timeout Time"',
	'N04 = "Reg num timeout"',
	"V05 = \"NOT-CONSECUTIVE\":'1',",
	"      \"CONSECUTIVE\":'2'",
	'N06 = "Model ID"',
	'[ENDPROGRAM]',
	'[PROGRAM]',
	'NAME = "HANDLING"',
	"ARGUMENT : '4'",
	'[ARGUMENT]',
	'N01 = "LINE"',
	"V02 = \"SLOW\":'1', \"FAST\":'2'",
	"V03 = \"SMALL\":'1', \"NORMAL\":'2', \"BIG\":'3'",
	"V04 = \"MAX_LOAD\":'10000', \"NO_LOAD\":'0'",
	'[ENDPROGRAM]',
	'[PROGRAM]   {OFFSSET}',
	'NAME = "POS_OFFSET"',
	"ARGUMENT = '5'",
	'[ARGUMENT]',
	"N01 = \"X-OFFSET\":'10'",
	'N02 = "Y-OFFSET":(R)',
	'N03 = "Z-OFFSET":(AR)',
	'S04 = "Area Name":"Booth1"',
	'W05 = "NO_WELD", "WELD001", "WELD002", "WELDSTOP"',
	'[ENDPROGRAM]',
	''
].join('\r\n');

test('Handbuch-Beispiele inkl. Kommentar, Folgezeile, Vorgabewerten und W-Liste', () => {
	const f = D.parseDt(MANUAL);
	assert.deepStrictEqual(f.issues, []);
	assert.deepStrictEqual(f.programs.map((p) => [p.name, p.argumentCount, p.args.length]), [['TRACKING', 6, 6], ['HANDLING', 4, 4], ['POS_OFFSET', 5, 5]]);
	const v05 = f.programs[0].args[4];
	assert.deepStrictEqual(v05.choices.map((c) => [c.label, c.value, c.span.line]), [['NOT-CONSECUTIVE', '1', 8], ['CONSECUTIVE', '2', 9]]);
	const pos = f.programs[2].args;
	assert.deepStrictEqual(pos.map((a) => a.defaultValue), ['10', '(R)', '(AR)', 'Booth1', undefined]);
	assert.deepStrictEqual(pos[4].choices.map((c) => c.label), ['NO_WELD', 'WELD001', 'WELD002', 'WELDSTOP']);
	assert.strictEqual(f.comments.length, 2);
});

test('Typische Fehler mit FANUC-Alarmbezug', () => {
	const bad = [
		'[PROGRAM]',
		'PROGRAM = "MODEL_CHANGE"',
		"ARGUMENT = '4'",
		'[ARGUMENT]',
		'N01 = "G2 Home OFS"',
		'N01 = "doppelt"',
		'X02 = "falsch"',
		'N03 = "viel zu lange Bedeutung"',
		"V04 = \"A\":'1', \"B\":'1.5', \"A\":'1'",
		'S05 = "Text, mit Komma"',
		"N31 = \"zu hoch\":'99999999'",
		'[ENDPROGRAM]',
		'nachgeschoben = "x"'
	].join('\n');
	const c = D.parseDt(bad).issues.map((i) => `${i.line}:${i.code}`);
	for (const expected of ['1:dt-program-key', '0:dt-name', '5:dt-arg-duplicate', '6:dt-arg-key', '7:dt-length', '8:dt-value', '9:dt-char', '10:dt-value', '10:dt-arg-range', '12:dt-trailing']) {
		assert.ok(c.includes(expected), `${expected} fehlt in ${c.join(' ')}`);
	}
	assert.ok(D.parseDt(bad).issues.some((i) => /FILE-102/.test(i.message)));
});

test('Nicht abgeschlossener Block und ARGUMENT-Anzahl mit Quick Fixes', () => {
	const src = ['[PROGRAM]', 'NAME = "A"', "ARGUMENT = '1'", '[ARGUMENT]', 'N01 = "X"', 'N02 = "Y"', ''].join('\n');
	const f = D.parseDt(src);
	assert.deepStrictEqual(f.issues.map((i) => i.code).sort(), ['dt-arg-count', 'dt-unclosed']);
	const lines = src.split('\n');
	const fixed = applyChanges(src, [D.fixUnclosedChange(f.programs[0], lines, '\n'), D.fixArgumentCountChange(f.programs[0], '\n')]);
	assert.deepStrictEqual(D.parseDt(fixed).issues, []);
	assert.ok(fixed.includes("ARGUMENT = '2'") && fixed.includes('N02 = "Y"\n[ENDPROGRAM]'));
	const p = ['[PROGRAM]', 'PROGRAM = "B"', '[ENDPROGRAM]'];
	assert.strictEqual(applyChanges(p.join('\n'), [D.fixProgramKeyChange(p, 1)]).split('\n')[1], 'NAME = "B"');
});

test('Dateiname', () => {
	assert.strictEqual(D.checkDtFileName('ARGDISPEG01.DT'), undefined);
	assert.strictEqual(D.checkDtFileName('argdispgr12.dt'), undefined);
	assert.ok(D.checkDtFileName('ARGDISPEG01_1.DT'));
	assert.ok(D.checkDtFileName('ARGDISPXX01.DT'));
	assert.ok(D.checkDtFileName('ARGDISPEG00.DT'));
});

test('Block erzeugen ist gültig', () => {
	const block = D.programBlock('PICK_100', [
		{ index: 1, kind: 'N', label: 'Greiferposition für Teil', defaultValue: '10' },
		{ index: 2, kind: 'V', label: 'Seite', choices: [{ label: 'LINKS', value: '1' }, { label: 'RECHTS', value: '2' }] },
		{ index: 3, kind: 'S', label: 'Name', defaultValue: '(SR)' },
		{ index: 4, kind: 'W', label: '', choices: [{ label: 'NO_WELD', value: 'NO_WELD' }] }
	], '\r\n', 'erzeugt');
	assert.deepStrictEqual(D.parseDt(block).issues, []);
	assert.ok(block.includes('N01 = "Greiferposition"'));
});

test('Argumente aus einem TP-Programm', () => {
	const ls = '/PROG X\r\n/MN\r\n   1:  !AR[9] nur Kommentar ;\r\n   2:  IF AR[2]=1,JMP LBL[1] ;\r\n   3:  R[1]=AR[1] ;\r\n/POS\r\n/END\r\n';
	assert.deepStrictEqual([...D.argumentsUsedInProgram(ls).keys()], [1, 2]);
});

test('CALL-Argumente in beiden LS-Schreibweisen prüfen', () => {
	const def = D.parseDt(MANUAL).programs[1]; // HANDLING
	const plain = D.splitCallArgs("3,1,3,0");
	assert.deepStrictEqual(D.checkCallArguments(def, plain), []);
	const labelled = D.splitCallArgs('"LINE"=3,"SLOW"=1,"BIG"=3,"NO_LOAD"=0');
	assert.deepStrictEqual(labelled.map((a) => [a.label, a.value]), [['LINE', '3'], ['SLOW', '1'], ['BIG', '3'], ['NO_LOAD', '0']]);
	assert.deepStrictEqual(D.checkCallArguments(def, labelled), []);
	const wrong = D.checkCallArguments(def, D.splitCallArgs("3,7,3,0,9"));
	assert.deepStrictEqual(wrong.map((w) => [w.argIndex, w.severity]), [[-1, 'warning'], [1, 'warning']]);
	assert.deepStrictEqual(D.checkCallArguments(def, D.splitCallArgs('R[1],AR[2],(R[3]),0')), []);
	const tracking = D.parseDt(MANUAL).programs[0];
	const t = D.splitCallArgs(`"Area Name"='CStn_Out_R1',"VR num"=2,"Timeout Time"=(-1),"Reg num timeout"=1,"NOT-CONSECUTIVE"=1,"Model ID"=1`);
	assert.strictEqual(t.length, 6);
	assert.deepStrictEqual(D.checkCallArguments(tracking, t), []);
});
