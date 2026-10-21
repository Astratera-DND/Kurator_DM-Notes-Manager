const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createDiagnostics, describe } = require('../src/diagnostics');

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok  - ${name}`); }
  catch (err) { failures++; console.log(`FAIL - ${name}\n  ${err.stack}`); }
}

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'diag-')); }

(async () => {
  await test('entries are appended as one JSON line each, with time and kind', async () => {
    const f = path.join(tmpDir(), 'd.log');
    const d = createDiagnostics(f, { now: () => new Date('2026-01-01T00:00:00Z') });
    d.log('a', { x: 1 }); d.log('b', 'hello');
    await d.drain();
    const lines = fs.readFileSync(f, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepStrictEqual(lines.map((l) => l.kind), ['a', 'b']);
    assert.strictEqual(lines[0].t, '2026-01-01T00:00:00.000Z');
    assert.deepStrictEqual(lines[0].details, { x: 1 });
  });

  await test('errors are unpacked; big strings, arrays and objects are capped', () => {
    const e = describe(Object.assign(new Error('boom'), { code: 'EPERM' }));
    assert.strictEqual(e.message, 'boom'); assert.strictEqual(e.code, 'EPERM');
    assert.ok(describe('x'.repeat(5000)).length < 2100);
    assert.strictEqual(describe(new Array(100).fill(1)).length, 21);
    const big = {}; for (let i = 0; i < 100; i++) big['k' + i] = i;
    assert.ok(Object.keys(describe(big)).length <= 31);
    assert.strictEqual(describe({ a: { b: { c: { d: 1 } } } }).a.b.c, '[…]');
  });

  await test('logging never throws, even for circular or hostile values', async () => {
    const f = path.join(tmpDir(), 'd.log');
    const d = createDiagnostics(f);
    const circ = {}; circ.self = circ;
    const hostile = { get boom() { throw new Error('no'); } };
    d.log('c', circ); d.log('h', hostile); d.log(undefined, undefined);
    await d.drain();
    assert.ok(fs.readFileSync(f, 'utf8').trim().split('\n').length >= 3);
  });

  await test('the file is rotated once it passes the size limit', async () => {
    const f = path.join(tmpDir(), 'd.log');
    const d = createDiagnostics(f, { maxBytes: 500 });
    for (let i = 0; i < 40; i++) { d.log('x', 'y'.repeat(50)); await d.drain(); }
    assert.ok(fs.existsSync(f + '.1'));
    assert.ok(fs.statSync(f).size < 2000);
  });

  await test('an unwritable location is swallowed silently', async () => {
    const base = tmpDir();
    const blocker = path.join(base, 'file');
    fs.writeFileSync(blocker, 'x');
    const d = createDiagnostics(path.join(blocker, 'sub', 'd.log'));
    d.log('x', 1);
    await d.drain();
  });

  if (failures) { console.log(`${failures} failed`); process.exit(1); }
  console.log('All diagnostics tests passed.');
})();
