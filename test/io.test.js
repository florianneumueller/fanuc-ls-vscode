const test = require('node:test');
const assert = require('node:assert');
const IO = require('../out/ioCore');
const { applyChanges } = require('../out/textChange');

test('Referenzen mit Status und Kommentar (#2)', () => {
	const refs = IO.findIoRefs('   4:  WAIT DO[6338:ON :PrePosPickupDisk]=ON    ;', 3);
	assert.strictEqual(refs.length, 1);
	const r = refs[0];
	assert.deepStrictEqual([r.type, r.index, r.status, r.comment], ['DO', 6338, 'ON', 'PrePosPickupDisk']);
	assert.strictEqual('   4:  WAIT DO[6338:ON :PrePosPickupDisk]=ON    ;'.slice(r.statusStart, r.statusEnd), 'ON :');
	const plain = IO.findIoRefs('   5:  DO[12:Greifer zu]=ON ;', 0)[0];
	assert.deepStrictEqual([plain.status, plain.comment], [undefined, 'Greifer zu']);
	assert.deepStrictEqual(IO.findIoRefs('   6:  !DO[1] nur Bemerkung ;', 0), []);
	const gi = IO.findIoRefs('   7:  R[1]=GI[3:  12:Typnummer] ;', 0)[0];
	assert.deepStrictEqual([gi.status, gi.comment], ['12', 'Typnummer']);
});

test('Status dauerhaft entfernen', () => {
	const src = ['   4:  WAIT DO[6338:ON :PrePosPickupDisk]=ON    ;', '   5:  DI[1:OFF:] ;', '   6:  DO[2:Ohne Status]=ON ;'].join('\r\n');
	const out = applyChanges(src, IO.stripStatusChanges(src));
	assert.strictEqual(out, ['   4:  WAIT DO[6338:PrePosPickupDisk]=ON    ;', '   5:  DI[1] ;', '   6:  DO[2:Ohne Status]=ON ;'].join('\r\n'));
});

test('Kommentare aus Programmen sammeln', () => {
	const e = IO.commentsFromProgram('   1:  WAIT DO[6338:ON :PrePosPickupDisk]=ON ;\n   2:  DI[12:Teil da]=ON ;\n   3:  DO[1]=ON ;');
	assert.deepStrictEqual(e, [
		{ type: 'DO', index: 6338, comment: 'PrePosPickupDisk' },
		{ type: 'DI', index: 12, comment: 'Teil da' }
	]);
});

test('E/A-Liste tolerant einlesen, Status wird verworfen', () => {
	const listing = [
		'F Number: F00000',
		' DIN[   1] OFF  Teil vorhanden',
		' DIN[   2] ON   ',
		' DOUT[ 12]  ON  S  Greifer zu',
		' RDO[1] OFF Vakuum    RDO[2] ON Blasen',
		' GIN[  3]      12  Typnummer',
		' DO[6338:PrePosPickupDisk]',
		'UOUT[  1] ON  Cmd enabled'
	].join('\r\n');
	assert.deepStrictEqual(IO.parseIoListing(listing).map((e) => [e.type, e.index, e.comment]), [
		['DI', 1, 'Teil vorhanden'],
		['DI', 2, ''],
		['DO', 12, 'Greifer zu'],
		['DO', 6338, 'PrePosPickupDisk'],
		['RO', 1, 'Vakuum'],
		['RO', 2, 'Blasen'],
		['GI', 3, 'Typnummer'],
		['UO', 1, 'Cmd enabled']
	]);
});

test('CSV einlesen', () => {
	const csv = 'Typ;Nummer;Kommentar\nDO;12;Greifer zu\nDI,5,Sensor, links\nRO[2]\tBlasen\n';
	assert.deepStrictEqual(IO.parseIoCsv(csv).map((e) => [e.type, e.index, e.comment]), [
		['DI', 5, 'Sensor, links'],
		['DO', 12, 'Greifer zu'],
		['RO', 2, 'Blasen']
	]);
});

test('Bereiche für die Indexprüfung (#2)', () => {
	assert.deepStrictEqual(IO.parseRanges(512), [{ from: 1, to: 512 }]);
	assert.strictEqual(IO.parseRanges(0), undefined);
	const r = IO.parseRanges('1-512, 6000-6999, 7001');
	assert.ok(IO.inRanges(r, 6338));
	assert.ok(IO.inRanges(r, 7001));
	assert.ok(!IO.inRanges(r, 600));
	assert.strictEqual(IO.formatRanges([...r, IO.suggestRange(600)]), '1-1000, 6000-6999, 7001');
	assert.deepStrictEqual(IO.suggestRange(6338), { from: 6001, to: 7000 });
});
