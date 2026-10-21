const assert = require('assert');
const dataModel = require('../src/dataModel');
const storage = require('../src/storage');

function ok(msg) { console.log('ok  -', msg); }

// A, B, C at the top; A has A1, A2; B has B1.
function tree() {
  const c = dataModel.emptyCampaign();
  const g = {};
  const mk = (name, parent) => { g[name] = dataModel.createEntityGroup(c, { name, parentId: parent ? g[parent].id : null }); };
  mk('A'); mk('B'); mk('C'); mk('A1', 'A'); mk('A2', 'A'); mk('B1', 'B');
  return { c, g };
}
const childrenOf = (c, parentName, g) => c.entityGroups
  .filter((x) => (x.parentId || null) === (parentName ? g[parentName].id : null))
  .sort((a, b) => a.order - b.order)
  .map((x) => x.name);
const orders = (c, parentName, g) => c.entityGroups
  .filter((x) => (x.parentId || null) === (parentName ? g[parentName].id : null))
  .sort((a, b) => a.order - b.order)
  .map((x) => x.order);

// --- Test 1: drop zones resolve to the right placement -------------------
{
  const { c, g } = tree();
  assert.deepStrictEqual(dataModel.resolveGroupDrop(c, 'before', g.B.id), { parentId: null, beforeGroupId: g.B.id });
  assert.deepStrictEqual(dataModel.resolveGroupDrop(c, 'before', g.A2.id), { parentId: g.A.id, beforeGroupId: g.A2.id }, 'before a nested group stays inside that group\'s parent');
  assert.deepStrictEqual(dataModel.resolveGroupDrop(c, 'inside', g.B.id), { parentId: g.B.id, beforeGroupId: null });
  assert.deepStrictEqual(dataModel.resolveGroupDrop(c, 'top'), { parentId: null, beforeGroupId: g.A.id }, 'the very top means top-level, ahead of the current first group');
  assert.deepStrictEqual(dataModel.resolveGroupDrop(c, 'end'), { parentId: null, beforeGroupId: null });
  assert.strictEqual(dataModel.resolveGroupDrop(c, 'before', 'grp_nope'), null, 'an unknown target resolves to nothing');
  assert.strictEqual(dataModel.resolveGroupDrop(c, 'sideways', g.A.id), null, 'an unknown zone resolves to nothing');
  assert.deepStrictEqual(dataModel.resolveGroupDrop(dataModel.emptyCampaign(), 'top'), { parentId: null, beforeGroupId: null }, 'with no groups at all, "top" is simply top-level');
  ok('each drop zone resolves to the right parent and position, and unknown targets or zones resolve to nothing');
}

// --- Test 2: reordering among siblings ------------------------------------
{
  const { c, g } = tree();
  assert.ok(dataModel.placeEntityGroup(c, g.C.id, { parentId: null, beforeGroupId: g.A.id }));
  assert.deepStrictEqual(childrenOf(c, null, g), ['C', 'A', 'B'], 'C moved to the front');
  assert.deepStrictEqual(orders(c, null, g), [0, 1, 2], 'order numbers are renumbered cleanly');

  assert.ok(dataModel.placeEntityGroup(c, g.C.id, dataModel.resolveGroupDrop(c, 'end')));
  assert.deepStrictEqual(childrenOf(c, null, g), ['A', 'B', 'C'], 'moved to the end');

  assert.ok(dataModel.placeEntityGroup(c, g.B.id, dataModel.resolveGroupDrop(c, 'top')));
  assert.deepStrictEqual(childrenOf(c, null, g), ['B', 'A', 'C'], 'moved above the first entry');
  ok('groups reorder among their siblings, and sibling order numbers stay a clean 0..n-1');
}

// --- Test 3: nesting and un-nesting ---------------------------------------
{
  const { c, g } = tree();
  assert.ok(dataModel.placeEntityGroup(c, g.C.id, dataModel.resolveGroupDrop(c, 'inside', g.B.id)));
  assert.deepStrictEqual(childrenOf(c, 'B', g), ['B1', 'C'], 'dropped inside B, as its last child');
  assert.strictEqual(g.C.parentId, g.B.id);
  assert.deepStrictEqual(childrenOf(c, null, g), ['A', 'B']);

  // A nested group dragged to the very top becomes the first top-level group.
  assert.ok(dataModel.placeEntityGroup(c, g.A2.id, dataModel.resolveGroupDrop(c, 'top')));
  assert.strictEqual(g.A2.parentId, null, 'dragging to the very top makes it top-level');
  assert.deepStrictEqual(childrenOf(c, null, g), ['A2', 'A', 'B']);
  assert.deepStrictEqual(childrenOf(c, 'A', g), ['A1'], 'and it left its old parent');

  // Before a nested sibling in a DIFFERENT parent moves it there.
  assert.ok(dataModel.placeEntityGroup(c, g.A1.id, dataModel.resolveGroupDrop(c, 'before', g.B1.id)));
  assert.deepStrictEqual(childrenOf(c, 'B', g), ['A1', 'B1', 'C']);
  assert.strictEqual(g.A1.parentId, g.B.id);

  // A group can be dropped to the end of the top level from deep inside.
  assert.ok(dataModel.placeEntityGroup(c, g.B1.id, dataModel.resolveGroupDrop(c, 'end')));
  assert.deepStrictEqual(childrenOf(c, null, g), ['A2', 'A', 'B', 'B1']);
  ok('groups can be nested, pulled back out to the very top or the very end, and moved between parents');
}

// --- Test 4: a group never goes inside itself or its own descendants -------
{
  const { c, g } = tree();
  const before = JSON.stringify(c.entityGroups);
  assert.strictEqual(dataModel.placeEntityGroup(c, g.A.id, { parentId: g.A.id }), false, 'not inside itself');
  assert.strictEqual(dataModel.placeEntityGroup(c, g.A.id, { parentId: g.A1.id }), false, 'not inside its own child');
  assert.strictEqual(dataModel.canPlaceEntityGroup(c, g.A.id, { parentId: g.A1.id }), false);
  assert.strictEqual(dataModel.placeEntityGroup(c, g.A.id, { parentId: null, beforeGroupId: g.A.id }), false, 'not "before itself"');

  // a deeper chain: A > A1 > A1x, then try A inside A1x
  const deep = dataModel.createEntityGroup(c, { name: 'A1x', parentId: g.A1.id });
  assert.strictEqual(dataModel.placeEntityGroup(c, g.A.id, { parentId: deep.id }), false, 'not inside a grandchild either');
  assert.strictEqual(JSON.stringify(c.entityGroups.filter((x) => x.id !== deep.id)), before, 'every refused move left the tree exactly as it was');
  ok('a group can never be dropped inside itself or any of its own descendants, and a refused drop changes nothing');
}

// --- Test 5: malformed placements are refused -----------------------------
{
  const { c, g } = tree();
  const before = JSON.stringify(c.entityGroups);
  assert.strictEqual(dataModel.placeEntityGroup(c, 'grp_nope', { parentId: null }), false, 'unknown group');
  assert.strictEqual(dataModel.placeEntityGroup(c, g.A.id, { parentId: 'grp_nope' }), false, 'unknown parent');
  assert.strictEqual(dataModel.placeEntityGroup(c, g.A.id, { parentId: null, beforeGroupId: 'grp_nope' }), false, 'unknown "before" sibling');
  assert.strictEqual(dataModel.placeEntityGroup(c, g.C.id, { parentId: g.A.id, beforeGroupId: g.B.id }), false, '"before" a group that is not a child of the chosen parent');
  assert.strictEqual(JSON.stringify(c.entityGroups), before, 'every refusal left the tree exactly as it was');

  // An empty placement means "top-level, last". C is already exactly there,
  // so that is a legal move that happens to change nothing — not an error.
  assert.strictEqual(dataModel.placeEntityGroup(c, g.C.id), true);
  assert.strictEqual(JSON.stringify(c.entityGroups), before, 'and it really does change nothing');
  ok('placements naming a missing group, parent or sibling, or a sibling under the wrong parent, are refused without changing anything');
}

// --- Test 6: moving a group never disturbs entities or unrelated groups ----
{
  const { c, g } = tree();
  const e = dataModel.createEntity(c, { type: 'npc', name: 'Rook' });
  e.groupId = g.A1.id;
  const otherOrdersBefore = orders(c, 'B', g).join();
  dataModel.placeEntityGroup(c, g.A.id, dataModel.resolveGroupDrop(c, 'inside', g.C.id));
  assert.strictEqual(e.groupId, g.A1.id, 'entities stay in the group they were in when it moves');
  assert.strictEqual(orders(c, 'B', g).join(), otherOrdersBefore, 'an unrelated parent\'s children are untouched');
  assert.strictEqual(g.A1.parentId, g.A.id, 'a moved group keeps its own children');
  ok('moving a group carries its subtree and entities along and leaves everything else alone');
}

// --- Test 7: repeated moves never create ties --------------------------------
{
  const { c, g } = tree();
  const names = ['A', 'B', 'C'];
  for (let i = 0; i < 25; i++) {
    const moving = g[names[i % 3]];
    const target = g[names[(i + 1) % 3]];
    dataModel.placeEntityGroup(c, moving.id, dataModel.resolveGroupDrop(c, i % 2 ? 'before' : 'top', target.id));
  }
  const top = orders(c, null, g);
  assert.strictEqual(new Set(top).size, top.length, 'no two siblings share an order number');
  assert.deepStrictEqual(top, [0, 1, 2]);
  ok('after many moves, siblings still have distinct, contiguous order numbers');
}

// --- Test 8: the group last used is remembered per type -------------------
{
  const { c, g } = tree();
  assert.strictEqual(dataModel.getRememberedGroup(c, 'npc'), null, 'nothing remembered at first');
  dataModel.rememberEntityGroup(c, 'npc', g.A.id);
  dataModel.rememberEntityGroup(c, 'location', g.B.id);
  assert.strictEqual(dataModel.getRememberedGroup(c, 'npc'), g.A.id);
  assert.strictEqual(dataModel.getRememberedGroup(c, 'location'), g.B.id, 'NPCs and locations are remembered separately');

  dataModel.rememberEntityGroup(c, 'npc', null);
  assert.strictEqual(dataModel.getRememberedGroup(c, 'npc'), null, 'creating one ungrouped is remembered too');
  assert.strictEqual(dataModel.getRememberedGroup(c, 'location'), g.B.id, 'and doesn\'t disturb the other type');

  dataModel.rememberEntityGroup(c, 'npc', g.A1.id);
  dataModel.deleteEntityGroup(c, g.A1.id);
  assert.strictEqual(dataModel.getRememberedGroup(c, 'npc'), null, 'a group that has since been deleted is never offered');
  ok('the last group used is remembered separately for NPCs and locations, including "none", and a deleted group is never offered');
}

// --- Test 9: the memory is part of the campaign and backfilled ----------
{
  assert.deepStrictEqual(dataModel.emptyCampaign().meta.lastGroupByType, {});

  const legacy = dataModel.emptyCampaign();
  delete legacy.meta.lastGroupByType;
  storage.normalizeCampaign(legacy);
  assert.deepStrictEqual(legacy.meta.lastGroupByType, {}, 'an older campaign gains the field on load');

  const kept = dataModel.emptyCampaign();
  kept.meta.lastGroupByType = { npc: 'grp_x' };
  storage.normalizeCampaign(kept);
  assert.deepStrictEqual(kept.meta.lastGroupByType, { npc: 'grp_x' }, 'an existing value is left alone');

  [[], 'nope', null, 5].forEach((bad) => {
    const c = dataModel.emptyCampaign();
    c.meta.lastGroupByType = bad;
    storage.normalizeCampaign(c);
    assert.deepStrictEqual(c.meta.lastGroupByType, {}, 'a malformed value is replaced rather than crashing: ' + JSON.stringify(bad));
  });
  ok('the remembered groups are part of every campaign, backfilled into older ones, and a malformed value is repaired');
}

// --- Test 10: a draft entity is invisible to everything that lists ----------
{
  const c = dataModel.emptyCampaign();
  const real = dataModel.createEntity(c, { type: 'npc', name: 'Real' });
  const draft = dataModel.createDraftEntity(c, { type: 'npc', groupId: null });

  assert.strictEqual(c.entities[draft.id], draft, 'looked up by id, a draft is just an entity — so every editor handler works on it');
  assert.ok(draft.id in c.entities);
  assert.ok(dataModel.isDraftEntity(c, draft.id));
  assert.ok(!dataModel.isDraftEntity(c, real.id), 'a real entity is never mistaken for a draft');
  assert.ok(!dataModel.isDraftEntity(c, 'npc_nope'));

  assert.deepStrictEqual(Object.values(c.entities).map((e) => e.name), ['Real'], 'not in Object.values');
  assert.deepStrictEqual(Object.keys(c.entities), [real.id], 'not in Object.keys');
  const seen = []; for (const k in c.entities) seen.push(k);
  assert.deepStrictEqual(seen, [real.id], 'not in for...in');
  assert.deepStrictEqual(Object.keys({ ...c.entities }), [real.id], 'not carried by a spread copy');
  assert.ok(!JSON.stringify(c).includes(draft.id), 'and never written when the campaign is saved');
  assert.strictEqual(JSON.parse(JSON.stringify(c)).entities[draft.id], undefined);
  ok('a draft entity can be looked up by id but is invisible to every list, search, copy and save');
}

// --- Test 11: starting a draft does not use up a color ---------------------
{
  const c = dataModel.emptyCampaign();
  c.meta.nextColorIndex = 3;
  const draft = dataModel.createDraftEntity(c, { type: 'location' });
  assert.strictEqual(c.meta.nextColorIndex, 3, 'a draft that is never created must not advance the palette');

  const probe = dataModel.emptyCampaign();
  probe.meta.nextColorIndex = 3;
  assert.strictEqual(draft.color, dataModel.createEntity(probe, { type: 'location', name: 'x' }).color, 'it is offered the same color a real entity would get');
  assert.strictEqual(draft.type, 'location');
  assert.strictEqual(draft.icon, require('../src/constants').DEFAULT_ICON.location);
  ok('starting a draft previews the next palette color without using it up');
}

// --- Test 12: committing a draft makes it a real entity -------------------
{
  const c = dataModel.emptyCampaign();
  const draft = dataModel.createDraftEntity(c, { type: 'npc', groupId: null });
  draft.name = 'New Guy';
  const later = dataModel.createEntity(c, { type: 'npc', name: 'Created while the draft was open' });
  const indexBefore = c.meta.nextColorIndex;

  const committed = dataModel.commitDraftEntity(c, draft.id);
  assert.strictEqual(committed, draft);
  assert.ok(!dataModel.isDraftEntity(c, draft.id), 'no longer a draft');
  assert.ok(Object.values(c.entities).some((e) => e.id === draft.id), 'now in every list');
  assert.ok(JSON.parse(JSON.stringify(c)).entities[draft.id], 'and now saved');
  assert.strictEqual(c.meta.nextColorIndex, indexBefore + 1, 'its color is now used up');
  assert.strictEqual(Object.keys(c.entities).pop(), draft.id, 'it counts as the newest entity, not as one created back when the draft was started');
  assert.ok(later);
  assert.strictEqual(dataModel.commitDraftEntity(c, draft.id), null, 'committing twice does nothing');
  assert.strictEqual(dataModel.commitDraftEntity(c, later.id), null, 'committing a real entity does nothing');
  ok('committing a draft turns it into an ordinary, listed, saved entity — once');
}

// --- Test 13: discarding a draft removes everything made for it -----------
{
  const c = dataModel.emptyCampaign();
  const library = dataModel.createContentModule(c, { type: 'note', name: '', text: 'pre-existing library note' });
  const snapshot = new Set(c.contentModules.map((m) => m.id));

  const draft = dataModel.createDraftEntity(c, { type: 'npc' });
  const made = dataModel.createContentModule(c, { type: 'note', name: '', text: 'typed into the new-entity form' });
  dataModel.createAssignment(c, { moduleId: made.id, entityId: draft.id, timeId: null });
  dataModel.createAssignment(c, { moduleId: library.id, entityId: draft.id, timeId: null });
  draft.image = { filename: draft.id + '.jpg', size: 'medium', updatedAt: 'x' };

  assert.deepStrictEqual([...dataModel.getDraftOwnedModuleIds(c, draft.id, snapshot)], [made.id], 'only the module made during the draft is the draft\'s own — a pre-existing library one assigned to it is not');

  const filename = dataModel.discardDraftEntity(c, draft.id, snapshot);
  assert.strictEqual(filename, draft.id + '.jpg', 'reports the uploaded image so the file can be deleted from disk');
  assert.ok(!(draft.id in c.entities), 'the entity is gone');
  assert.strictEqual(c.assignments.length, 0, 'every assignment to it is gone');
  assert.deepStrictEqual(c.contentModules.map((m) => m.id), [library.id], 'the module made for it is gone, the pre-existing library note survives');
  ok('discarding a draft removes it, its assignments and the modules made for it — never a pre-existing library module');
}

// --- Test 14: discard will not touch a real entity -------------------------
{
  const c = dataModel.emptyCampaign();
  const real = dataModel.createEntity(c, { type: 'npc', name: 'Keep me' });
  const m = dataModel.createContentModule(c, { type: 'note', name: '', text: 't' });
  dataModel.createAssignment(c, { moduleId: m.id, entityId: real.id, timeId: null });
  assert.strictEqual(dataModel.discardDraftEntity(c, real.id, new Set()), null);
  assert.ok(real.id in c.entities, 'a real entity survives');
  assert.strictEqual(c.assignments.length, 1, 'and so does its content');
  assert.strictEqual(c.contentModules.length, 1);
  assert.strictEqual(dataModel.discardDraftEntity(c, 'npc_nope', new Set()), null, 'an unknown id is harmless');
  ok('discarding refuses to touch anything that is not a draft');
}

console.log('\nAll group organizing and draft entity tests passed.');
