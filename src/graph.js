// The Content Graph: a pure view of the campaign as nodes and lines.
//
// Nothing here is stored. Every node and line is derived from data that
// already exists (entities, content modules, assignments, checkpoints, the
// present-here lists on arrival blocks and the [[...]] tokens in text). The
// only thing the graph adds to a campaign is layout: campaign.graph.positions.
//
// Node ids are the ids of the things they show (npc_…, loc_…, mod_…, cp_…), so
// they never collide and renaming or moving never breaks anything.
(function () {

const _c = (typeof module !== 'undefined' && module.exports) ? require('./constants') : window.Constants;
const _cond = (typeof module !== 'undefined' && module.exports) ? require('./conditions') : window.Conditions;

const PORT_ORDER = ['description', 'note', 'topic', 'beat', 'scene'];
const PORT_LABELS = { description: 'Descriptions', note: 'Notes', topic: 'Topics', beat: 'Sections', scene: 'Scenes', presence: 'Present here' };

const SIZES = {
  entityW: 224, entityHead: 52, portH: 22, entityPad: 8,
  cardW: 196, cardH: 58,
  msW: 132, msH: 30,
  condH: 64
};

function entityHeight(node) { return SIZES.entityHead + node.ports.length * SIZES.portH + SIZES.entityPad; }

function sortedCheckpoints(campaign) {
  return (campaign.checkpoints || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}

// Readable one-line excerpt of a piece of content.
function plainText(campaign, s) {
  return String(s == null ? '' : s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[\[SAY:[a-zA-Z0-9_]+\]\]/g, '').replace(/\[\[\/SAY\]\]/g, '')
    .replace(/\[\[JUMP:[a-zA-Z0-9_:]+\]\]/g, '').replace(/\[\[\/JUMP\]\]/g, '')
    .replace(/\[\[(DCCHECK|SCENEBTN|MUSICBTN|QFBTN|DIRBTN):[^\]]*\]\]/g, '').replace(/\[\[\/(SCENEBTN|MUSICBTN|QFBTN|DIRBTN)\]\]/g, '')
    .replace(/\[\[\/?IF(:[^\]]*)?\]\]/g, '')
    .replace(/\[\[([a-zA-Z0-9_]+)\]\]/g, (m, id) => (campaign.entities[id] ? campaign.entities[id].name : ''))
    .replace(/\s+/g, ' ').trim();
}

function excerptOf(campaign, m) {
  if (m.type === 'scene') {
    const first = (m.lines || []).find((l) => l.text && l.text.trim());
    return first ? plainText(campaign, first.text) : '';
  }
  return plainText(campaign, m.type === 'description' ? m.html : m.text);
}

const RE_ID_TOKENS = [
  /\[\[SAY:([a-zA-Z0-9_]+)\]\]/g,
  /\[\[JUMP:([a-zA-Z0-9_]+)(?::[a-zA-Z0-9_]+)?\]\]/g,
  /\[\[([a-zA-Z0-9_]+)\]\]/g
];

function referencedEntityIds(campaign, module) {
  const ids = new Set();
  const scan = (s) => {
    if (typeof s !== 'string') return;
    RE_ID_TOKENS.forEach((re) => {
      const r = new RegExp(re.source, 'g');
      let m;
      while ((m = r.exec(s))) if (campaign.entities[m[1]]) ids.add(m[1]);
    });
  };
  scan(module.html); scan(module.text);
  (module.lines || []).forEach((l) => { scan(l.text); if (l.speakerId && campaign.entities[l.speakerId]) ids.add(l.speakerId); });
  return ids;
}

function buildGraph(campaign, { includeRefs = true } = {}) {
  const nodes = [];
  const byId = {};
  const edges = [];
  const add = (n) => { nodes.push(n); byId[n.id] = n; return n; };

  const entities = Object.values(campaign.entities || {}).filter((e) => e.type !== 'quest');
  entities.forEach((e) => add({
    id: e.id, kind: 'entity', type: e.type, name: e.name, color: e.color, icon: e.icon, groupId: e.groupId || null,
    image: e.image && e.image.filename ? e.image : null, ports: [], portCounts: {}
  }));

  const cps = sortedCheckpoints(campaign);
  cps.forEach((cp, i) => add({ id: cp.id, kind: 'milestone', name: cp.label, order: i }));
  for (let i = 0; i + 1 < cps.length; i++) edges.push({ id: `chain_${cps[i].id}`, kind: 'chain', from: cps[i].id, to: cps[i + 1].id, timeId: null });

  const modules = campaign.contentModules || [];
  const assignedModuleIds = new Set();
  const assignmentCount = {};
  (campaign.assignments || []).forEach((a) => {
    if (byId[a.entityId] && modules.some((m) => m.id === a.moduleId)) { assignedModuleIds.add(a.moduleId); assignmentCount[a.moduleId] = (assignmentCount[a.moduleId] || 0) + 1; }
  });
  modules.forEach((m) => add({
    id: m.id, kind: 'module', type: m.type, name: m.name || '', excerpt: excerptOf(campaign, m), complete: !!m.complete,
    inbox: !assignedModuleIds.has(m.id), assignedTo: assignmentCount[m.id] || 0
  }));

  (campaign.assignments || []).forEach((a) => {
    const target = byId[a.entityId];
    const mod = byId[a.moduleId];
    if (!target || !mod || target.kind !== 'entity' || mod.kind !== 'module') return;
    const timeId = a.timeId && byId[a.timeId] ? a.timeId : null;
    edges.push({ id: a.id, kind: 'assign', from: a.moduleId, to: a.entityId, port: mod.type, timeId, assignmentId: a.id, order: a.order || 0 });
    target.portCounts[mod.type] = (target.portCounts[mod.type] || 0) + 1;
  });

  // Present-here lists: NPC -> location, one line per (npc, location, time).
  const occEdges = [];
  (campaign.blocks || []).forEach((b) => {
    if (b.kind !== 'arrival') return;
    const loc = byId[b.locationId];
    if (!loc || loc.kind !== 'entity') return;
    const timeId = b.timeId && byId[b.timeId] ? b.timeId : null;
    (b.presence || []).forEach((npcId) => {
      const npc = byId[npcId];
      if (!npc || npc.kind !== 'entity') return;
      edges.push({ id: `pres_${b.id}_${npcId}`, kind: 'presence', from: npcId, to: b.locationId, port: 'presence', timeId, blockId: b.id });
      loc.portCounts.presence = (loc.portCounts.presence || 0) + 1;
      if (npc.type === 'location' && npc.id !== loc.id) occEdges.push([loc.id, npc.id]);
    });
  });
  // A location that is present inside another location is an "occupant": it sits right
  // of its host, in the NPC lane, and behaves like an NPC there. Locations that host each
  // other (loops) stay hosts, so the Locations lane never ends up empty. The campaign can
  // switch the whole idea off (campaign.graph.subLocations === false).
  if (!(campaign.graph && campaign.graph.subLocations === false)) {
    const hosts = {};
    occEdges.forEach(([h, o]) => { (hosts[h] = hosts[h] || []).push(o); });
    const reach = (from) => { const seen = new Set(); const st = [from]; while (st.length) { const x = st.pop(); (hosts[x] || []).forEach((y) => { if (!seen.has(y)) { seen.add(y); st.push(y); } }); } return seen; };
    const cache = {};
    occEdges.forEach(([h, o]) => {
      if (byId[o].occupant) return;
      const r = cache[o] || (cache[o] = reach(o));
      if (!r.has(h)) byId[o].occupant = true;
    });
  }

  nodes.forEach((n) => {
    if (n.kind !== 'entity') return;
    const order = PORT_ORDER.concat(n.type === 'location' ? ['presence'] : []);
    n.ports = order.filter((k) => n.portCounts[k] > 0).map((k) => ({ key: k, label: PORT_LABELS[k], count: n.portCounts[k] }));
  });

  // Lines derived from the text itself: content that mentions an entity.
  if (includeRefs) {
    const seen = new Set();
    modules.forEach((m) => {
      referencedEntityIds(campaign, m).forEach((id) => {
        const key = `${m.id}>${id}`;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({ id: `ref_${key}`, kind: 'ref', from: m.id, to: id, timeId: null });
      });
    });
  }

  // Conditions that something uses: a node each, with a line to every block that
  // carries one of its sections (or is wholly conditional). Unused ones stay in the
  // Conditions tab, so the graph holds only what matters.
  const conds = campaign.conditions || [];
  if (conds.length && _cond) {
    const usedBy = {};
    modules.forEach((m) => _cond.conditionIdsOfModule(m).forEach((cid) => { (usedBy[cid] = usedBy[cid] || []).push(m); }));
    // A DC check's own roll condition belongs to every block that carries its [[DCCHECK:id]] button.
    modules.forEach((m) => _cond.dcConditionIdsOfModule(campaign, m).forEach((cid) => {
      if (!(usedBy[cid] || (usedBy[cid] = [])).includes(m)) usedBy[cid].push(m);
    }));
    conds.forEach((c) => {
      usedBy[c.id] = usedBy[c.id] || [];   // every condition gets a card, used or not
      const st = _cond.statesOf(c).find((s) => s.key === _cond.stateOf(campaign, c, {}));
      add({ id: c.id, kind: 'condition', condKind: c.kind, name: c.name, stateLabel: st ? st.label : '—', states: _cond.statesOf(c), current: _cond.stateOf(campaign, c, {}) });
      usedBy[c.id].forEach((m) => edges.push({ id: `cond_${c.id}_${m.id}`, kind: 'cond', from: c.id, to: m.id, timeId: null, whole: !!(m.showIf && m.showIf.conditionId === c.id) }));
      // What the condition looks at: a thin dotted line to the entities / content it tests.
      const cs = c.settings || {};
      const subjects = c.kind === 'presence' ? [cs.entityId, cs.locationId] : c.kind === 'item' ? [cs.entityId] : c.kind === 'resolved' ? [cs.moduleId] : [];
      subjects.filter((id) => id && byId[id] && byId[id].kind !== 'condition').forEach((id) => edges.push({ id: `subj_${c.id}_${id}`, kind: 'condsubj', from: c.id, to: id, timeId: null, subject: true }));
    });
  }

  // Quests are a band of their own (see questLayout): quest entities and the content tagged with them,
  // kept apart from nodes/edges so they never take part in the lane layout or the line routing.
  const quests = { nodes: [], edges: [] };
  Object.values(campaign.entities || {}).filter((e) => e.type === 'quest').sort((a, b) => a.name.localeCompare(b.name)).forEach((q) => {
    const items = modules.filter((m) => m.questId === q.id).sort((a, b) => ((a.questIndex || 1e9) - (b.questIndex || 1e9)));
    quests.nodes.push({ id: q.id, kind: 'quest', name: q.name, color: q.color, icon: q.icon, count: items.length });
    let prev = q.id;
    items.forEach((m, i) => {
      const id = `qi_${m.id}`;
      quests.nodes.push({ id, kind: 'questitem', questId: q.id, moduleId: m.id, type: m.type, name: m.name || '', excerpt: excerptOf(campaign, m), index: i + 1, complete: !!m.complete });
      quests.edges.push({ id: `qc_${prev}_${id}`, kind: 'questchain', from: prev, to: id });
      prev = id;
    });
  });

  return { nodes, byId, edges, checkpoints: cps, quests };
}

// The quest band: one row per quest below everything else. The quest sits at the right end of
// its row and its content runs to the left in rising index (1 right next to the quest, then 2, 3 …).
// Derived every time; never stored, so it can not drift.
const QUEST = { w: 196, h: 62, gapX: 56, gapY: 34, top: 150 };
function questLayout(graph, positions) {
  const pos = {};
  const qs = (graph.quests && graph.quests.nodes) || [];
  if (!qs.length) return { pos, bounds: null, labelAt: null };
  let right = LANE_X.npcCard + SIZES.cardW, bottom = -Infinity;
  graph.nodes.forEach((n) => {
    const p = positions[n.id]; if (!p || n.kind === 'milestone') return;
    const s = nodeSize(n);
    right = Math.max(right, p.x + s.w); bottom = Math.max(bottom, p.y + s.h);
  });
  if (!Number.isFinite(bottom)) bottom = 0;
  const y0 = bottom + QUEST.top;
  let row = 0, minX = right, maxY = y0;
  qs.filter((n) => n.kind === 'quest').forEach((q) => {
    const y = y0 + row * (QUEST.h + QUEST.gapY);
    pos[q.id] = { x: right - QUEST.w, y };
    qs.filter((n) => n.kind === 'questitem' && n.questId === q.id).forEach((it, i) => {
      const x = right - QUEST.w - (i + 1) * (QUEST.w + QUEST.gapX);
      pos[it.id] = { x, y }; minX = Math.min(minX, x);
    });
    maxY = y + QUEST.h; row++;
  });
  return { pos, bounds: { x0: minX, y0, x1: right, y1: maxY }, labelAt: { x: minX, y: y0 - 56 } };
}


// --- Focus -----------------------------------------------------------------

function adjacency(graph) {
  const adj = {};
  const link = (a, b) => { (adj[a] = adj[a] || new Set()).add(b); (adj[b] = adj[b] || new Set()).add(a); };
  graph.edges.forEach((e) => { if (e.kind === 'assign' || e.kind === 'presence' || e.kind === 'cond' || e.kind === 'condsubj') link(e.from, e.to); });
  return adj;
}

// Ids within `hops` steps of the roots. A milestone root brings everything
// tied to it. `pinned` ids are always included.
function neighborhood(graph, rootIds, hops = 1, pinned = []) {
  const adj = adjacency(graph);
  const out = new Set();
  let frontier = [];
  rootIds.forEach((id) => {
    const n = graph.byId[id];
    if (!n) return;
    out.add(id);
    if (n.kind === 'milestone') {
      graph.edges.forEach((e) => { if ((e.kind === 'assign' || e.kind === 'presence') && e.timeId === id) { frontier.push(e.from, e.to); } });
    } else frontier.push(id);
  });
  frontier.forEach((id) => out.add(id));
  for (let depth = 0; depth < hops; depth++) {
    const next = [];
    frontier.forEach((id) => {
      (adj[id] ? Array.from(adj[id]) : []).forEach((nb) => { if (!out.has(nb)) { out.add(nb); next.push(nb); } });
    });
    frontier = next;
  }
  pinned.forEach((id) => { if (graph.byId[id]) out.add(id); });
  return out;
}

// --- Layout ------------------------------------------------------------------

// The default layout reads left to right in five lanes. Every line joins two
// neighbouring lanes, so nothing ever flows backwards:
//   Unassigned | Location content | Locations | NPCs | NPC content
// ("Present here" runs from a location's right side to the NPC's left side.)
const GUT = 200;   // gap between a content lane and its entities
const MID = 300;   // wider gap between Locations and NPCs: the presence lines run here
const SUBGAP = 150;  // gap between the Locations column and the Sub-locations column beside it
function lanesFor(gut, mid, subGap) {
  const inbox = 0;
  const cond = -(SIZES.cardW + gut);
  const locCard = inbox + SIZES.cardW + gut;
  const loc = locCard + SIZES.cardW + gut;
  const sub = subGap == null ? null : loc + SIZES.entityW + subGap;
  const npc = (sub == null ? loc : sub) + SIZES.entityW + mid;
  const npcCard = npc + SIZES.entityW + gut;
  const lanes = { cond, inbox, locCard, loc, npc, npcCard };
  if (sub != null) lanes.sub = sub;
  return lanes;
}
const LANE_X = lanesFor(GUT, MID, SUBGAP);
// Earlier layout versions used other gaps / no sub-location column; stored positions are carried over.
const OLD_LANES = { 2: lanesFor(130, 200), 3: lanesFor(200, 300) };
const COLUMNS = [
  { key: 'cond', label: 'Conditions', x: LANE_X.cond, w: SIZES.cardW },
  { key: 'inbox', label: 'Unassigned', x: LANE_X.inbox, w: SIZES.cardW },
  { key: 'locCard', label: 'Location content', x: LANE_X.locCard, w: SIZES.cardW },
  { key: 'loc', label: 'Locations', x: LANE_X.loc, w: SIZES.entityW },
  { key: 'sub', label: 'Sub-locations', x: LANE_X.sub, w: SIZES.entityW },
  { key: 'npc', label: 'NPCs', x: LANE_X.npc, w: SIZES.entityW },
  { key: 'npcCard', label: 'NPC content', x: LANE_X.npcCard, w: SIZES.cardW }
];
const LAYOUT_VERSION = 5;

function groupPathName(campaign, groupId) {
  const names = [];
  const seen = new Set();
  let g = (campaign.entityGroups || []).find((x) => x.id === groupId);
  while (g && !seen.has(g.id)) { seen.add(g.id); names.unshift(g.name); g = g.parentId ? (campaign.entityGroups || []).find((x) => x.id === g.parentId) : null; }
  return names.join(' / ');
}

// Full automatic layout of every node. Locations are stacked in the Locations
// lane (sorted by group, then name) with their content beside them. NPCs are
// stacked in the NPC lane next to the locations they are present in (group
// members stay together), so presence lines stay short and mostly horizontal.
function autoLayout(campaign, graph) {
  const pos = {};
  const sortKey = (n) => `${n.groupId ? groupPathName(campaign, n.groupId) : '￿'}\u0000${n.name.toLowerCase()}`;
  // Locations that are present inside another location are laid out like NPCs
  // (right of their host), so presence lines never run backwards.
  const locs = graph.nodes.filter((n) => n.kind === 'entity' && n.type === 'location' && !n.occupant).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const npcs = graph.nodes.filter((n) => n.kind === 'entity' && n.type !== 'location');

  // First entity that holds a card gets the card beside it.
  const firstOwner = {};
  graph.edges.filter((e) => e.kind === 'assign').sort((a, b) => (a.order - b.order)).forEach((e) => { if (!firstOwner[e.from]) firstOwner[e.from] = e.to; });
  const cardsOf = {};
  graph.nodes.filter((n) => n.kind === 'module' && firstOwner[n.id]).forEach((m) => { (cardsOf[firstOwner[m.id]] = cardsOf[firstOwner[m.id]] || []).push(m); });
  Object.values(cardsOf).forEach((list) => list.sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name)));

  const GAP = 28;
  const CARD_STEP = SIZES.cardH + 10;
  const rowHeight = (e) => Math.max(entityHeight(e), (cardsOf[e.id] || []).length * CARD_STEP - 10);
  const putRow = (e, y, entityX, cardX) => {
    const h = rowHeight(e);
    pos[e.id] = { x: entityX, y: y + Math.max(0, (h - entityHeight(e)) / 2 | 0) };
    (cardsOf[e.id] || []).forEach((c, i) => { pos[c.id] = { x: cardX, y: y + i * CARD_STEP }; });
    return h;
  };

  // Locations: a plain stack, a little extra air between groups. A location's
  // sub-locations (locations present inside it) stand in the column to its right,
  // in rows underneath it, so the Locations column stays free beside them.
  const childrenOf = {};
  graph.edges.filter((e) => e.kind === 'presence').forEach((e) => {
    const child = graph.byId[e.from];
    if (child && child.occupant && graph.byId[e.to] && graph.byId[e.to].type === 'location') (childrenOf[e.to] = childrenOf[e.to] || []).push(child);
  });
  const subSeen = new Set();
  const stackSubs = (host, yy) => {
    (childrenOf[host.id] || []).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())).forEach((ch) => {
      if (subSeen.has(ch.id)) return;
      subSeen.add(ch.id);
      yy += putRow(ch, yy, LANE_X.sub, LANE_X.locCard) + GAP;
      yy = stackSubs(ch, yy);
    });
    return yy;
  };
  let y = 40, prevGroup;
  locs.forEach((e) => {
    if (prevGroup !== undefined && prevGroup !== (e.groupId || null)) y += 18;
    prevGroup = e.groupId || null;
    y += putRow(e, y, LANE_X.loc, LANE_X.locCard) + GAP;
    y = stackSubs(e, y);
  });
  graph.nodes.filter((n) => n.kind === 'entity' && n.type === 'location' && n.occupant && !subSeen.has(n.id)).forEach((ch) => { subSeen.add(ch.id); y += putRow(ch, y, LANE_X.sub, LANE_X.locCard) + GAP; });

  // NPCs: wanted height = middle of the locations they are present in.
  const locMid = {};
  graph.nodes.filter((n) => n.kind === 'entity' && n.type === 'location').forEach((l) => { if (pos[l.id]) locMid[l.id] = pos[l.id].y + entityHeight(l) / 2; });
  const wanted = {};
  graph.edges.filter((e) => e.kind === 'presence').forEach((e) => {
    if (locMid[e.to] == null) return;
    (wanted[e.from] = wanted[e.from] || []).push(locMid[e.to]);
  });
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const want = (n) => (wanted[n.id] ? mean(wanted[n.id]) : null);
  // Units to place: whole groups stay together, loose NPCs stand alone.
  const units = {};
  npcs.forEach((n) => {
    const key = n.groupId ? `g:${n.groupId}` : `n:${n.id}`;
    (units[key] = units[key] || { key, members: [], name: n.groupId ? groupPathName(campaign, n.groupId) : n.name }).members.push(n);
  });
  const unitList = Object.values(units);
  unitList.forEach((u) => {
    u.members.sort((a, b) => ((want(a) == null ? 1e12 : want(a)) - (want(b) == null ? 1e12 : want(b))) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    const ws = u.members.map(want).filter((v) => v != null);
    u.want = ws.length ? mean(ws) : null;
  });
  unitList.sort((a, b) => ((a.want == null ? 1e12 : a.want) - (b.want == null ? 1e12 : b.want)) || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  // Rows in order. Each wants to centre on its locations; where that is not possible
  // (they would overlap) the deviation is shared out as evenly as it can be (pool-adjacent-
  // violators on "wanted top minus the height stacked above"), so a crowd around one
  // location spreads up and down instead of piling up below it.
  const rows = [];
  unitList.forEach((u) => {
    u.members.forEach((n, i) => { rows.push({ n, h: rowHeight(n), w: want(n), gap: GAP + (i === u.members.length - 1 ? 10 : 0) }); });
  });
  let cum = 0;
  rows.forEach((r) => { r.cum = cum; cum += r.h + r.gap; });
  const wantedRows = rows.filter((r) => r.w != null);
  const blocks = [];
  wantedRows.forEach((r) => {
    blocks.push({ sum: r.w - r.h / 2 - r.cum, n: 1, rows: [r] });
    while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].n > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].n) {
      const last = blocks.pop(), prev = blocks.pop();
      blocks.push({ sum: prev.sum + last.sum, n: prev.n + last.n, rows: prev.rows.concat(last.rows) });
    }
  });
  let ny = 40;
  blocks.forEach((bl) => {
    const z = Math.max(bl.sum / bl.n, 40);
    bl.rows.forEach((r) => { r.top = z + r.cum; });
  });
  wantedRows.forEach((r) => {
    const top = Math.max(r.top, 40 + r.cum);
    putRow(r.n, Math.round(top), LANE_X.npc, LANE_X.npcCard);
    ny = Math.max(ny, top + r.h + r.gap);
  });
  rows.filter((r) => r.w == null).forEach((r) => { putRow(r.n, ny, LANE_X.npc, LANE_X.npcCard); ny += r.h + r.gap; });

  let iy = 40;
  graph.nodes.filter((n) => n.kind === 'module' && !firstOwner[n.id]).sort((a, b) => (a.type + a.name).localeCompare(b.type + b.name)).forEach((m) => {
    pos[m.id] = { x: LANE_X.inbox, y: iy }; iy += CARD_STEP;
  });
  let cy = 40;
  graph.nodes.filter((n) => n.kind === 'condition').sort((a, b) => a.name.localeCompare(b.name)).forEach((n) => { pos[n.id] = { x: LANE_X.cond, y: cy }; cy += SIZES.condH + 12; });
  graph.nodes.filter((n) => n.kind === 'milestone').forEach((m, i) => { pos[m.id] = { x: LANE_X.loc + i * (SIZES.msW + 24), y: -110 }; });
  return pos;
}

// A location can change role (it becomes present inside another location, or
// stops being so). Its lane changes with it: if it still sits exactly on the old
// lane (the user never moved it), its position and its own content cards are
// dropped so placeMissing puts them in the right lane. Manually moved nodes stay.
// Returns the ids that were reset. Roles are stored in store.roles ({id: 'occ'}).
function relane(campaign, graph, store) {
  const roles = store.roles && typeof store.roles === 'object' ? store.roles : (store.roles = {});
  const reset = [];
  const firstOwner = {};
  graph.edges.filter((e) => e.kind === 'assign').sort((a, b) => (a.order - b.order)).forEach((e) => { if (!firstOwner[e.from]) firstOwner[e.from] = e.to; });
  Object.keys(roles).forEach((id) => { if (!graph.byId[id]) delete roles[id]; });
  graph.nodes.forEach((n) => {
    if (n.kind !== 'entity' || n.type !== 'location') return;
    const now = n.occupant ? 'occ' : 'loc';
    const was = roles[n.id] || 'loc';
    if (now === 'occ') roles[n.id] = 'occ'; else delete roles[n.id];
    if (was === now) return;
    const oldX = was === 'occ' ? LANE_X.sub : LANE_X.loc;
    const oldCardX = LANE_X.locCard;
    const p = store.positions[n.id];
    if (!p || Math.abs(p.x - oldX) > 160) return;
    delete store.positions[n.id];
    reset.push(n.id);
    graph.nodes.forEach((m) => {
      const mp = store.positions[m.id];
      if (m.kind === 'module' && firstOwner[m.id] === n.id && mp && Math.abs(mp.x - oldCardX) <= 160) { delete store.positions[m.id]; reset.push(m.id); }
    });
  });
  return reset;
}

// Positions for nodes that have none yet (new entities and content). Content
// goes as close as possible to the height of the entity that owns it (first
// owner), everything else to the free slot nearest to its automatic position.
// Nothing is ever put on top of something already placed.
function firstOwnerMap(graph) {
  const firstOwner = {};
  graph.edges.filter((e) => e.kind === 'assign').sort((a, b) => (a.order - b.order)).forEach((e) => { if (!firstOwner[e.from]) firstOwner[e.from] = e.to; });
  return firstOwner;
}

// Nearest collision-free y to `target` for a box in lane x. Tries down first, then up.
function freeSlot(placed, x, w, h, target) {
  const clash = (y) => placed.some((r) => x < r.x + r.w + 4 && x + w + 4 > r.x && y < r.y + r.h + 10 && y + h + 10 > r.y);
  const t = Math.round(target / 10) * 10;
  for (let k = 0; k < 800; k++) {
    const d = Math.ceil(k / 2) * 10 * (k % 2 ? 1 : -1);
    const y = t + (k === 0 ? 0 : d);
    if (!clash(y)) return y;
  }
  return t;
}

// Re-stacks one entity lane with its content lane as rows (entity + its first-owner
// cards), keeping the order the entities are in now. Used when a lane is packed so
// tight that new content cannot get a slot beside its owner. Cards without a
// position yet (`pending` ids) join the end of their owner's cards. Returns
// {id: {x, y}} for every node that changed.
function reflowLane(graph, positions, laneKey, pending) {
  const STEP = SIZES.cardH + 10, GAP = 28;
  const firstOwner = firstOwnerMap(graph);
  const ex = LANE_X[laneKey], cx = LANE_X[laneKey === 'loc' ? 'locCard' : 'npcCard'];
  const ents = graph.nodes.filter((n) => n.kind === 'entity' && positions[n.id] && Math.abs(positions[n.id].x - ex) <= 1 && entityLane(n) === laneKey)
    .sort((a, b) => positions[a.id].y - positions[b.id].y);
  if (!ents.length) return {};
  const cardsOf = {};
  graph.nodes.forEach((m) => {
    if (m.kind !== 'module') return;
    const o = firstOwner[m.id];
    if (!o || !ents.some((e) => e.id === o)) return;
    const isPending = pending && pending.has(m.id);
    const p = positions[m.id];
    if (!isPending && !(p && Math.abs(p.x - cx) <= 40)) return;
    (cardsOf[o] = cardsOf[o] || []).push({ m, y: isPending ? Infinity : p.y });
  });
  let cursor = Infinity;
  ents.forEach((e) => { cursor = Math.min(cursor, positions[e.id].y); (cardsOf[e.id] || []).forEach((c) => { if (c.y !== Infinity) cursor = Math.min(cursor, c.y); }); });
  const out = {};
  const put = (id, x, y) => { const p = positions[id]; if (!p || p.x !== x || p.y !== y) out[id] = { x, y }; };
  ents.forEach((e) => {
    const cards = (cardsOf[e.id] || []).sort((a, b) => (a.y - b.y) || a.m.name.localeCompare(b.m.name));
    const eh = entityHeight(e);
    const h = Math.max(eh, cards.length * STEP - 10);
    put(e.id, ex, cursor + Math.max(0, ((h - eh) / 2) | 0));
    cards.forEach((c, i) => put(c.m.id, cx, cursor + i * STEP));
    cursor += h + GAP;
  });
  return out;
}

// Mean height of the middle of the locations an entity is present in (null if none are placed).
function hostCentre(graph, positions, n) {
  const ys = [];
  graph.edges.forEach((e) => {
    if (e.kind !== 'presence' || e.from !== n.id) return;
    const l = graph.byId[e.to], p = positions[e.to];
    if (l && p) ys.push(p.y + entityHeight(l) / 2);
  });
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
}

function placeMissing(campaign, graph, positions) {
  const missing = graph.nodes.filter((n) => !positions[n.id]);
  if (!missing.length) return {};
  const auto = autoLayout(campaign, graph);
  if (missing.length === graph.nodes.length) return auto;
  const firstOwner = firstOwnerMap(graph);
  const placed = [];
  graph.nodes.forEach((n) => { if (positions[n.id]) { const s = nodeSize(n); placed.push({ x: positions[n.id].x, y: positions[n.id].y, w: s.w, h: s.h }); } });
  const out = {};
  const crowded = {};
  const rank = (n) => (n.kind === 'entity' ? 0 : n.kind === 'module' ? 1 : 2);
  missing.sort((a, b) => (rank(a) - rank(b)) || (auto[a.id].y - auto[b.id].y)).forEach((n) => {
    const s = nodeSize(n);
    const x = auto[n.id].x;
    if (n.kind === 'milestone') {
      out[n.id] = { x: auto[n.id].x, y: auto[n.id].y };
      let guard = 0;
      while (placed.some((r) => out[n.id].x < r.x + r.w && out[n.id].x + s.w > r.x && out[n.id].y < r.y + r.h && out[n.id].y + s.h > r.y) && guard++ < 50) out[n.id].x += SIZES.msW + 24;
      placed.push({ x: out[n.id].x, y: out[n.id].y, w: s.w, h: s.h });
      return;
    }
    const owner = n.kind === 'module' ? firstOwner[n.id] : null;
    const op = owner && (positions[owner] || out[owner]);
    let y;
    if (op && graph.byId[owner]) {
      // beside its owner: centre on the owner, then the nearest free slot
      const oh = nodeSize(graph.byId[owner]).h;
      const ideal = op.y + oh / 2 - s.h / 2;
      y = freeSlot(placed, x, s.w, s.h, ideal);
      const laneKey = entityLane(graph.byId[owner]);
      if (laneKey !== 'sub' && Math.abs(y - ideal) > 2 * (SIZES.cardH + 10) && graph.byId[owner].kind === 'entity' && Math.abs(op.x - LANE_X[laneKey]) <= 1) {
        // The lane is packed: re-stack it as rows instead of banishing the card.
        (crowded[laneKey] = crowded[laneKey] || new Set()).add(n.id);
        return;
      }
    } else if (n.kind === 'entity') {
      // NPCs and sub-locations: beside the locations they are present in
      const hc = hostCentre(graph, Object.assign({}, positions, out), n);
      y = freeSlot(placed, x, s.w, s.h, hc != null ? hc - s.h / 2 : auto[n.id].y);
    } else {
      // unassigned content and conditions: end of their own lane
      let bottom = -Infinity;
      placed.forEach((r) => { if (Math.abs(r.x - x) < 60 && r.y > -90) bottom = Math.max(bottom, r.y + r.h); });
      y = bottom === -Infinity ? auto[n.id].y : bottom + 20;
    }
    out[n.id] = { x, y };
    placed.push({ x, y, w: s.w, h: s.h });
  });
  Object.keys(crowded).forEach((laneKey) => {
    const work = Object.assign({}, positions, out);
    const moved = reflowLane(graph, work, laneKey, crowded[laneKey]);
    Object.keys(moved).forEach((id) => { out[id] = moved[id]; });
  });
  return out;
}

// Which lane key an entity / content card belongs to.
function entityLane(n) { return n.type === 'location' ? (n.occupant ? 'sub' : 'loc') : 'npc'; }
function cardLaneOf(owner) { return owner && owner.kind === 'entity' && owner.type === 'location' ? 'locCard' : 'npcCard'; }

// Carry positions saved under an older lane geometry over to the current one.
function remapLanes(graph, positions, fromVersion) {
  const old = OLD_LANES[fromVersion];
  if (!old) return 0;
  const keys = Object.keys(old);
  let n = 0;
  graph.nodes.forEach((node) => {
    const p = positions[node.id];
    if (!p || node.kind === 'milestone') return;
    let best = null;
    keys.forEach((k) => { const d = Math.abs(p.x - old[k]); if (!best || d < best.d) best = { k, d }; });
    // every lane keeps its distance to the lane it was nearest to
    const nx = LANE_X[best.k] + (p.x - old[best.k]);
    if (Math.abs(nx - p.x) > 0.5) { p.x = nx; n++; }
  });
  return n;
}

// Locations that live in the Sub-locations column (and their content) lose their
// saved position so placeMissing puts them there. Used when that column was introduced.
function resetOccupants(graph, positions) {
  const firstOwner = firstOwnerMap(graph);
  const out = [];
  graph.nodes.forEach((n) => {
    if (n.kind === 'entity' && n.occupant && positions[n.id]) { delete positions[n.id]; out.push(n.id); }
  });
  graph.nodes.forEach((m) => {
    if (m.kind === 'module' && positions[m.id] && out.includes(firstOwner[m.id])) { delete positions[m.id]; out.push(m.id); }
  });
  return out;
}

// Entities that sit a little beside their lane (dragged without snapping, or left
// over from an older geometry) are put back on it. Returns the ids moved.
function alignLanes(graph, positions, tolerance = 160) {
  const moved = [];
  graph.nodes.forEach((n) => {
    if (n.kind !== 'entity') return;
    const p = positions[n.id];
    if (!p) return;
    const lx = LANE_X[entityLane(n)];
    const dx = Math.abs(p.x - lx);
    if (dx > 0.5 && dx <= tolerance) { p.x = lx; moved.push(n.id); }
  });
  // a node that lands on top of another one takes the nearest free height in its lane
  moved.forEach((id) => {
    const n = graph.byId[id], s = nodeSize(n), p = positions[id];
    const others = [];
    graph.nodes.forEach((m) => { if (m.id !== id && positions[m.id]) { const t = nodeSize(m); others.push({ x: positions[m.id].x, y: positions[m.id].y, w: t.w, h: t.h }); } });
    p.y = freeSlot(others, p.x, s.w, s.h, p.y);
  });
  return moved;
}

// Content cards that sit in their owner's content lane but far from the owner's
// height are re-placed beside it. Returns the ids moved.
function tidyContent(campaign, graph, positions) {
  const firstOwner = firstOwnerMap(graph);
  const STEP = SIZES.cardH + 10;
  const stale = [];
  const count = {};
  Object.values(firstOwner).forEach((o) => { count[o] = (count[o] || 0) + 1; });
  graph.nodes.forEach((m) => {
    if (m.kind !== 'module') return;
    const owner = graph.byId[firstOwner[m.id]];
    const mp = positions[m.id];
    const op = owner && positions[owner.id];
    if (!mp || !op || owner.kind !== 'entity') return;
    if (Math.abs(mp.x - LANE_X[cardLaneOf(owner)]) > 40) return;   // placed somewhere else on purpose
    const oh = entityHeight(owner);
    const reach = Math.max(oh / 2, (count[owner.id] || 1) * STEP / 2) + STEP;
    if (Math.abs((mp.y + SIZES.cardH / 2) - (op.y + oh / 2)) > reach) stale.push(m.id);
  });
  // NPCs and sub-locations that stand far from the locations they are present in
  graph.nodes.forEach((n) => {
    if (n.kind !== 'entity' || n.type === 'location' && !n.occupant) return;
    const p = positions[n.id];
    if (!p || Math.abs(p.x - LANE_X[entityLane(n)]) > 40) return;
    const ys = [];
    graph.edges.forEach((e) => { if (e.kind === 'presence' && e.from === n.id && positions[e.to] && graph.byId[e.to]) ys.push(positions[e.to].y + entityHeight(graph.byId[e.to]) / 2); });
    if (!ys.length) return;
    if (Math.max(...ys) - Math.min(...ys) > 500) return;   // spread over distant locations: no meaningful place
    const mid = ys.reduce((a, b) => a + b, 0) / ys.length;
    if (Math.abs(p.y + entityHeight(n) / 2 - mid) > 350) stale.push(n.id);
  });
  if (!stale.length) return [];
  // content of entities that move follows them
  const movedEnts = new Set(stale);
  graph.nodes.forEach((m) => {
    if (m.kind === 'module' && !movedEnts.has(m.id) && movedEnts.has(firstOwner[m.id]) && positions[m.id]) stale.push(m.id);
  });
  stale.forEach((id) => { delete positions[id]; });
  const added = placeMissing(campaign, graph, positions);
  Object.keys(added).forEach((id) => { positions[id] = added[id]; });
  return stale;
}

function nodeSize(n) {
  if (n.kind === 'entity') return { w: SIZES.entityW, h: entityHeight(n) };
  if (n.kind === 'module') return { w: SIZES.cardW, h: SIZES.cardH };
  if (n.kind === 'condition') return { w: SIZES.cardW, h: SIZES.condH + (n.condKind === 'switch' ? 20 * Math.max(0, Math.ceil((n.states || []).length / 3) - 1) : 0) };
  return { w: SIZES.msW, h: SIZES.msH };
}

// --- Line routing ----------------------------------------------------------------
//
// Every line is made of horizontal and vertical pieces only. A line leaves its
// start straight out of the side it is attached to, turns inside the gap
// between lanes and enters the other end straight on. Lines that belong to the
// same node share one vertical "highway" next to it; different nodes whose
// highways would overlap are given neighbouring tracks instead.

const ROUTE = { stub: 16, track: 8, fan: 5, grid: 160, pad: 4 };

// Line colours: one per kind of content, matching the card headings.
const EDGE_COLORS = { cond: '#e8836b', description: '#e0b56a', note: '#9acb7c', topic: '#6fb3e8', beat: '#d67f9f', scene: '#b595ea', presence: '#8f7bd1' };
function edgeColor(edge) { if (edge.kind === 'cond' || edge.kind === 'condsubj') return EDGE_COLORS.cond; return edge.kind === 'presence' ? EDGE_COLORS.presence : edge.kind === 'assign' ? (EDGE_COLORS[edge.port] || null) : null; }

// Where a line attaches: { x, y, dir } with dir +1 = leaves to the right,
// -1 = leaves to the left, plus the id of the node.
function portFor(graph, positions, node, edge, role) {
  const p = positions[node.id];
  if (!p) return null;
  const { w, h } = nodeSize(node);
  if (node.kind === 'entity') {
    if (edge.kind === 'presence') {
      // The hosting location sends presence out of its right side; whoever is
      // present (usually an NPC) takes it in on the left.
      return role === 'to'
        ? { x: p.x + w, y: p.y + SIZES.entityHead + Math.max(0, node.ports.findIndex((x) => x.key === 'presence')) * SIZES.portH + SIZES.portH / 2, dir: 1, id: node.id }
        : { x: p.x, y: p.y + SIZES.entityHead / 2, dir: -1, id: node.id };
    }
    if (edge.kind === 'assign') {
      let idx = node.ports.findIndex((x) => x.key === edge.port);
      if (idx < 0) idx = 0;
      const y = p.y + SIZES.entityHead + idx * SIZES.portH + SIZES.portH / 2;
      // The line attaches on the side that faces the card, so it never has to wrap around
      // its own entity. Without a card position the lane's usual side is used.
      const cp = positions[edge.from], cn = graph.byId[edge.from];
      let left = node.type === 'location';
      if (cp && cn) left = cp.x + nodeSize(cn).w / 2 < p.x + w / 2;
      return left ? { x: p.x, y, dir: -1, id: node.id } : { x: p.x + w, y, dir: 1, id: node.id };
    }
    return null;
  }
  if (node.kind === 'milestone') return { x: role === 'from' ? p.x + w : p.x, y: p.y + h / 2, dir: role === 'from' ? 1 : -1, id: node.id };
  return null;
}

function edgePorts(graph, positions, edge) {
  const from = graph.byId[edge.from], to = graph.byId[edge.to];
  if (!from || !to || !positions[from.id] || !positions[to.id]) return null;
  if (edge.kind === 'chain') return { a: portFor(graph, positions, from, edge, 'from'), b: portFor(graph, positions, to, edge, 'to'), entityEnd: null };
  if (edge.kind === 'presence') {
    // edge.from is the NPC, edge.to the location; the line is drawn location -> NPC.
    const a = portFor(graph, positions, to, edge, 'to'), b = portFor(graph, positions, from, edge, 'from');
    return a && b ? { a, b, entityEnd: 'b' } : null;
  }
  if (edge.kind === 'cond' || edge.kind === 'condsubj') {
    const pc0 = positions[from.id], pm = positions[to.id];
    const cs0 = nodeSize(from), ms = nodeSize(to);
    const toRight = pc0.x + cs0.w / 2 < pm.x + ms.w / 2;
    return {
      a: { x: toRight ? pc0.x + cs0.w : pc0.x, y: pc0.y + cs0.h / 2, dir: toRight ? 1 : -1, id: from.id },
      b: { x: toRight ? pm.x : pm.x + ms.w, y: to.kind === 'entity' ? pm.y + 14 : pm.y + ms.h / 2, dir: toRight ? -1 : 1, id: to.id },
      entityEnd: null
    };
  }
  const pc = positions[from.id], pe = positions[to.id];
  const cs = nodeSize(from), es = nodeSize(to);
  let b;
  if (edge.kind === 'assign') b = portFor(graph, positions, to, edge, 'to');
  else { // mention: attaches to the header, on the side facing the card
    const facingLeft = pc.x + cs.w / 2 < pe.x + es.w / 2;
    b = { x: facingLeft ? pe.x : pe.x + es.w, y: pe.y + SIZES.entityHead / 2, dir: facingLeft ? -1 : 1, id: to.id };
  }
  if (!b) return null;
  const cardOnRight = pc.x + cs.w / 2 < b.x;
  const a = { x: cardOnRight ? pc.x + cs.w : pc.x, y: pc.y + cs.h / 2, dir: cardOnRight ? 1 : -1, id: from.id };
  return { a, b, entityEnd: 'b' };
}

function buildObstacleIndex(graph, positions, nodeIds) {
  const cells = new Map();
  const rects = [];
  nodeIds.forEach((id) => {
    const n = graph.byId[id], p = positions[id];
    if (!n || !p) return;
    const s = nodeSize(n);
    const r = { id, x0: p.x - ROUTE.pad, y0: p.y - ROUTE.pad, x1: p.x + s.w + ROUTE.pad, y1: p.y + s.h + ROUTE.pad };
    rects.push(r);
    for (let cx = Math.floor(r.x0 / ROUTE.grid); cx <= Math.floor(r.x1 / ROUTE.grid); cx++) {
      for (let cy = Math.floor(r.y0 / ROUTE.grid); cy <= Math.floor(r.y1 / ROUTE.grid); cy++) {
        const k = `${cx},${cy}`;
        (cells.get(k) || cells.set(k, []).get(k)).push(r);
      }
    }
  });
  return { cells, rects };
}

// Is the horizontal or vertical stretch free of nodes? (`ignore` = node ids to skip)
function stretchFree(index, x1, y1, x2, y2, ignore) {
  const xa = Math.min(x1, x2), xb = Math.max(x1, x2), ya = Math.min(y1, y2), yb = Math.max(y1, y2);
  for (let cx = Math.floor(xa / ROUTE.grid); cx <= Math.floor(xb / ROUTE.grid); cx++) {
    for (let cy = Math.floor(ya / ROUTE.grid); cy <= Math.floor(yb / ROUTE.grid); cy++) {
      const list = index.cells.get(`${cx},${cy}`);
      if (!list) continue;
      for (const r of list) {
        if (ignore && ignore.has(r.id)) continue;
        if (xb >= r.x0 && xa <= r.x1 && yb >= r.y0 && ya <= r.y1) return false;
      }
    }
  }
  return true;
}

function simplify(pts) {
  const out = [];
  pts.forEach((p) => {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) return;
    out.push({ x: p.x, y: p.y });
  });
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) out.splice(i, 1);
  }
  return out;
}

function pathLength(pts) { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y); return l; }

function pointAlong(pts, dist) {
  let d = Math.max(0, dist);
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.abs(pts[i].x - pts[i - 1].x) + Math.abs(pts[i].y - pts[i - 1].y);
    if (d <= seg || i === pts.length - 1) {
      const t = seg ? Math.min(1, d / seg) : 0;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    d -= seg;
  }
  return pts[pts.length - 1];
}

function pathData(pts) { return pts.map((p, i) => `${i ? 'L' : 'M'}${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`).join(''); }

// A free horizontal channel for the long way round.
function findChannel(index, xa, xb, ya, yb, near) {
  const base = Math.round(near / 10) * 10;
  for (let k = 0; k <= 160; k++) {
    for (const sgn of (k === 0 ? [1] : [1, -1])) {
      const yc = base + sgn * k * 10;
      if (stretchFree(index, xa, yc, xb, yc) && stretchFree(index, xa, ya, xa, yc) && stretchFree(index, xb, yc, xb, yb)) return yc;
    }
  }
  let top = Infinity;
  index.rects.forEach((r) => { top = Math.min(top, r.y0); });
  return (isFinite(top) ? top : 0) - 40;
}

// Routes every edge in `edges`. Returns a Map: edge id -> { pts, d, pip }.
// `obstacleIds` are the nodes lines should keep clear of.
function routeEdges(graph, positions, edges, obstacleIds) {
  const S = ROUTE.stub;
  const index = buildObstacleIndex(graph, positions, obstacleIds || graph.nodes.map((n) => n.id));
  const items = [];
  const degree = {};
  edges.forEach((edge) => {
    const ports = edgePorts(graph, positions, edge);
    if (!ports || !ports.a || !ports.b) return;
    items.push({ edge, a: ports.a, b: ports.b, entityEnd: ports.entityEnd });
    const ka = `${ports.a.id}:${ports.a.dir}`, kb = `${ports.b.id}:${ports.b.dir}`;
    degree[ka] = (degree[ka] || 0) + 1; degree[kb] = (degree[kb] || 0) + 1;
  });

  // Several lines leaving the same port fan out a few pixels apart, so each one
  // can be followed from the very first piece.
  const fans = new Map();
  items.forEach((it) => {
    [['a', 'b'], ['b', 'a']].forEach(([me, other]) => {
      const key = `${it[me].id}:${it[me].dir}:${Math.round(it[me].y)}`;
      (fans.get(key) || fans.set(key, []).get(key)).push({ it, me, farY: it[other].y });
    });
  });
  fans.forEach((list) => {
    if (list.length < 2) return;
    const node = graph.byId[list[0].it[list[0].me].id];
    const maxOff = node.kind === 'entity' ? (list[0].it.edge.kind === 'presence' && node.type !== 'location' ? 20 : list[0].it.edge.kind === 'presence' ? 8 : 8) : node.kind === 'module' ? 22 : 0;
    const step = Math.min(ROUTE.fan, list.length > 1 ? (2 * maxOff) / (list.length - 1) : 0);
    list.sort((p, q) => p.farY - q.farY).forEach((m, i) => { m.it[m.me] = Object.assign({}, m.it[m.me], { y: m.it[m.me].y + (i - (list.length - 1) / 2) * step }); });
  });

  const trunks = []; // vertical highways to be given tracks
  items.forEach((it) => {
    const { a, b } = it;
    const gap = a.dir === 1 && b.dir === -1 ? b.x - a.x : a.dir === -1 && b.dir === 1 ? a.x - b.x : -1;
    if (it.edge.kind === 'chain' || (gap >= 14 && gap < 2 * S)) { it.plan = 'mid'; it.x = (a.x + b.x) / 2; return; }
    const facing = (a.dir === 1 && b.dir === -1 && b.x - a.x >= 2 * S) || (a.dir === -1 && b.dir === 1 && a.x - b.x >= 2 * S);
    if (facing) {
      // The vertical highway hugs the busier end (ties: the entity).
      const da = degree[`${a.id}:${a.dir}`], db = degree[`${b.id}:${b.dir}`];
      const hug = da > db ? a : db > da ? b : (it.entityEnd === 'a' ? a : b);
      const other = hug === a ? b : a;
      const x0 = hug.x + hug.dir * S;
      const own = new Set([a.id, b.id]);
      const ok = a.y === b.y
        ? stretchFree(index, a.x, a.y, b.x, b.y, own)
        : stretchFree(index, a.x, a.y, x0, a.y, new Set([a.id])) && stretchFree(index, x0, a.y, x0, b.y) && stretchFree(index, x0, b.y, b.x, b.y, new Set([b.id]));
      if (ok) { it.plan = 'z'; it.hug = hug; it.other = other; it.x = x0; trunks.push(it); return; }
    }
    if (a.dir === b.dir) {
      const xs = a.dir > 0 ? Math.max(a.x, b.x) + S : Math.min(a.x, b.x) - S;
      if (!(stretchFree(index, a.x, a.y, xs, a.y, new Set([a.id])) && stretchFree(index, xs, a.y, xs, b.y) && stretchFree(index, xs, b.y, b.x, b.y, new Set([b.id])))) { it.plan = 'channel'; return; }
      it.plan = 'u'; it.x = xs;
      it.hug = (a.dir > 0 ? a.x >= b.x : a.x <= b.x) ? a : b; it.other = it.hug === a ? b : a;
      trunks.push(it); return;
    }
    it.plan = 'channel';
  });

  // Tracks: every line gets a lane of its own beside the busier node, so
  // parallel lines never share a stretch of road. Lines whose vertical pieces
  // do not overlap may reuse a lane. Order inside a bunch is chosen so that
  // neighbouring lines do not cross each other on the way.
  const buckets = new Map();
  trunks.forEach((it) => {
    const key = `${Math.round(it.x / 8)}:${it.hug.dir}`;
    (buckets.get(key) || buckets.set(key, []).get(key)).push(it);
  });
  buckets.forEach((list) => {
    list.forEach((it) => { it.near = it.hug.y; it.far = it.other.y; it.y0 = Math.min(it.a.y, it.b.y); it.y1 = Math.max(it.a.y, it.b.y); });
    const down = list.filter((it) => it.near > it.far).sort((p, q) => p.far - q.far || p.near - q.near);
    const up = list.filter((it) => it.near < it.far).sort((p, q) => q.far - p.far || q.near - p.near);
    const flat = list.filter((it) => it.near === it.far);
    const placed = [];
    let maxLane = 0;
    down.concat(up).forEach((it) => {
      const used = new Set();
      placed.forEach((o) => { if (o.y0 < it.y1 + 6 && it.y0 < o.y1 + 6) used.add(o.lane); });
      let lane = 0; while (used.has(lane)) lane++;
      it.lane = lane; maxLane = Math.max(maxLane, lane); placed.push(it);
    });
    flat.forEach((it) => { it.lane = 0; });
    // Squeeze the tracks closer if the gap between the two nodes is small.
    let room = Infinity;
    list.forEach((it) => { if (it.plan === 'z') room = Math.min(room, Math.abs(it.other.x - it.hug.x) - S - 8); });
    const spacing = Math.max(3, Math.min(ROUTE.track, room / Math.max(1, maxLane + 1)));
    list.forEach((it) => {
      let x = it.x + it.hug.dir * it.lane * spacing;
      if (it.plan === 'z') { const lim = it.other.x - it.hug.dir * 8; x = it.hug.dir > 0 ? Math.min(x, lim) : Math.max(x, lim); }
      it.x = x;
    });
  });

  const routes = new Map();
  const chanUsed = {};
  const placedPips = [];
  items.forEach((it) => {
    const { a, b } = it;
    let pts;
    if (it.plan === 'z' || it.plan === 'u' || it.plan === 'mid') pts = [a, { x: it.x, y: a.y }, { x: it.x, y: b.y }, b];
    else {
      // lines that go through a channel keep their end pieces off the shared highways
      const ka = `${a.id}:${a.dir}`, kb = `${b.id}:${b.dir}`;
      const ia = chanUsed[ka] = (chanUsed[ka] || 0) + 1, ib = chanUsed[kb] = (chanUsed[kb] || 0) + 1;
      const xa = a.x + a.dir * (S + 44 + (ia - 1) * ROUTE.track), xb = b.x + b.dir * (S + 44 + (ib - 1) * ROUTE.track);
      const yc = findChannel(index, xa, xb, a.y, b.y, (a.y + b.y) / 2);
      pts = [a, { x: xa, y: a.y }, { x: xa, y: yc }, { x: xb, y: yc }, { x: xb, y: b.y }, b];
    }
    pts = simplify(pts);
    it.pts = pts;
  });

  // Dots on the lines (the "when" marker): in the middle of the line, nudged
  // along it until they do not sit on top of each other.
  items.forEach((it) => {
    let pip = null;
    if (it.edge.kind === 'assign' || it.edge.kind === 'presence') {
      const len = pathLength(it.pts);
      let best = len / 2;
      // prefer the middle of the longest straight piece
      let longest = 0, acc = 0;
      for (let i = 1; i < it.pts.length; i++) {
        const seg = Math.abs(it.pts[i].x - it.pts[i - 1].x) + Math.abs(it.pts[i].y - it.pts[i - 1].y);
        if (seg > longest) { longest = seg; best = acc + seg / 2; }
        acc += seg;
      }
      const tries = [0, 16, -16, 32, -32, 48, -48, 64, -64];
      for (const t of tries) {
        const d = Math.max(8, Math.min(len - 8, best + t));
        const pt = pointAlong(it.pts, d);
        if (!placedPips.some((q) => Math.abs(q.x - pt.x) < 15 && Math.abs(q.y - pt.y) < 15)) { pip = pt; break; }
      }
      if (!pip) pip = pointAlong(it.pts, best);
      placedPips.push(pip);
    }
    routes.set(it.edge.id, { pts: it.pts, d: pathData(it.pts), pip });
  });
  return routes;
}

// Plain elbow between a point and the cursor (used while dragging a new line).
function elbowPath(a, b) {
  const mx = a.x + (b.x - a.x) / 2;
  return pathData(simplify([a, { x: mx, y: a.y }, { x: mx, y: b.y }, b]));
}

const api = { questLayout, QUEST, resetOccupants, reflowLane, remapLanes, alignLanes, tidyContent, freeSlot, entityLane, cardLaneOf, OLD_LANES, PORT_ORDER, PORT_LABELS, SIZES, COLUMNS, LANE_X, LAYOUT_VERSION, ROUTE, EDGE_COLORS, edgeColor, buildGraph, neighborhood, autoLayout, placeMissing, relane, nodeSize, edgePorts, routeEdges, elbowPath, entityHeight, plainText, excerptOf, sortedCheckpoints, groupPathName };

if (typeof module !== 'undefined' && module.exports) module.exports = api;
else window.Graph = api;

})();
