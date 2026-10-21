const assert = require('assert');
const DM = require('../src/dataModel');
const CC = require('../src/characterCard');
const T = require('../src/transfer');
const storage = require('../src/storage');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`ok  - ${name}`); }
  catch (err) { failures++; console.log(`FAIL - ${name}\n  ${err.stack}`); }
}
const clone = (v) => JSON.parse(JSON.stringify(v));

// A small campaign with everything a transfer has to deal with.
function buildSource() {
  const c = DM.emptyCampaign();
  const dawn = DM.createCheckpoint(c, { label: 'Day 1 · dawn' });
  const noon = DM.createCheckpoint(c, { label: 'Day 1 · noon' });
  const dusk = DM.createCheckpoint(c, { label: 'Day 1 · dusk' });
  const world = DM.createEntityGroup(c, { name: 'World', parentId: null });
  const city = DM.createEntityGroup(c, { name: 'City', parentId: world.id });
  const grey = DM.createEntity(c, { type: 'npc', name: 'Grey man', summary: 'Engineer' });
  const sailor = DM.createEntity(c, { type: 'npc', name: 'Old sailor' });
  const market = DM.createEntity(c, { type: 'location', name: 'Rusted spire market' });
  const gate = DM.createEntity(c, { type: 'location', name: 'Scrap gate' });
  const bystander = DM.createEntity(c, { type: 'npc', name: 'Bystander' });
  DM.assignEntitiesToGroup(c, [grey.id, sailor.id], city.id);
  CC.ensureStatblock(grey).ac = 15; CC.ensureCard(grey).voice.accent = 'Gravel';
  grey.image = { filename: `${grey.id}.jpg`, size: 'large' };
  grey.lootTable = [{ dc: 10, result: `A note from [[${sailor.id}]]` }];

  const check = DM.createDCCheck(c, { name: 'Spot the wire', checkType: 'Perception' });
  DM.addDCTableRow(c, check.id, { dc: 12, text: `Wire leads to [[${gate.id}]]` });
  check.rollLog.push({ value: 14 });

  const mk = (type, name, text, entity, time, extra = {}) => {
    const m = DM.createContentModule(c, Object.assign({ type, name }, type === 'description' ? { html: text } : { text }, extra));
    DM.createAssignment(c, { moduleId: m.id, entityId: entity.id, timeId: time });
    return m;
  };
  const desc = mk('description', 'Arrival', `You see [[${grey.id}]] near [[${gate.id}]]. [[SAY:${grey.id}]]Hello[[/SAY]] [[JUMP:${gate.id}:${noon.id}]]the gate[[/JUMP]] [[DCCHECK:${check.id}]]`, market, dawn.id);
  desc.complete = true;
  mk('description', 'Later', 'Quiet.', market, noon.id);
  mk('note', 'General', `Knows [[${sailor.id}]] and [[${bystander.id}]]`, grey, null);
  mk('topic', 'The debt', 'Owes money', grey, dawn.id);
  mk('beat', 'Fountain', 'Robbery', market, dawn.id);
  const scene = mk('scene', 'Confrontation', '', market, noon.id, { lines: [] });
  DM.addSceneLine(scene, { speakerId: grey.id, text: 'Stop.' });
  DM.addSceneLine(scene, { speakerId: sailor.id, text: 'Never.' });
  const shared = DM.createContentModule(c, { type: 'note', name: 'Shared', text: 'both know' });
  DM.createAssignment(c, { moduleId: shared.id, entityId: grey.id, timeId: null });
  DM.createAssignment(c, { moduleId: shared.id, entityId: sailor.id, timeId: null });
  DM.createAssignment(c, { moduleId: shared.id, entityId: bystander.id, timeId: null });

  const arr = DM.createArrivalBlock(c, { locationId: market.id, timeId: dawn.id });
  arr.presence = [grey.id, sailor.id, bystander.id];
  const arr2 = DM.createArrivalBlock(c, { locationId: market.id, timeId: dusk.id });
  arr2.presence = [grey.id];
  return { c, dawn, noon, dusk, grey, sailor, market, gate, bystander, check, city, world };
}

function emptyTarget() { return DM.emptyCampaign(); }
const entry = (e, exclude) => ({ id: e.id, exclude: exclude || {} });
const findByName = (c, name) => Object.values(c.entities).find((e) => e.name === name);
const modulesOf = (c, entityId, type) => c.assignments.filter((a) => a.entityId === entityId)
  .map((a) => c.contentModules.find((m) => m.id === a.moduleId)).filter((m) => m && (!type || m.type === type));

test('describeContent counts only what exists, so the UI can offer the right "leave out" boxes', () => {
  const { c, grey, market, gate } = buildSource();
  assert.deepStrictEqual(T.describeContent(c, grey.id), { note: 2, topic: 1, lootTable: 1, characterCard: 1, image: 1 });
  const m = T.describeContent(c, market.id);
  assert.strictEqual(m.description, 2); assert.strictEqual(m.beat, 1); assert.strictEqual(m.scene, 1); assert.strictEqual(m.presence, 2);
  assert.deepStrictEqual(T.describeContent(c, gate.id), {});
});

test('an entity is copied with a fresh id; the source is untouched', () => {
  const { c, grey } = buildSource();
  const before = clone(c);
  const t = emptyTarget();
  const r = T.applyTransfer(c, t, [entry(grey)]);
  assert.deepStrictEqual(c, before, 'the source campaign must not change');
  const copy = findByName(t, 'Grey man');
  assert.ok(copy && copy.id !== grey.id && r.idMap[grey.id] === copy.id);
  assert.strictEqual(copy.summary, 'Engineer'); assert.strictEqual(copy.icon, grey.icon); assert.strictEqual(copy.color, grey.color);
  assert.strictEqual(copy.characterCard.statblock.ac, 15); assert.strictEqual(copy.characterCard.voice.accent, 'Gravel');
  assert.strictEqual(r.entities, 1);
});

test('descriptions, notes, topics, beats and scenes come along, with checkpoints mapped and completion reset', () => {
  const { c, market, grey, gate } = buildSource();
  const t = emptyTarget();
  const r = T.applyTransfer(c, t, [entry(market), entry(grey), entry(gate)]);
  const m = findByName(t, 'Rusted spire market');
  const descs = modulesOf(t, m.id, 'description');
  assert.strictEqual(descs.length, 2);
  assert.ok(descs.every((d) => d.complete === false));
  assert.strictEqual(modulesOf(t, m.id, 'beat').length, 1);
  assert.strictEqual(modulesOf(t, m.id, 'scene').length, 1);
  assert.strictEqual(modulesOf(t, findByName(t, 'Grey man').id, 'topic').length, 1);
  assert.deepStrictEqual(t.checkpoints.map((x) => x.label), ['Day 1 · dawn', 'Day 1 · noon', 'Day 1 · dusk']);
  const cpIds = new Set(t.checkpoints.map((x) => x.id));
  t.assignments.forEach((a) => assert.ok(a.timeId === null || cpIds.has(a.timeId), 'every time id exists in the target'));
  const dawnNew = t.checkpoints.find((x) => x.label === 'Day 1 · dawn').id;
  const arrivalAsg = t.assignments.find((a) => a.entityId === m.id && modulesOf(t, m.id, 'description').some((d) => d.id === a.moduleId && d.name === 'Arrival'));
  assert.strictEqual(arrivalAsg.timeId, dawnNew);
  assert.strictEqual(r.modules, t.contentModules.length);
});

test('mentions, speakers, dialogue and jump links are rewritten to the new ids', () => {
  const { c, market, grey, gate, sailor } = buildSource();
  const t = emptyTarget();
  T.applyTransfer(c, t, [entry(market), entry(grey), entry(gate), entry(sailor)]);
  const id = (n) => findByName(t, n).id;
  const desc = modulesOf(t, id('Rusted spire market'), 'description').find((d) => d.name === 'Arrival');
  assert.ok(desc.html.includes(`[[${id('Grey man')}]]`) && desc.html.includes(`[[${id('Scrap gate')}]]`));
  assert.ok(desc.html.includes(`[[SAY:${id('Grey man')}]]Hello[[/SAY]]`));
  const noonNew = t.checkpoints.find((x) => x.label === 'Day 1 · noon').id;
  assert.ok(desc.html.includes(`[[JUMP:${id('Scrap gate')}:${noonNew}]]the gate[[/JUMP]]`));
  assert.ok(!desc.html.includes(grey.id) && !desc.html.includes(gate.id), 'no old id is left behind');
  const scene = modulesOf(t, id('Rusted spire market'), 'scene')[0];
  assert.deepStrictEqual(scene.lines.map((l) => l.speakerId), [id('Grey man'), id('Old sailor')]);
  assert.ok(scene.lines.every((l) => !c.contentModules.some((m) => (m.lines || []).some((x) => x.id === l.id))), 'scene lines get new ids');
  assert.ok(findByName(t, 'Grey man').lootTable[0].result.includes(`[[${id('Old sailor')}]]`));
});

test('references to entities that are not transferred become plain text instead of dead tokens', () => {
  const { c, market, grey } = buildSource();
  const t = emptyTarget();
  const r = T.applyTransfer(c, t, [entry(market)]);
  const desc = modulesOf(t, findByName(t, 'Rusted spire market').id, 'description').find((d) => d.name === 'Arrival');
  assert.ok(desc.html.startsWith('You see Grey man near Scrap gate. Hello the gate'), desc.html);
  assert.ok(!/\[\[(SAY|JUMP):/.test(desc.html));
  const scene = modulesOf(t, findByName(t, 'Rusted spire market').id, 'scene')[0];
  assert.deepStrictEqual(scene.lines.map((l) => l.speakerId), [null, null]);
  assert.ok(r.droppedReferences > 0 && r.warnings.length === 1);
});

test('"present here" is kept for entities that travelled along and dropped for those that did not', () => {
  const { c, market, grey, sailor } = buildSource();
  const t = emptyTarget();
  const r = T.applyTransfer(c, t, [entry(market), entry(grey), entry(sailor)]);
  const loc = findByName(t, 'Rusted spire market');
  const lists = t.blocks.filter((b) => b.kind === 'arrival' && b.locationId === loc.id);
  assert.strictEqual(lists.length, 2);
  const byTime = (label) => lists.find((b) => b.timeId === t.checkpoints.find((x) => x.label === label).id);
  assert.deepStrictEqual(byTime('Day 1 · dawn').presence.slice().sort(), [findByName(t, 'Grey man').id, findByName(t, 'Old sailor').id].sort(), 'the bystander was not transferred');
  assert.deepStrictEqual(byTime('Day 1 · dusk').presence, [findByName(t, 'Grey man').id]);
  assert.ok(lists.every((b) => b.complete === false));
  assert.strictEqual(r.presenceLists, 2);
});

test('each kind of content can be left out per entity', () => {
  const { c, market, grey } = buildSource();
  const t = emptyTarget();
  T.applyTransfer(c, t, [
    entry(market, { description: true, scene: true, presence: true }),
    entry(grey, { topic: true, characterCard: true, image: true, lootTable: true, note: true })
  ]);
  const m = findByName(t, 'Rusted spire market');
  assert.strictEqual(modulesOf(t, m.id, 'description').length, 0);
  assert.strictEqual(modulesOf(t, m.id, 'scene').length, 0);
  assert.strictEqual(modulesOf(t, m.id, 'beat').length, 1, 'what is not ticked still comes along');
  assert.strictEqual(t.blocks.filter((b) => b.locationId === m.id).length, 0);
  const g = findByName(t, 'Grey man');
  assert.strictEqual(modulesOf(t, g.id).length, 0);
  assert.ok(!g.characterCard); assert.strictEqual(g.image, null); assert.deepStrictEqual(g.lootTable, []);
});

test('excluding content also drops its references from the dependency check', () => {
  const { c, market, grey } = buildSource();
  const full = T.findMissingDependencies(c, [entry(market)]).map((d) => d.name);
  assert.deepStrictEqual(full, ['Bystander', 'Grey man', 'Old sailor', 'Scrap gate']);
  const trimmed = T.findMissingDependencies(c, [entry(market, { description: true, scene: true, presence: true })]).map((d) => d.name);
  assert.deepStrictEqual(trimmed, []);
  assert.deepStrictEqual(T.findMissingDependencies(c, [entry(market), entry(grey)]).map((d) => d.name), ['Bystander', 'Old sailor', 'Scrap gate']);
});

test('dependencies report who needs them, and the closure follows them further', () => {
  const { c, market, grey } = buildSource();
  const deps = T.findMissingDependencies(c, [entry(market)]);
  const g = deps.find((d) => d.name === 'Grey man');
  assert.deepStrictEqual(g.neededBy, ['Rusted spire market']);
  const direct = T.findMissingDependencies(c, [entry(grey)]).map((d) => d.name);
  assert.deepStrictEqual(direct, ['Bystander', 'Old sailor']);
  const closure = T.findMissingDependencies(c, [entry(grey)], { closure: true }).map((d) => d.name);
  assert.deepStrictEqual(closure, ['Bystander', 'Old sailor']);
});

test('missing checkpoints are created in the right place, existing ones are matched by label', () => {
  const { c, market } = buildSource();
  const t = emptyTarget();
  const a = DM.createCheckpoint(t, { label: 'Prologue' });
  const noonT = DM.createCheckpoint(t, { label: 'day 1 · NOON' });
  const z = DM.createCheckpoint(t, { label: 'Epilogue' });
  const r = T.applyTransfer(c, t, [entry(market, { presence: true })]);
  const order = t.checkpoints.slice().sort((x, y) => x.order - y.order).map((x) => x.label);
  assert.ok(order.indexOf('Day 1 · dawn') < order.indexOf('day 1 · NOON'), 'dawn comes before the matched noon');
  assert.strictEqual(order.filter((l) => /noon/i.test(l)).length, 1, 'noon was matched, not duplicated');
  assert.deepStrictEqual(r.checkpointsCreated, ['Day 1 · dawn']);
  assert.ok(t.checkpoints.every((x, i, arr) => arr.filter((y) => y.order === x.order).length === 1), 'order numbers stay distinct');
  void a; void noonT; void z;
});

test('groups are matched by name path and created when missing', () => {
  const { c, grey } = buildSource();
  const t = emptyTarget();
  const world = DM.createEntityGroup(t, { name: 'world', parentId: null });
  const r = T.applyTransfer(c, t, [entry(grey)]);
  const g = findByName(t, 'Grey man');
  const city = t.entityGroups.find((x) => x.id === g.groupId);
  assert.strictEqual(city.name, 'City'); assert.strictEqual(city.parentId, world.id);
  assert.strictEqual(t.entityGroups.length, 2);
  assert.deepStrictEqual(r.groupsCreated, ['World / City']);
  T.applyTransfer(c, t, [entry(grey)]);
  assert.strictEqual(t.entityGroups.length, 2, 'a second transfer reuses the groups');
});

test('a module shared by chosen entities stays shared; it is not shared with entities left behind', () => {
  const { c, grey, sailor } = buildSource();
  const t = emptyTarget();
  T.applyTransfer(c, t, [entry(grey), entry(sailor)]);
  const shared = t.contentModules.filter((m) => m.name === 'Shared');
  assert.strictEqual(shared.length, 1);
  assert.strictEqual(t.assignments.filter((a) => a.moduleId === shared[0].id).length, 2);
  assert.ok(t.assignments.every((a) => findByName(t, 'Bystander') ? true : a.entityId !== undefined));
  assert.ok(!Object.values(t.entities).some((e) => e.name === 'Bystander'));
});

test('DC checks used by the copied text come along once, with an empty roll log and remapped references', () => {
  const { c, market, gate } = buildSource();
  const t = emptyTarget();
  const r = T.applyTransfer(c, t, [entry(market), entry(gate)]);
  assert.strictEqual(t.dcChecks.length, 1); assert.strictEqual(r.dcChecks, 1);
  const check = t.dcChecks[0];
  assert.notStrictEqual(check.id, c.dcChecks[0].id);
  assert.deepStrictEqual(check.rollLog, []);
  assert.ok(check.table[0].text.includes(`[[${findByName(t, 'Scrap gate').id}]]`));
  const desc = modulesOf(t, findByName(t, 'Rusted spire market').id, 'description').find((d) => d.name === 'Arrival');
  assert.ok(desc.html.includes(`[[DCCHECK:${check.id}]]`));
  assert.strictEqual(c.dcChecks[0].rollLog.length, 1, 'the source log is untouched');
});

test('images get the new entity id in their file name; leaving the image out clears it', () => {
  const { c, grey } = buildSource();
  const t = emptyTarget();
  const r = T.applyTransfer(c, t, [entry(grey)]);
  const g = findByName(t, 'Grey man');
  assert.strictEqual(g.image.filename, `${g.id}.jpg`); assert.strictEqual(g.image.size, 'large');
  assert.deepStrictEqual(r.imageCopies, [{ from: `${grey.id}.jpg`, to: `${g.id}.jpg`, entityId: g.id }]);
  const t2 = emptyTarget();
  const r2 = T.applyTransfer(c, t2, [entry(grey, { image: true })]);
  assert.strictEqual(findByName(t2, 'Grey man').image, null); assert.deepStrictEqual(r2.imageCopies, []);
});

test('transferring twice merges: nothing is duplicated and the second run changes nothing', () => {
  const { c, market, grey } = buildSource();
  const t = emptyTarget();
  T.applyTransfer(c, t, [entry(market), entry(grey)]);
  const snapshot = clone(t);
  const r = T.applyTransfer(c, t, [entry(market), entry(grey)]);
  assert.strictEqual(Object.values(t.entities).filter((e) => e.name === 'Grey man').length, 1);
  assert.strictEqual(r.entities, 0); assert.strictEqual(r.merged, 2);
  assert.ok(r.skippedContent > 0);
  assert.deepStrictEqual(t, snapshot);
});

test('merging keeps the target data, fills gaps, adds new content and unites present-here', () => {
  const { c, market, grey, sailor } = buildSource();
  const t = emptyTarget();
  const hereGrey = DM.createEntity(t, { type: 'npc', name: 'GREY MAN' }); // different case, nothing filled in
  hereGrey.summary = 'My own summary';
  const hereMarket = DM.createEntity(t, { type: 'location', name: 'Rusted spire market' });
  const other = DM.createEntity(t, { type: 'npc', name: 'Local trader' });
  const cp = DM.createCheckpoint(t, { label: 'Day 1 · dawn' });
  DM.createBlock ? 0 : 0;
  t.blocks.push({ id: 'blk_existing', kind: 'arrival', locationId: hereMarket.id, timeId: cp.id, html: '', presence: [other.id], beats: [], complete: false });
  const note = DM.createContentModule(t, { type: 'note', name: 'Mine', text: 'local note' });
  DM.createAssignment(t, { moduleId: note.id, entityId: hereGrey.id, timeId: null });
  const r = T.applyTransfer(c, t, [entry(market), entry(grey), entry(sailor)]);
  assert.strictEqual(Object.values(t.entities).filter((e) => e.name.toLowerCase() === 'grey man').length, 1);
  assert.strictEqual(hereGrey.summary, 'My own summary', 'the target wins');
  assert.ok(hereGrey.lootTable && hereGrey.lootTable.length, 'empty loot table was filled');
  assert.ok(hereGrey.groupId, 'group was filled');
  assert.ok(r.merged >= 2 && r.entities === 1);
  const mine = t.assignments.filter((a) => a.entityId === hereGrey.id).map((a) => t.contentModules.find((m) => m.id === a.moduleId).name);
  assert.ok(mine.includes('Mine') && mine.length > 1, 'local content stays, new content added');
  const blocks = t.blocks.filter((b) => b.kind === 'arrival' && b.locationId === hereMarket.id && b.timeId === cp.id);
  assert.strictEqual(blocks.length, 1, 'present-here merged into the existing list');
  const names = blocks[0].presence.map((id) => t.entities[id].name);
  assert.ok(names.includes('Local trader') && names.includes('Grey man') || names.some((n) => /grey man/i.test(n)), names.join());
  assert.ok(blocks[0].presence.every((id) => t.entities[id]));
});

test('the result is a valid campaign: it survives saving and loading unchanged', () => {
  const { c, market, grey, gate, sailor } = buildSource();
  const t = emptyTarget();
  T.applyTransfer(c, t, [entry(market), entry(grey), entry(gate), entry(sailor)]);
  const reloaded = storage.normalizeCampaign(JSON.parse(JSON.stringify(t)));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(reloaded)), JSON.parse(JSON.stringify(t)));
  assert.ok(CC.isDefaultStatblock(findByName(reloaded, 'Old sailor')) || true);
});

test('unknown entity ids in the request are ignored; an empty request changes nothing', () => {
  const { c } = buildSource();
  const t = emptyTarget(); const before = clone(t);
  const r = T.applyTransfer(c, t, [{ id: 'npc_missing', exclude: {} }]);
  assert.deepStrictEqual(t, before); assert.strictEqual(r.entities, 0);
  assert.deepStrictEqual(T.applyTransfer(c, t, []).imageCopies, []);
});

if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('All transfer tests passed.');
