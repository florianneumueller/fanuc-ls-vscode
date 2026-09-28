const test = require('node:test');
const assert = require('node:assert');
const { parse, isValidProgramName, findReferences } = require('../out/parser');

test('Programmnamen mit Ziffern sind gültig (#3)', () => {
	for (const n of ['PICK100', '100_PICK', '1', 'A_1_B', 'MAIN']) {
		assert.ok(isValidProgramName(n), n);
	}
	for (const n of ['PICK-1', 'A.B', 'ÄRGER', '']) {
		assert.ok(!isValidProgramName(n), n);
	}
});

test('Parser liest /PROG-Namen mit führender Ziffer', () => {
	const p = parse('/PROG  100_PICK\r\n/ATTR\r\n/MN\r\n   1:  END ;\r\n/POS\r\n/END\r\n');
	assert.strictEqual(p.progName, '100_PICK');
	assert.strictEqual(p.tpLines.length, 1);
});

test('Referenzen mit Kommentar und Status werden erkannt', () => {
	const refs = findReferences('WAIT DO[6338:ON :PrePosPickupDisk]=ON');
	assert.deepStrictEqual(refs.map((r) => [r.type, r.id]), [['DO', 6338]]);
});
