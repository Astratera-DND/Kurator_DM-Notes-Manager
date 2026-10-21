const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const DM = require('../src/dataModel');
const storage = require('../src/storage');
const cm = require('../src/campaignManager');
const eimg = require('../src/entityImages');
const R = require('../src/transferRunner');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`ok  - ${name}`); }
  catch (err) { failures++; console.log(`FAIL - ${name}\n  ${err.stack}`); }
}

function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'trr-'));
  const a = cm.createCampaign(base, 'Source');
  const b = cm.createCampaign(base, 'Target B');
  const c = cm.createCampaign(base, 'Target C');
  cm.setActive(base, a.id);
  const dirA = cm.campaignDir(base, a.id);
  const src = storage.loadCampaign(dirA);
  const npc = DM.createEntity(src, { type: 'npc', name: 'Mara' });
  const loc = DM.createEntity(src, { type: 'location', name: 'Dock' });
  npc.image = { filename: `${npc.id}.png`, size: 'large' };
  fs.mkdirSync(eimg.imagesDir(dirA), { recursive: true });
  fs.writeFileSync(path.join(eimg.imagesDir(dirA), npc.image.filename), 'PNGDATA');
  storage.writeCampaignSync(dirA, src);
  return { base, a, b, c, dirA, src, npc, loc };
}

test('targets exclude the active campaign and carry counts', () => {
  const { base, a } = setup();
  const t = R.listTargets(base, a.id);
  assert.deepStrictEqual(t.map((x) => x.name).sort(), ['Target B', 'Target C']);
  assert.deepStrictEqual(t[0].counts, { npcs: 0, locations: 0 });
});

test('transfer writes every selected target, backs it up, copies the image, leaves the source alone', () => {
  const { base, b, c, dirA, src, npc, loc } = setup();
  const before = fs.readFileSync(path.join(dirA, 'campaign.json'), 'utf8');
  const res = R.runTransfer(base, src, dirA, [b.id, c.id], [{ id: npc.id }, { id: loc.id }]);
  assert.ok(res.every((r) => r.ok), JSON.stringify(res));
  [b, c].forEach((t) => {
    const dir = cm.campaignDir(base, t.id);
    const loaded = storage.loadCampaign(dir);
    const mara = Object.values(loaded.entities).find((e) => e.name === 'Mara');
    assert.ok(mara && Object.values(loaded.entities).some((e) => e.name === 'Dock'));
    assert.strictEqual(fs.readFileSync(path.join(eimg.imagesDir(dir), mara.image.filename), 'utf8'), 'PNGDATA');
    assert.ok(fs.existsSync(path.join(dir, 'backups')) && fs.readdirSync(path.join(dir, 'backups')).length >= 1);
  });
  assert.strictEqual(fs.readFileSync(path.join(dirA, 'campaign.json'), 'utf8'), before);
});

test('a missing image file is dropped with a warning, a bad target does not stop the others', () => {
  const { base, b, dirA, src, npc } = setup();
  fs.unlinkSync(path.join(eimg.imagesDir(dirA), npc.image.filename));
  const res = R.runTransfer(base, src, dirA, ['camp_nope', b.id], [{ id: npc.id }]);
  assert.strictEqual(res[0].ok, false);
  assert.strictEqual(res[1].ok, true);
  assert.ok(res[1].report.warnings.some((w) => /image/.test(w)));
  const loaded = storage.loadCampaign(cm.campaignDir(base, b.id));
  assert.strictEqual(Object.values(loaded.entities).find((e) => e.name === 'Mara').image, null);
});

test('preview lists names that already exist in a target', () => {
  const { base, b, c, dirA, src, npc, loc } = setup();
  R.runTransfer(base, src, dirA, [b.id], [{ id: npc.id }]);
  const p = R.previewTargets(base, src, [b.id, c.id], [{ id: npc.id }, { id: loc.id }]);
  assert.deepStrictEqual(p.find((x) => x.id === b.id).duplicates, ['Mara']);
  assert.deepStrictEqual(p.find((x) => x.id === c.id).duplicates, []);
});

if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('All transferRunner tests passed.');
