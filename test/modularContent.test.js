const assert = require('assert');
const {
  emptyCampaign, createEntity, createCheckpoint,
  createContentModule, createAssignment, moveAssignment, updateAssignmentTimeId,
  deleteAssignment, deleteContentModule, setModuleComplete
} = require('../src/dataModel');

function ok(msg) { console.log('ok  -', msg); }

// --- Test 1: createContentModule produces the right shape per type --------
{
  const c = emptyCampaign();
  const note = createContentModule(c, { type: 'note', name: 'A note', text: 'Note body' });
  assert.strictEqual(note.type, 'note');
  assert.strictEqual(note.text, 'Note body');
  assert.strictEqual(note.complete, false);
  assert.strictEqual(note.html, undefined, 'a note should not carry an unused html field');
  assert.strictEqual(note.lines, undefined, 'a note should not carry an unused lines field');

  const topic = createContentModule(c, { type: 'topic', name: 'Rumors', text: 'Topic body' });
  assert.strictEqual(topic.type, 'topic');
  assert.strictEqual(topic.text, 'Topic body');

  const beat = createContentModule(c, { type: 'beat', name: 'Find the key', text: 'Beat body' });
  assert.strictEqual(beat.type, 'beat');
  assert.strictEqual(beat.text, 'Beat body');

  const scene = createContentModule(c, { type: 'scene', name: 'The confrontation', lines: [{ id: 'ln1', speakerId: null, text: 'Hello.' }] });
  assert.strictEqual(scene.type, 'scene');
  assert.deepStrictEqual(scene.lines, [{ id: 'ln1', speakerId: null, text: 'Hello.' }]);
  assert.strictEqual(scene.text, undefined, 'a scene should not carry an unused text field');

  const desc = createContentModule(c, { type: 'description', name: 'Market at dusk', html: '<p>It is quiet.</p>' });
  assert.strictEqual(desc.type, 'description');
  assert.strictEqual(desc.html, '<p>It is quiet.</p>');
  assert.strictEqual(desc.text, undefined, 'a description should not carry an unused text field');

  assert.strictEqual(c.contentModules.length, 5);
  ok('createContentModule produces the correct type-specific shape for every content type, with no stray unused fields');
}

// --- Test 2: createAssignment auto-assigns order, scoped correctly --------
{
  const c = emptyCampaign();
  const npc = createEntity(c, { type: 'npc', name: 'Innkeeper' });
  const day1 = createCheckpoint(c, { label: 'Day 1' });
  const day2 = createCheckpoint(c, { label: 'Day 2' });

  // Topics: scoped by entityId ALONE (per assignmentScopeKey), matching
  // moveTopic's own pre-existing rule — order must make sense across
  // topics with different timeIds since they can end up shown together.
  const topicMod1 = createContentModule(c, { type: 'topic', name: 'Rumors', text: '' });
  const topicMod2 = createContentModule(c, { type: 'topic', name: 'Debt', text: '' });
  const asgT1 = createAssignment(c, { moduleId: topicMod1.id, entityId: npc.id, timeId: day1.id });
  const asgT2 = createAssignment(c, { moduleId: topicMod2.id, entityId: npc.id, timeId: day2.id });
  assert.strictEqual(asgT1.order, 0);
  assert.strictEqual(asgT2.order, 1, 'a second topic assignment on the same entity should get the next order value even though its timeId differs');

  // Notes: scoped by entityId+timeId — a note on a DIFFERENT checkpoint
  // starts its own order sequence from 0 again.
  const noteMod1 = createContentModule(c, { type: 'note', name: 'n1', text: '' });
  const noteMod2 = createContentModule(c, { type: 'note', name: 'n2', text: '' });
  const asgN1 = createAssignment(c, { moduleId: noteMod1.id, entityId: npc.id, timeId: day1.id });
  const asgN2 = createAssignment(c, { moduleId: noteMod2.id, entityId: npc.id, timeId: day2.id });
  assert.strictEqual(asgN1.order, 0);
  assert.strictEqual(asgN2.order, 0, 'a note assignment on a different checkpoint should start its own order sequence at 0, not continue day1\'s');

  ok('createAssignment auto-assigns order correctly, scoped by entityId alone for topics and entityId+timeId for everything else');
}

// --- Test 3: moveAssignment swaps with neighbor, isolates scopes ----------
{
  const c = emptyCampaign();
  const loc = createEntity(c, { type: 'location', name: 'Market' });
  const day1 = createCheckpoint(c, { label: 'Day 1' });
  const day2 = createCheckpoint(c, { label: 'Day 2' });

  const beat1 = createContentModule(c, { type: 'beat', name: 'First', text: '' });
  const beat2 = createContentModule(c, { type: 'beat', name: 'Second', text: '' });
  const beat3 = createContentModule(c, { type: 'beat', name: 'Third', text: '' });
  const a1 = createAssignment(c, { moduleId: beat1.id, entityId: loc.id, timeId: day1.id });
  const a2 = createAssignment(c, { moduleId: beat2.id, entityId: loc.id, timeId: day1.id });
  const a3 = createAssignment(c, { moduleId: beat3.id, entityId: loc.id, timeId: day1.id });
  // A beat on a different checkpoint — must be a fully separate scope,
  // unaffected by anything happening among the day1 beats.
  const otherMod = createContentModule(c, { type: 'beat', name: 'Other day', text: '' });
  const otherAsg = createAssignment(c, { moduleId: otherMod.id, entityId: loc.id, timeId: day2.id });

  const order = () => c.assignments
    .filter((a) => a.entityId === loc.id && a.timeId === day1.id)
    .sort((x, y) => x.order - y.order)
    .map((a) => c.contentModules.find((m) => m.id === a.moduleId).name);
  assert.deepStrictEqual(order(), ['First', 'Second', 'Third']);

  const moved = moveAssignment(c, a3.id, -1);
  assert.strictEqual(moved, true);
  assert.deepStrictEqual(order(), ['First', 'Third', 'Second']);

  const cantMoveFurther = moveAssignment(c, a1.id, -1);
  assert.strictEqual(cantMoveFurther, false, 'moving the first assignment up should no-op, not error or wrap around');

  const otherUnaffected = moveAssignment(c, otherAsg.id, 1);
  assert.strictEqual(otherUnaffected, false, 'the lone day2 assignment has no sibling to swap with — unaffected by the day1 reordering above');

  ok('moveAssignment swaps with its neighbor and safely no-ops at scope boundaries, without affecting a different checkpoint\'s assignments');
}

// --- Test 4: updateAssignmentTimeId re-scopes into the new group ----------
{
  const c = emptyCampaign();
  const npc = createEntity(c, { type: 'npc', name: 'Scribe' });
  const day1 = createCheckpoint(c, { label: 'Day 1' });
  const day2 = createCheckpoint(c, { label: 'Day 2' });

  const noteA = createContentModule(c, { type: 'note', name: 'a', text: '' });
  const noteB = createContentModule(c, { type: 'note', name: 'b', text: '' });
  const asgA = createAssignment(c, { moduleId: noteA.id, entityId: npc.id, timeId: day2.id });
  createAssignment(c, { moduleId: noteB.id, entityId: npc.id, timeId: day2.id });

  const moved = updateAssignmentTimeId(c, asgA.id, day1.id);
  assert.strictEqual(moved, true);
  assert.strictEqual(asgA.timeId, day1.id);
  assert.strictEqual(asgA.order, 0, 'moving into a checkpoint with no existing assignments should land at order 0, same as a freshly created one');

  ok('updateAssignmentTimeId re-scopes an assignment into its new checkpoint\'s order sequence, landing at the end (or 0, if empty)');
}

// --- Test 5: deleteAssignment removes only the placement, not the module --
{
  const c = emptyCampaign();
  const npc1 = createEntity(c, { type: 'npc', name: 'Tavernkeeper' });
  const npc2 = createEntity(c, { type: 'npc', name: 'Dockworker' });
  const day1 = createCheckpoint(c, { label: 'Day 1' });

  const warning = createContentModule(c, { type: 'topic', name: 'Ambush warning', text: 'Watch out.' });
  const asg1 = createAssignment(c, { moduleId: warning.id, entityId: npc1.id, timeId: day1.id });
  const asg2 = createAssignment(c, { moduleId: warning.id, entityId: npc2.id, timeId: day1.id });

  deleteAssignment(c, asg1.id);
  assert.strictEqual(c.assignments.length, 1, 'only the deleted assignment should be gone');
  assert.strictEqual(c.assignments[0].id, asg2.id, 'the other placement of the same module should be untouched');
  assert.strictEqual(c.contentModules.length, 1, 'the module itself must still exist — this is unassigning from one place, not deleting the content');

  ok('deleteAssignment removes only that one placement, leaving the module and its other assignments untouched');
}

// --- Test 6: deleteContentModule cascades to every assignment -------------
{
  const c = emptyCampaign();
  const npc1 = createEntity(c, { type: 'npc', name: 'Tavernkeeper' });
  const npc2 = createEntity(c, { type: 'npc', name: 'Dockworker' });
  const day1 = createCheckpoint(c, { label: 'Day 1' });

  const warning = createContentModule(c, { type: 'topic', name: 'Ambush warning', text: 'Watch out.' });
  createAssignment(c, { moduleId: warning.id, entityId: npc1.id, timeId: day1.id });
  createAssignment(c, { moduleId: warning.id, entityId: npc2.id, timeId: day1.id });
  assert.strictEqual(c.assignments.length, 2);

  deleteContentModule(c, warning.id);
  assert.strictEqual(c.contentModules.length, 0, 'the module should be gone');
  assert.strictEqual(c.assignments.length, 0, 'every assignment of the deleted module must be cascaded away too, or they would be dangling references to a module that no longer exists');

  ok('deleteContentModule cascades — removing a module also removes every assignment of it, leaving no dangling references');
}

// --- Test 7: setModuleComplete is shared across every assignment ----------
// This is the actual feature being asked for, not just a data-shape
// detail: mark a piece of content resolved wherever it happens to come
// up, and every other place it's also assigned should immediately read
// as resolved too — not require completing it separately in each spot.
{
  const c = emptyCampaign();
  const npc1 = createEntity(c, { type: 'npc', name: 'Tavernkeeper' });
  const npc2 = createEntity(c, { type: 'npc', name: 'Dockworker' });
  const npc3 = createEntity(c, { type: 'npc', name: 'Blacksmith' });
  const day1 = createCheckpoint(c, { label: 'Day 1' });

  const warning = createContentModule(c, { type: 'topic', name: 'Ambush warning', text: 'Watch out.' });
  createAssignment(c, { moduleId: warning.id, entityId: npc1.id, timeId: day1.id });
  createAssignment(c, { moduleId: warning.id, entityId: npc2.id, timeId: day1.id });
  createAssignment(c, { moduleId: warning.id, entityId: npc3.id, timeId: day1.id });

  const readComplete = () => c.assignments.map((a) => c.contentModules.find((m) => m.id === a.moduleId).complete);
  assert.deepStrictEqual(readComplete(), [false, false, false]);

  // Simulates marking it complete via whichever assignment the player
  // actually encountered — the tavernkeeper, say.
  setModuleComplete(c, warning.id, true);
  assert.deepStrictEqual(readComplete(), [true, true, true], 'completing the module through one assignment must be reflected reading through every other assignment of the same module — this is the whole point of a shared completion flag rather than a per-assignment one');

  ok('setModuleComplete is genuinely shared — completing content assigned to multiple entities resolves it everywhere at once, not per-placement');
}

// --- Test 8: getModuleAssignments resolves every placement of a module ----
{
  const c = emptyCampaign();
  const npc1 = createEntity(c, { type: 'npc', name: 'Tavernkeeper' });
  const npc2 = createEntity(c, { type: 'npc', name: 'Dockworker' });
  const day1 = createCheckpoint(c, { label: 'Day 1' });

  const warning = createContentModule(c, { type: 'topic', name: 'Ambush warning', text: 'Watch out.' });
  createAssignment(c, { moduleId: warning.id, entityId: npc1.id, timeId: day1.id });
  createAssignment(c, { moduleId: warning.id, entityId: npc2.id, timeId: null });

  const { getModuleAssignments } = require('../src/query');
  const placements = getModuleAssignments(c, warning.id);
  assert.strictEqual(placements.length, 2, 'both placements of the module should be found');
  const names = placements.map((p) => p.entity.name).sort();
  assert.deepStrictEqual(names, ['Dockworker', 'Tavernkeeper'], 'each placement should resolve its actual entity, not just an id');
  const withCheckpoint = placements.find((p) => p.entityId === npc1.id);
  assert.strictEqual(withCheckpoint.checkpoint.label, 'Day 1', 'a timed placement should resolve its checkpoint too');
  const always = placements.find((p) => p.entityId === npc2.id);
  assert.strictEqual(always.checkpoint, null, 'an untimed placement should resolve checkpoint as null, not throw');

  ok('getModuleAssignments resolves every placement of a shared module, each with its actual entity and checkpoint');
}

console.log('\nAll Modular Content data-model tests passed.');
