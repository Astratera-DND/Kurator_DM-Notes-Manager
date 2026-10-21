// Regression tests for getLocationView/getEntityCard reading through
// contentModules+assignments — direct assertions now, not an old-vs-new
// comparison. This file used to compare the pre-flip implementation
// against the new one; now that the flip has actually happened (the old
// implementation no longer exists), that framing doesn't apply anymore.
// The underlying scenarios are still valuable coverage, so they're kept
// here as straightforward checks against expected values — including
// specifically multiple scenes sharing one checkpoint (derived
// sequential order), which query.test.js's own scene coverage doesn't
// happen to exercise.
//
// This was also spot-checked directly against a real, hand-authored
// campaign file during development (every entity, every checkpoint,
// zero mismatches, both before and after the id-preservation fix found
// along the way) — that file can't be bundled here since it's the
// user's own data.

const assert = require('assert');
const dataModel = require('../src/dataModel');
const query = require('../src/query');

function ok(msg) { console.log('ok  -', msg); }

function addBeat(c, { locationId, timeId, label, text = '' }) {
  const module = dataModel.createContentModule(c, { type: 'beat', name: label, text });
  return dataModel.createAssignment(c, { moduleId: module.id, entityId: locationId, timeId });
}
function addNote(c, { entityId, timeId = null, text = '' }) {
  const module = dataModel.createContentModule(c, { type: 'note', name: '', text });
  return dataModel.createAssignment(c, { moduleId: module.id, entityId, timeId });
}
function addTopic(c, { entityId, label, text = '', timeId = null }) {
  const module = dataModel.createContentModule(c, { type: 'topic', name: label, text });
  return dataModel.createAssignment(c, { moduleId: module.id, entityId, timeId });
}
function addScene(c, { locationId, timeId, label, lines = [] }) {
  const module = dataModel.createContentModule(c, { type: 'scene', name: label, lines });
  return dataModel.createAssignment(c, { moduleId: module.id, entityId: locationId, timeId });
}
function addDescription(c, { locationId, timeId, html }) {
  const module = dataModel.createContentModule(c, { type: 'description', name: '', html });
  return dataModel.createAssignment(c, { moduleId: module.id, entityId: locationId, timeId });
}

// --- Test 1: multiple scenes at one checkpoint keep their creation order --
{
  const c = dataModel.emptyCampaign();
  const loc = dataModel.createEntity(c, { type: 'location', name: 'Ruins' });
  const day1 = dataModel.createCheckpoint(c, { label: 'Day 1' });
  dataModel.createArrivalBlock(c, { locationId: loc.id, timeId: day1.id });

  addScene(c, { locationId: loc.id, timeId: day1.id, label: 'Scene A', lines: [{ id: 'l1', speakerId: null, text: 'Line one.' }] });
  addScene(c, { locationId: loc.id, timeId: day1.id, label: 'Scene B', lines: [] });
  addScene(c, { locationId: loc.id, timeId: day1.id, label: 'Scene C', lines: [] });

  const view = query.getLocationView(c, loc.id, day1.id);
  assert.strictEqual(view.scenes.length, 3, 'all three scenes at the same checkpoint should show');
  assert.deepStrictEqual(view.scenes.map((s) => s.name), ['Scene A', 'Scene B', 'Scene C'], 'multiple scenes at one checkpoint should keep their creation order, derived sequentially since scenes have no explicit order field of their own');

  ok('multiple scenes sharing one checkpoint display in creation order');
}

// --- Test 2: a resolved scene stops carrying forward, an unresolved one ---
// keeps carrying — full multi-checkpoint scenario combining beats,
// scenes, and a description together at once.
{
  const c = dataModel.emptyCampaign();
  const loc = dataModel.createEntity(c, { type: 'location', name: 'Ruins' });
  const day1 = dataModel.createCheckpoint(c, { label: 'Day 1' });
  const day2 = dataModel.createCheckpoint(c, { label: 'Day 2' }); // no arrival at all -> tests fallback
  const day3 = dataModel.createCheckpoint(c, { label: 'Day 3' });

  dataModel.createArrivalBlock(c, { locationId: loc.id, timeId: day1.id });
  addDescription(c, { locationId: loc.id, timeId: day1.id, html: '<p>Day 1 description.</p>' });
  addBeat(c, { locationId: loc.id, timeId: day1.id, label: 'Find the entrance', text: 'It is hidden.' });
  const sceneA = addScene(c, { locationId: loc.id, timeId: day1.id, label: 'Scene A', lines: [] });
  const sceneB = addScene(c, { locationId: loc.id, timeId: day1.id, label: 'Scene B', lines: [] });
  query.markModuleComplete(c, sceneA.moduleId, true); // resolved -- must NOT carry forward

  dataModel.createArrivalBlock(c, { locationId: loc.id, timeId: day3.id });
  addDescription(c, { locationId: loc.id, timeId: day3.id, html: '<p>Day 3 description.</p>' });
  addBeat(c, { locationId: loc.id, timeId: day3.id, label: 'New beat', text: 'Body text.' });

  [day1, day2, day3].forEach((cp) => {
    const view = query.getLocationView(c, loc.id, cp.id);
    assert.ok(view, `${cp.label}: view should resolve`);
  });

  const day3View = query.getLocationView(c, loc.id, day3.id);
  const carriedLabels = day3View.carried.map((item) => item.label);
  assert.ok(carriedLabels.includes('Scene B'), 'the unresolved scene should carry forward to day 3');
  assert.ok(!carriedLabels.includes('Scene A'), 'the resolved scene must NOT carry forward — completion excludes it');
  assert.ok(day3View.carried.some((item) => item.kind === 'beat'), 'the unresolved day 1 beat should also carry forward');
  assert.ok(day3View.carried.some((item) => item.kind === 'description'), 'the unresolved day 1 description should also carry forward');

  const day2View = query.getLocationView(c, loc.id, day2.id);
  assert.strictEqual(day2View.fallback, true, 'day 2 has no arrival of its own, so it should fall back to day 1');

  ok('a resolved scene correctly stops carrying forward while an unresolved one continues, alongside beats and the description, across a fallback checkpoint');
}

// --- Test 3: notes and topics resolve correctly for an entity card --------
{
  const c = dataModel.emptyCampaign();
  const npc = dataModel.createEntity(c, { type: 'npc', name: 'Guide' });
  const day1 = dataModel.createCheckpoint(c, { label: 'Day 1' });

  addNote(c, { entityId: npc.id, text: 'Always relevant.' });
  addNote(c, { entityId: npc.id, timeId: day1.id, text: 'Day 1 note.' });
  addTopic(c, { entityId: npc.id, label: 'Always available topic', text: 'Small talk.' });
  addTopic(c, { entityId: npc.id, label: 'Day 1 topic', text: 'Revealed day 1.', timeId: day1.id });

  const card = query.getEntityCard(c, npc.id, day1.id);
  assert.strictEqual(card.general.length, 1);
  assert.strictEqual(card.currentNotes.length, 1);
  assert.strictEqual(card.topics.length, 2);

  ok('notes and topics resolve correctly through getEntityCard for a freshly-built module+assignment campaign');
}

console.log('\nAll Modular Content equivalence tests passed.');
