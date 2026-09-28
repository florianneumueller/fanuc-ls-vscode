const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const K = require('../out/karelCore');

test('Kommentare entfernen, Zeichenketten beachten', () => {
	assert.strictEqual(K.stripKarelComment("a = 1 -- Kommentar"), 'a = 1 ');
	assert.strictEqual(K.stripKarelComment("WRITE('a--b') -- x"), "WRITE('a--b') ");
});

test('Gliederung eines KAREL-Programms (#6)', () => {
	const text = fs.readFileSync(path.join(__dirname, '..', 'examples', 'ZAEHLER.KL'), 'utf8');
	const syms = K.parseKarel(text);
	assert.strictEqual(syms.length, 1);
	const prog = syms[0];
	assert.deepStrictEqual([prog.kind, prog.name], ['program', 'zaehler']);
	assert.strictEqual(prog.endLine, text.split('\n').findIndex((l) => l.startsWith('END zaehler')));
	const summary = prog.children.map((c) => [c.kind, c.name]);
	assert.deepStrictEqual(summary, [
		['const', 'REG_ZAEHLER'],
		['const', 'MAX_TEILE'],
		['type', 'statistik_t'],
		['var', 'stat'],
		['var', 'status'],
		['var', 'anzahl'],
		['var', 'real_flag'],
		['var', 'real_wert'],
		['external', 'lese_zaehler'],
		['routine', 'melde'],
		['routine', 'voll']
	]);
	const voll = prog.children.find((c) => c.name === 'voll');
	assert.strictEqual(voll.detail, '(n : INTEGER) : BOOLEAN');
	assert.deepStrictEqual(voll.children.map((c) => [c.kind, c.name, c.detail]), [['var', 'grenze', 'INTEGER']]);
	assert.ok(voll.endLine > voll.line);
	assert.strictEqual(prog.children.find((c) => c.name === 'lese_zaehler').detail, '() : INTEGER FROM zaehlib');
	assert.strictEqual(prog.children.find((c) => c.name === 'REG_ZAEHLER').detail, '= 10');
});
