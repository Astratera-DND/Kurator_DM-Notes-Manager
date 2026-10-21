const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cm = require('../src/campaignManager');
const { loadCampaign } = require('../src/storage');

function ok(msg) { console.log('ok  -', msg); }
function freshDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-mgr-test-')); }

// --- Test 1: fresh install seeds exactly one campaign ----------------------
{
  const base = freshDir();
  const result = cm.ensureActiveCampaign(base);
  assert.strictEqual(result.list.length, 1, 'fresh install should produce exactly one campaign');
  const data = loadCampaign(result.dir);
  assert.ok(Object.keys(data.entities).length > 0, 'the first campaign should have the seed scenario, not be empty');
  ok('fresh install creates exactly one seeded campaign');
}

// --- Test 2: legacy single-campaign.json gets migrated, not orphaned -------
{
  const base = freshDir();
  const legacyDir = path.join(base, 'campaign-data');
  fs.mkdirSync(legacyDir, { recursive: true });
  const legacyCampaign = { entities: { npc_x: { id: 'npc_x', name: 'Pre-existing NPC', type: 'npc' } }, checkpoints: [], blocks: [], meta: {} };
  fs.writeFileSync(path.join(legacyDir, 'campaign.json'), JSON.stringify(legacyCampaign), 'utf8');
  fs.mkdirSync(path.join(legacyDir, 'backups'), { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'backups', 'campaign-old.json'), JSON.stringify(legacyCampaign), 'utf8');

  const result = cm.ensureActiveCampaign(base);
  assert.strictEqual(result.list.length, 1, 'migration should produce exactly one campaign entry');
  const migrated = loadCampaign(result.dir);
  assert.ok(migrated.entities.npc_x, 'the pre-existing NPC must survive migration');
  assert.ok(fs.existsSync(path.join(result.dir, 'backups', 'campaign-old.json')), 'old backups must carry over too');
  assert.ok(fs.existsSync(path.join(legacyDir, 'campaign.pre-multi-campaign-backup.json')), 'old file is moved aside, never deleted outright');
  ok('legacy single-campaign layout migrates without losing data, including backup history');
}

// --- Test 3: create, rename, list ------------------------------------------
{
  const base = freshDir();
  cm.ensureActiveCampaign(base); // bootstraps campaign #1
  const entry2 = cm.createCampaign(base, 'Second campaign', { seed: false });
  let list = cm.listCampaigns(base);
  assert.strictEqual(list.length, 2, 'creating a second campaign should bring the total to two');
  const emptyData = loadCampaign(cm.campaignDir(base, entry2.id));
  assert.strictEqual(Object.keys(emptyData.entities).length, 0, 'a user-created campaign must start empty, not with demo content');

  cm.renameCampaign(base, entry2.id, 'Renamed campaign');
  list = cm.listCampaigns(base);
  assert.strictEqual(list.find((c) => c.id === entry2.id).name, 'Renamed campaign');
  ok('creating a second campaign starts empty, and rename works');
}

// --- Test 4: soft delete moves the folder instead of destroying it ---------
{
  const base = freshDir();
  const first = cm.ensureActiveCampaign(base);
  const entry2 = cm.createCampaign(base, 'To be deleted', { seed: false });
  const dirBeforeDelete = cm.campaignDir(base, entry2.id);
  assert.ok(fs.existsSync(dirBeforeDelete));

  cm.deleteCampaign(base, entry2.id);
  assert.ok(!fs.existsSync(dirBeforeDelete), 'deleted campaign should no longer be in campaigns/');
  const deletedDirContents = fs.readdirSync(path.join(base, 'campaign-data', 'deleted'));
  assert.ok(deletedDirContents.some((d) => d.startsWith(entry2.id)), 'deleted campaign must be recoverable in deleted/, not gone');

  const list = cm.listCampaigns(base);
  assert.strictEqual(list.length, 1, 'index should drop the deleted campaign');
  assert.strictEqual(list[0].id, first.id, 'the other campaign must be unaffected');
  ok('deleting a campaign moves it aside (recoverable) instead of destroying it');
}

// --- Test 5: deleting every campaign recovers with an EMPTY one, not reseeded
{
  const base = freshDir();
  const first = cm.ensureActiveCampaign(base);
  cm.deleteCampaign(base, first.id);
  assert.strictEqual(cm.listCampaigns(base).length, 0, 'list should be empty right after deleting the only campaign');

  const recovered = cm.ensureActiveCampaign(base);
  assert.strictEqual(recovered.list.length, 1, 'should self-heal to exactly one campaign');
  const data = loadCampaign(recovered.dir);
  assert.strictEqual(Object.keys(data.entities).length, 0, 'recovery campaign must be empty, not reseeded with demo content — this is not a fresh install');
  ok('deleting every campaign recovers with a fresh empty one, never silently reseeding demo content');
}

// --- Test 6: active campaign persists and is honored across calls ----------
{
  const base = freshDir();
  cm.ensureActiveCampaign(base);
  const entry2 = cm.createCampaign(base, 'Switch target', { seed: false }); // createCampaign also sets it active
  assert.strictEqual(cm.getActiveId(base), entry2.id);
  const result = cm.ensureActiveCampaign(base);
  assert.strictEqual(result.id, entry2.id, 'ensureActiveCampaign should honor the already-set active campaign, not reset it');
  ok('active campaign selection is stable across repeated startup calls');
}

console.log('\nAll campaign manager tests passed.');
