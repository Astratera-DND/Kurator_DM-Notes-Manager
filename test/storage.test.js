const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadCampaign, writeCampaignSync, createBackup, campaignFile, backupsDir, migrateToModularContent
} = require('../src/storage');

function ok(msg) { console.log('ok  -', msg); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-console-test-'));

// --- Test 1: first load creates seed data ----------------------------------
let campaign = loadCampaign(dir);
assert.ok(Object.keys(campaign.entities).length > 0, 'seed campaign should have entities');
assert.ok(fs.existsSync(campaignFile(dir)), 'campaign.json should be written on first load');
ok('first load creates and persists seed data');

// --- Test 2: round-trip save/load -------------------------------------------
campaign.entities[Object.keys(campaign.entities)[0]].name = 'Renamed entity';
writeCampaignSync(dir, campaign);
const reloaded = loadCampaign(dir);
const firstId = Object.keys(reloaded.entities)[0];
assert.strictEqual(reloaded.entities[firstId].name, 'Renamed entity');
ok('save/load round-trips edits correctly');

// --- Test 3: atomic write leaves no .tmp file behind ------------------------
assert.ok(!fs.existsSync(campaignFile(dir) + '.tmp'), 'temp file should be cleaned up by rename');
ok('atomic write via temp-file + rename leaves no stray file');

// --- Test 4: backups get created and pruned ---------------------------------
for (let i = 0; i < 5; i++) createBackup(dir);
const files = fs.readdirSync(backupsDir(dir));
assert.ok(files.length >= 5, 'backups should accumulate');
ok(`backup snapshots created (${files.length} present)`);

// --- Test 5: corrupt campaign.json falls back to latest backup -------------
fs.writeFileSync(campaignFile(dir), '{ this is not valid json', 'utf8');
const recovered = loadCampaign(dir);
assert.ok(Object.keys(recovered.entities).length > 0, 'should recover from latest backup on corruption');
ok('corrupt campaign.json recovers from the latest backup instead of losing data');

// --- Test 6: loading a campaign saved before entity groups existed --------
// This is the one that matters most: a real campaign file, saved by an
// earlier version of the app, has no `entityGroups` array and no
// `groupId` on any entity at all. This must load exactly as it did
// before — nothing about existing data changes, nothing crashes.
{
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'session-console-legacy-test-'));
  const legacyCampaign = {
    entities: {
      npc_old: { id: 'npc_old', type: 'npc', name: 'Pre-existing NPC', icon: 'user', color: 'coral', summary: 'Written before groups existed.', notionUrl: '', createdAt: new Date().toISOString() }
    },
    checkpoints: [{ id: 'cp_old', label: 'Day 1', order: 0 }],
    blocks: [],
    meta: { nextColorIndex: 1, startBookmark: null, completedSinceStart: [] }
    // deliberately no entityGroups field at all, matching real pre-existing files
  };
  fs.writeFileSync(campaignFile(dir2), JSON.stringify(legacyCampaign, null, 2), 'utf8');

  const loaded = loadCampaign(dir2);
  assert.ok(Array.isArray(loaded.entityGroups), 'entityGroups should be backfilled to an empty array, not left undefined');
  assert.strictEqual(loaded.entityGroups.length, 0);
  assert.ok(Array.isArray(loaded.meta.collapsedGroupIds), 'meta.collapsedGroupIds should also be backfilled to an empty array for a campaign saved before it existed');
  assert.strictEqual(loaded.entities.npc_old.name, 'Pre-existing NPC', 'the pre-existing entity must be completely unchanged');
  assert.strictEqual(loaded.entities.npc_old.groupId, undefined, 'an entity from before this feature existed should NOT have groupId force-added — its absence already means "ungrouped"');
  assert.strictEqual(loaded.checkpoints[0].label, 'Day 1', 'existing checkpoints must be untouched');
  ok('a campaign saved before entity groups existed loads safely, with existing data completely unchanged');
}

// --- Test 7: pre-existing notes/topics with no order field get backfilled -
// Regression test for a real reported bug: a note or topic created before
// the `order` field existed has no value for it at all, and every such
// sibling within the same group defaults to the same 0 via `|| 0` in
// moveNote/moveTopic — meaning they're permanently tied, and the reorder
// buttons silently do nothing no matter how many times they're clicked
// (swapping a tied 0 for 0 changes nothing). Reported specifically as
// "new topics work, old ones don't react" — exactly what this tie looks
// like from the outside.
{
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'kurator-test3-'));
  const legacyCampaign = {
    entities: {
      npc_old: { id: 'npc_old', type: 'npc', name: 'Innkeeper', icon: 'user', color: 'coral', summary: '', notionUrl: '', createdAt: new Date().toISOString() }
    },
    checkpoints: [{ id: 'cp_old', label: 'Day 1', order: 0 }],
    blocks: [
      // Deliberately no `order` field on any of these, matching real
      // pre-existing data saved before the field existed.
      { id: 'blk_t1', kind: 'topic', entityId: 'npc_old', label: 'Rumors', text: '', timeId: null, complete: false, createdAt: new Date().toISOString() },
      { id: 'blk_t2', kind: 'topic', entityId: 'npc_old', label: 'Debt', text: '', timeId: null, complete: false, createdAt: new Date().toISOString() },
      { id: 'blk_t3', kind: 'topic', entityId: 'npc_old', label: 'Gossip', text: '', timeId: null, complete: false, createdAt: new Date().toISOString() },
      { id: 'blk_n1', kind: 'note', entityId: 'npc_old', timeId: 'cp_old', text: 'First', complete: false, createdAt: new Date().toISOString() },
      { id: 'blk_n2', kind: 'note', entityId: 'npc_old', timeId: 'cp_old', text: 'Second', complete: false, createdAt: new Date().toISOString() }
    ],
    entityGroups: [],
    meta: { nextColorIndex: 1, startBookmark: null, completedSinceStart: [], collapsedGroupIds: [] }
  };
  fs.writeFileSync(campaignFile(dir3), JSON.stringify(legacyCampaign, null, 2), 'utf8');

  const loaded = loadCampaign(dir3);
  // Notes/topics no longer live in campaign.blocks after loading —
  // migrateToModularContent (wired into normalizeCampaign) converts them
  // to modules+assignments automatically now, on every load.
  const topicModules = loaded.contentModules.filter((m) => m.type === 'topic');
  const noteModules = loaded.contentModules.filter((m) => m.type === 'note');
  const topicOrders = loaded.assignments.filter((a) => topicModules.some((m) => m.id === a.moduleId)).map((a) => a.order);
  const noteOrders = loaded.assignments.filter((a) => noteModules.some((m) => m.id === a.moduleId)).map((a) => a.order);
  assert.ok(topicOrders.every((o) => typeof o === 'number'), 'every topic assignment should have a real numeric order after loading, not undefined');
  assert.strictEqual(new Set(topicOrders).size, topicOrders.length, 'topics in the same group must end up with distinct order values, not all tied at the same default');
  assert.ok(noteOrders.every((o) => typeof o === 'number'), 'every note assignment should have a real numeric order after loading');
  assert.strictEqual(new Set(noteOrders).size, noteOrders.length, 'notes in the same group must end up with distinct order values');

  // Backfilling must not itself change what's currently displayed —
  // only resolve the tie so future reordering works.
  const topicLabelsInOrder = loaded.assignments
    .filter((a) => topicModules.some((m) => m.id === a.moduleId))
    .sort((a, b) => a.order - b.order)
    .map((a) => loaded.contentModules.find((m) => m.id === a.moduleId).name);
  assert.deepStrictEqual(topicLabelsInOrder, ['Rumors', 'Debt', 'Gossip'], 'backfilling should preserve the original creation-order display, not silently reshuffle anything');

  // And the actual reported symptom: the reorder button must now work.
  // 'blk_t3' (Gossip) still resolves directly to its module — ids are
  // preserved through migration, not regenerated.
  const { moveAssignment } = require('../src/dataModel');
  const gossipAssignment = loaded.assignments.find((a) => a.moduleId === 'blk_t3');
  const moved = moveAssignment(loaded, gossipAssignment.id, -1);
  assert.strictEqual(moved, true);
  const afterMove = loaded.assignments
    .filter((a) => topicModules.some((m) => m.id === a.moduleId))
    .sort((a, b) => a.order - b.order)
    .map((a) => loaded.contentModules.find((m) => m.id === a.moduleId).name);
  assert.deepStrictEqual(afterMove, ['Rumors', 'Gossip', 'Debt'], 'after backfilling, moving a pre-existing topic must actually change its displayed position — this is the exact bug that was reported');

  ok('pre-existing notes/topics with no order field are backfilled with distinct values on load, preserving current display order while fixing the reorder buttons');
}

// --- Test 8: migrateToModularContent — notes and topics -------------------
{
  const dataModel = require('../src/dataModel');
  const c = dataModel.emptyCampaign();
  const npc = dataModel.createEntity(c, { type: 'npc', name: 'Innkeeper' });
  const day1 = dataModel.createCheckpoint(c, { label: 'Day 1' });

  const note = dataModel.createNoteBlock(c, { entityId: npc.id, timeId: day1.id, text: 'A note about the innkeeper.' });
  note.complete = true;
  const topic = dataModel.createTopicBlock(c, { entityId: npc.id, label: 'Rumors', text: 'What people say.', timeId: day1.id });

  migrateToModularContent(c);

  assert.strictEqual(c.contentModules.length, 2);
  assert.strictEqual(c.assignments.length, 2);
  assert.strictEqual(c.blocks.filter((b) => b.kind === 'note' || b.kind === 'topic').length, 0, 'old note/topic blocks should be gone after migration, not left duplicated alongside the new modules');

  const noteModule = c.contentModules.find((m) => m.type === 'note');
  assert.strictEqual(noteModule.text, 'A note about the innkeeper.');
  assert.strictEqual(noteModule.complete, true, 'a completed note\'s complete flag must survive the conversion');
  const noteAssignment = c.assignments.find((a) => a.moduleId === noteModule.id);
  assert.strictEqual(noteAssignment.entityId, npc.id);
  assert.strictEqual(noteAssignment.timeId, day1.id);

  const topicModule = c.contentModules.find((m) => m.type === 'topic');
  assert.strictEqual(topicModule.name, 'Rumors', 'a topic\'s existing label should become its module name directly, not a separately-derived preview');
  assert.strictEqual(topicModule.text, 'What people say.');

  ok('migrateToModularContent converts notes and topics correctly — text, completion, and assignment placement all preserved, old blocks removed');
}

// --- Test 9: migrateToModularContent — scenes, with derived order ---------
{
  const dataModel = require('../src/dataModel');
  const c = dataModel.emptyCampaign();
  const loc = dataModel.createEntity(c, { type: 'location', name: 'Tavern' });
  const day1 = dataModel.createCheckpoint(c, { label: 'Day 1' });

  // Scenes never had an explicit order field — order must be derived
  // from creation order (the order they appear in campaign.blocks),
  // same reasoning as the beat/note/topic order-backfill fix earlier.
  const sceneA = dataModel.createSceneBlock(c, { locationId: loc.id, timeId: day1.id, label: 'Opening', lines: [{ id: 'l1', speakerId: null, text: 'Welcome.' }] });
  const sceneB = dataModel.createSceneBlock(c, { locationId: loc.id, timeId: day1.id, label: 'Confrontation', lines: [] });

  migrateToModularContent(c);

  const modA = c.contentModules.find((m) => m.name === 'Opening');
  const modB = c.contentModules.find((m) => m.name === 'Confrontation');
  const asgA = c.assignments.find((a) => a.moduleId === modA.id);
  const asgB = c.assignments.find((a) => a.moduleId === modB.id);
  assert.deepStrictEqual(modA.lines, [{ id: 'l1', speakerId: null, text: 'Welcome.' }]);
  assert.strictEqual(asgA.order, 0);
  assert.strictEqual(asgB.order, 1, 'the second scene created at the same location+checkpoint should get the next order value');
  assert.strictEqual(asgA.entityId, loc.id);

  ok('migrateToModularContent converts scenes correctly, deriving sequential order from creation order since scenes never had an explicit order field');
}

// --- Test 10: migrateToModularContent — beats and description -------------
{
  const dataModel = require('../src/dataModel');
  const c = dataModel.emptyCampaign();
  const loc = dataModel.createEntity(c, { type: 'location', name: 'Market' });
  const day1 = dataModel.createCheckpoint(c, { label: 'Day 1' });

  const arrival = dataModel.createArrivalBlock(c, { locationId: loc.id, timeId: day1.id, html: '<p>The market is bustling.</p>' });
  arrival.presence = ['npc_someone'];
  dataModel.addBeat(arrival, { label: 'Find the merchant', text: 'He is by the fountain.' });
  dataModel.addBeat(arrival, { label: 'Notice the guard', text: 'Watching closely.' });

  migrateToModularContent(c);

  const beatModules = c.contentModules.filter((m) => m.type === 'beat');
  assert.strictEqual(beatModules.length, 2);
  const beat1 = c.contentModules.find((m) => m.name === 'Find the merchant');
  const beat2 = c.contentModules.find((m) => m.name === 'Notice the guard');
  const beat1Asg = c.assignments.find((a) => a.moduleId === beat1.id);
  const beat2Asg = c.assignments.find((a) => a.moduleId === beat2.id);
  assert.strictEqual(beat1Asg.order, 0, 'the first beat added should keep order 0, derived from its array position');
  assert.strictEqual(beat2Asg.order, 1);
  assert.strictEqual(beat1Asg.entityId, loc.id);
  assert.strictEqual(beat1Asg.timeId, day1.id);

  const descModule = c.contentModules.find((m) => m.type === 'description');
  assert.ok(descModule, 'a non-empty arrival html should become a description module');
  assert.strictEqual(descModule.html, '<p>The market is bustling.</p>');

  const survivingArrival = c.blocks.find((b) => b.kind === 'arrival');
  assert.ok(survivingArrival, 'the arrival record itself should still exist after migration');
  assert.deepStrictEqual(survivingArrival.presence, ['npc_someone'], 'presence must survive on the arrival — it is not content, it stays where it was');
  assert.strictEqual(survivingArrival.html, undefined, 'html should be gone from the arrival — it now lives in the description module');
  assert.strictEqual(survivingArrival.beats, undefined, 'beats should be gone from the arrival — they now live as separate modules+assignments');
  assert.strictEqual(survivingArrival.complete, undefined, 'complete should be gone from the arrival — it now lives on the description module');

  ok('migrateToModularContent converts beats and the arrival description correctly, and the arrival itself survives stripped down to locationId/timeId/presence');
}

// --- Test 11: an empty arrival html does not manufacture a description ----
{
  const dataModel = require('../src/dataModel');
  const c = dataModel.emptyCampaign();
  const loc = dataModel.createEntity(c, { type: 'location', name: 'Empty Room' });
  const day1 = dataModel.createCheckpoint(c, { label: 'Day 1' });
  dataModel.createArrivalBlock(c, { locationId: loc.id, timeId: day1.id, html: '' });

  migrateToModularContent(c);

  assert.strictEqual(c.contentModules.filter((m) => m.type === 'description').length, 0, 'an arrival with empty/whitespace-only html should not create a description module');
  assert.ok(c.blocks.find((b) => b.kind === 'arrival'), 'the arrival itself should still survive even with nothing to convert');

  ok('an empty arrival html does not manufacture a description module, but the arrival itself still survives');
}

// --- Test 12: idempotency — running migration twice doesn't duplicate -----
{
  const dataModel = require('../src/dataModel');
  const c = dataModel.emptyCampaign();
  const npc = dataModel.createEntity(c, { type: 'npc', name: 'Someone' });
  const day1 = dataModel.createCheckpoint(c, { label: 'Day 1' });
  dataModel.createNoteBlock(c, { entityId: npc.id, timeId: day1.id, text: 'Once.' });

  migrateToModularContent(c);
  const countAfterFirst = c.contentModules.length;
  migrateToModularContent(c);
  assert.strictEqual(c.contentModules.length, countAfterFirst, 'running migration a second time must not duplicate anything');

  ok('migrateToModularContent is idempotent — running it again on already-migrated data changes nothing');
}

// --- Test 13: empty campaign migrates safely, no errors -------------------
{
  const dataModel = require('../src/dataModel');
  const c = dataModel.emptyCampaign();
  migrateToModularContent(c);
  assert.strictEqual(c.contentModules.length, 0);
  assert.strictEqual(c.assignments.length, 0);
  ok('migrating a campaign with nothing to convert is a safe no-op, not an error');
}

// --- Test 14: an empty label is preserved exactly, never fallback-named ---
// Regression test for a real bug found while verifying against a real
// campaign file specifically: a beat with an empty label ("") got
// migrated with the module name "Section" instead. That field doubles
// as the rendered Play-mode label for beat/topic/scene modules — so
// this wasn't just a cosmetic manager-naming choice, it would have
// changed what actually shows up in a live session for existing
// content, directly contradicting the whole point of this migration
// (existing content must appear exactly like it did before).
{
  const dataModel = require('../src/dataModel');
  const c = dataModel.emptyCampaign();
  const loc = dataModel.createEntity(c, { type: 'location', name: 'Somewhere' });
  const day1 = dataModel.createCheckpoint(c, { label: 'Day 1' });
  const arrival = dataModel.createArrivalBlock(c, { locationId: loc.id, timeId: day1.id, html: '' });
  dataModel.addBeat(arrival, { label: '', text: 'Body text with no title.' });
  const topic = dataModel.createTopicBlock(c, { entityId: loc.id, label: '', text: 'A topic with no title.' });

  migrateToModularContent(c);

  const beatModule = c.contentModules.find((m) => m.type === 'beat');
  assert.strictEqual(beatModule.name, '', 'an empty beat label must migrate to an empty module name, never a substituted fallback — that field is the rendered label');
  const topicModule = c.contentModules.find((m) => m.type === 'topic');
  assert.strictEqual(topicModule.name, '', 'same for an empty topic label');

  ok('an empty label is preserved exactly during migration rather than replaced with a fallback name, since it doubles as the actual rendered Play-mode label');
}

// --- Test 15: migration preserves original ids for JUMP-targetable types --
// Ctrl+L jump links store a raw id directly in text ([[JUMP:beat_xxx]] /
// [[JUMP:topic_xxx]]) — a real, findable reference baked into stored
// content, not something that goes through any lookup this migration
// touches. If migration generated a fresh id for the resulting module
// instead of keeping the original, any such existing link would quietly
// stop resolving to anything. Checked and confirmed there are no JUMP
// tokens in this project's own real campaign file today, so nothing is
// broken by this in practice right now — but the bug was real regardless
// of whether today's data happens to exercise it, and is now fixed at
// the source rather than left as a known limitation for a hypothetical
// campaign that does use it.
{
  const dataModel = require('../src/dataModel');
  const c = dataModel.emptyCampaign();
  const loc = dataModel.createEntity(c, { type: 'location', name: 'Ruins' });
  const npc = dataModel.createEntity(c, { type: 'npc', name: 'Guide' });
  const day1 = dataModel.createCheckpoint(c, { label: 'Day 1' });

  const note = dataModel.createNoteBlock(c, { entityId: npc.id, timeId: day1.id, text: 'n' });
  const topic = dataModel.createTopicBlock(c, { entityId: npc.id, label: 'Rumors', text: 't' });
  const scene = dataModel.createSceneBlock(c, { locationId: loc.id, timeId: day1.id, label: 'Scene', lines: [] });
  const arrival = dataModel.createArrivalBlock(c, { locationId: loc.id, timeId: day1.id, html: '' });
  const beat = dataModel.addBeat(arrival, { label: 'Section', text: 'b' });

  migrateToModularContent(c);

  assert.ok(c.contentModules.find((m) => m.id === note.id), 'a note\'s module must keep the note block\'s original id');
  assert.ok(c.contentModules.find((m) => m.id === topic.id), 'a topic\'s module must keep the topic block\'s original id — an existing [[JUMP:topic_xxx]] token depends on this exact id still existing');
  assert.ok(c.contentModules.find((m) => m.id === scene.id), 'a scene\'s module must keep the scene block\'s original id');
  assert.ok(c.contentModules.find((m) => m.id === beat.id), 'a beat\'s module must keep the beat\'s original id — an existing [[JUMP:beat_xxx]] token depends on this exact id still existing');

  ok('migration preserves original ids for note/topic/scene/beat, so an existing JUMP link stored in text keeps resolving to the same module after conversion');
}

console.log('\nAll storage tests passed.');
