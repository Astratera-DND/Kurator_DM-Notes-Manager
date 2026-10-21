const assert = require('assert');
const DM = require('../src/dataModel');
const G = require('../src/graph');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`ok  - ${name}`); }
  catch (err) { failures++; console.log(`FAIL - ${name}\n  ${err.stack}`); }
}

function build() {
  const c = DM.emptyCampaign();
  const dawn = DM.createCheckpoint(c, { label: 'Dawn' });
  const noon = DM.createCheckpoint(c, { label: 'Noon' });
  const market = DM.createEntity(c, { type: 'location', name: 'Market' });
  const gate = DM.createEntity(c, { type: 'location', name: 'Gate' });
  const grey = DM.createEntity(c, { type: 'npc', name: 'Grey man' });
  const sailor = DM.createEntity(c, { type: 'npc', name: 'Sailor' });
  const desc = DM.createContentModule(c, { type: 'description', name: 'Arrival', html: `You see [[${grey.id}]] <b>here</b>.` });
  DM.createAssignment(c, { moduleId: desc.id, entityId: market.id, timeId: noon.id });
  // One note shared by an NPC and a location (multi assignment).
  const note = DM.createContentModule(c, { type: 'note', name: 'Shared secret', text: 'Both know it' });
  DM.createAssignment(c, { moduleId: note.id, entityId: grey.id, timeId: null });
  DM.createAssignment(c, { moduleId: note.id, entityId: market.id, timeId: null });
  DM.createAssignment(c, { moduleId: note.id, entityId: gate.id, timeId: dawn.id });
  const topic = DM.createContentModule(c, { type: 'topic', name: 'Ask', text: 'hello' });
  DM.createAssignment(c, { moduleId: topic.id, entityId: grey.id, timeId: null });
  topic.complete = true;
  const loose = DM.createContentModule(c, { type: 'note', name: 'Loose', text: 'nobody owns me' });
  c.blocks.push({ id: 'blk1', kind: 'arrival', locationId: market.id, timeId: noon.id, presence: [grey.id, sailor.id] });
  return { c, dawn, noon, market, gate, grey, sailor, desc, note, topic, loose };
}

test('one node per entity, content module and checkpoint', () => {
  const { c } = build();
  const g = G.buildGraph(c);
  assert.strictEqual(g.nodes.filter((n) => n.kind === 'entity').length, 4);
  assert.strictEqual(g.nodes.filter((n) => n.kind === 'module').length, 4);
  assert.strictEqual(g.nodes.filter((n) => n.kind === 'milestone').length, 2);
});

test('a content module assigned to several entities is ONE card with one line per assignment', () => {
  const { c, note, market, gate, grey } = build();
  const g = G.buildGraph(c);
  assert.strictEqual(g.nodes.filter((n) => n.id === note.id).length, 1);
  const lines = g.edges.filter((e) => e.kind === 'assign' && e.from === note.id);
  assert.deepStrictEqual(lines.map((e) => e.to).sort(), [grey.id, market.id, gate.id].sort());
  assert.strictEqual(g.byId[note.id].assignedTo, 3);
});

test('every line carries its own time stamp (the pip) or none for always', () => {
  const { c, note, gate, dawn, market } = build();
  const g = G.buildGraph(c);
  assert.strictEqual(g.edges.find((e) => e.from === note.id && e.to === gate.id).timeId, dawn.id);
  assert.strictEqual(g.edges.find((e) => e.from === note.id && e.to === market.id).timeId, null);
});

test('ports appear only for the content an entity has, plus present-here on locations', () => {
  const { c, market, grey, gate } = build();
  const g = G.buildGraph(c);
  assert.deepStrictEqual(g.byId[market.id].ports.map((p) => p.key), ['description', 'note', 'presence']);
  assert.deepStrictEqual(g.byId[grey.id].ports.map((p) => p.key), ['note', 'topic']);
  assert.deepStrictEqual(g.byId[gate.id].ports.map((p) => p.key), ['note']);
  assert.strictEqual(g.byId[market.id].ports.find((p) => p.key === 'presence').count, 2);
});

test('present-here lists become NPC -> location lines at their milestone', () => {
  const { c, market, grey, sailor, noon } = build();
  const g = G.buildGraph(c);
  const pres = g.edges.filter((e) => e.kind === 'presence');
  assert.deepStrictEqual(pres.map((e) => e.from).sort(), [grey.id, sailor.id].sort());
  assert.ok(pres.every((e) => e.to === market.id && e.timeId === noon.id));
});

test('completed content is flagged and unassigned content is marked as inbox', () => {
  const { c, topic, loose } = build();
  const g = G.buildGraph(c);
  assert.strictEqual(g.byId[topic.id].complete, true);
  assert.strictEqual(g.byId[loose.id].inbox, true);
  assert.strictEqual(g.byId[topic.id].inbox, false);
});

test('mentions in text give derived reference lines, which can be turned off', () => {
  const { c, desc, grey } = build();
  assert.ok(G.buildGraph(c).edges.some((e) => e.kind === 'ref' && e.from === desc.id && e.to === grey.id));
  assert.ok(!G.buildGraph(c, { includeRefs: false }).edges.some((e) => e.kind === 'ref'));
});

test('excerpts are readable: tags and tokens removed, mentions replaced by names', () => {
  const { c, desc } = build();
  assert.strictEqual(G.buildGraph(c).byId[desc.id].excerpt, 'You see Grey man here .');
});

test('the checkpoint chain follows the checkpoint order', () => {
  const { c, dawn, noon } = build();
  const chain = G.buildGraph(c).edges.filter((e) => e.kind === 'chain');
  assert.deepStrictEqual(chain.map((e) => [e.from, e.to]), [[dawn.id, noon.id]]);
});

test('lines pointing at deleted things are ignored', () => {
  const { c, market } = build();
  delete c.entities[market.id];
  const g = G.buildGraph(c);
  assert.ok(!g.edges.some((e) => e.to === market.id || e.from === market.id));
});

test('focus: one step shows the entity, its content and who is present; two steps reach shared entities', () => {
  const { c, gate, market, note, grey, sailor } = build();
  const g = G.buildGraph(c);
  const one = G.neighborhood(g, [gate.id], 1);
  assert.ok(one.has(gate.id) && one.has(note.id));
  assert.ok(!one.has(market.id), 'other entities of a shared card are two steps away');
  const two = G.neighborhood(g, [gate.id], 2);
  assert.ok(two.has(market.id) && two.has(grey.id));
  assert.ok(!two.has(sailor.id));
  const m = G.neighborhood(g, [market.id], 1);
  assert.ok(m.has(grey.id) && m.has(sailor.id), 'present NPCs are one step from the location');
});

test('focus on a milestone brings everything tied to it', () => {
  const { c, noon, desc, market, grey } = build();
  const g = G.buildGraph(c);
  const s = G.neighborhood(g, [noon.id], 1);
  assert.ok(s.has(desc.id) && s.has(market.id) && s.has(grey.id));
});

test('pinned ids always stay in the focus set', () => {
  const { c, gate, loose } = build();
  const g = G.buildGraph(c);
  assert.ok(G.neighborhood(g, [gate.id], 1, [loose.id]).has(loose.id));
});

test('auto-layout positions every node and never overlaps two nodes', () => {
  const { c } = build();
  const g = G.buildGraph(c);
  const pos = G.autoLayout(c, g);
  assert.strictEqual(Object.keys(pos).length, g.nodes.length);
  const boxes = g.nodes.map((n) => ({ id: n.id, ...pos[n.id], ...G.nodeSize(n) }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.ok(!overlap, `${a.id} overlaps ${b.id}`);
  }
});

test('auto-layout scales: 300 entities and 1500 cards in well under a second, no overlaps in a column', () => {
  const c = DM.emptyCampaign();
  const ents = [];
  for (let i = 0; i < 300; i++) ents.push(DM.createEntity(c, { type: i % 3 ? 'npc' : 'location', name: `E${i}` }));
  for (let i = 0; i < 1500; i++) {
    const m = DM.createContentModule(c, { type: i % 3 ? 'note' : 'topic', name: `M${i}`, text: 'x' });
    DM.createAssignment(c, { moduleId: m.id, entityId: ents[i % 300].id, timeId: null });
  }
  const t = Date.now();
  const g = G.buildGraph(c);
  const pos = G.autoLayout(c, g);
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t}ms`);
  assert.strictEqual(Object.keys(pos).length, g.nodes.length);
});

const Constants = require('../src/constants');
const Storage = require('../src/storage');

test('the graph keeps a list of things taken out of it, and loading repairs a missing or broken one', () => {
  assert.deepStrictEqual(DM.emptyCampaign().graph.hidden, {});
  const c = DM.emptyCampaign();
  delete c.graph.hidden;
  Storage.normalizeCampaign(c);
  assert.deepStrictEqual(c.graph.hidden, {});
  c.graph.hidden = [1, 2];
  Storage.normalizeCampaign(c);
  assert.deepStrictEqual(c.graph.hidden, {});
  c.graph.hidden = { a: true };
  Storage.normalizeCampaign(c);
  assert.deepStrictEqual(c.graph.hidden, { a: true });
});


test('dialogue topics can only be connected to NPCs', () => {
  assert.deepStrictEqual(Constants.MODULE_TYPE_ENTITY_TYPES.topic, ['npc']);
});

// A mid-size campaign for layout and routing checks.
function bigger() {
  const c = DM.emptyCampaign();
  const cps = ['One', 'Two', 'Three'].map((label) => DM.createCheckpoint(c, { label }));
  const locs = [], npcs = [];
  for (let i = 0; i < 12; i++) locs.push(DM.createEntity(c, { type: 'location', name: `Loc ${String(i).padStart(2, '0')}` }));
  for (let i = 0; i < 16; i++) npcs.push(DM.createEntity(c, { type: 'npc', name: `Npc ${String(i).padStart(2, '0')}` }));
  const types = ['description', 'note', 'beat', 'scene'];
  locs.forEach((l, i) => {
    for (let k = 0; k < 1 + (i % 3); k++) {
      const type = types[(i + k) % 4];
      const m = DM.createContentModule(c, { type, name: `L${i}-${k}`, text: 'x', html: 'x' });
      DM.createAssignment(c, { moduleId: m.id, entityId: l.id, timeId: cps[k % 3].id });
    }
    c.blocks.push({ id: `blk${i}`, kind: 'arrival', locationId: l.id, timeId: cps[i % 3].id, presence: [npcs[i % 16].id, npcs[(i * 5 + 3) % 16].id] });
  });
  npcs.forEach((n, i) => {
    for (let k = 0; k < i % 3; k++) {
      const m = DM.createContentModule(c, { type: k ? 'note' : 'topic', name: `N${i}-${k}`, text: 'x' });
      DM.createAssignment(c, { moduleId: m.id, entityId: n.id, timeId: null });
    }
  });
  // A note shared between a location and an NPC (crosses lanes).
  const shared = DM.createContentModule(c, { type: 'note', name: 'Shared', text: 'x' });
  DM.createAssignment(c, { moduleId: shared.id, entityId: locs[0].id, timeId: null });
  DM.createAssignment(c, { moduleId: shared.id, entityId: npcs[9].id, timeId: null });
  DM.createContentModule(c, { type: 'note', name: 'Loose', text: 'x' });
  return { c, locs, npcs };
}

function routeAll(c) {
  const g = G.buildGraph(c);
  const pos = G.autoLayout(c, g);
  const routes = G.routeEdges(g, pos, g.edges, g.nodes.map((n) => n.id));
  return { g, pos, routes };
}

test('default layout: lanes in a fixed order, left to right', () => {
  const { c } = bigger();
  const g = G.buildGraph(c);
  const pos = G.autoLayout(c, g);
  const X = G.LANE_X;
  g.nodes.filter((n) => n.kind === 'entity').forEach((n) => assert.strictEqual(pos[n.id].x, n.type === 'location' ? X.loc : X.npc));
  assert.ok(X.inbox < X.locCard && X.locCard < X.loc && X.loc < X.npc && X.npc < X.npcCard);
  // content sits in the lane beside its first owner
  g.edges.filter((e) => e.kind === 'assign').forEach((e) => {
    const card = pos[e.from];
    if (g.byId[e.to].type === 'location' && card.x !== X.inbox) assert.ok([X.locCard, X.npcCard].includes(card.x));
  });
  // every present-here line runs from the location lane to the NPC lane, rightwards
  g.edges.filter((e) => e.kind === 'presence').forEach((e) => assert.ok(pos[e.to].x + G.SIZES.entityW < pos[e.from].x));
  // unassigned content waits in the first lane
  g.nodes.filter((n) => n.kind === 'module' && n.inbox).forEach((n) => assert.strictEqual(pos[n.id].x, X.inbox));
});

test('default layout: NPCs stand next to the location they are present in', () => {
  const { c } = bigger();
  const g = G.buildGraph(c);
  const pos = G.autoLayout(c, g);
  const mid = (id) => pos[id].y + G.nodeSize(g.byId[id]).h / 2;
  const far = g.edges.filter((e) => e.kind === 'presence').map((e) => Math.abs(mid(e.from) - mid(e.to)));
  const avg = far.reduce((a, b) => a + b, 0) / far.length;
  const stackHeight = Math.max(...g.nodes.filter((n) => n.kind === 'entity').map((n) => pos[n.id].y));
  assert.ok(avg < stackHeight / 2, `average distance ${Math.round(avg)} should be well below half the stack (${Math.round(stackHeight)})`);
});

test('every line is made of horizontal and vertical pieces only', () => {
  const { g, routes } = routeAll(bigger().c);
  assert.ok(routes.size >= g.edges.length - 2);
  routes.forEach((r, id) => {
    for (let i = 1; i < r.pts.length; i++) assert.ok(r.pts[i].x === r.pts[i - 1].x || r.pts[i].y === r.pts[i - 1].y, `edge ${id} has a diagonal piece`);
    assert.ok(/^M[-\d. ]+(L[-\d. ]+)*$/.test(r.d), 'path data uses straight pieces only');
  });
});

test('lines do not run through nodes (apart from the two they join)', () => {
  const { g, pos, routes } = routeAll(bigger().c);
  const rect = (n) => ({ x: pos[n.id].x, y: pos[n.id].y, w: G.nodeSize(n).w, h: G.nodeSize(n).h });
  let checked = 0;
  g.edges.forEach((e) => {
    const r = routes.get(e.id);
    if (!r) return;
    for (let i = 1; i < r.pts.length; i++) {
      const p = r.pts[i - 1], q = r.pts[i];
      const x0 = Math.min(p.x, q.x), x1 = Math.max(p.x, q.x), y0 = Math.min(p.y, q.y), y1 = Math.max(p.y, q.y);
      g.nodes.forEach((n) => {
        const isEnd = n.id === e.from || n.id === e.to;
        if (isEnd && (i === 1 || i === r.pts.length - 1)) return; // leaving or entering its own node
        const b = rect(n);
        const inside = x1 > b.x + 0.5 && x0 < b.x + b.w - 0.5 && y1 > b.y + 0.5 && y0 < b.y + b.h - 0.5;
        assert.ok(!inside, `edge ${e.id} (${e.kind}) crosses node ${n.id}`);
      });
      checked++;
    }
  });
  assert.ok(checked > 50);
});

test('multilane: every connection gets a lane of its own, nobody shares a stretch of road', () => {
  const c = DM.emptyCampaign();
  const cp = DM.createCheckpoint(c, { label: 'A' });
  const l1 = DM.createEntity(c, { type: 'location', name: 'First' });
  const l2 = DM.createEntity(c, { type: 'location', name: 'Second' });
  const mk = (type, name, ent) => { const m = DM.createContentModule(c, { type, name, text: 'x', html: 'x' }); DM.createAssignment(c, { moduleId: m.id, entityId: ent.id, timeId: cp.id }); return m; };
  const a1 = mk('beat', 'a1', l1), a2 = mk('beat', 'a2', l1), b1 = mk('beat', 'b1', l2), b2 = mk('beat', 'b2', l2);
  const g = G.buildGraph(c);
  const pos = G.autoLayout(c, g);
  pos[a1.id] = { x: G.LANE_X.locCard, y: 40 }; pos[a2.id] = { x: G.LANE_X.locCard, y: 400 };
  pos[b1.id] = { x: G.LANE_X.locCard, y: 120 }; pos[b2.id] = { x: G.LANE_X.locCard, y: 480 };
  pos[l1.id] = { x: G.LANE_X.loc, y: 200 }; pos[l2.id] = { x: G.LANE_X.loc, y: 300 };
  const routes = G.routeEdges(g, pos, g.edges, g.nodes.map((n) => n.id));
  const trunkX = (cardId) => { const e = g.edges.find((x) => x.from === cardId); const pts = routes.get(e.id).pts; return pts.find((p, i) => i && p.x === pts[i - 1].x && p.y !== pts[i - 1].y).x; };
  const info = [a1, a2, b1, b2].map((m) => { const e = g.edges.find((x) => x.from === m.id); const pts = routes.get(e.id).pts; return { x: trunkX(m.id), y0: Math.min(pts[0].y, pts[pts.length - 1].y), y1: Math.max(pts[0].y, pts[pts.length - 1].y) }; });
  let overlapping = 0;
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) if (info[i].y0 < info[j].y1 && info[j].y0 < info[i].y1) { overlapping++; assert.notStrictEqual(info[i].x, info[j].x, 'lines that run side by side must not share a lane'); }
  assert.ok(overlapping >= 3);
  // lines into the same port leave it a few pixels apart
  const ys = g.edges.filter((e) => e.to === l1.id).map((e) => routes.get(e.id).pts[routes.get(e.id).pts.length - 1].y);
  assert.strictEqual(new Set(ys).size, 2, 'two lines into one port are fanned out');
});

test('multilane: in a whole campaign no two lines overlap on a vertical stretch', () => {
  const { g, routes } = routeAll(bigger().c);
  const vertical = [];
  routes.forEach((r, id) => { for (let i = 1; i < r.pts.length; i++) if (r.pts[i].x === r.pts[i - 1].x && r.pts[i].y !== r.pts[i - 1].y) vertical.push({ id, x: r.pts[i].x, y0: Math.min(r.pts[i].y, r.pts[i - 1].y), y1: Math.max(r.pts[i].y, r.pts[i - 1].y) }); });
  let clashes = 0;
  for (let i = 0; i < vertical.length; i++) for (let j = i + 1; j < vertical.length; j++) {
    const p = vertical[i], q = vertical[j];
    if (p.id !== q.id && Math.abs(p.x - q.x) < 1 && Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0) > 2) clashes++;
  }
  assert.ok(vertical.length > 20);
  assert.ok(clashes <= 2, `${clashes} vertical stretches are shared`);
  void g;
});

test('lines are coloured by the kind of content they carry', () => {
  const { c } = bigger();
  const g = G.buildGraph(c);
  const colours = new Set(g.edges.map((e) => G.edgeColor(e)).filter(Boolean));
  assert.ok(colours.size >= 4);
  assert.strictEqual(G.edgeColor({ kind: 'presence' }), G.EDGE_COLORS.presence);
  assert.strictEqual(G.edgeColor({ kind: 'assign', port: 'topic' }), G.EDGE_COLORS.topic);
  assert.strictEqual(G.edgeColor({ kind: 'ref' }), null);
});

test('a line that has to go backwards still stays rectilinear and keeps clear of nodes', () => {
  const { c, locs, npcs } = bigger();
  const g = G.buildGraph(c);
  const pos = G.autoLayout(c, g);
  // drag an NPC to the far left of a location it is present in
  const e = g.edges.find((x) => x.kind === 'presence');
  pos[e.from] = { x: pos[e.to].x - 500, y: pos[e.to].y + 400 };
  const routes = G.routeEdges(g, pos, g.edges, g.nodes.map((n) => n.id));
  const r = routes.get(e.id);
  assert.ok(r.pts.length >= 4);
  for (let i = 1; i < r.pts.length; i++) assert.ok(r.pts[i].x === r.pts[i - 1].x || r.pts[i].y === r.pts[i - 1].y);
  void locs; void npcs;
});

test('dots on lines are kept apart', () => {
  const { routes } = routeAll(bigger().c);
  const pips = Array.from(routes.values()).map((r) => r.pip).filter(Boolean);
  assert.ok(pips.length > 20);
  let close = 0;
  for (let i = 0; i < pips.length; i++) for (let j = i + 1; j < pips.length; j++) if (Math.abs(pips[i].x - pips[j].x) < 10 && Math.abs(pips[i].y - pips[j].y) < 10) close++;
  assert.ok(close <= Math.ceil(pips.length * 0.05), `${close} dots sit on top of each other`);
});

test('new nodes go to the end of their lane without touching anything', () => {
  const { c } = bigger();
  const g1 = G.buildGraph(c);
  const positions = G.autoLayout(c, g1);
  const fresh = DM.createEntity(c, { type: 'npc', name: 'Latecomer' });
  const card = DM.createContentModule(c, { type: 'note', name: 'Late', text: 'x' });
  const g2 = G.buildGraph(c);
  const add = G.placeMissing(c, g2, positions);
  assert.deepStrictEqual(Object.keys(add).sort(), [fresh.id, card.id].sort());
  assert.strictEqual(add[fresh.id].x, G.LANE_X.npc);
  assert.strictEqual(add[card.id].x, G.LANE_X.inbox);
  const all = Object.assign({}, positions, add);
  const boxes = g2.nodes.filter((n) => all[n.id]).map((n) => ({ id: n.id, ...all[n.id], ...G.nodeSize(n) }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${a.id} overlaps ${b.id}`);
  }
});

test('new content for a location lands beside that location, not at the end of the lane', () => {
  const c = DM.emptyCampaign();
  const cp = DM.createCheckpoint(c, { label: 'A' });
  const locs = [];
  for (let i = 0; i < 8; i++) locs.push(DM.createEntity(c, { type: 'location', name: `L${i}` }));
  locs.forEach((l, i) => { for (let k = 0; k < 2 + (i % 3); k++) { const m = DM.createContentModule(c, { type: 'note', name: `${l.name}-${k}`, text: 'x' }); DM.createAssignment(c, { moduleId: m.id, entityId: l.id, timeId: cp.id }); } });
  const positions = G.autoLayout(c, G.buildGraph(c));
  // later, three more cards for a location in the middle
  const mid = locs[3];
  const fresh = [0, 1, 2].map((k) => { const m = DM.createContentModule(c, { type: 'note', name: `late${k}`, text: 'x' }); DM.createAssignment(c, { moduleId: m.id, entityId: mid.id, timeId: cp.id }); return m; });
  const g = G.buildGraph(c);
  const add = G.placeMissing(c, g, positions);
  const all = Object.assign({}, positions, add);
  const cy = all[mid.id].y + G.entityHeight(g.byId[mid.id]) / 2;
  fresh.forEach((m) => {
    assert.strictEqual(add[m.id].x, G.LANE_X.locCard);
    assert.ok(Math.abs(add[m.id].y + G.SIZES.cardH / 2 - cy) < 5 * (G.SIZES.cardH + 10), `card ${m.name} is ${Math.abs(add[m.id].y - cy)}px from its location`);
  });
  const boxes = g.nodes.filter((n) => all[n.id]).map((n) => ({ id: n.id, ...all[n.id], ...G.nodeSize(n) }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(!(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h), `${a.id} overlaps ${b.id}`);
  }
});

test('tidyContent brings far-away content back beside its owner; alignLanes snaps drifted locations', () => {
  const { c, market, desc, gate } = build();
  const g = G.buildGraph(c);
  const pos = G.autoLayout(c, g);
  pos[desc.id].y += 1500;                 // stale: far below its location
  pos[gate.id].x -= 90;                   // drifted left of the lane
  assert.deepStrictEqual(G.alignLanes(g, pos), [gate.id]);
  assert.strictEqual(pos[gate.id].x, G.LANE_X.loc);
  const moved = G.tidyContent(c, g, pos);
  assert.deepStrictEqual(moved, [desc.id]);
  assert.ok(Math.abs(pos[desc.id].y - pos[market.id].y) < 200);
  assert.strictEqual(pos[desc.id].x, G.LANE_X.locCard);
  assert.deepStrictEqual(G.tidyContent(c, g, pos), []);   // idempotent
});

test('positions from the narrower v2 lanes are carried over to the wider lanes', () => {
  const { c, market, desc } = build();
  const g = G.buildGraph(c);
  const pos = { [market.id]: { x: G.OLD_LANES[2].loc, y: 50 }, [desc.id]: { x: G.OLD_LANES[2].locCard, y: 40 } };
  G.remapLanes(g, pos, 2);
  assert.strictEqual(pos[market.id].x, G.LANE_X.loc);
  assert.strictEqual(pos[desc.id].x, G.LANE_X.locCard);
  assert.ok(G.LANE_X.loc - G.LANE_X.locCard - G.SIZES.cardW >= 190, 'room between lanes');
});

test('a card left of an NPC attaches to the NPC\'s left side; lines between facing neighbours never double back', () => {
  const c = DM.emptyCampaign();
  const cp = DM.createCheckpoint(c, { label: 'A' });
  const loc = DM.createEntity(c, { type: 'location', name: 'Hall' });
  const npc = DM.createEntity(c, { type: 'npc', name: 'Guard' });
  const m = DM.createContentModule(c, { type: 'note', name: 'Shared', text: 'x' });
  DM.createAssignment(c, { moduleId: m.id, entityId: loc.id, timeId: cp.id });
  DM.createAssignment(c, { moduleId: m.id, entityId: npc.id, timeId: cp.id });
  c.blocks.push({ id: 'b1', kind: 'arrival', locationId: loc.id, timeId: cp.id, presence: [npc.id] });
  const g = G.buildGraph(c);
  const pos = G.autoLayout(c, g);
  pos[npc.id].y = pos[loc.id].y + 400;
  const routes = G.routeEdges(g, pos, g.edges.filter((e) => e.kind === 'assign' || e.kind === 'presence'));
  g.edges.filter((e) => e.kind === 'assign' || e.kind === 'presence').forEach((e) => {
    const pts = routes.get(e.id).pts;
    const ys = pts.map((p) => p.y);
    let dirs = 0, last = 0;
    for (let i = 1; i < ys.length; i++) { const d = Math.sign(ys[i] - ys[i - 1]); if (d && last && d !== last) dirs++; if (d) last = d; }
    assert.strictEqual(dirs, 0, `edge ${e.id} reverses vertically: ${JSON.stringify(pts)}`);
  });
});

test('locations that host each other stay hosts; sub-locations can be switched off', () => {
  const c = DM.emptyCampaign();
  const cp = DM.createCheckpoint(c, { label: 'A' });
  const a = DM.createEntity(c, { type: 'location', name: 'Dock' });
  const b = DM.createEntity(c, { type: 'location', name: 'Ship' });
  const d = DM.createEntity(c, { type: 'location', name: 'Hold' });
  c.blocks.push({ id: 'p1', kind: 'arrival', locationId: a.id, timeId: cp.id, presence: [b.id] });
  c.blocks.push({ id: 'p2', kind: 'arrival', locationId: b.id, timeId: cp.id, presence: [a.id, d.id] });
  let g = G.buildGraph(c);
  assert.ok(!g.byId[a.id].occupant && !g.byId[b.id].occupant, 'a loop never empties the Locations lane');
  assert.ok(g.byId[d.id].occupant);
  c.graph.subLocations = false;
  g = G.buildGraph(c);
  assert.ok(g.nodes.every((n) => !n.occupant));
  const pos = G.autoLayout(c, g);
  [a, b, d].forEach((l) => assert.strictEqual(pos[l.id].x, G.LANE_X.loc));
});

test('v3 positions (occupants in the NPC lane) move to the Sub-locations column', () => {
  const { c, archive, level, npc, d } = occupantCampaign();
  const g = G.buildGraph(c);
  const o = G.OLD_LANES[3];
  const pos = { [archive.id]: { x: o.loc, y: 40 }, [level.id]: { x: o.npc, y: 40 }, [npc.id]: { x: o.npc, y: 300 }, [d.id]: { x: o.npcCard, y: 40 } };
  G.remapLanes(g, pos, 3);
  assert.deepStrictEqual(G.resetOccupants(g, pos).sort(), [d.id, level.id].sort());
  const add = G.placeMissing(c, g, pos);
  assert.strictEqual(pos[archive.id].x, G.LANE_X.loc);
  assert.strictEqual(pos[npc.id].x, G.LANE_X.npc);
  assert.strictEqual(add[level.id].x, G.LANE_X.sub);
  assert.strictEqual(add[d.id].x, G.LANE_X.locCard);
});

test('alignLanes without a limit pulls a location from any lane onto the Locations lane without overlap', () => {
  const { c, market, gate } = build();
  const g = G.buildGraph(c);
  const pos = G.autoLayout(c, g);
  pos[gate.id].x = G.LANE_X.locCard - 20;
  pos[gate.id].y = pos[market.id].y;
  assert.ok(G.alignLanes(g, pos, 160).length === 0);
  assert.deepStrictEqual(G.alignLanes(g, pos, Infinity), [gate.id]);
  assert.strictEqual(pos[gate.id].x, G.LANE_X.loc);
  assert.ok(pos[gate.id].y + G.entityHeight(g.byId[gate.id]) <= pos[market.id].y || pos[market.id].y + G.entityHeight(g.byId[market.id]) <= pos[gate.id].y, 'does not overlap the other location');
});

test('NPCs sit at the height of their location: new ones are placed beside it, far ones are brought back', () => {
  const c = DM.emptyCampaign();
  const cp = DM.createCheckpoint(c, { label: 'A' });
  const locs = [];
  for (let i = 0; i < 10; i++) locs.push(DM.createEntity(c, { type: 'location', name: `L${String(i).padStart(2, '0')}` }));
  const npcs = locs.map((l, i) => { const n = DM.createEntity(c, { type: 'npc', name: `N${i}` }); c.blocks.push({ id: `b${i}`, kind: 'arrival', locationId: l.id, timeId: cp.id, presence: [n.id] }); return n; });
  let g = G.buildGraph(c);
  const pos = G.autoLayout(c, g);
  const dist = (n, l) => Math.abs(pos[n.id].y + G.entityHeight(g.byId[n.id]) / 2 - (pos[l.id].y + G.entityHeight(g.byId[l.id]) / 2));
  npcs.forEach((n, i) => assert.ok(dist(n, locs[i]) < 60, `auto layout: ${n.name} is ${dist(n, locs[i])}px from its location`));
  // a crowd in one location spreads around it instead of piling up below
  const crowd = [0, 1, 2, 3, 4, 5].map((k) => DM.createEntity(c, { type: 'npc', name: `Crowd${k}` }));
  c.blocks.push({ id: 'bc', kind: 'arrival', locationId: locs[5].id, timeId: cp.id, presence: crowd.map((n) => n.id) });
  g = G.buildGraph(c);
  const p2 = G.autoLayout(c, g);
  const ys = crowd.map((n) => p2[n.id].y);
  assert.ok(Math.min(...ys) < p2[locs[5].id].y && Math.max(...ys) > p2[locs[5].id].y, 'crowd is centred on the location');
  // a newcomer for a location in the middle goes beside it
  const late = DM.createEntity(c, { type: 'npc', name: 'Late' });
  c.blocks.push({ id: 'bl', kind: 'arrival', locationId: locs[2].id, timeId: cp.id, presence: [late.id] });
  g = G.buildGraph(c);
  const base = G.autoLayout(c, g); delete base[late.id];
  const add = G.placeMissing(c, g, base);
  assert.ok(Math.abs(add[late.id].y - base[locs[2].id].y) < 3 * (G.SIZES.cardH + 10), 'new NPC placed near its location');
  // stale: far away, then tidied
  const st = Object.assign({}, base, add);
  st[npcs[4].id] = { x: G.LANE_X.npc, y: st[npcs[4].id].y + 2000 };
  assert.ok(G.tidyContent(c, g, st).includes(npcs[4].id));
  assert.ok(Math.abs(st[npcs[4].id].y - st[locs[4].id].y) < 3 * (G.SIZES.cardH + 10));
});

test('conditions that test something get a dotted line to it (entity, location or content)', () => {
  const C = require('../src/conditions');
  const { c, market, grey, topic, note } = build();
  const present = C.createCondition(c, { name: 'Grey man at market', kind: 'presence', settings: { entityId: grey.id, locationId: market.id } });
  const item = C.createCondition(c, { name: 'Has key', kind: 'item', settings: { entityId: grey.id, itemName: 'key' } });
  const done = C.createCondition(c, { name: 'Note done', kind: 'resolved', settings: { moduleId: note.id } });
  const unused = C.createCondition(c, { name: 'Unused', kind: 'resolved', settings: { moduleId: note.id } });
  [present, item, done].forEach((cnd, i) => { topic.text = (topic.text || '') + `[[IF:${cnd.id}:${i === 0 ? 'here' : i === 1 ? 'has' : 'done'}]]x[[/IF]]`; });
  const g = G.buildGraph(c);
  const subj = g.edges.filter((e) => e.kind === 'condsubj');
  assert.deepStrictEqual(subj.filter((e) => e.from === present.id).map((e) => e.to).sort(), [grey.id, market.id].sort());
  assert.deepStrictEqual(subj.filter((e) => e.from === item.id).map((e) => e.to), [grey.id]);
  assert.deepStrictEqual(subj.filter((e) => e.from === done.id).map((e) => e.to), [note.id]);
  assert.ok(g.byId[unused.id], 'an unused condition still gets a card');
  const pos = G.autoLayout(c, g);
  const routes = G.routeEdges(g, pos, g.edges);
  subj.forEach((e) => {
    const r = routes.get(e.id);
    assert.ok(r && r.pts.length >= 2, `line for ${e.id}`);
    r.pts.slice(1).forEach((p, i) => assert.ok(p.x === r.pts[i].x || p.y === r.pts[i].y, 'only straight pieces'));
    assert.ok(!r.pip, 'no when-dot on these lines');
  });
});

test('routing 300 entities and 1500 cards stays fast', () => {
  const c = DM.emptyCampaign();
  const cp = DM.createCheckpoint(c, { label: 'A' });
  const ents = [];
  for (let i = 0; i < 300; i++) ents.push(DM.createEntity(c, { type: i % 3 ? 'npc' : 'location', name: `E${i}` }));
  for (let i = 0; i < 1500; i++) {
    const ent = ents[i % 300];
    const type = ent.type === 'location' ? 'beat' : 'note';
    const m = DM.createContentModule(c, { type, name: `M${i}`, text: 'x' });
    DM.createAssignment(c, { moduleId: m.id, entityId: ent.id, timeId: cp.id });
  }
  const g = G.buildGraph(c);
  const pos = G.autoLayout(c, g);
  const t = Date.now();
  const routes = G.routeEdges(g, pos, g.edges, g.nodes.map((n) => n.id));
  const ms = Date.now() - t;
  assert.strictEqual(routes.size, g.edges.length);
  assert.ok(ms < 3000, `routing took ${ms}ms`);
  console.log(`      (routed ${routes.size} lines in ${ms}ms)`);
});


function occupantCampaign() {
  const c = DM.emptyCampaign();
  const archive = DM.createEntity(c, { type: 'location', name: 'Archive' });
  const level = DM.createEntity(c, { type: 'location', name: 'Archive Level 2' });
  const vault = DM.createEntity(c, { type: 'location', name: 'Vault' });
  const npc = DM.createEntity(c, { type: 'npc', name: 'Keeper' });
  const d = DM.createContentModule(c, { type: 'description', name: 'Level text', html: 'dark' });
  DM.createAssignment(c, { moduleId: d.id, entityId: level.id, timeId: null });
  c.blocks.push({ id: 'b1', kind: 'arrival', locationId: archive.id, timeId: null, presence: [level.id, npc.id] });
  return { c, archive, level, vault, npc, d };
}
test('loading repairs the remembered Content-tab location and the graph roles', () => {
  const c = DM.emptyCampaign();
  c.meta.lastContentLocationId = 42; c.graph.roles = [1];
  Storage.normalizeCampaign(c);
  assert.strictEqual(c.meta.lastContentLocationId, null);
  assert.deepStrictEqual(c.graph.roles, {});
  c.meta.lastContentLocationId = 'loc_x';
  Storage.normalizeCampaign(c);
  assert.strictEqual(c.meta.lastContentLocationId, 'loc_x');
});

test('a location present inside another location stands in the Sub-locations column under its host', () => {
  const { c, archive, level, vault, npc, d } = occupantCampaign();
  const g = G.buildGraph(c);
  assert.ok(g.byId[level.id].occupant);
  assert.ok(!g.byId[archive.id].occupant && !g.byId[vault.id].occupant);
  const pos = G.autoLayout(c, g);
  assert.strictEqual(pos[archive.id].x, G.LANE_X.loc);
  assert.strictEqual(pos[level.id].x, G.LANE_X.sub);
  assert.ok(G.LANE_X.sub > G.LANE_X.loc && G.LANE_X.npc > G.LANE_X.sub, 'sub-location column sits between Locations and NPCs');
  assert.strictEqual(pos[npc.id].x, G.LANE_X.npc);
  assert.strictEqual(pos[d.id].x, G.LANE_X.locCard);
  assert.ok(pos[level.id].y >= pos[archive.id].y + G.entityHeight(g.byId[archive.id]), 'sub-location stands underneath its host');
  assert.ok(Math.abs(pos[d.id].y - pos[level.id].y) < 2 * (G.SIZES.cardH + 10), 'its content stays beside it');
  // every presence line leaves the host rightwards and enters the occupant on its left
  g.edges.filter((e) => e.kind === 'presence').forEach((e) => {
    const ep = G.edgePorts(g, pos, e);
    assert.strictEqual(ep.a.dir, 1); assert.strictEqual(ep.b.dir, -1);
    assert.ok(ep.a.x < ep.b.x, 'presence must flow left to right');
  });
  // the sub-location's own content comes in from its left side, like any location's
  const assign = g.edges.find((e) => e.kind === 'assign');
  const ap = G.edgePorts(g, pos, assign);
  assert.strictEqual(ap.b.dir, -1);
  assert.ok(ap.a.x < ap.b.x);
});

test('relane moves a location that changed role only if it still sits on its old lane', () => {
  const { c, archive, level, vault, d } = occupantCampaign();
  let g = G.buildGraph(c);
  const store = { positions: G.autoLayout(c, g), roles: { [level.id]: 'occ' } };
  c.blocks[0].presence = [];                       // level is a plain location again
  g = G.buildGraph(c);
  assert.deepStrictEqual(G.relane(c, g, store).sort(), [d.id, level.id].sort());
  assert.ok(!store.positions[level.id] && !store.positions[d.id] && !store.roles[level.id]);
  const added = G.placeMissing(c, g, store.positions);
  assert.strictEqual(added[level.id].x, G.LANE_X.loc);
  assert.strictEqual(added[d.id].x, G.LANE_X.locCard);
  // now the vault becomes an occupant of the archive: it sits on the Locations lane -> moved
  c.blocks[0].presence = [vault.id];
  Object.assign(store.positions, added);
  g = G.buildGraph(c);
  assert.deepStrictEqual(G.relane(c, g, store), [vault.id]);
  assert.strictEqual(store.roles[vault.id], 'occ');
  // a manually placed node stays where the user put it
  store.positions[vault.id] = { x: 5000, y: 5000 };
  c.blocks[0].presence = [];
  g = G.buildGraph(c);
  assert.deepStrictEqual(G.relane(c, g, store), []);
  assert.deepStrictEqual(store.positions[vault.id], { x: 5000, y: 5000 });
  assert.ok(!store.roles[vault.id]);
});

if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('All graph tests passed.');

test('a DC check condition has a card and a line to every block holding its button', () => {
  const DM = require('../src/dataModel');
  const C = require('../src/conditions');
  const { c, topic, note } = build();
  const check = DM.createDCCheck ? DM.createDCCheck(c, {}) : null;
  assert.ok(check, 'createDCCheck exists');
  C.syncDCChecks(c);
  topic.text = (topic.text || '') + ` [[DCCHECK:${check.id}]]`;
  const g = G.buildGraph(c);
  assert.ok(check.conditionId && g.byId[check.conditionId], 'card for the DC condition');
  assert.ok(g.edges.some((e) => e.kind === 'cond' && e.from === check.conditionId && e.to === topic.id), 'line to the block');
  assert.ok(!g.edges.some((e) => e.kind === 'cond' && e.from === check.conditionId && e.to === note.id));
});

test('quests: a quest band lists tagged content right to left in rising index and stays out of the lanes', () => {
  const DM = require('../src/dataModel');
  const Q = require('../src/quests');
  const { c, topic, note } = build();
  const q = DM.createEntity(c, { type: 'quest', name: 'Find the key' });
  const extra = DM.createContentModule(c, { type: 'description', name: 'Vault' });
  Q.assign(c, topic.id, q.id); Q.assign(c, note.id, q.id); Q.assign(c, extra.id, q.id);
  const g = G.buildGraph(c);
  assert.ok(!g.byId[q.id], 'a quest is not an entity node');
  assert.strictEqual(g.quests.nodes.filter((n) => n.kind === 'questitem').length, 3);
  const L = G.questLayout(g, G.autoLayout(c, g));
  const items = g.quests.nodes.filter((n) => n.kind === 'questitem').sort((a, b) => a.index - b.index);
  items.forEach((it, i) => { if (i) assert.ok(L.pos[it.id].x < L.pos[items[i - 1].id].x, 'index rises to the left'); });
  assert.ok(L.pos[items[0].id].x < L.pos[q.id].x, 'index 1 sits next to the quest, left of it');
  const all = G.autoLayout(c, g);
  const maxY = Math.max(...g.nodes.map((n) => (all[n.id] ? all[n.id].y + G.nodeSize(n).h : 0)));
  assert.ok(L.pos[q.id].y > maxY, 'band is below the graph');
});
