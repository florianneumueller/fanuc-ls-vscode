const test = require('node:test');
const assert = require('node:assert');
const W = require('../out/weldCore');
const { applyChanges } = require('../out/textChange');

const SRC = [
	'/PROG  NAEHTE',
	'/MN',
	'   1:J P[1] 100% CNT100    ;',
	'   2:L P[2] 200mm/sec FINE Arc Start[1]    ;',
	'   3:L P[3] 10mm/sec CNT100    ;',
	'   4:  Weave Sine[2] ;',
	'   5:L P[4] 12.5mm/sec FINE Arc End[1]    ;',
	'   6:L P[5] 500mm/sec CNT100    ;',
	'   7:  Arc Start[2,3] ;',
	'   8:L P[6] WELD_SPEED FINE    ;',
	'   9:L P[7] 8mm/sec FINE    ;',
	'  10:  Arc End[2] ;',
	'/POS',
	'/END'
].join('\n');

test('Nähte und Schweißbewegungen werden erkannt', () => {
	const seams = W.findSeams(SRC);
	assert.strictEqual(seams.length, 2);
	assert.deepStrictEqual(seams[0].moves.map((m) => m.tpNum), [3, 5]);
	assert.strictEqual(seams[0].startTpNum, 2);
	assert.strictEqual(seams[0].endTpNum, 5);
	assert.strictEqual(seams[0].schedule, '1');
	assert.match(seams[0].weave, /Weave Sine\[2\]/);
	assert.deepStrictEqual(seams[1].moves.map((m) => m.speedText), ['WELD_SPEED', '8 mm/sec']);
	assert.strictEqual(seams[1].moves[0].speed, undefined);
	assert.strictEqual(seams[1].schedule, '2,3');
});

test('Geschwindigkeit setzen ändert nur Schweißbewegungen der gewählten Naht', () => {
	const seams = W.findSeams(SRC);
	const out = applyChanges(SRC, W.setSeamSpeedChanges(seams, [1], 9));
	assert.match(out, /3:L P\[3\] 9mm\/sec CNT100/);
	assert.match(out, /5:L P\[4\] 9mm\/sec FINE Arc End/);
	assert.match(out, /2:L P\[2\] 200mm\/sec/);
	assert.match(out, /9:L P\[7\] 8mm\/sec/);
});

test('Geschwindigkeit prozentual anpassen', () => {
	const seams = W.findSeams(SRC);
	const out = applyChanges(SRC, W.scaleSeamSpeedChanges(seams, [1, 2], 10));
	assert.match(out, /P\[3\] 11mm\/sec/);
	assert.match(out, /P\[4\] 13.8mm\/sec/);
	assert.match(out, /P\[7\] 8.8mm\/sec/);
	assert.match(out, /P\[6\] WELD_SPEED/);
});

test('Naht ohne Ende bleibt offen', () => {
	const seams = W.findSeams('/PROG X\n/MN\n   1:  Arc Start[1] ;\n   2:L P[1] 5mm/sec FINE ;\n/POS\n/END');
	assert.strictEqual(seams.length, 1);
	assert.strictEqual(seams[0].endTpNum, undefined);
	assert.strictEqual(seams[0].moves.length, 1);
});

test('Umrechnung in mm/sec', () => {
	assert.strictEqual(W.toMmPerSec(10, 'mm/sec'), 10);
	assert.strictEqual(W.toMmPerSec(60, 'cm/min'), 10);
	assert.ok(Math.abs(W.toMmPerSec(60, 'inch/min') - 25.4) < 1e-9);
});
