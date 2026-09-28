const test = require('node:test');
const assert = require('node:assert');
const P = require('../out/posData');
const { applyChanges } = require('../out/textChange');

const EOL = '\r\n';
const prog = (dg, pos, mn = ['   1:J P[1] 50% FINE    ;']) =>
	['/PROG  T', '/ATTR', `DEFAULT_GROUP\t= ${dg};`, '/MN', ...mn, '/POS', ...pos, '/END', ''].join(EOL);

const P1 = [
	'P[1:"Home"]{',
	'   GP1:',
	"\tUF : 1, UT : 1,\t\tCONFIG : 'N U T, 0, 0, 0',",
	'\tX =   100.000  mm,\tY =     0.000  mm,\tZ =   300.000  mm,',
	'\tW =   180.000 deg,\tP =     0.000 deg,\tR =     0.000 deg',
	'};'
];
const P2 = P1.map((l) => l.replace('P[1:"Home"]', 'P[2]').replace('100.000', '200.000'));

test('Positionen, Gruppen und Achsen einlesen', () => {
	const d = P.parsePositions(prog('1,*,*,*,*', [...P1, ...P2]));
	assert.deepStrictEqual(d.defaultGroup.mask, [true, false, false, false, false]);
	assert.strictEqual(d.blocks.length, 2);
	assert.strictEqual(d.blocks[0].comment, 'Home');
	assert.deepStrictEqual(d.blocks[0].groups[0].axes.map((a) => a.name), ['X', 'Y', 'Z', 'W', 'P', 'R']);
	assert.deepStrictEqual(P.checkGroups(d), []);
});

test('Gruppenprüfung gegen DEFAULT_GROUP (#4)', () => {
	let d = P.parsePositions(prog('1,1,*,*,*', [...P1, ...P2]));
	assert.deepStrictEqual(P.checkGroups(d).map((i) => [i.code, i.group]), [['group-missing', 2], ['group-missing', 2]]);
	d = P.parsePositions(prog('*,*,*,*,*', [...P1]));
	assert.deepStrictEqual(P.checkGroups(d).map((i) => i.code), ['group-none']);
	d = P.parsePositions(prog('*,*,*,*,*', [], ['   1:  DO[1]=ON ;']));
	assert.deepStrictEqual(P.checkGroups(d), []);
});

test('Externe Achse hinzufügen und entfernen (#5)', () => {
	const src = prog('1,*,*,*,*', [...P1, ...P2]);
	let d = P.parsePositions(src);
	assert.strictEqual(P.nextExtAxisName(d, 1), 'E1');
	let out = applyChanges(src, P.addExtAxisChanges(d, 1, 'E1', 'mm', 0, EOL));
	assert.ok(out.includes('R =     0.000 deg,' + EOL + '\tE1=     0.000  mm' + EOL + '};'), out);
	d = P.parsePositions(out);
	assert.deepStrictEqual(d.blocks.map((b) => b.groups[0].extAxes.map((a) => a.name)), [['E1'], ['E1']]);
	assert.deepStrictEqual(P.checkGroups(d), []);

	out = applyChanges(out, P.addExtAxisChanges(d, 1, 'E2', 'deg', 0, EOL));
	assert.ok(out.includes('\tE1=     0.000  mm,\tE2=     0.000 deg'), out);
	d = P.parsePositions(out);
	assert.deepStrictEqual(P.extAxesOf(d, 1), [{ name: 'E1', unit: 'mm' }, { name: 'E2', unit: 'deg' }]);

	out = applyChanges(out, P.removeExtAxisChanges(d, 1, 'E1'));
	assert.ok(out.includes('R =     0.000 deg,' + EOL + '\tE2=     0.000 deg' + EOL + '};'), out);
	d = P.parsePositions(out);
	out = applyChanges(out, P.removeExtAxisChanges(d, 1, 'E2'));
	assert.strictEqual(out, src);
});

test('Uneinheitliche externe Achsen werden gemeldet', () => {
	const src = prog('1,*,*,*,*', [...P1, ...P2, ...P2.map((l) => l.replace('P[2]', 'P[3]'))]);
	let d = P.parsePositions(src);
	// nur P[2] bekommt E1
	const change = P.addExtAxisChanges(d, 1, 'E1', 'mm', 5, EOL).filter((c) => c.line > d.blocks[1].line && c.line < d.blocks[1].closeLine);
	d = P.parsePositions(applyChanges(src, change));
	assert.deepStrictEqual(P.checkGroups(d).map((i) => [i.code, i.line === d.blocks[1].groups[0].headerLine]), [['ext-axis-mismatch', true]]);
	assert.deepStrictEqual(P.nonZeroExtAxis(d, 1, 'E1'), [2]);
});

test('Bewegungsgruppe hinzufügen und entfernen (#5)', () => {
	const src = prog('1,*,*,*,*', [...P1, ...P2]);
	let d = P.parsePositions(src);
	let out = applyChanges(src, P.addGroupChanges(d, 2, { axes: 2, unit: 'deg' }, EOL));
	assert.ok(out.includes('DEFAULT_GROUP\t= 1,1,*,*,*;'));
	assert.ok(out.includes('   GP2:' + EOL + '\tUF : 0, UT : 1,' + EOL + '\tJ1=     0.000 deg,\tJ2=     0.000 deg' + EOL + '};'), out);
	d = P.parsePositions(out);
	assert.deepStrictEqual(d.blocks.map((b) => b.groups.map((g) => g.group)), [[1, 2], [1, 2]]);
	assert.deepStrictEqual(P.checkGroups(d), []);
	out = applyChanges(out, P.removeGroupChanges(d, 2));
	assert.strictEqual(out, src);
});

test('Fehlende Gruppe per Quick Fix aus Vorlage ergänzen', () => {
	// P[1] hat GP2 mit 3 Achsen, P[2] fehlt GP2
	const withGp2 = [...P1.slice(0, 5), '   GP2:', '\tUF : 1, UT : 2,', '\tJ1=    10.000 deg,\tJ2=    20.000 deg,\tJ3=    30.000 deg,', '\tJ4=    40.000 deg', '};'];
	const src = prog('1,1,*,*,*', [...withGp2, ...P2]);
	let d = P.parsePositions(src);
	assert.deepStrictEqual(P.checkGroups(d).map((i) => [i.code, i.group]), [['group-missing', 2]]);
	const out = applyChanges(src, P.addGroupChanges(d, 2, undefined, EOL));
	d = P.parsePositions(out);
	assert.deepStrictEqual(P.checkGroups(d), []);
	assert.deepStrictEqual(d.blocks[1].groups[1].axes.map((a) => [a.name, a.value]), [['J1', 0], ['J2', 0], ['J3', 0], ['J4', 0]]);
	assert.ok(out.includes('\tUF : 1, UT : 2,'));
});

test('Neue Position mit passenden Gruppen anlegen', () => {
	const withE = applyChanges(prog('1,*,*,*,*', [...P1, ...P2]), P.addExtAxisChanges(P.parsePositions(prog('1,*,*,*,*', [...P1, ...P2])), 1, 'E1', 'mm', 0, EOL));
	let d = P.parsePositions(withE);
	const out = applyChanges(withE, P.newPositionChanges(d, 5, 'TEACH', EOL));
	d = P.parsePositions(out);
	const b = d.blocks.find((x) => x.id === 5);
	assert.strictEqual(b.comment, 'TEACH');
	assert.deepStrictEqual(b.groups[0].axes.map((a) => a.value), [0, 0, 0, 0, 0, 0]);
	assert.deepStrictEqual(b.groups[0].extAxes.map((a) => a.name), ['E1']);
	assert.deepStrictEqual(P.checkGroups(d), []);
	// Reihenfolge: P[1], P[2], P[5] vor /END; P[0]... P[1] kommt vor P[2]
	const out2 = applyChanges(out, P.newPositionChanges(d, 3, '', EOL));
	assert.deepStrictEqual(P.parsePositions(out2).blocks.map((x) => x.id), [1, 2, 3, 5]);
});
