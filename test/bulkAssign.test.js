const assert = require('assert');
const dataModel = require('../src/dataModel');
const query = require('../src/query');

function ok(msg) { console.log('ok  -', msg); }

function makeCampaign() {
  const c = dataModel.emptyCampaign();
  const ships = dataModel.createEntityGroup(c, { name: 'Ships' });
  const crew = dataModel.createEntityGroup(c, { name: 'Crew', parentId: ships.id });
  const docks = dataModel.createEntityGroup(c, { name: 'Docks' });

  const kade = dataModel.createEntity(c, { type: 'npc', name: 'Old Kade' });
  const rill = dataModel.createEntity(c, { type: 'npc', name: 'Rill Tanner' });
  const vera = dataModel.createEntity(c, { type: 'npc', name: 'Vera Quill' });
  const tavern = dataModel.createEntity(c, { type: 'location', name: 'Dockside Tavern' });
  const hull = dataModel.createEntity(c, { type: 'location', name: 'Hull Bay' });
  kade.groupId = crew.id;      // nested: Ships > Crew
  rill.groupId = docks.id;
  tavern.groupId = docks.id;
  // vera and hull deliberately ungrouped
  return { c, ships, crew, docks, kade, rill, vera, tavern, hull, all: [kade, rill, vera, tavern, hull] };
}

// --- Test 1: searching for a type name finds entities of that type --------
// (the reported problem: "npc" in the search field didn't bring in NPCs)
{
  const { c, all } = makeCampaign();
  const names = query.filterEntitiesForPicker(c, all, { query: 'npc' }).map((e) => e.name);
  assert.deepStrictEqual(names, ['Old Kade', 'Rill Tanner', 'Vera Quill']);
  const locs = query.filterEntitiesForPicker(c, all, { query: 'location' }).map((e) => e.name);
  assert.deepStrictEqual(locs, ['Dockside Tavern', 'Hull Bay']);
  ok('searching "npc" or "location" matches by entity type, not just by name');
}

// --- Test 2: search also matches group names, including ancestors ---------
{
  const { c, all } = makeCampaign();
  assert.deepStrictEqual(query.filterEntitiesForPicker(c, all, { query: 'docks' }).map((e) => e.name), ['Dockside Tavern', 'Rill Tanner'].sort(),
    '"docks" should match by group name (and Dockside Tavern by its own name too)');
  // Old Kade sits in Ships > Crew — searching the ancestor "ships" must find him.
  assert.deepStrictEqual(query.filterEntitiesForPicker(c, all, { query: 'ships' }).map((e) => e.name), ['Old Kade']);
  ok('search matches an entity\'s group name, including groups it\'s nested under');
}

// --- Test 3: multiple terms must ALL match --------------------------------
{
  const { c, all } = makeCampaign();
  const r = query.filterEntitiesForPicker(c, all, { query: 'npc docks' }).map((e) => e.name);
  assert.deepStrictEqual(r, ['Rill Tanner'], 'only an NPC that is also in Docks should match both terms');
  assert.deepStrictEqual(query.filterEntitiesForPicker(c, all, { query: 'npc zzz' }), []);
  ok('multiple search terms must all match, combining across name, type and group');
}

// --- Test 4: type filter -----------------------------------------------------
{
  const { c, all } = makeCampaign();
  assert.strictEqual(query.filterEntitiesForPicker(c, all, { type: 'npc' }).length, 3);
  assert.strictEqual(query.filterEntitiesForPicker(c, all, { type: 'location' }).length, 2);
  assert.strictEqual(query.filterEntitiesForPicker(c, all, { type: '' }).length, 5);
  ok('the type filter narrows to one entity type, and empty means any');
}

// --- Test 5: group filter includes subgroups; "__none__" means ungrouped --
{
  const { c, all, ships } = makeCampaign();
  const inShips = query.filterEntitiesForPicker(c, all, { groupId: ships.id }).map((e) => e.name);
  assert.deepStrictEqual(inShips, ['Old Kade'], 'filtering by a parent group must include entities in its subgroups');
  const ungrouped = query.filterEntitiesForPicker(c, all, { groupId: '__none__' }).map((e) => e.name);
  assert.deepStrictEqual(ungrouped, ['Hull Bay', 'Vera Quill']);
  ok('a group filter includes everything in its subgroups, and "no group" finds only ungrouped entities');
}

// --- Test 6: an entity pointing at a deleted group counts as ungrouped ----
{
  const { c, all, vera } = makeCampaign();
  vera.groupId = 'grp_that_no_longer_exists';
  const ungrouped = query.filterEntitiesForPicker(c, all, { groupId: '__none__' }).map((e) => e.name);
  assert.ok(ungrouped.includes('Vera Quill'), 'a dangling groupId should be treated as no group, not hidden from every filter');
  ok('an entity whose group no longer exists is still findable under "no group"');
}

// --- Test 7: filters combine, results are alphabetical --------------------
{
  const { c, all, docks } = makeCampaign();
  const r = query.filterEntitiesForPicker(c, all, { query: 'r', type: 'npc', groupId: docks.id }).map((e) => e.name);
  assert.deepStrictEqual(r, ['Rill Tanner']);
  const sorted = query.filterEntitiesForPicker(c, all, {}).map((e) => e.name);
  assert.deepStrictEqual(sorted, [...sorted].sort((a, b) => a.localeCompare(b)));
  ok('search, type and group filters combine, and results always come back in alphabetical order');
}

// --- Test 8: a group cycle can't hang the path or descendant lookups ------
{
  const { c, ships, crew } = makeCampaign();
  ships.parentId = crew.id; // corrupt: Ships -> Crew -> Ships
  assert.doesNotThrow(() => query.getGroupPathName(c, crew.id));
  assert.doesNotThrow(() => query.getGroupAndDescendantIds(c, ships.id));
  ok('a corrupted parent cycle in the group tree cannot cause an infinite loop');
}

// --- Test 9: bulk assign creates one assignment per entity ---------------
{
  const { c, kade, rill, vera } = makeCampaign();
  const mod = dataModel.createContentModule(c, { type: 'topic', name: 'Rumors', text: 'x' });
  const res = dataModel.assignModuleToEntities(c, { moduleId: mod.id, entityIds: [kade.id, rill.id, vera.id], timeId: null });
  assert.strictEqual(res.created.length, 3);
  assert.strictEqual(res.skipped.length, 0);
  assert.strictEqual(c.assignments.filter((a) => a.moduleId === mod.id).length, 3);
  ok('bulk assigning a module to several entities creates exactly one assignment each');
}

// --- Test 10: already-assigned entities are skipped, never duplicated -----
{
  const { c, kade, rill } = makeCampaign();
  const mod = dataModel.createContentModule(c, { type: 'topic', name: 'Rumors', text: 'x' });
  dataModel.createAssignment(c, { moduleId: mod.id, entityId: kade.id, timeId: null });

  const res = dataModel.assignModuleToEntities(c, { moduleId: mod.id, entityIds: [kade.id, rill.id], timeId: null });
  assert.deepStrictEqual(res.created, [rill.id]);
  assert.deepStrictEqual(res.skipped, [kade.id]);
  assert.strictEqual(c.assignments.filter((a) => a.moduleId === mod.id && a.entityId === kade.id).length, 1, 'Kade must not end up with a duplicate');
  ok('an entity that already has this content at the same time-scope is skipped instead of getting a duplicate');
}

// --- Test 11: a different time-scope is NOT a duplicate -------------------
{
  const { c, kade } = makeCampaign();
  const cp1 = dataModel.createCheckpoint(c, { label: 'Day 1' });
  const cp2 = dataModel.createCheckpoint(c, { label: 'Day 2' });
  const mod = dataModel.createContentModule(c, { type: 'topic', name: 'Rumors', text: 'x' });
  dataModel.createAssignment(c, { moduleId: mod.id, entityId: kade.id, timeId: cp1.id });

  const res = dataModel.assignModuleToEntities(c, { moduleId: mod.id, entityIds: [kade.id], timeId: cp2.id });
  assert.strictEqual(res.created.length, 1, 'the same entity at a different checkpoint is a legitimately separate placement');
  const always = dataModel.assignModuleToEntities(c, { moduleId: mod.id, entityIds: [kade.id], timeId: null });
  assert.strictEqual(always.created.length, 1, '"always available" is distinct from any specific checkpoint too');
  ok('the same content at a different checkpoint (or "always available") is a separate placement, not a duplicate');
}

// --- Test 12: the same entity listed twice in one call assigns once -------
{
  const { c, kade } = makeCampaign();
  const mod = dataModel.createContentModule(c, { type: 'note', text: 'x' });
  const res = dataModel.assignModuleToEntities(c, { moduleId: mod.id, entityIds: [kade.id, kade.id], timeId: null });
  assert.strictEqual(res.created.length, 1);
  assert.strictEqual(c.assignments.filter((a) => a.moduleId === mod.id).length, 1);
  ok('an entity appearing twice in the same bulk call is only assigned once');
}

console.log('\nAll bulk assign tests passed.');
