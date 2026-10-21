const assert = require('assert');
const DM = require('../src/dataModel');
const Q = require('../src/quests');

let failures = 0;
function test(name, fn) { try { fn(); console.log(`ok  - ${name}`); } catch (e) { failures++; console.log(`FAIL - ${name}\n  ${e.stack}`); } }

function setup() {
  const c = DM.emptyCampaign();
  const q = DM.createEntity(c, { type: 'quest', name: 'Find the key' });
  const q2 = DM.createEntity(c, { type: 'quest', name: 'Other' });
  const mods = ['note', 'topic', 'scene', 'description'].map((t) => DM.createContentModule(c, { type: t, name: t }));
  return { c, q, q2, mods };
}
const order = (c, q) => Q.itemsOf(c, q.id).map((m) => m.name);

test('a quest is an entity with its own id and icon', () => {
  const { q } = setup();
  assert.strictEqual(q.type, 'quest'); assert.ok(q.id.startsWith('quest_')); assert.strictEqual(q.icon, 'flag');
});
test('new tagged content goes on top with the next index, any content type', () => {
  const { c, q, mods } = setup();
  mods.forEach((m, i) => assert.strictEqual(Q.assign(c, m.id, q.id), i + 1));
  assert.deepStrictEqual(order(c, q), ['note', 'topic', 'scene', 'description']);
});
test('re-tagging the same quest changes nothing; switching quest renumbers both', () => {
  const { c, q, q2, mods } = setup();
  mods.forEach((m) => Q.assign(c, m.id, q.id));
  Q.assign(c, mods[1].id, q.id);
  assert.strictEqual(mods[1].questIndex, 2);
  Q.assign(c, mods[1].id, q2.id);
  assert.deepStrictEqual(order(c, q), ['note', 'scene', 'description']);
  assert.deepStrictEqual(Q.itemsOf(c, q.id).map((m) => m.questIndex), [1, 2, 3]);
  assert.strictEqual(mods[1].questId, q2.id); assert.strictEqual(mods[1].questIndex, 1);
});
test('moving to an index, stepping and drag-and-drop all keep 1..n', () => {
  const { c, q, mods } = setup();
  mods.forEach((m) => Q.assign(c, m.id, q.id));
  Q.moveTo(c, mods[3].id, 1);
  assert.deepStrictEqual(order(c, q), ['description', 'note', 'topic', 'scene']);
  Q.step(c, mods[3].id, 1);
  assert.deepStrictEqual(order(c, q), ['note', 'description', 'topic', 'scene']);
  Q.moveBefore(c, mods[0].id, null);
  assert.deepStrictEqual(order(c, q), ['description', 'topic', 'scene', 'note']);
  Q.moveBefore(c, mods[0].id, mods[2].id);
  assert.deepStrictEqual(order(c, q), ['description', 'topic', 'note', 'scene']);
  Q.moveTo(c, mods[0].id, 99);
  assert.deepStrictEqual(Q.itemsOf(c, q.id).map((m) => m.questIndex), [1, 2, 3, 4]);
  assert.strictEqual(Q.itemsOf(c, q.id)[3].name, 'note');
});
test('removing a block or a whole quest closes the gap / frees the blocks', () => {
  const { c, q, mods } = setup();
  mods.forEach((m) => Q.assign(c, m.id, q.id));
  Q.unassign(c, mods[1].id);
  assert.deepStrictEqual(Q.itemsOf(c, q.id).map((m) => m.questIndex), [1, 2, 3]);
  assert.ok(!('questId' in mods[1]));
  Q.releaseQuest(c, q.id);
  assert.ok(mods.every((m) => !m.questId && !('questIndex' in m)));
});
test('sanitize drops tags of missing quests and renumbers', () => {
  const { c, q, mods } = setup();
  Q.assign(c, mods[0].id, q.id); Q.assign(c, mods[1].id, q.id);
  mods[2].questId = 'quest_gone'; mods[2].questIndex = 5;
  mods[0].questIndex = 7;
  Q.sanitize(c);
  assert.ok(!mods[2].questId);
  assert.deepStrictEqual(Q.itemsOf(c, q.id).map((m) => m.questIndex), [1, 2]);
});
test('quests never show up in entity pickers (presence, mentions) unless asked for', () => {
  const { c } = setup();
  const Query = require('../src/query');
  DM.createEntity(c, { type: 'npc', name: 'Grey' });
  const list = Query.filterEntitiesForPicker(c, Object.values(c.entities), {});
  assert.ok(list.every((e) => e.type !== 'quest') && list.length === 1);
  assert.strictEqual(Query.filterEntitiesForPicker(c, Object.values(c.entities), { type: 'quest' }).length, 2);
});

if (failures) { console.log(`${failures} failed`); process.exit(1); }
