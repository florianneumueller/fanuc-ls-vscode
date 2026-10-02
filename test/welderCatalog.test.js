const test = require('node:test');
const assert = require('node:assert');
const { SECTIONS, INTERNAL_COMMANDS, allTiles } = require('../out/welderCatalog');
const pkg = require('../package.json');

test('jeder Befehl der Extension ist als Kachel erreichbar', () => {
	const tiles = new Set(allTiles().map((t) => t.command));
	const missing = pkg.contributes.commands.map((c) => c.command).filter((c) => !tiles.has(c) && !INTERNAL_COMMANDS.includes(c));
	assert.deepStrictEqual(missing, []);
});

test('Kacheln verweisen nur auf vorhandene Befehle, keine doppelt', () => {
	const declared = new Set(pkg.contributes.commands.map((c) => c.command));
	const all = allTiles().map((t) => t.command);
	assert.deepStrictEqual(all.filter((c) => !declared.has(c)), []);
	assert.strictEqual(new Set(all).size, all.length);
	assert.ok(SECTIONS.every((s) => s.tiles.length > 0));
});
