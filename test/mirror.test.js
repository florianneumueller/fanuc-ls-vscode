const test = require('node:test');
const assert = require('node:assert');
const M = require('../out/mirror');
const P = require('../out/posData');
const { applyChanges } = require('../out/textChange');

const EOL = '\r\n';
const SRC = [
	'/PROG  NAHT_L',
	'/ATTR',
	'COMMENT\t\t= "Naht links";',
	'DEFAULT_GROUP\t= 1,1,*,*,*;',
	'/MN',
	'   1:J P[1] 50% FINE    ;',
	'   2:L P[2] 100mm/sec FINE    ;',
	'   3:L P[3] 100mm/sec FINE INC    ;',
	'   4:L PR[5] 100mm/sec FINE    ;',
	'   5:L P[1] 100mm/sec FINE Offset,PR[2]    ;',
	'/POS',
	'P[1]{',
	'   GP1:',
	"\tUF : 1, UT : 1,\t\tCONFIG : 'N U T, 0, 0, 0',",
	'\tX =   100.000  mm,\tY =   250.000  mm,\tZ =   300.000  mm,',
	'\tW =   170.000 deg,\tP =    10.000 deg,\tR =    30.000 deg,',
	'\tE1=   500.000  mm',
	'   GP2:',
	'\tUF : 0, UT : 1,',
	'\tJ1=    45.000 deg,\tJ2=    90.000 deg',
	'};',
	'P[2]{',
	'   GP1:',
	"\tUF : 1, UT : 1,\t\tCONFIG : 'N U T, 0, 0, 0',",
	'\tX =   200.000  mm,\tY =  -100.000  mm,\tZ =   300.000  mm,',
	'\tW =  -180.000 deg,\tP =     0.000 deg,\tR =   -90.000 deg,',
	'\tE1=   600.000  mm',
	'   GP2:',
	'\tUF : 0, UT : 1,',
	'\tJ1=   -30.000 deg,\tJ2=    90.000 deg',
	'};',
	'P[3]{',
	'   GP1:',
	"\tUF : 1, UT : 1,\t\tCONFIG : 'N U T, 0, 0, 0',",
	'\tX =     0.000  mm,\tY =    20.000  mm,\tZ =     0.000  mm,',
	'\tW =     0.000 deg,\tP =     0.000 deg,\tR =     0.000 deg,',
	'\tE1=     0.000  mm',
	'   GP2:',
	'\tUF : 0, UT : 1,',
	'\tJ1=     5.000 deg,\tJ2=     0.000 deg',
	'};',
	'/END',
	''
].join(EOL);

const vals = (text, id, group) =>
	Object.fromEntries(
		P.parsePositions(text).blocks.find((b) => b.id === id).groups.find((g) => g.group === group)
			.axes.concat(P.parsePositions(text).blocks.find((b) => b.id === id).groups.find((g) => g.group === group).extAxes)
			.map((a) => [a.name, a.value])
	);

test('Gruppen erkennen', () => {
	const g = M.mirrorGroups(P.parsePositions(SRC));
	assert.deepStrictEqual(g.map((x) => [x.group, x.kind, x.positions]), [[1, 'cartesian', 3], [2, 'joint', 3]]);
	assert.deepStrictEqual(g[1].axes.map((a) => a.name), ['J1', 'J2']);
	assert.deepStrictEqual(g[0].extAxes.map((a) => a.name), ['E1']);
});

test('Nur GP1 an der XZ-Ebene spiegeln, GP2 bleibt unverändert', () => {
	const { changes, report } = M.mirrorChanges(SRC, { group: 1, plane: 'XZ', offset: 0 });
	const out = applyChanges(SRC, changes);
	assert.deepStrictEqual(vals(out, 1, 1), { X: 100, Y: -250, Z: 300, W: -170, P: 10, R: -30, E1: 500 });
	assert.deepStrictEqual(vals(out, 2, 1), { X: 200, Y: 100, Z: 300, W: 180, P: 0, R: 90, E1: 600 });
	assert.deepStrictEqual(vals(out, 1, 2), vals(SRC, 1, 2));
	assert.deepStrictEqual(report.mirrored, [1, 2, 3]);
	assert.deepStrictEqual(report.incremental, [3]);
	assert.deepStrictEqual(report.userFrames, [1]);
	assert.strictEqual(report.notes.length, 2);
	assert.ok(out.includes('\tX =   100.000  mm,\tY =  -250.000  mm,\tZ =   300.000  mm,'));
	// zweimal spiegeln = Original
	const back = applyChanges(out, M.mirrorChanges(out, { group: 1, plane: 'XZ', offset: 0 }).changes);
	assert.deepStrictEqual(vals(back, 1, 1), vals(SRC, 1, 1));
	assert.deepStrictEqual(vals(back, 2, 1), { X: 200, Y: -100, Z: 300, W: 180, P: 0, R: -90, E1: 600 });
});

test('Ebene mit Versatz; inkrementelle Position ohne Versatz', () => {
	const out = applyChanges(SRC, M.mirrorChanges(SRC, { group: 1, plane: 'YZ', offset: 150 }).changes);
	assert.deepStrictEqual(vals(out, 1, 1), { X: 200, Y: 250, Z: 300, W: 170, P: -10, R: -30, E1: 500 });
	assert.strictEqual(vals(out, 3, 1).X, 0);
	assert.strictEqual(vals(out, 3, 1).Y, 20);
});

test('Nur GP2 isoliert spiegeln: J1 um 0, GP1 bleibt unverändert', () => {
	const { changes, report } = M.mirrorChanges(SRC, { group: 2, axes: { J1: 0 } });
	const out = applyChanges(SRC, changes);
	assert.deepStrictEqual(vals(out, 1, 2), { J1: -45, J2: 90 });
	assert.deepStrictEqual(vals(out, 2, 2), { J1: 30, J2: 90 });
	assert.deepStrictEqual(vals(out, 1, 1), vals(SRC, 1, 1));
	assert.deepStrictEqual(report.mirrored, [1, 2, 3]);
	assert.deepStrictEqual(P.checkGroups(P.parsePositions(out)), []);
});

test('Achse um Mittelwert, externe Achse mitspiegeln', () => {
	const out = applyChanges(SRC, M.mirrorChanges(SRC, { group: 2, axes: { J2: 90 } }).changes);
	assert.strictEqual(vals(out, 3, 2).J2, 0); // INC: um 0 gespiegelt
	assert.strictEqual(vals(out, 1, 2).J2, 90);
	const e = applyChanges(SRC, M.mirrorChanges(SRC, { group: 1, plane: 'XZ', axes: { E1: 550 } }).changes);
	assert.deepStrictEqual([vals(e, 1, 1).E1, vals(e, 2, 1).E1], [600, 500]);
});

test('Kopie umbenennen', () => {
	const out = applyChanges(SRC, M.renameProgramChanges(SRC, 'NAHT_R', ' gesp.'));
	assert.ok(out.startsWith('/PROG  NAHT_R\r\n'));
	assert.ok(out.includes('COMMENT\t\t= "Naht links gesp.";'));
	const long = SRC.replace('"Naht links"', '"Kehlnaht Bauteil A"');
	assert.ok(applyChanges(long, M.renameProgramChanges(long, 'X', ' gesp.')).includes('"Kehlnaht Bauteil A"'));
});
