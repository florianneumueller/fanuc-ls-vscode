const test = require('node:test');
const assert = require('node:assert');
const L = require('../out/labels');

const PROG = [
	'/PROG  ENTNAHME',
	'/ATTR',
	'LINE_COUNT\t= 11;',
	'/MN',
	'   1:  WAIT DO[6338:ON :PrePosPickupDisk]=ON    ;',
	'   2:  LBL[201];',
	'   3:  IF (DI[4601]=ON) THEN ;',
	'   4:  HOME ROB_2    ;',
	'   5:  ENDIF ;',
	'   6:  IF (DI[4523]=OFF) THEN ;',
	'   7:  JMP LBL[201] ;',
	'   8:  ENDIF ;',
	'   9:  WAIT DI[1]=ON TIMEOUT,LBL[99]    ;',
	'  10:  LBL[99:Timeout] ;',
	'  11:  !JMP LBL[5] nur Kommentar ;',
	'  12:  MESSAGE[JMP LBL[7]] ;',
	'  13:  LBL[50] ;',
	'/POS',
	'/END'
].join('\r\n');

test('Labels und Verweise aus dem Beispiel in #7', () => {
	const a = L.analyzeLabels(PROG);
	const summary = a.labels.map((l) => [l.id, l.def && l.def.tpNum, l.def && l.def.comment, l.refs.map((r) => [r.kind, r.tpNum])]);
	assert.deepStrictEqual(summary, [
		[201, 2, undefined, [['JMP', 7]]],
		[99, 10, 'Timeout', [['TIMEOUT', 9]]],
		[50, 13, undefined, []]
	]);
	// Text in MESSAGE[...] und Bemerkungen zählt nicht als Sprung
	assert.ok(!a.labels.some((l) => l.id === 7 || l.id === 5));
});

test('Umbenennen ändert Definition und alle Sprünge', () => {
	const a = L.analyzeLabels(PROG);
	const out = L.applyChanges(PROG, L.renameLabelChanges(a, 201, 10));
	assert.match(out, /   2:  LBL\[10\];/);
	assert.match(out, /   7:  JMP LBL\[10\] ;/);
	assert.ok(!out.includes('201'));
});

test('Kommentar setzen und entfernen', () => {
	const a = L.analyzeLabels(PROG);
	const l201 = a.labels.find((l) => l.id === 201);
	let out = L.applyChanges(PROG, [L.setCommentChange(l201.def, 'Warten Freigabe')]);
	assert.match(out, /LBL\[201:Warten Freigabe\];/);
	const l99 = L.analyzeLabels(out).labels.find((l) => l.id === 99);
	out = L.applyChanges(out, [L.setCommentChange(l99.def, '')]);
	assert.match(out, /  10:  LBL\[99\] ;/);
});

test('Alle Labels neu nummerieren', () => {
	const a = L.analyzeLabels(PROG);
	const out = L.applyChanges(PROG, L.renumberAllChanges(a, 10, 10));
	assert.match(out, /LBL\[10\];/);
	assert.match(out, /JMP LBL\[10\]/);
	assert.match(out, /TIMEOUT,LBL\[20\]/);
	assert.match(out, /LBL\[20:Timeout\]/);
	assert.match(out, /LBL\[30\] ;/);
});

test('Nächste freie Nummer und Position', () => {
	const a = L.analyzeLabels(PROG);
	assert.strictEqual(L.nextFreeLabel(a), 1);
	assert.strictEqual(L.nextFreeLabel(a, 99), 100);
	const hit = L.labelAt(a, 10, 14);
	assert.strictEqual(hit.label.id, 201);
});
