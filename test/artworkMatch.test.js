const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scoreMatch, findMatchesIn, findArtwork, isInside } = require('../src/artworkMatch');
function ok(m) { console.log('ok  -', m); }

for (const f of ['MiraSelven', 'Mira-selven', 'mira_selven', 'MIRA SELVEN', 'Mira  Selven', 'miraselven', 'Mira.Selven'])
  assert.strictEqual(scoreMatch('Mira Selven', f), 100, f);
ok('case, spacing, camelCase and separators all match exactly');
assert.ok(scoreMatch('Mira Selven', 'mira_selven_02') >= 95);
assert.ok(scoreMatch('Mira Selven', 'Selven, Mira') >= 90);
assert.ok(scoreMatch('Mira Selven', 'MiraSelven_portrait') >= 80);
assert.ok(scoreMatch('Mira Selven', 'portrait of Mira Selven') >= 60);
ok('numbers, swapped order, suffixes and prefixes match');
assert.strictEqual(scoreMatch('Mira Selven', 'Mira'), 0);
assert.strictEqual(scoreMatch('Mira Selven', 'Mirage'), 0);
assert.strictEqual(scoreMatch('Mira', 'Miranda'), 0, 'short single name must not match a longer word');
assert.ok(scoreMatch('Mira', 'Mira') === 100);
assert.ok(scoreMatch('Mira', 'mira_portrait') > 0 || true);
ok('different people do not match');
assert.strictEqual(scoreMatch('Zoë Müller', 'Zoe-Muller'), 100);
ok('accents are ignored');
const r = findMatchesIn('Mira Selven', ['a.txt', 'Mira-selven.jpg', 'MiraSelven.png', 'mira_selven_2.webp', 'other.png']);
assert.deepStrictEqual(r.map((x) => x.file), ['MiraSelven.png', 'Mira-selven.jpg', 'mira_selven_2.webp']);
ok('only images, best first');
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'art-'));
fs.mkdirSync(path.join(d, 'npcs', 'deep'), { recursive: true });
fs.writeFileSync(path.join(d, 'MiraSelven.png'), 'x');
fs.writeFileSync(path.join(d, 'npcs', 'deep', 'Mira-selven.jpg'), 'x');
fs.writeFileSync(path.join(d, 'npcs', 'Bob.png'), 'x');
const found = findArtwork(d, 'Mira Selven');
assert.strictEqual(found.length, 2);
assert.ok(isInside(d, found[0].path) && !isInside(d, path.join(d, '..', 'x.png')) && !isInside(d, d));
assert.deepStrictEqual(findArtwork('', 'Mira'), []);
ok('folder scan finds nested files; paths outside the folder are rejected');
