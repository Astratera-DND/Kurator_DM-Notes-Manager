const assert = require('assert');
const dataModel = require('../src/dataModel');
const storage = require('../src/storage');
const query = require('../src/query');

function ok(msg) { console.log('ok  -', msg); }

function fixture() {
  const c = dataModel.emptyCampaign();
  const crew = dataModel.createEntityGroup(c, { name: 'Ship Crew' });
  const eng = dataModel.createEntityGroup(c, { name: 'Engineering', parentId: crew.id });
  const dock = dataModel.createEntityGroup(c, { name: 'Station Dock' });
  const mk = (name, type, group) => { const e = dataModel.createEntity(c, { type, name }); if (group) e.groupId = group.id; return e; };
  const e = {
    bridge: mk('Bridge', 'location', crew),
    mara: mk('Captain Mara', 'npc', crew),
    rook: mk('Chief Rook', 'npc', eng),
    pell: mk('Mechanic Pell', 'npc', eng),
    yul: mk('Harbormaster Yul', 'npc', dock),
    cat: mk('Stray Cat', 'npc', null)
  };
  return { c, e, crew, eng, dock, all: Object.values(c.entities) };
}
const names = (list) => list.map((x) => x.name);

// --- Test 1: with no filters, everyone comes back, alphabetical -----------
{
  const { c, all } = fixture();
  const out = query.filterPresenceCandidates(c, all, [], {});
  assert.deepStrictEqual(names(out), ['Bridge', 'Captain Mara', 'Chief Rook', 'Harbormaster Yul', 'Mechanic Pell', 'Stray Cat']);
  assert.strictEqual(query.filterPresenceCandidates(c, all, [], undefined).length, 6, 'no options at all behaves the same');
  ok('with no filters every entity is offered, in a predictable alphabetical order');
}

// --- Test 2: the status filter is measured against who is present --------
{
  const { c, e, all } = fixture();
  const present = [e.mara.id, e.yul.id];
  assert.deepStrictEqual(names(query.filterPresenceCandidates(c, all, present, { status: 'added' })), ['Captain Mara', 'Harbormaster Yul']);
  assert.strictEqual(query.filterPresenceCandidates(c, all, present, { status: 'notAdded' }).length, 4);
  assert.ok(!names(query.filterPresenceCandidates(c, all, present, { status: 'notAdded' })).includes('Captain Mara'));
  assert.strictEqual(query.filterPresenceCandidates(c, all, present, { status: 'all' }).length, 6);
  assert.strictEqual(query.filterPresenceCandidates(c, all, present, { status: 'anything-else' }).length, 6, 'an unrecognized status means no restriction rather than hiding everything');
  assert.deepStrictEqual(names(query.filterPresenceCandidates(c, all, ['npc_ghost_that_was_deleted'], { status: 'added' })), [], 'a presence entry for a deleted entity matches nothing and breaks nothing');
  ok('"added" and "not added" are measured against the people flagged present; unknown status values and stale ids are harmless');
}

// --- Test 3: search matches name, type and group, and combines with filters
{
  const { c, e, crew, eng, all } = fixture();
  assert.deepStrictEqual(names(query.filterPresenceCandidates(c, all, [], { query: 'mech' })), ['Mechanic Pell']);
  assert.deepStrictEqual(names(query.filterPresenceCandidates(c, all, [], { query: 'engineering' })), ['Chief Rook', 'Mechanic Pell'], 'a group name finds everyone in it');
  assert.deepStrictEqual(names(query.filterPresenceCandidates(c, all, [], { query: 'location' })), ['Bridge'], 'a type name finds that type');
  assert.deepStrictEqual(names(query.filterPresenceCandidates(c, all, [], { type: 'location' })), ['Bridge']);
  assert.strictEqual(query.filterPresenceCandidates(c, all, [], { groupId: crew.id }).length, 4, 'a group filter includes its subgroups (Bridge, Mara, Rook, Pell)');
  assert.deepStrictEqual(names(query.filterPresenceCandidates(c, all, [], { groupId: eng.id })), ['Chief Rook', 'Mechanic Pell']);
  assert.deepStrictEqual(names(query.filterPresenceCandidates(c, all, [], { groupId: '__none__' })), ['Stray Cat']);

  // all of them together
  const out = query.filterPresenceCandidates(c, all, [e.pell.id], { query: 'm', type: 'npc', groupId: crew.id, status: 'notAdded' });
  assert.deepStrictEqual(names(out), ['Captain Mara'], 'search, type, group and status all apply at once');
  ok('search covers name/type/group, the group filter includes subgroups, and every filter combines with the others');
}

// --- Test 4: the collapse list exists and is backfilled -------------------
{
  assert.deepStrictEqual(dataModel.emptyCampaign().meta.collapsedPresenceGroups, [], 'a new campaign starts with everything expanded');

  const legacy = dataModel.emptyCampaign();
  delete legacy.meta.collapsedPresenceGroups;
  storage.normalizeCampaign(legacy);
  assert.deepStrictEqual(legacy.meta.collapsedPresenceGroups, [], 'a campaign saved before the picker existed gains the list on load');

  const kept = dataModel.emptyCampaign();
  kept.meta.collapsedPresenceGroups = ['grp_a', '__ungrouped__'];
  storage.normalizeCampaign(kept);
  assert.deepStrictEqual(kept.meta.collapsedPresenceGroups, ['grp_a', '__ungrouped__'], 'an existing list is left exactly as it was');

  const corrupt = dataModel.emptyCampaign();
  corrupt.meta.collapsedPresenceGroups = 'nope';
  storage.normalizeCampaign(corrupt);
  assert.deepStrictEqual(corrupt.meta.collapsedPresenceGroups, [], 'a malformed value is replaced rather than crashing the picker');
  ok('the picker\'s collapse list defaults to empty, is backfilled into older campaigns, and survives untouched');
}

// --- Test 5: it is separate from the Entities tab's collapse list --------
{
  const c = dataModel.emptyCampaign();
  c.meta.collapsedGroupIds = ['grp_x'];
  storage.normalizeCampaign(c);
  assert.deepStrictEqual(c.meta.collapsedPresenceGroups, [], 'collapsing groups on the Entities tab does not collapse them in the picker');
  ok('the picker keeps its own collapse list, independent of the Entities tab');
}

console.log('\nAll presence picker tests passed.');
