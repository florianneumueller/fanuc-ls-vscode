const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const core = require('../out/cloneCore');

test('Geräteordner und Remote-Pfade', () => {
	assert.strictEqual(core.deviceFolder('md:'), 'md');
	assert.strictEqual(core.deviceFolder('ud1:'), 'ud1');
	assert.strictEqual(core.remotePathFor('md:', 'A.LS'), 'md:A.LS');
	assert.strictEqual(core.remotePathFor('ud1:', 'BACKUP/A.LS'), 'ud1:BACKUP/A.LS');
});

test('Dateitypfilter', () => {
	assert.ok(core.matchesTypes('SCHWEISS1.LS', ['ls', 'tp']));
	assert.ok(core.matchesTypes('X.tp', ['.TP']));
	assert.ok(!core.matchesTypes('ERRALL.DG', ['ls', 'tp']));
	assert.ok(core.matchesTypes('ERRALL.DG', []));
});

test('Änderungen im Klon erkennen (#10)', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'clone-'));
	await fs.mkdir(path.join(root, 'md'));
	await fs.writeFile(path.join(root, 'md', 'A.LS'), 'alt');
	await fs.writeFile(path.join(root, 'md', 'B.LS'), 'bleibt');
	await fs.writeFile(path.join(root, 'md', 'C.LS'), 'weg');
	const manifest = {
		version: 1, controller: 'R1', host: 'h', created: '', updated: '',
		devices: { md: 'md:' },
		files: {}
	};
	for (const n of ['A.LS', 'B.LS', 'C.LS']) {
		manifest.files[`md/${n}`] = { remotePath: `md:${n}`, sha1: await core.sha1File(path.join(root, 'md', n)), size: 0 };
	}
	await core.writeManifest(root, manifest);
	assert.deepStrictEqual(await core.computeChanges(root, await core.readManifest(root)), []);

	await fs.writeFile(path.join(root, 'md', 'A.LS'), 'neu');
	await fs.rm(path.join(root, 'md', 'C.LS'));
	await fs.writeFile(path.join(root, 'md', 'D.LS'), 'neu angelegt');
	const changes = await core.computeChanges(root, await core.readManifest(root));
	assert.deepStrictEqual(
		changes.map((c) => [c.kind, c.relPath, c.remotePath]),
		[
			['modified', 'md/A.LS', 'md:A.LS'],
			['added', 'md/D.LS', 'md:D.LS'],
			['deleted', 'md/C.LS', 'md:C.LS']
		]
	);
});
