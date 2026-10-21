const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const storage = require('../src/storage');

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`ok  - ${name}`); }
  catch (err) { failures++; console.log(`FAIL - ${name}\n  ${err.stack}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await test('rapid saves collapse into one write of the newest state', async () => {
    const writes = [];
    const save = storage.makeAutosaver('x', { debounceMs: 20, write: (d, c) => writes.push(c) });
    save({ v: 1 }); save({ v: 2 }); save({ v: 3 });
    await sleep(80);
    assert.deepStrictEqual(writes, [{ v: 3 }]);
  });

  await test('a failing write does not throw; it is reported and retried until it works', async () => {
    let calls = 0; const errors = []; let recovered = 0;
    const save = storage.makeAutosaver('x', {
      debounceMs: 10, retryDelays: [10, 10],
      write: () => { calls++; if (calls < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' }); },
      onError: (e, n) => errors.push(n), onRecovered: () => recovered++
    });
    save({ v: 1 });
    await sleep(150);
    assert.strictEqual(calls, 3);
    assert.deepStrictEqual(errors, [1, 2]);
    assert.strictEqual(recovered, 1);
  });

  await test('while failing, newer edits replace the old state and are what finally gets written', async () => {
    const written = []; let fail = true;
    const save = storage.makeAutosaver('x', {
      debounceMs: 10, retryDelays: [30],
      write: (d, c) => { if (fail) throw new Error('x'); written.push(c); }
    });
    save({ v: 1 }); await sleep(25);
    save({ v: 2 }); save({ v: 3 });
    fail = false; await sleep(120);
    assert.deepStrictEqual(written, [{ v: 3 }]);
  });

  await test('an edit made during a successful write is not lost', async () => {
    const written = []; let save;
    save = storage.makeAutosaver('x', {
      debounceMs: 10,
      write: (d, c) => { written.push(c.v); if (c.v === 1) save({ v: 2 }); }
    });
    save({ v: 1 }); await sleep(100);
    assert.deepStrictEqual(written, [1, 2]);
  });

  await test('a throwing error hook cannot break saving', async () => {
    let n = 0;
    const save = storage.makeAutosaver('x', {
      debounceMs: 5, retryDelays: [5],
      write: () => { if (++n < 2) throw new Error('x'); },
      onError: () => { throw new Error('hook'); }
    });
    save({}); await sleep(60);
    assert.strictEqual(n, 2);
  });

  await test('transient Windows-style errors are recognised, others are not', () => {
    for (const c of ['EPERM', 'EBUSY', 'EACCES']) assert.ok(storage.isTransientFileError({ code: c }));
    assert.ok(!storage.isTransientFileError({ code: 'ENOENT' }));
    assert.ok(!storage.isTransientFileError(null));
  });

  await test('real disk: writes campaign.json and leaves no tmp file behind', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-'));
    const save = storage.makeAutosaver(dir, { debounceMs: 10 });
    save({ hello: 'world' }); await sleep(80);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(storage.campaignFile(dir), 'utf8')), { hello: 'world' });
    assert.ok(!fs.existsSync(storage.campaignFile(dir) + '.tmp'));
  });

  await test('real disk: a rename that fails with EPERM falls back to copying', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-'));
    const orig = fs.renameSync;
    fs.renameSync = () => { throw Object.assign(new Error('locked'), { code: 'EPERM' }); };
    try { storage.writeCampaignSync(dir, { a: 1 }); } finally { fs.renameSync = orig; }
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(storage.campaignFile(dir), 'utf8')), { a: 1 });
    assert.ok(!fs.existsSync(storage.campaignFile(dir) + '.tmp'));
  });

  if (failures) { console.log(`${failures} failed`); process.exit(1); }
  console.log('All autosave tests passed.');
})();
