// Content Graph view (Create mode, "Graph" tab).
//
// Everything on the canvas is derived from the campaign by src/graph.js; this
// file only draws it and turns gestures into the same data changes the Library
// and Content tab make (assignments, present-here lists, completion, time
// stamps). The only data it owns is layout: campaign.graph.positions.
//
// Loaded before app.js; it uses app.js's globals (ui, campaign, esc, icon,
// refresh, ...) only when called, never while loading.

const GV_ZOOM_MIN = 0.2;
const GV_ZOOM_MAX = 2;

function gv() {
  if (!ui.graph) {
    ui.graph = {
      view: { x: 30, y: 60, k: 1 }, focus: null, hops: 1, time: null, showRefs: false, libOpen: false,
      libSearch: '', libType: '', pinned: [], selected: null, note: '', undo: [], redo: [], needFit: true, newMsOpen: false,
      multi: [], lanes: true, frames: false, mini: true
    };
  }
  return ui.graph;
}

function gvStore() {
  if (!campaign.graph || typeof campaign.graph !== 'object') campaign.graph = {};
  if (!campaign.graph.positions || typeof campaign.graph.positions !== 'object') campaign.graph.positions = {};
  if (!campaign.graph.hidden || typeof campaign.graph.hidden !== 'object') campaign.graph.hidden = {};
  return campaign.graph;
}

let gvCache = null; // { graph, visible, pos }
let gvDrag = null;

// --- Data -----------------------------------------------------------------

function gvFocus(graph) {
  const g = gv();
  if (g.focus && (g.focus.kind === 'all' || graph.byId[g.focus.id])) return g.focus;
  const loc = ui.createContentLocationId && graph.byId[ui.createContentLocationId];
  if (loc) g.focus = { kind: 'node', id: loc.id };
  else {
    const first = graph.nodes.find((n) => n.kind === 'entity' && n.type === 'location') || graph.nodes.find((n) => n.kind === 'entity');
    g.focus = graph.nodes.length <= 60 || !first ? { kind: 'all' } : { kind: 'node', id: first.id };
  }
  return g.focus;
}

function gvCompute() {
  const g = gv();
  const graph = window.Graph.buildGraph(campaign);
  const store = gvStore();
  if (store.layout !== window.Graph.LAYOUT_VERSION) {
    const from = store.layout;
    store.layout = window.Graph.LAYOUT_VERSION;
    if (Object.keys(store.positions).length) {
      gvSnapshot();
      if (from >= 2 && from <= 4) {
        // Wider lanes: carry positions over, then put content beside its owner again.
        if (from <= 3) {
          window.Graph.remapLanes(graph, store.positions, from);
          window.Graph.resetOccupants(graph, store.positions);   // sub-locations get their own column
        }
        window.Graph.alignLanes(graph, store.positions);
        window.Graph.tidyContent(campaign, graph, store.positions);   // content and NPCs back beside their locations
        window.Graph.alignLanes(graph, store.positions);      // locations that sat a little beside their lane
        g.note = 'Layout updated: sub-locations have their own column, and content and NPCs that were far from their location moved back beside it. Ctrl+Z brings the old arrangement back.';
      } else {
        store.positions = window.Graph.autoLayout(campaign, graph);
        g.note = 'The layout now reads left to right in lanes (Unassigned, Location content, Locations, NPCs, NPC content). Ctrl+Z brings the old arrangement back.';
      }
      g.needFit = true;
    }
    scheduleFieldSave('graph-pos');
  }
  if (window.Graph.relane(campaign, graph, store).length) scheduleFieldSave('graph-pos');
  const added = window.Graph.placeMissing(campaign, graph, store.positions);
  const ids = Object.keys(added);
  if (ids.length) {
    ids.forEach((id) => { store.positions[id] = added[id]; });
    scheduleFieldSave('graph-pos');
  }
  const f = gvFocus(graph);
  const visible = f.kind === 'all'
    ? new Set(graph.nodes.map((n) => n.id))
    : window.Graph.neighborhood(graph, [f.id], g.hops, g.pinned);
  graph.nodes.forEach((n) => { if (n.kind === 'milestone') visible.add(n.id); });
  // A condition is shown whenever a block that depends on it is.
  graph.edges.forEach((e) => { if (e.kind === 'cond' && visible.has(e.to)) visible.add(e.from); });
  // Things the user removed from the graph stay out of it. Content that was hidden comes
  // back by itself once it is connected to something shown; content whose every
  // entity is hidden goes with them.
  const hidden = store.hidden;
  graph.nodes.forEach((n) => {
    if (n.kind === 'module' && hidden[n.id] && graph.edges.some((e) => e.kind === 'assign' && e.from === n.id && !hidden[e.to])) { delete hidden[n.id]; scheduleFieldSave('graph-pos'); }
  });
  const owners = {};
  graph.edges.forEach((e) => { if (e.kind === 'assign') (owners[e.from] = owners[e.from] || []).push(e.to); });
  graph.nodes.forEach((n) => {
    if (n.kind === 'milestone') return;
    if (hidden[n.id] || (n.kind === 'module' && owners[n.id] && owners[n.id].every((id) => hidden[id]))) visible.delete(n.id);
  });
  gvCache = { graph, visible, pos: store.positions, quest: window.Graph.questLayout(graph, store.positions) };
  return gvCache;
}

function gvSnapshot() {
  const g = gv();
  g.undo.push(JSON.stringify(campaign));
  if (g.undo.length > 40) g.undo.shift();
  g.redo = [];
}

async function gvMutate(fn) {
  gvSnapshot();
  fn();
  await refresh();
}

function gvFirstCheckpoint() {
  const cps = window.Query.sortedCheckpoints(campaign);
  return cps[0] ? cps[0].id : null;
}

function gvAllowsNoTime(type) { return type === 'note' || type === 'topic'; }

function gvDefaultTime(type) {
  const g = gv();
  if (g.time) return g.time;
  return gvAllowsNoTime(type) ? null : gvFirstCheckpoint();
}

function gvCompatible(moduleType, entity) {
  return (window.Constants.MODULE_TYPE_ENTITY_TYPES[moduleType] || []).includes(entity.type);
}

// --- Drawing ----------------------------------------------------------------

const GV_ICON_CHECK = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';

function gvNodeHTML(n, c) {
  const p = c.pos[n.id];
  const size = window.Graph.nodeSize(n);
  const g = gv();
  const sel = (g.selected === n.id ? ' sel' : '') + (g.multi.includes(n.id) ? ' multi' : '');
  const dimNode = gvNodeDimmed(n, c) ? ' dim' : '';
  const base = `data-id="${n.id}" style="left:${p.x}px;top:${p.y}px;width:${size.w}px;${n.kind === 'entity' ? '' : `height:${size.h}px;`}"`;
  if (n.kind === 'entity') {
    const e = campaign.entities[n.id];
    const rows = n.ports.map((pt) => `<div class="gv-port" data-port="${pt.key}" style="height:${window.Graph.SIZES.portH}px"><span>${esc(pt.label)}</span><b>${pt.count}</b></div>`).join('');
    const asNpc = n.type === 'npc' || n.occupant;
    return `<div class="gv-node gv-entity ${n.type}${n.occupant ? ' occ' : ''}${sel}${dimNode}" ${base}>
      <div class="gv-ehead" style="height:${window.Graph.SIZES.entityHead}px">
        ${entityBadge(e, 26)}
        <div class="gv-etext"><div class="gv-ename">${esc(n.name)}</div><div class="gv-esub">${n.type}${n.groupId ? ` · ${esc(window.Graph.groupPathName(campaign, n.groupId))}` : ''}</div></div>
        <button class="gv-mini" data-act="edit-entity" title="Open in the Entities tab">${icon('edit')}</button>
      </div>
      <button class="gv-rm" data-act="remove" title="Remove from the graph (Delete key). Nothing is deleted from your campaign.">×</button>
      ${rows}
      ${asNpc ? `<i class="gv-out gv-out-l" data-out="presence" title="Drag onto a location to place this ${n.type === 'npc' ? 'NPC' : 'location'} there"></i>` : ''}
    </div>`;
  }
  if (n.kind === 'condition') {
    const ctl = n.condKind === 'switch'
      ? `<span class="gv-cstates">${n.states.map((s) => `<button class="${s.key === n.current ? 'on' : ''}" data-act="cond-state" data-cond="${n.id}" data-key="${esc(s.key)}">${esc(s.label)}</button>`).join('')}</span>`
      : `<span class="cond-chip ${n.current ? 'set' : ''}">${esc(n.stateLabel)}</span>`;
    return `<div class="gv-node gv-cond${sel}${dimNode}" ${base}>
      <div class="gv-chead"><span class="gv-ct">${esc(window.Conditions.KIND_LABELS[n.condKind] || 'Condition')}</span><button class="gv-mini" data-act="cond-edit" title="Edit in the Conditions tab">${icon('edit')}</button></div>
      <div class="gv-cn">${esc(n.name)}</div>${ctl}
      <i class="gv-out gv-out-r" data-out="cond" title="Drag onto a content card to show that whole card only for a result"></i>
    </div>`;
  }
  if (n.kind === 'module') {
    const label = window.Constants.MODULE_TYPE_LABELS[n.type] || n.type;
    const cls = `${n.complete ? ' done' : ''}${n.inbox ? ' inbox' : ''}`;
    return `<div class="gv-node gv-card t-${n.type}${cls}${sel}${dimNode}" ${base}>
      <div class="gv-chead"><span class="gv-ct">${esc(label)}</span>${n.assignedTo > 1 ? `<span class="gv-multi" title="Assigned to ${n.assignedTo} places">×${n.assignedTo}</span>` : ''}${n.inbox ? '<span class="gv-multi inbox-tag">unassigned</span>' : ''}<button class="gv-tick" data-act="tick" title="${n.complete ? 'Resolved — click to reopen' : 'Mark as resolved'}">${n.complete ? GV_ICON_CHECK : ''}</button></div>
      <div class="gv-cn">${esc(n.name || '(untitled)')}</div>
      <div class="gv-cx">${esc(n.excerpt || '')}</div>
      <button class="gv-rm" data-act="remove" title="Remove from the graph (Delete key). It stays in the Library.">×</button>
      <i class="gv-out gv-out-l" data-out="module" title="Drag onto an entity to connect"></i><i class="gv-out gv-out-r" data-out="module" title="Drag onto an entity to connect"></i>
    </div>`;
  }
  const active = g.time === n.id ? ' active' : '';
  return `<div class="gv-node gv-ms${active}${sel}" ${base} title="Click to show only what is live at this milestone. Drag onto a line's pip to set when.">${esc(n.name)}</div>`;
}

function gvNodeDimmed(n, c) {
  const g = gv();
  if (!g.time || n.kind === 'milestone') return false;
  const mine = c.graph.edges.filter((e) => (e.kind === 'assign' || e.kind === 'presence') && (e.from === n.id || e.to === n.id) && c.visible.has(e.from) && c.visible.has(e.to));
  return mine.length > 0 && mine.every((e) => e.timeId && e.timeId !== g.time);
}

// --- Quest band ----------------------------------------------------------------------------

function gvQuestHTML(c) {
  const q = c.quest;
  if (!q || !q.bounds) return '';
  const QS = window.Graph.QUEST;
  const labels = window.Constants.MODULE_TYPE_LABELS;
  return c.graph.quests.nodes.map((n) => {
    const p = q.pos[n.id]; if (!p) return '';
    const st = `left:${p.x}px;top:${p.y}px;width:${QS.w}px;height:${QS.h}px`;
    if (n.kind === 'quest') {
      const e = campaign.entities[n.id];
      return `<div class="gv-qnode gv-quest" data-quest="${n.id}" style="${st}" title="Open this quest">${e ? entityBadge(e, 24) : ''}<div class="gv-qtext"><div class="gv-cn">${esc(n.name || '(unnamed quest)')}</div><div class="gv-esub">quest · ${n.count} item${n.count === 1 ? '' : 's'}</div></div></div>`;
    }
    return `<div class="gv-qnode gv-qitem t-${n.type}${n.complete ? ' done' : ''}" data-module="${n.moduleId}" style="${st}" title="Show this content in the graph"><span class="gv-qno">${n.index}</span><div class="gv-qtext"><div class="gv-ct">${esc(labels[n.type] || n.type)}</div><div class="gv-cn">${esc(n.name || n.excerpt || '(untitled)')}</div></div></div>`;
  }).join('');
}

function gvQuestEdges(c) {
  const q = c.quest;
  if (!q || !q.bounds) return '';
  const QS = window.Graph.QUEST;
  return c.graph.quests.edges.map((e) => {
    const a = q.pos[e.from], b = q.pos[e.to];
    if (!a || !b) return '';
    const y = a.y + QS.h / 2;
    return `<path class="gv-edge k-questchain" d="M ${b.x + QS.w} ${y} H ${a.x}"/><path class="gv-edge k-questchain" d="M ${a.x - 9} ${y - 5} L ${a.x} ${y} L ${a.x - 9} ${y + 5}" style="fill:none"/>`;
  }).join('');
}

function gvQuestUnder(c) {
  const q = c.quest;
  if (!q || !q.bounds) return '';
  const b = q.bounds;
  return `<div class="gv-qband" style="left:${b.x0 - 24}px;top:${b.y0 - 34}px;width:${b.x1 - b.x0 + 48}px;height:${b.y1 - b.y0 + 58}px"><span>Quests — content runs right to left in rising order (1, 2, 3 …)</span></div>`;
}

function gvDrawEdges() {
  const svg = document.getElementById('gv-edges');
  if (!svg || !gvCache) return;
  const c = gvCache;
  const g = gv();
  const edges = c.graph.edges.filter((e) => c.visible.has(e.from) && c.visible.has(e.to)
    && !(e.kind === 'ref' && !(g.showRefs || g.selected === e.from || g.selected === e.to)));
  // Milestones are small markers, not obstacles: lines may pass beside them and dragging one must not move the lines under it.
  const nodeIds = c.graph.nodes.filter((n) => c.visible.has(n.id) && n.kind !== 'milestone').map((n) => n.id);
  const routes = window.Graph.routeEdges(c.graph, c.pos, edges, nodeIds);
  let paths = '', pips = '';
  edges.forEach((e) => {
    const r = routes.get(e.id);
    if (!r) return;
    const dim = (e.kind === 'assign' || e.kind === 'presence') && g.time && e.timeId && e.timeId !== g.time;
    const hl = g.selected && (e.from === g.selected || e.to === g.selected);
    const colour = window.Graph.edgeColor(e);
    const cv = colour ? ` style="--c:${colour}"` : '';
    paths += `<path class="gv-edge k-${e.kind}${dim ? ' dim' : ''}${hl ? ' hl' : ''}"${cv} d="${r.d}"/>`;
    if (r.pip) {
      const cp = e.timeId ? c.graph.byId[e.timeId] : null;
      pips += `<g class="gv-pip${cp ? ' timed' : ''}${dim ? ' dim' : ''}${hl ? ' hl' : ''}" data-edge="${e.id}" ${cv} transform="translate(${r.pip.x} ${r.pip.y})"><title>${cp ? esc(cp.name) : 'Always'} — click to change</title><circle r="${cp ? 7 : 5}"/>${cp ? `<text y="-11" text-anchor="middle">${esc(cp.name)}</text>` : ''}</g>`;
    }
  });
  paths += gvQuestEdges(c);
  svg.innerHTML = `<g class="gv-edge-layer">${paths}</g><path id="gv-ghost" class="gv-ghost" d=""/>`;
  const pipSvg = document.getElementById('gv-pips');
  if (pipSvg) pipSvg.innerHTML = pips;
}

let gvEdgeFrame = 0;
function gvDrawEdgesSoon() {
  if (gvEdgeFrame) return;
  gvEdgeFrame = requestAnimationFrame(() => { gvEdgeFrame = 0; gvDrawEdges(); gvMiniDraw(); });
}

// Lane bands and group frames sit under the lines.
function gvUnderHTML(c) {
  const g = gv();
  const nodes = c.graph.nodes.filter((n) => c.visible.has(n.id) && n.kind !== 'milestone');
  if (!nodes.length) return '';
  let html = gvQuestUnder(c);
  let y0 = Infinity, y1 = -Infinity;
  nodes.forEach((n) => { const p = c.pos[n.id]; const s = window.Graph.nodeSize(n); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y + s.h); });
  if (g.lanes) {
    window.Graph.COLUMNS.forEach((col) => {
      if (!nodes.some((n) => Math.abs(c.pos[n.id].x - col.x) < 80)) return;
      html += `<div class="gv-lane" style="left:${col.x - 14}px;top:${y0 - 44}px;width:${col.w + 28}px;height:${y1 - y0 + 88}px"><span>${esc(col.label)}</span></div>`;
    });
  }
  if (g.frames) {
    const groups = campaign.entityGroups || [];
    const kids = {};
    groups.forEach((gr) => { (kids[gr.parentId || ''] = kids[gr.parentId || ''] || []).push(gr.id); });
    const members = {};
    const collect = (gid) => {
      if (members[gid]) return members[gid];
      const own = nodes.filter((n) => n.kind === 'entity' && n.groupId === gid).map((n) => n.id);
      members[gid] = own.concat((kids[gid] || []).flatMap(collect));
      return members[gid];
    };
    const depth = (gid) => 1 + Math.max(0, ...(kids[gid] || []).filter((k) => collect(k).length).map(depth));
    const frames = [];
    groups.forEach((gr) => {
      const ids = collect(gr.id);
      if (!ids.length) return;
      let x0 = Infinity, yy0 = Infinity, x1 = -Infinity, yy1 = -Infinity;
      ids.forEach((id) => { const p = c.pos[id]; const s = window.Graph.nodeSize(c.graph.byId[id]); x0 = Math.min(x0, p.x); yy0 = Math.min(yy0, p.y); x1 = Math.max(x1, p.x + s.w); yy1 = Math.max(yy1, p.y + s.h); });
      const pad = 12 + 10 * (depth(gr.id) - 1);
      frames.push({ id: gr.id, name: gr.name, x: x0 - pad, y: yy0 - pad - 20, w: x1 - x0 + pad * 2, h: yy1 - yy0 + pad * 2 + 20, area: (x1 - x0) * (yy1 - yy0) });
    });
    frames.sort((p, q) => q.area - p.area).forEach((f) => {
      html += `<div class="gv-frame" style="left:${f.x}px;top:${f.y}px;width:${f.w}px;height:${f.h}px"><div class="gv-frame-label" data-frame="${f.id}" title="Drag to move everything inside">${esc(f.name)}</div></div>`;
    });
  }
  return html;
}

// --- Minimap ----------------------------------------------------------------------

let gvMiniMap = null;

function gvMiniDraw() {
  const el = document.getElementById('gv-mini');
  if (!el) return;
  const g = gv();
  if (!g.mini || !gvCache) { el.style.display = 'none'; return; }
  const c = gvCache;
  const nodes = c.graph.nodes.filter((n) => c.visible.has(n.id) && !(n.kind === 'milestone' && g.focus && g.focus.kind !== 'all'));
  if (!nodes.length) { el.style.display = 'none'; return; }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  nodes.forEach((n) => { const p = c.pos[n.id]; const s = window.Graph.nodeSize(n); x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + s.w); y1 = Math.max(y1, p.y + s.h); });
  const pad = 60;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  gvMiniMap = { x0, y0, w: x1 - x0, h: y1 - y0 };
  el.style.display = 'block';
  const colour = (n) => (n.kind === 'entity' ? (n.type === 'location' ? '#d98a4e' : '#4eb6a2') : n.kind === 'milestone' ? '#8f7bd1' : (n.complete ? '#555' : '#7a8aa6'));
  const rects = nodes.slice(0, 3000).map((n) => { const p = c.pos[n.id]; const s = window.Graph.nodeSize(n); return `<rect x="${p.x}" y="${p.y}" width="${s.w}" height="${s.h}" fill="${colour(n)}"/>`; }).join('');
  el.innerHTML = `<svg viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" preserveAspectRatio="xMidYMid meet" width="100%" height="100%">${rects}<rect id="gv-mini-view" fill="rgba(255,255,255,.08)" stroke="#fff" stroke-width="${Math.max(2, (x1 - x0) / 120)}"/></svg>`;
  gvMiniView();
}

function gvMiniView() {
  const r = document.getElementById('gv-mini-view');
  const vp = document.getElementById('gv-viewport');
  if (!r || !vp) return;
  const v = gv().view;
  const b = vp.getBoundingClientRect();
  r.setAttribute('x', -v.x / v.k); r.setAttribute('y', -v.y / v.k);
  r.setAttribute('width', b.width / v.k); r.setAttribute('height', b.height / v.k);
}

function gvMiniTo(ev) {
  const svg = document.querySelector('#gv-mini svg');
  const vp = document.getElementById('gv-viewport');
  if (!svg || !vp || !gvMiniMap) return;
  const r = svg.getBoundingClientRect();
  const m = gvMiniMap;
  const scale = Math.min(r.width / m.w, r.height / m.h);
  const offX = (r.width - m.w * scale) / 2, offY = (r.height - m.h * scale) / 2;
  const wx = m.x0 + (ev.clientX - r.left - offX) / scale;
  const wy = m.y0 + (ev.clientY - r.top - offY) / scale;
  const b = vp.getBoundingClientRect();
  const v = gv().view;
  v.x = b.width / 2 - wx * v.k; v.y = b.height / 2 - wy * v.k;
  gvApplyView();
}

function gvApplyView() {
  const w = document.getElementById('gv-world');
  if (!w) return;
  const v = gv().view;
  w.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`;
  w.classList.toggle('gv-far', v.k < 0.55);
  w.classList.toggle('gv-farther', v.k < 0.35);
  gvMiniView();
}

function gvDraw() {
  const nodesEl = document.getElementById('gv-nodes');
  if (!nodesEl) return;
  const c = gvCompute();
  nodesEl.innerHTML = c.graph.nodes.filter((n) => c.visible.has(n.id)).map((n) => gvNodeHTML(n, c)).join('') + gvQuestHTML(c);
  const under = document.getElementById('gv-under');
  if (under) under.innerHTML = gvUnderHTML(c);
  gvDrawEdges();
  if (gv().needFit) { gv().needFit = false; gvFit(); } else gvApplyView();
  gvMiniDraw();
  gvSelectionBar();
  const cnt = document.getElementById('gv-count');
  if (cnt) cnt.textContent = `${c.graph.nodes.filter((n) => c.visible.has(n.id) && n.kind !== 'milestone').length} of ${c.graph.nodes.filter((n) => n.kind !== 'milestone').length} shown`;
}

function gvFit() {
  const vp = document.getElementById('gv-viewport');
  if (!vp || !gvCache) return;
  const nodes = gvCache.graph.nodes.filter((n) => gvCache.visible.has(n.id) && !(n.kind === 'milestone' && gv().focus && gv().focus.kind !== 'all'));
  if (!nodes.length) return;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  nodes.forEach((n) => {
    const p = gvCache.pos[n.id]; const s = window.Graph.nodeSize(n);
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + s.w); y1 = Math.max(y1, p.y + s.h);
  });
  const qb = gvCache.quest && gvCache.quest.bounds;
  if (qb) { x0 = Math.min(x0, qb.x0); y0 = Math.min(y0, qb.y0 - 60); x1 = Math.max(x1, qb.x1); y1 = Math.max(y1, qb.y1); }
  const r = vp.getBoundingClientRect();
  const pad = 40;
  const k = Math.max(GV_ZOOM_MIN, Math.min(1, (r.width - pad * 2) / (x1 - x0), (r.height - pad * 2) / (y1 - y0)));
  const v = gv().view;
  v.k = k;
  v.x = (r.width - (x1 - x0) * k) / 2 - x0 * k;
  v.y = Math.max(pad / 2, (r.height - (y1 - y0) * k) / 2) - y0 * k;
  gvApplyView();
}

// --- Tab ---------------------------------------------------------------------

function gvFocusOptionsHTML(graph, focus) {
  const opt = (v, label, sel) => `<option value="${v}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  const ents = graph.nodes.filter((n) => n.kind === 'entity').sort((a, b) => a.name.localeCompare(b.name));
  const group = (label, list) => (list.length ? `<optgroup label="${label}">${list.map((n) => opt(`n:${n.id}`, n.name, focus.kind === 'node' && focus.id === n.id)).join('')}</optgroup>` : '');
  return opt('all', 'Whole campaign', focus.kind === 'all')
    + group('Locations', ents.filter((n) => n.type === 'location'))
    + group('NPCs', ents.filter((n) => n.type === 'npc'))
    + group('Milestones', graph.nodes.filter((n) => n.kind === 'milestone'));
}

function renderGraphTab() {
  const body = document.getElementById('create-body');
  body.style.padding = '0';
  const g = gv();
  const graph = window.Graph.buildGraph(campaign, { includeRefs: false });
  const focus = gvFocus(graph);
  const cps = window.Query.sortedCheckpoints(campaign);
  body.innerHTML = `
    <div class="gv-wrap">
      <div class="gv-toolbar">
        <label>Show <select id="gv-focus" onchange="window.app.gvSetFocus(this.value)">${gvFocusOptionsHTML(graph, focus)}</select></label>
        <label>Reach <select onchange="window.app.gvSetHops(this.value)" ${focus.kind === 'all' ? 'disabled' : ''}><option value="1" ${g.hops === 1 ? 'selected' : ''}>1 step</option><option value="2" ${g.hops === 2 ? 'selected' : ''}>2 steps</option><option value="3" ${g.hops === 3 ? 'selected' : ''}>3 steps</option></select></label>
        <label>Time <select id="gv-time" onchange="window.app.gvSetTime(this.value)"><option value="">Any time</option>${cps.map((cp) => `<option value="${cp.id}" ${g.time === cp.id ? 'selected' : ''}>${esc(cp.label)}</option>`).join('')}</select></label>
        <button class="icon-btn" ${ui.curTime ? '' : 'disabled'} title="Show what is live at the milestone the Play tab is on" onclick="window.app.gvPlayTime()">${icon('clock')} Play time</button>
        <label class="gv-check"><input type="checkbox" ${g.showRefs ? 'checked' : ''} onchange="window.app.gvToggleRefs(this.checked)"> Mentions</label>
        <label class="gv-check"><input type="checkbox" ${g.lanes ? 'checked' : ''} onchange="window.app.gvToggleOpt('lanes',this.checked)"> Lanes</label>
        <label class="gv-check"><input type="checkbox" ${g.frames ? 'checked' : ''} onchange="window.app.gvToggleOpt('frames',this.checked)"> Groups</label>
        <label class="gv-check" title="Locations that are present inside another location stand in their own column right of the Locations lane. Switch off to keep every location in the Locations lane."><input type="checkbox" ${campaign.graph.subLocations === false ? '' : 'checked'} onchange="window.app.gvToggleSubLoc(this.checked)"> Sub-location column</label>
        <label class="gv-check"><input type="checkbox" ${g.mini ? 'checked' : ''} onchange="window.app.gvToggleOpt('mini',this.checked)"> Map</label>
        <span class="gv-sep"></span>
        <button class="icon-btn" onclick="window.app.gvToggleLib()">${icon('search')} ${g.libOpen ? 'Hide' : 'Library'}</button>
        <button class="icon-btn" onclick="window.app.gvFit()">${icon('maximize')} Fit</button>
        <button class="icon-btn" onclick="window.app.gvAutoLayout()">Auto-layout</button>
        <button class="icon-btn" onclick="window.app.gvTidy()" title="Move content that is far from its location back beside it, and put locations back on their lane">Tidy</button>
        <button class="icon-btn" ${g.undo.length ? '' : 'disabled'} onclick="window.app.gvUndo()" title="Ctrl+Z">${icon('arrowLeft')} Undo</button>
        <button class="icon-btn" ${(g.redo || []).length ? '' : 'disabled'} onclick="window.app.gvRedo()" title="Ctrl+Shift+Z">Redo ${icon('arrowRight')}</button>
        ${g.newMsOpen
          ? `<input type="text" id="gv-newms" placeholder="Milestone name, Enter" style="width:150px" onkeydown="if(event.key==='Enter')window.app.gvCreateMilestone(this.value);else if(event.key==='Escape')window.app.gvToggleNewMs()">`
          : `<button class="icon-btn" onclick="window.app.gvToggleNewMs()">${icon('plus')} Milestone</button>`}
        <span class="gv-count" id="gv-count"></span>
      </div>
      <div class="gv-note" id="gv-note">${esc(g.note || 'Double-click empty space to create content · drag from a card’s dots onto an entity to connect · click a card to edit it · click the dot on a line to set when · Shift-drag to select several.')}</div>
      <div class="gv-selbar" id="gv-selbar" style="display:none"></div>
      <div class="gv-main">
        ${g.libOpen ? '<div class="gv-lib" id="gv-lib"></div>' : ''}
        <div class="gv-viewport" id="gv-viewport">
          <div class="gv-world" id="gv-world"><div id="gv-under"></div><svg id="gv-edges" class="gv-edges" width="1" height="1"></svg><div id="gv-nodes"></div><svg id="gv-pips" class="gv-edges gv-pips" width="1" height="1"></svg></div>
          <div id="gv-lasso" class="gv-lasso" style="display:none"></div>
          <div id="gv-confirm" class="gv-confirm" style="display:none"></div>
          <div id="gv-mini" class="gv-mini-map" style="display:none"></div>
          <div id="gv-menu" class="gv-menu" style="display:none"></div>
        </div>
      </div>
    </div>`;
  gvDraw();
  if (g.libOpen) gvRenderLib();
  gvWireViewport();
  if (g.newMsOpen) { const i = document.getElementById('gv-newms'); if (i) i.focus(); }
}

// --- Viewport gestures --------------------------------------------------------------

function gvWorldPoint(ev) {
  const r = document.getElementById('gv-viewport').getBoundingClientRect();
  const v = gv().view;
  return { x: (ev.clientX - r.left - v.x) / v.k, y: (ev.clientY - r.top - v.y) / v.k };
}

function gvCloseMenu() {
  const m = document.getElementById('gv-menu');
  if (m) { m.style.display = 'none'; m.innerHTML = ''; }
}

function gvShowMenu(ev, html) {
  const vp = document.getElementById('gv-viewport');
  const m = document.getElementById('gv-menu');
  const r = vp.getBoundingClientRect();
  m.innerHTML = html;
  m.style.display = 'block';
  const x = Math.min(ev.clientX - r.left, r.width - m.offsetWidth - 8);
  const y = Math.min(ev.clientY - r.top, r.height - m.offsetHeight - 8);
  m.style.left = `${Math.max(4, x)}px`;
  m.style.top = `${Math.max(4, y)}px`;
}

function gvSetNote(text) {
  gv().note = text;
  const el = document.getElementById('gv-note');
  if (el) el.textContent = text;
}

function gvWireViewport() {
  const vp = document.getElementById('gv-viewport');
  if (!vp) return;
  vp.addEventListener('pointerdown', gvPointerDown);
  vp.addEventListener('wheel', gvWheel, { passive: false });
  vp.addEventListener('dblclick', gvDblClick);
  vp.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('text/gv-node')) e.preventDefault(); });
  vp.addEventListener('drop', gvLibDrop);
}

function gvWheel(ev) {
  ev.preventDefault();
  const vp = document.getElementById('gv-viewport');
  const r = vp.getBoundingClientRect();
  const v = gv().view;
  const factor = Math.exp(-ev.deltaY * 0.0015);
  const k = Math.max(GV_ZOOM_MIN, Math.min(GV_ZOOM_MAX, v.k * factor));
  const px = ev.clientX - r.left, py = ev.clientY - r.top;
  v.x = px - (px - v.x) * (k / v.k);
  v.y = py - (py - v.y) * (k / v.k);
  v.k = k;
  gvApplyView();
}

function gvPointerDown(ev) {
  if (ev.button !== 0) return;
  if (ev.target.closest('#gv-confirm')) return;
  const menu = ev.target.closest('#gv-menu');
  if (!menu) gvCloseMenu(); else return;
  const t = ev.target;
  const g = gv();

  const pip = t.closest('.gv-pip');
  if (pip) { gvOpenPipMenu(ev, pip.dataset.edge); ev.preventDefault(); return; }

  const qn = t.closest('.gv-qnode');
  if (qn) {
    ev.preventDefault();
    if (qn.dataset.module) window.app.gvReveal(qn.dataset.module); else if (qn.dataset.quest) gvOpenEntity(qn.dataset.quest);
    return;
  }

  if (t.closest('#gv-mini')) { gvDrag = { kind: 'mini' }; gvMiniTo(ev); ev.preventDefault(); gvTrack(ev); return; }

  const frameLabel = t.closest('.gv-frame-label');
  if (frameLabel) {
    const ids = gvFrameMembers(frameLabel.dataset.frame);
    gvDrag = { kind: 'group', ids, starts: ids.map((id) => ({ id, x: gvCache.pos[id].x, y: gvCache.pos[id].y })), sx: ev.clientX, sy: ev.clientY, moved: false };
    ev.preventDefault(); gvTrack(ev); return;
  }

  const out = t.closest('.gv-out');
  if (out) {
    const nodeEl = out.closest('.gv-node');
    gvDrag = { kind: 'connect', outKind: out.dataset.out, id: nodeEl.dataset.id, sx: ev.clientX, sy: ev.clientY, moved: false };
    gvMarkTargets(gvDrag);
    ev.preventDefault();
    gvTrack(ev);
    return;
  }
  const rm = t.closest('[data-act="remove"]');
  if (rm) { const id = rm.closest('.gv-node').dataset.id; ev.preventDefault(); gvRemoveFromGraph(g.multi.includes(id) ? g.multi : [id]); return; }
  const tick = t.closest('[data-act="tick"]');
  if (tick) { const id = tick.closest('.gv-node').dataset.id; ev.preventDefault(); gvToggleDone(id); return; }
  const condState = t.closest('[data-act="cond-state"]');
  if (condState) { ev.preventDefault(); window.app.condSetState(condState.dataset.cond, condState.dataset.key); return; }
  const condEdit = t.closest('[data-act="cond-edit"]');
  if (condEdit) { ev.preventDefault(); ui.createTab = 'conditions'; renderAll(); return; }
  const editBtn = t.closest('[data-act="edit-entity"]');
  if (editBtn) { const id = editBtn.closest('.gv-node').dataset.id; ev.preventDefault(); gvOpenEntity(id); return; }

  const nodeEl = t.closest('.gv-node');
  if (nodeEl) {
    const id = nodeEl.dataset.id;
    const p = gvCache.pos[id];
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) { // add to / remove from the selection, do not open
      g.multi = g.multi.includes(id) ? g.multi.filter((x) => x !== id) : [...g.multi, id];
      ev.preventDefault();
      gvDraw();
      return;
    }
    // Dragging a node that belongs to the selection moves the whole selection.
    const group = g.multi.includes(id) && g.multi.length > 1 ? g.multi.filter((x) => gvCache.pos[x]).map((x) => ({ id: x, x: gvCache.pos[x].x, y: gvCache.pos[x].y })) : null;
    gvDrag = { kind: 'node', id, el: nodeEl, ox: p.x, oy: p.y, group, sx: ev.clientX, sy: ev.clientY, moved: false };
    ev.preventDefault();
    gvTrack(ev);
    return;
  }
  if (t.closest('#gv-viewport') && ev.shiftKey) {
    const r = document.getElementById('gv-viewport').getBoundingClientRect();
    gvDrag = { kind: 'lasso', sx: ev.clientX, sy: ev.clientY, left: r.left, top: r.top, moved: false, add: ev.ctrlKey || ev.metaKey };
    ev.preventDefault();
    gvTrack(ev);
    return;
  }
  if (t.closest('#gv-viewport')) {
    const v = g.view;
    gvDrag = { kind: 'pan', ox: v.x, oy: v.y, sx: ev.clientX, sy: ev.clientY, moved: false };
    ev.preventDefault();
    gvTrack(ev);
  }
}

function gvTrack(ev) {
  const move = (e) => gvPointerMove(e);
  const up = (e) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); gvPointerUp(e); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function gvSnapX(node, x) {
  const cols = window.Graph.COLUMNS;
  let keys;
  if (node.kind === 'entity') keys = [node.type === 'location' ? (node.occupant ? 'sub' : 'loc') : 'npc'];
  else if (node.kind === 'module') keys = ['inbox', 'locCard', 'npcCard'];
  else return x;
  for (const col of cols) if (keys.includes(col.key) && Math.abs(x - col.x) <= (node.kind === 'entity' ? 60 : 24)) return col.x;
  return x;
}

function gvPointerMove(ev) {
  const d = gvDrag;
  if (!d) return;
  if (d.kind === 'mini') { gvMiniTo(ev); return; }
  const dx = ev.clientX - d.sx, dy = ev.clientY - d.sy;
  if (!d.moved && Math.hypot(dx, dy) < 4) return;
  d.moved = true;
  if ((d.kind === 'node' || d.kind === 'group') && !d.snapped) { d.snapped = true; gvSnapshot(); }   // moving things can be undone
  const v = gv().view;
  if (d.kind === 'pan') { v.x = d.ox + dx; v.y = d.oy + dy; gvApplyView(); }
  else if (d.kind === 'lasso') {
    const el = document.getElementById('gv-lasso');
    const x0 = Math.min(d.sx, ev.clientX) - d.left, y0 = Math.min(d.sy, ev.clientY) - d.top;
    el.style.display = 'block';
    el.style.left = `${x0}px`; el.style.top = `${y0}px`;
    el.style.width = `${Math.abs(dx)}px`; el.style.height = `${Math.abs(dy)}px`;
  } else if (d.kind === 'group') {
    d.starts.forEach((s0) => {
      const x = Math.round(s0.x + dx / v.k), y = Math.round(s0.y + dy / v.k);
      gvCache.pos[s0.id] = { x, y };
      const el = document.querySelector(`#gv-nodes .gv-node[data-id="${s0.id}"]`);
      if (el) { el.style.left = `${x}px`; el.style.top = `${y}px`; }
    });
    gvDrawEdgesSoon();
  } else if (d.kind === 'node') {
    let x = Math.round(d.ox + dx / v.k), y = Math.round(d.oy + dy / v.k);
    if (!ev.altKey && !d.group) { x = gvSnapX(gvCache.graph.byId[d.id], x); y = Math.round(y / 10) * 10; }
    const ddx = x - d.ox, ddy = y - d.oy;
    (d.group || [{ id: d.id, x: d.ox, y: d.oy }]).forEach((s0) => {
      const nx = s0.x + ddx, ny = s0.y + ddy;
      gvCache.pos[s0.id] = { x: nx, y: ny };
      const el = s0.id === d.id ? d.el : document.querySelector(`#gv-nodes .gv-node[data-id="${s0.id}"]`);
      if (el) { el.style.left = `${nx}px`; el.style.top = `${ny}px`; el.classList.add('dragging'); }
    });
    gvDrawEdgesSoon();
  } else if (d.kind === 'connect') {
    const ghost = document.getElementById('gv-ghost');
    const n = gvCache.graph.byId[d.id];
    const p = gvCache.pos[d.id];
    const sz = window.Graph.nodeSize(n);
    const w = gvWorldPoint(ev);
    const start = n.kind === 'entity' ? { x: p.x, y: p.y + window.Graph.SIZES.entityHead / 2 } : { x: w.x < p.x + sz.w / 2 ? p.x : p.x + sz.w, y: p.y + sz.h / 2 };
    if (ghost) ghost.setAttribute('d', window.Graph.elbowPath(start, w));
    document.querySelectorAll('.gv-node.gv-over').forEach((el) => el.classList.remove('gv-over'));
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const tn = hit && hit.closest('.gv-entity');
    if (tn && tn.classList.contains('gv-ok')) tn.classList.add('gv-over');
  }
}

function gvClearTargets() {
  document.querySelectorAll('.gv-ok,.gv-over,.gv-no').forEach((el) => el.classList.remove('gv-ok', 'gv-over', 'gv-no'));
  const ghost = document.getElementById('gv-ghost');
  if (ghost) ghost.setAttribute('d', '');
}

function gvMarkTargets(d) {
  const n = gvCache.graph.byId[d.id];
  if (d.outKind === 'cond') {
    document.querySelectorAll('.gv-card').forEach((el) => el.classList.add('gv-ok'));
    document.querySelectorAll('.gv-entity').forEach((el) => el.classList.add('gv-no'));
    return;
  }
  document.querySelectorAll('.gv-entity').forEach((el) => {
    const t = campaign.entities[el.dataset.id];
    const ok = t && (d.outKind === 'presence' ? (t.type === 'location' && t.id !== d.id) : gvCompatible(n.type, t));
    el.classList.add(ok ? 'gv-ok' : 'gv-no');
  });
}

async function gvPointerUp(ev) {
  const d = gvDrag;
  gvDrag = null;
  if (!d) return;
  if (d.kind === 'mini') return;
  if (d.kind === 'pan') {
    if (!d.moved && (gv().selected || gv().multi.length)) { gv().selected = null; gv().multi = []; gvDraw(); }
    return;
  }
  if (d.kind === 'lasso') {
    const el = document.getElementById('gv-lasso');
    if (el) el.style.display = 'none';
    if (!d.moved) return;
    const v = gv().view;
    const w0 = { x: (Math.min(d.sx, ev.clientX) - d.left - v.x) / v.k, y: (Math.min(d.sy, ev.clientY) - d.top - v.y) / v.k };
    const w1 = { x: (Math.max(d.sx, ev.clientX) - d.left - v.x) / v.k, y: (Math.max(d.sy, ev.clientY) - d.top - v.y) / v.k };
    const hit = gvCache.graph.nodes.filter((n) => {
      if (!gvCache.visible.has(n.id) || n.kind === 'milestone') return false;
      const p = gvCache.pos[n.id]; const s = window.Graph.nodeSize(n);
      return p.x < w1.x && p.x + s.w > w0.x && p.y < w1.y && p.y + s.h > w0.y;
    }).map((n) => n.id);
    gv().multi = d.add ? Array.from(new Set([...gv().multi, ...hit])) : hit;
    gv().selected = null;
    gvDraw();
    return;
  }
  if (d.kind === 'group') {
    if (d.moved) { d.ids.forEach((id) => { gvStore().positions[id] = gvCache.pos[id]; }); scheduleFieldSave('graph-pos'); gvDraw(); }
    return;
  }
  if (d.kind === 'connect') {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    const tn = hit && hit.closest(d.outKind === 'cond' ? '.gv-card' : '.gv-entity');
    const ok = tn && tn.classList.contains('gv-ok');
    gvClearTargets();
    if (!d.moved || !ok) return;
    if (d.outKind === 'cond') { condPickStatesForCard(ev, d.id, tn.dataset.id); return; }
    if (d.outKind === 'presence') await gvPlace(d.id, tn.dataset.id);
    else await gvConnect(d.id, tn.dataset.id);
    return;
  }
  if (d.kind === 'node') {
    document.querySelectorAll('.gv-node.dragging').forEach((el) => el.classList.remove('dragging'));
    const node = gvCache.graph.byId[d.id];
    if (d.moved) {
      (d.group || [{ id: d.id }]).forEach((s0) => { gvStore().positions[s0.id] = gvCache.pos[s0.id]; });
      gvDrawEdges(); gvMiniDraw();
      scheduleFieldSave('graph-pos');
      if (node.kind === 'milestone') {
        const els = document.elementsFromPoint(ev.clientX, ev.clientY);
        const pip = els.find((el) => el.classList && el.classList.contains('gv-pip')) || els.map((el) => el.closest && el.closest('.gv-pip')).find(Boolean);
        if (pip) await gvSetEdgeTime(pip.dataset.edge, d.id);
      }
      return;
    }
    // A click.
    if (node.kind === 'module') { gv().selected = d.id; gvDraw(); window.app.gvOpenContent(d.id); }
    else if (node.kind === 'milestone') { gv().time = gv().time === d.id ? null : d.id; gv().selected = null; renderGraphTab(); }
    else { gv().selected = d.id; gvDraw(); window.app.gvOpenEntityWin(d.id); }
  }
}

function gvFrameMembers(groupId) {
  const c = gvCache;
  const groups = campaign.entityGroups || [];
  const inGroup = (gid) => gid === groupId || (groups.find((x) => x.id === gid) && groups.find((x) => x.id === gid).parentId && inGroup(groups.find((x) => x.id === gid).parentId));
  const ents = c.graph.nodes.filter((n) => n.kind === 'entity' && c.visible.has(n.id) && n.groupId && inGroup(n.groupId)).map((n) => n.id);
  const set = new Set(ents);
  // content that only belongs to these entities moves with them
  const owners = {};
  c.graph.edges.filter((e) => e.kind === 'assign').forEach((e) => { (owners[e.from] = owners[e.from] || []).push(e.to); });
  const cards = Object.keys(owners).filter((m) => c.visible.has(m) && owners[m].every((o) => set.has(o)));
  return ents.concat(cards);
}

function gvSelectionBar() {
  const el = document.getElementById('gv-selbar');
  if (!el) return;
  const g = gv();
  const ids = g.multi.filter((id) => gvCache && gvCache.graph.byId[id]);
  if (!ids.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
  const ents = ids.filter((id) => gvCache.graph.byId[id].kind === 'entity');
  el.style.display = 'flex';
  el.innerHTML = `<b>${ids.length} selected</b><span class="hint" style="margin:0">${ents.length} NPC/location${ents.length === 1 ? '' : 's'} · drag one to move them all · Shift-click adds or removes</span><span style="flex:1"></span>
    <button class="icon-btn" ${ents.length ? '' : 'disabled'} title="${ents.length ? 'Copy the selected NPCs and locations to another campaign' : 'Select at least one NPC or location'}" onclick="window.app.gvTransferSelection()">${icon('chevronRight')} Transfer to other campaign…</button>
    <button class="icon-btn" title="Takes them out of the graph. Nothing is deleted from your campaign." onclick="window.app.gvRemoveSelection()">${icon('trash')} Remove from graph</button>
    <button class="icon-btn" onclick="window.app.gvClearSelection()">Clear</button>`;
}

// --- Removing things from the graph ---------------------------------------------------------
// Never deletes content from the campaign. A card is disconnected from what it was
// attached to (so it is gone from there in Play too) and parked in the Library; an
// entity is only hidden from the canvas. Both can be brought back from the Library panel.

function gvRemovalPlan(ids) {
  const c = gvCache;
  const plan = { modules: [], entities: [], connected: [] };
  ids.forEach((id) => {
    const n = c.graph.byId[id];
    if (!n || n.kind === 'milestone') return;
    if (n.kind === 'entity') { plan.entities.push({ id, name: n.name }); return; }
    plan.modules.push({ id, name: n.name || '(untitled)' });
    const links = c.graph.edges.filter((e) => e.kind === 'assign' && e.from === id).map((e) => (c.graph.byId[e.to] ? c.graph.byId[e.to].name : '')).filter(Boolean);
    if (links.length) plan.connected.push({ id, name: n.name || '(untitled)', links: Array.from(new Set(links)) });
  });
  return plan;
}

function gvConfirm(html, yesLabel, onYes) {
  const el = document.getElementById('gv-confirm');
  if (!el) { onYes(); return; }
  el.innerHTML = `<div class="gv-confirm-box">${html}<div class="gv-confirm-btns"><button class="icon-btn danger" id="gv-confirm-yes">${esc(yesLabel)}</button><button class="icon-btn" id="gv-confirm-no">Cancel</button></div></div>`;
  el.style.display = 'flex';
  document.getElementById('gv-confirm-yes').onclick = () => { gvCloseConfirm(); onYes(); };
  document.getElementById('gv-confirm-no').onclick = gvCloseConfirm;
}

function gvCloseConfirm() {
  const el = document.getElementById('gv-confirm');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

function gvConfirmOpen() {
  const el = document.getElementById('gv-confirm');
  return !!el && el.style.display !== 'none';
}

async function gvRemoveFromGraph(ids) {
  if (!gvCache) return;
  const plan = gvRemovalPlan(ids);
  if (!plan.modules.length && !plan.entities.length) return;
  const go = () => gvDoRemove(plan);
  if (!plan.connected.length) { await go(); return; }
  const lines = plan.connected.slice(0, 5).map((m) => `<li><b>${esc(m.name)}</b> is connected to ${m.links.map((x) => esc(x)).join(', ')}</li>`).join('');
  const more = plan.connected.length > 5 ? `<li>…and ${plan.connected.length - 5} more</li>` : '';
  gvConfirm(`<p><b>Remove from the graph?</b></p><ul class="gv-confirm-list">${lines}${more}</ul>
    <p class="hint" style="margin:6px 0 0">This disconnects ${plan.connected.length === 1 ? 'it' : 'them'} from ${plan.connected.length === 1 ? 'that' : 'those'} entit${plan.connected.length === 1 && plan.connected[0].links.length === 1 ? 'y' : 'ies'}, so the content no longer shows there, in Play either. It is <b>not</b> deleted: it stays in the Library, and you can connect it again. (Ctrl+Z undoes this.)</p>`, 'Remove from graph', go);
}

async function gvDoRemove(plan) {
  gvSnapshot();
  const store = gvStore();
  plan.modules.forEach((m) => {
    campaign.assignments.filter((a) => a.moduleId === m.id).map((a) => a.id).forEach((aid) => window.DataModel.deleteAssignment(campaign, aid));
    store.hidden[m.id] = true;
  });
  plan.entities.forEach((e) => { store.hidden[e.id] = true; });
  const g = gv();
  const gone = new Set([...plan.modules, ...plan.entities].map((x) => x.id));
  g.multi = g.multi.filter((id) => !gone.has(id));
  if (gone.has(g.selected)) g.selected = null;
  if (gone.has(ui.gvWinModuleId)) ui.gvWinModuleId = null;
  if (gone.has(ui.gvWinEntityId)) ui.gvWinEntityId = null;
  const parts = [];
  if (plan.modules.length) parts.push(`${plan.modules.length} content block${plan.modules.length === 1 ? '' : 's'} (still in the Library)`);
  if (plan.entities.length) parts.push(`${plan.entities.map((e) => e.name).join(', ')} (hidden from the graph only; its content stays connected)`);
  g.note = `Removed from the graph: ${parts.join(' and ')}. Bring things back from Library → "Hidden from graph". Ctrl+Z undoes.`;
  scheduleFieldSave('graph-pos');
  await refresh();
}

// --- Actions on data -----------------------------------------------------------------

async function gvConnect(moduleId, entityId) {
  const mod = campaign.contentModules.find((m) => m.id === moduleId);
  const ent = campaign.entities[entityId];
  if (!mod || !ent) return;
  if (!gvCompatible(mod.type, ent)) { gvSetNote(`${window.Constants.MODULE_TYPE_LABELS[mod.type]} cannot be attached to a ${ent.type}.`); return; }
  const timeId = gvDefaultTime(mod.type);
  if (!timeId && !gvAllowsNoTime(mod.type)) { gvSetNote('Create a milestone first: this kind of content needs one.'); return; }
  let res;
  gvSnapshot();
  res = window.DataModel.assignModuleToEntities(campaign, { moduleId, entityIds: [entityId], timeId });
  gv().pinned = Array.from(new Set([...gv().pinned, moduleId]));
  gv().note = res.created.length ? `Connected “${mod.name || 'content'}” to ${ent.name}${timeId ? ` at ${campaign.checkpoints.find((c) => c.id === timeId).label}` : ' (always)'}.` : `${ent.name} already has this content at that time.`;
  if (!res.created.length) gv().undo.pop();
  await refresh();
}

async function gvPlace(npcId, locationId) {
  const npc = campaign.entities[npcId], loc = campaign.entities[locationId];
  if (!npc || !loc || loc.type !== 'location') return;
  const timeId = gv().time || gvFirstCheckpoint();
  if (!timeId) { gvSetNote('Create a milestone first: "present here" is kept per milestone.'); return; }
  const exists = campaign.blocks.some((b) => b.kind === 'arrival' && b.locationId === locationId && b.timeId === timeId && (b.presence || []).includes(npcId));
  if (exists) { gvSetNote(`${npc.name} is already at ${loc.name} at that milestone.`); return; }
  gvSnapshot();
  const arrival = ensureArrivalExists(locationId, timeId);
  arrival.presence = Array.from(new Set([...(arrival.presence || []), npcId]));
  gv().note = `${npc.name} is now present at ${loc.name} (${campaign.checkpoints.find((c) => c.id === timeId).label}).`;
  await refresh();
}

function gvFindEdge(id) {
  return gvCache && gvCache.graph.edges.find((e) => e.id === id);
}

async function gvSetEdgeTime(edgeId, timeId) {
  const e = gvFindEdge(edgeId);
  if (!e) return;
  if (e.kind === 'assign') {
    const a = campaign.assignments.find((x) => x.id === e.assignmentId);
    const mod = campaign.contentModules.find((m) => m.id === e.from);
    if (!a || !mod) return;
    if (!timeId && !gvAllowsNoTime(mod.type)) { gvSetNote('This kind of content always needs a milestone.'); return; }
    if (campaign.assignments.some((x) => x.id !== a.id && x.moduleId === a.moduleId && x.entityId === a.entityId && (x.timeId || null) === (timeId || null))) {
      gvSetNote('That content is already connected there at that time.'); return;
    }
    await gvMutate(() => { window.DataModel.updateAssignmentTimeId(campaign, a.id, timeId || null); });
  } else if (e.kind === 'presence') {
    if (!timeId) { gvSetNote('"Present here" always belongs to a milestone.'); return; }
    const block = campaign.blocks.find((b) => b.id === e.blockId);
    if (!block) return;
    if (campaign.blocks.some((b) => b.kind === 'arrival' && b.locationId === e.to && b.timeId === timeId && (b.presence || []).includes(e.from))) { gvSetNote('Already present there at that milestone.'); return; }
    await gvMutate(() => {
      block.presence = (block.presence || []).filter((id) => id !== e.from);
      const target = ensureArrivalExists(e.to, timeId);
      target.presence = Array.from(new Set([...(target.presence || []), e.from]));
    });
  }
}

async function gvRemoveEdge(edgeId) {
  const e = gvFindEdge(edgeId);
  if (!e) return;
  if (e.kind === 'assign') await gvMutate(() => window.DataModel.deleteAssignment(campaign, e.assignmentId));
  else if (e.kind === 'presence') {
    const block = campaign.blocks.find((b) => b.id === e.blockId);
    if (block) await gvMutate(() => { block.presence = (block.presence || []).filter((id) => id !== e.from); });
  }
}

async function gvToggleDone(moduleId) {
  const m = campaign.contentModules.find((x) => x.id === moduleId);
  if (!m) return;
  await gvMutate(() => window.Query.markModuleComplete(campaign, moduleId, !m.complete));
}

function gvOpenEntity(id) {
  ui.mode = 'create'; ui.createTab = 'entities'; ui.createSelectedEntityId = id;
  renderAll();
}

function gvOpenPipMenu(ev, edgeId) {
  const e = gvFindEdge(edgeId);
  if (!e) return;
  const cps = window.Query.sortedCheckpoints(campaign);
  const mod = e.kind === 'assign' ? campaign.contentModules.find((m) => m.id === e.from) : null;
  const canAlways = e.kind === 'assign' && mod && gvAllowsNoTime(mod.type);
  const from = campaign.entities[e.from] ? campaign.entities[e.from].name : (mod ? mod.name : '');
  const to = campaign.entities[e.to] ? campaign.entities[e.to].name : '';
  const items = [];
  if (canAlways) items.push(`<button class="gv-mi${!e.timeId ? ' cur' : ''}" data-edge="${edgeId}" data-time="">Always</button>`);
  cps.forEach((cp) => items.push(`<button class="gv-mi${e.timeId === cp.id ? ' cur' : ''}" data-edge="${edgeId}" data-time="${cp.id}">${esc(cp.label)}</button>`));
  gvShowMenu(ev, `<div class="gv-mh">${esc(from || 'Line')} → ${esc(to)}</div><div class="gv-mh sub">${e.kind === 'presence' ? 'Present here at' : 'Live at'}</div>${items.join('') || '<div class="hint">No milestones yet.</div>'}<button class="gv-mi danger" data-edge="${edgeId}" data-remove="1">${e.kind === 'presence' ? 'Remove from this location' : 'Disconnect'}</button>`);
  document.getElementById('gv-menu').onclick = async (me) => {
    const b = me.target.closest('button');
    if (!b) return;
    gvCloseMenu();
    if (b.dataset.remove) await gvRemoveEdge(b.dataset.edge);
    else await gvSetEdgeTime(b.dataset.edge, b.dataset.time || null);
  };
}

function gvDblClick(ev) {
  if (ev.target.closest('.gv-node') || ev.target.closest('.gv-pip') || ev.target.closest('#gv-menu')) return;
  const w = gvWorldPoint(ev);
  const labels = window.Constants.MODULE_TYPE_LABELS;
  const ck = window.Conditions.KIND_LABELS;
  gvShowMenu(ev, `<div class="gv-mh">Create content here</div>${Object.keys(labels).map((k) => `<button class="gv-mi" data-new="${k}">${esc(labels[k])}</button>`).join('')}
    <div class="gv-mh sub">Create condition here</div>${Object.keys(ck).map((k) => `<button class="gv-mi" data-newcond="${k}">${esc(ck[k])}</button>`).join('')}`);
  document.getElementById('gv-menu').onclick = async (me) => {
    const b = me.target.closest('button');
    if (!b) return;
    if (b.dataset.new) { gvCloseMenu(); await gvCreateContent(b.dataset.new, w); }
    else if (b.dataset.newcond) { gvCloseMenu(); await gvCreateCondition(b.dataset.newcond, w); }
  };
}

async function gvCreateCondition(kind, world) {
  gvSnapshot();
  const label = window.Conditions.KIND_LABELS[kind] || 'condition';
  const c = window.Conditions.createCondition(campaign, { name: `New ${label.toLowerCase()} condition`, kind });
  gvStore().positions[c.id] = { x: Math.round(world.x), y: Math.round(world.y) };
  gv().pinned = Array.from(new Set([...gv().pinned, c.id]));
  gv().selected = c.id;
  gv().note = 'Condition created. Use the edit button on its card to set it up in the Conditions tab, then write [[IF…]] text or give a block a "show if".';
  await refresh();
}

async function gvCreateContent(type, world, name) {
  gvSnapshot();
  const m = window.DataModel.createContentModule(campaign, { type, name: name || `New ${window.Constants.MODULE_TYPE_LABELS[type].toLowerCase()}` });
  gvStore().positions[m.id] = { x: Math.round(world.x), y: Math.round(world.y) };
  gv().pinned = Array.from(new Set([...gv().pinned, m.id]));
  gv().selected = m.id;
  gv().note = 'Created. It is unassigned until you connect it: drag from its dots onto an entity.';
  await refresh();
  window.app.gvOpenContent(m.id, true);
}

// --- Library panel ------------------------------------------------------------------------

function gvRenderLib() {
  const el = document.getElementById('gv-lib');
  if (!el) return;
  const g = gv();
  const types = window.Constants.MODULE_TYPE_LABELS;
  el.innerHTML = `
    <div class="gv-lib-head">Library <span class="hint" style="margin:0">drag onto the canvas</span></div>
    <input type="text" id="gv-lib-search" placeholder="Search…" value="${esc(g.libSearch)}" oninput="window.app.gvLibSearch(this.value)">
    <select onchange="window.app.gvLibType(this.value)">
      <option value="">Everything</option><option value="unassigned" ${g.libType === 'unassigned' ? 'selected' : ''}>Unassigned content</option><option value="hidden" ${g.libType === 'hidden' ? 'selected' : ''}>Hidden from graph</option>
      <option value="npc" ${g.libType === 'npc' ? 'selected' : ''}>NPCs</option><option value="location" ${g.libType === 'location' ? 'selected' : ''}>Locations</option><option value="condition" ${g.libType === 'condition' ? 'selected' : ''}>Conditions</option>
      ${Object.keys(types).map((k) => `<option value="${k}" ${g.libType === k ? 'selected' : ''}>${esc(types[k])}</option>`).join('')}
    </select>
    <div class="gv-lib-list" id="gv-lib-list"></div>`;
  gvRenderLibList();
}

function gvRenderLibList() {
  const list = document.getElementById('gv-lib-list');
  if (!list) return;
  const g = gv();
  const q = g.libSearch.trim().toLowerCase();
  const graph = gvCache ? gvCache.graph : window.Graph.buildGraph(campaign, { includeRefs: false });
  let nodes = graph.nodes.filter((n) => n.kind === 'entity' || n.kind === 'module' || n.kind === 'condition');
  const hid = gvStore().hidden;
  if (g.libType === 'hidden') nodes = nodes.filter((n) => hid[n.id]);
  else if (g.libType === 'unassigned') nodes = nodes.filter((n) => n.kind === 'module' && n.inbox && !hid[n.id]);
  else if (g.libType === 'condition') nodes = nodes.filter((n) => n.kind === 'condition');
  else if (g.libType === 'npc' || g.libType === 'location') nodes = nodes.filter((n) => n.kind === 'entity' && n.type === g.libType);
  else if (g.libType) nodes = nodes.filter((n) => n.kind === 'module' && n.type === g.libType);
  if (q) nodes = nodes.filter((n) => `${n.name} ${n.excerpt || ''} ${n.type}`.toLowerCase().includes(q));
  nodes.sort((a, b) => (a.kind + a.type + a.name).localeCompare(b.kind + b.type + b.name));
  const shown = nodes.slice(0, 200);
  list.innerHTML = shown.map((n) => `<div class="gv-lib-row ${n.kind === 'module' && n.complete ? 'done' : ''}" draggable="true" data-node="${n.id}" title="Drag onto the canvas, or click to bring it into view">
      <span class="gv-lib-type">${n.kind === 'condition' ? 'cond.' : n.kind === 'entity' ? n.type : esc(window.Constants.MODULE_TYPE_LABELS[n.type] || n.type)}</span><span class="gv-lib-name">${esc(n.name || '(untitled)')}</span>${hid[n.id] ? '<span class="gv-lib-hid" title="Removed from the graph. Click to bring it back.">hidden</span>' : (n.kind === 'module' && n.inbox ? '<i class="gv-dot" title="unassigned"></i>' : '')}</div>`).join('')
    + (nodes.length > shown.length ? `<div class="hint" style="padding:6px">${nodes.length - shown.length} more — narrow the search.</div>` : '')
    || '<div class="hint" style="padding:6px">Nothing matches.</div>';
  list.querySelectorAll('.gv-lib-row').forEach((row) => {
    row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/gv-node', row.dataset.node); e.dataTransfer.effectAllowed = 'copy'; });
    row.addEventListener('click', () => window.app.gvReveal(row.dataset.node));
  });
}

async function gvLibDrop(ev) {
  ev.preventDefault();
  const id = ev.dataTransfer.getData('text/gv-node');
  if (!id || !gvCache) return;
  const node = gvCache.graph.byId[id];
  if (!node) return;
  const w = gvWorldPoint(ev);
  const g = gv();
  gvStore().positions[id] = { x: Math.round(w.x - 90), y: Math.round(w.y - 20) };
  delete gvStore().hidden[id];
  g.pinned = Array.from(new Set([...g.pinned, id]));
  scheduleFieldSave('graph-pos');
  const hit = document.elementFromPoint(ev.clientX, ev.clientY);
  const tn = hit && hit.closest('.gv-entity');
  if (node.kind === 'module' && tn && campaign.entities[tn.dataset.id] && gvCompatible(node.type, campaign.entities[tn.dataset.id])) {
    await gvConnect(id, tn.dataset.id);
  } else {
    gv().selected = id;
    gvDraw();
  }
}

// --- Content window ---------------------------------------------------------------------------

function gvWinHTML(m) {
  const labels = window.Constants.MODULE_TYPE_LABELS;
  const npcsList = Object.values(campaign.entities).filter((e) => e.type === 'npc');
  const cps = window.Query.sortedCheckpoints(campaign);
  const assignments = window.Query.getModuleAssignments(campaign, m.id);
  const allowsNoTime = gvAllowsNoTime(m.type);
  const compat = Object.values(campaign.entities).filter((e) => gvCompatible(m.type, e)).sort((a, b) => a.name.localeCompare(b.name));
  let html = `<div class="gv-win-head" id="gv-win-head">
      <span class="gv-ct">${esc(labels[m.type] || m.type)}</span>
      <span style="flex:1"></span>
      <button class="mini-btn" title="Close (Esc)" onclick="window.app.gvCloseContent()">${icon('x')}</button>
    </div>
    <div class="gv-win-body" id="gv-win-body">
    <div class="form-row"><label>Name</label><input type="text" id="gv-win-name" value="${esc(m.name)}" oninput="window.app.gvWinName('${m.id}',this.value)"></div>`;
  if (m.type === 'scene') html += renderLibrarySceneFieldsHTML(m, npcsList);
  else if (m.type === 'description') html += `<div class="form-row"><label>Text</label><textarea id="lib-field-${m.id}" class="mention-field gv-win-text" oninput="window.app.gvWinField('${m.id}','html',this.value)">${esc(m.html)}</textarea></div>`;
  else html += `<div class="form-row"><label>Text</label><textarea id="lib-field-${m.id}" class="mention-field gv-win-text" oninput="window.app.gvWinField('${m.id}','text',this.value)">${esc(m.text)}</textarea></div>`;
  html += `<label class="gv-resolved"><input type="checkbox" ${m.complete ? 'checked' : ''} onchange="window.app.toggleModuleComplete('${m.id}',this.checked)"> Resolved (turns the card dark grey, everywhere it is used)</label>
    ${condCardControlHTML(m)}
    ${questControlHTML(m.id)}
    <div class="section-label">Connected to</div>`;
  if (!assignments.length) html += '<p class="empty-hint">Not connected yet. It sits in the inbox until you connect it.</p>';
  html += assignments.map((a) => `<div class="gv-assign">
      <span class="gv-assign-name">${a.entity ? esc(a.entity.name) : '(deleted)'}</span>
      <select onchange="window.app.gvWinSetTime('${a.assignmentId}',this.value)">
        ${allowsNoTime ? `<option value="" ${!a.timeId ? 'selected' : ''}>Always</option>` : ''}
        ${cps.map((c) => `<option value="${c.id}" ${a.timeId === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
      </select>
      <button class="mini-btn" title="Disconnect" onclick="window.app.gvWinUnassign('${a.assignmentId}')">${icon('x')}</button>
    </div>`).join('');
  html += `<div class="gv-assign add">
      <select id="gv-win-add-ent"><option value="">Connect to…</option>${compat.map((e) => `<option value="${e.id}">${esc(e.name)} (${e.type})</option>`).join('')}</select>
      <select id="gv-win-add-time">${allowsNoTime ? '<option value="">Always</option>' : ''}${cps.map((c) => `<option value="${c.id}" ${gv().time === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
      <button class="icon-btn" onclick="window.app.gvWinAdd('${m.id}')">${icon('plus')}</button>
    </div>
    <div class="gv-win-foot"><button class="icon-btn" title="Takes it out of the graph and disconnects it. It stays in the Library." onclick="window.app.gvWinRemove('${m.id}')">${icon('trash')} Remove from graph</button><span class="hint" style="margin:0">Deleting content for good is done in the Library.</span></div>
    </div>`;
  return html;
}

function renderGraphWindow() {
  const el = document.getElementById('gv-win');
  if (!el) return;
  const eid = ui.gvWinEntityId;
  const ent = eid && campaign.entities[eid];
  const id = ui.gvWinModuleId;
  const m = !ent && id && campaign.contentModules.find((x) => x.id === id);
  if (eid && !ent) ui.gvWinEntityId = null;
  if (!ent && !m) { el.style.display = 'none'; el.innerHTML = ''; ui.gvWinModuleId = null; el.classList.remove('gv-win-entity'); return; }
  const oldBody = document.getElementById('gv-win-body');
  const top = oldBody ? oldBody.scrollTop : 0;
  const active = document.activeElement;
  const keepFocus = active && active.id && el.contains(active) ? { id: active.id, s: active.selectionStart, e: active.selectionEnd } : null;
  el.classList.toggle('gv-win-entity', !!ent);
  el.innerHTML = ent ? gvEntWinHTML(ent) : gvWinHTML(m);
  el.style.display = 'flex';
  const body = document.getElementById('gv-win-body');
  if (body) body.scrollTop = top;
  wireMentionAutocomplete(el);
  wirePasteHandler(el);
  if (keepFocus) {
    const f = document.getElementById(keepFocus.id);
    if (f) { f.focus(); try { f.setSelectionRange(keepFocus.s, keepFocus.e); } catch { /* not a text field */ } }
  }
  const head = document.getElementById('gv-win-head');
  if (head) head.onpointerdown = gvWinDragStart;
}

// --- Entity window: everything connected to one location or NPC, editable in place ----------------

const GV_TYPE_ORDER = ['description', 'beat', 'scene', 'note', 'topic'];

function gvTimeOptions(selected, withAlways) {
  const cps = window.Query.sortedCheckpoints(campaign);
  return (withAlways ? `<option value="" ${!selected ? 'selected' : ''}>Always</option>` : '')
    + cps.map((c) => `<option value="${c.id}" ${selected === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
}

function gvBlockHTML(e, a, m, npcsList) {
  const labels = window.Constants.MODULE_TYPE_LABELS;
  const open = ui.gvBlkOpen && ui.gvBlkOpen[m.id];
  const others = window.Query.getModuleAssignments(campaign, m.id).filter((x) => x.assignmentId !== a.id && x.entity);
  let body = `<div class="form-row"><label>Name</label><input type="text" value="${esc(m.name)}" oninput="window.app.gvWinName('${m.id}',this.value)"></div>`;
  if (m.type === 'scene') body += renderLibrarySceneFieldsHTML(m, npcsList);
  else if (m.type === 'description') body += `<div class="form-row"><label>Text</label><textarea id="lib-field-${m.id}" class="mention-field gv-win-text" oninput="window.app.gvWinField('${m.id}','html',this.value)">${esc(m.html)}</textarea></div>`;
  else body += `<div class="form-row"><label>Text</label><textarea id="lib-field-${m.id}" class="mention-field gv-win-text" oninput="window.app.gvWinField('${m.id}','text',this.value)">${esc(m.text)}</textarea></div>`;
  body += `<div class="gv-assign"><span class="gv-assign-name">Live at</span>
      <select onchange="window.app.gvWinSetTime('${a.id}',this.value)">${gvTimeOptions(a.timeId, gvAllowsNoTime(m.type))}</select>
      <label class="gv-resolved" style="margin:0"><input type="checkbox" ${m.complete ? 'checked' : ''} onchange="window.app.toggleModuleComplete('${m.id}',this.checked)"> Resolved</label></div>
    ${others.length ? `<div class="hint" style="margin:4px 0">Also used by: ${others.map((x) => esc(x.entity.name)).join(', ')}. Edits to the text apply everywhere.</div>` : ''}
    <div class="inline" style="gap:6px;margin-top:6px">
      <button class="icon-btn" title="Disconnect it from ${esc(e.name)} only. It stays in the Library." onclick="window.app.gvWinUnassign('${a.id}')">${icon('x')} Remove from ${esc(e.name)}</button>
      <button class="icon-btn" onclick="window.app.gvOpenContent('${m.id}')">Open on its own</button></div>`;
  return `<details class="gv-blk t-${m.type}" ${open ? 'open' : ''} ontoggle="window.app.gvBlkToggle('${m.id}',this.open)">
    <summary><span class="gv-ct">${esc(labels[m.type] || m.type)}</span><span class="gv-blk-name">${esc(m.name || '(untitled)')}</span>${m.complete ? '<i class="gv-blk-done">resolved</i>' : ''}</summary>
    <div class="gv-blk-body">${body}</div></details>`;
}

function gvEntWinHTML(e) {
  const labels = window.Constants.MODULE_TYPE_LABELS;
  const cps = window.Query.sortedCheckpoints(campaign);
  const npcsList = Object.values(campaign.entities).filter((x) => x.type === 'npc');
  const rows = campaign.assignments
    .filter((a) => a.entityId === e.id)
    .map((a) => ({ a, m: campaign.contentModules.find((x) => x.id === a.moduleId) }))
    .filter((r) => r.m);
  const groups = [{ id: null, label: 'Always' }].concat(cps.map((c) => ({ id: c.id, label: c.label })));
  let html = `<div class="gv-win-head" id="gv-win-head">
      <span class="gv-ct">${e.type === 'location' ? 'Location' : 'NPC'}</span>
      <span style="flex:1"></span>
      <button class="mini-btn" title="Open in the Entities tab (portrait, character card, inventory…)" onclick="window.app.gvOpenEntityTab('${e.id}')">${icon('edit')}</button>
      <button class="mini-btn" title="Close (Esc)" onclick="window.app.gvCloseContent()">${icon('x')}</button>
    </div>
    <div class="gv-win-body" id="gv-win-body">
    <div class="form-row"><label>Name</label><input type="text" id="gv-ew-name" value="${esc(e.name)}" oninput="window.app.gvEntField('${e.id}','name',this.value)"></div>
    <div class="form-row"><label>Summary</label><textarea id="gv-ew-summary" class="gv-win-text" style="min-height:54px" oninput="window.app.gvEntField('${e.id}','summary',this.value)">${esc(e.summary || '')}</textarea></div>`;

  // Content, grouped by when it is live.
  groups.forEach((grp) => {
    const list = rows.filter((r) => (r.a.timeId || null) === grp.id)
      .sort((p, q) => GV_TYPE_ORDER.indexOf(p.m.type) - GV_TYPE_ORDER.indexOf(q.m.type) || (p.a.order || 0) - (q.a.order || 0) || p.m.name.localeCompare(q.m.name));
    if (!list.length) return;
    html += `<div class="section-label">${esc(grp.label)}</div>` + list.map((r) => gvBlockHTML(e, r.a, r.m, npcsList)).join('');
  });
  if (!rows.length) html += '<p class="empty-hint">No content connected yet. Add some below.</p>';

  // Present here / present at.
  const blocks = campaign.blocks.filter((b) => b.kind === 'arrival');
  const cpLabel = (id) => (cps.find((c) => c.id === id) || { label: '?' }).label;
  if (e.type === 'location') {
    const mine = blocks.filter((b) => b.locationId === e.id && (b.presence || []).length).sort((p, q) => (cps.findIndex((c) => c.id === p.timeId)) - (cps.findIndex((c) => c.id === q.timeId)));
    html += `<div class="section-label">Present here</div>`;
    html += mine.length ? mine.map((b) => `<div class="gv-assign"><span class="gv-assign-name">${esc(cpLabel(b.timeId))}</span><span class="gv-chips">${(b.presence || []).map((id) => campaign.entities[id] ? `<span class="gv-chip">${esc(campaign.entities[id].name)}<button title="Remove" onclick="window.app.gvEntRemovePresence('${b.id}','${id}')">×</button></span>` : '').join('')}</span></div>`).join('')
      : '<p class="empty-hint">Nobody is placed here yet.</p>';
    const cands = Object.values(campaign.entities).filter((x) => x.id !== e.id).sort((p, q) => p.name.localeCompare(q.name));
    html += `<div class="gv-assign add"><select id="gv-ew-pres-who"><option value="">Add who is here…</option>${cands.map((x) => `<option value="${x.id}">${esc(x.name)} (${x.type})</option>`).join('')}</select>
      <select id="gv-ew-pres-time">${gvTimeOptions(gv().time || (cps[0] && cps[0].id), false)}</select>
      <button class="icon-btn" onclick="window.app.gvEntAddPresence('${e.id}')">${icon('plus')}</button></div>`;
  } else {
    const mine = blocks.filter((b) => (b.presence || []).includes(e.id));
    html += `<div class="section-label">Present at</div>`;
    html += mine.length ? mine.map((b) => `<div class="gv-assign"><span class="gv-assign-name">${esc((campaign.entities[b.locationId] || { name: '?' }).name)}</span><span class="hint" style="margin:0;flex:1">${esc(cpLabel(b.timeId))}</span><button class="mini-btn" title="Remove" onclick="window.app.gvEntRemovePresence('${b.id}','${e.id}')">${icon('x')}</button></div>`).join('')
      : '<p class="empty-hint">Not placed at any location yet.</p>';
    const locs = Object.values(campaign.entities).filter((x) => x.type === 'location').sort((p, q) => p.name.localeCompare(q.name));
    html += `<div class="gv-assign add"><select id="gv-ew-pres-where"><option value="">Place at…</option>${locs.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
      <select id="gv-ew-pres-time">${gvTimeOptions(gv().time || (cps[0] && cps[0].id), false)}</select>
      <button class="icon-btn" onclick="window.app.gvEntAddPresence('${e.id}')">${icon('plus')}</button></div>`;
  }

  // Add content: new, or one that already exists in the Library.
  const types = Object.keys(labels).filter((k) => (window.Constants.MODULE_TYPE_ENTITY_TYPES[k] || []).includes(e.type));
  const have = new Set(rows.map((r) => r.m.id));
  const existing = campaign.contentModules.filter((m) => types.includes(m.type) && !have.has(m.id)).sort((p, q) => (p.type + p.name).localeCompare(q.type + q.name)).slice(0, 400);
  html += `<div class="section-label">Add content</div>
    <div class="gv-assign add"><span class="gv-assign-name">When</span><select id="gv-ew-add-time">${gvTimeOptions(gv().time || (cps[0] && cps[0].id), true)}</select></div>
    <div class="inline" style="flex-wrap:wrap;gap:6px;margin:4px 0">${types.map((k) => `<button class="icon-btn" onclick="window.app.gvEntNewContent('${e.id}','${k}')">${icon('plus')} New ${esc(labels[k].toLowerCase())}</button>`).join('')}</div>
    <div class="gv-assign add"><select id="gv-ew-add-existing"><option value="">Connect one from the Library…</option>${existing.map((m) => `<option value="${m.id}">${esc(labels[m.type])} · ${esc(m.name || '(untitled)')}</option>`).join('')}</select>
      <button class="icon-btn" onclick="window.app.gvEntConnectExisting('${e.id}')">${icon('plus')}</button></div>
    <div class="gv-win-foot"><button class="icon-btn" title="Hides it from the graph only. Nothing is deleted and Play is unchanged." onclick="window.app.gvEntHide('${e.id}')">${icon('trash')} Hide from graph</button><span class="hint" style="margin:0">Entities are deleted in the Entities tab.</span></div>
    </div>`;
  return html;
}

function gvWinDragStart(ev) {
  if (ev.target.closest('button')) return;
  const el = document.getElementById('gv-win');
  const r = el.getBoundingClientRect();
  const ox = ev.clientX - r.left, oy = ev.clientY - r.top;
  const move = (e) => {
    el.style.left = `${Math.max(0, Math.min(window.innerWidth - 120, e.clientX - ox))}px`;
    el.style.top = `${Math.max(0, Math.min(window.innerHeight - 60, e.clientY - oy))}px`;
    el.style.right = 'auto';
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  ev.preventDefault();
}

function gvUpdateCardText(moduleId) {
  const m = campaign.contentModules.find((x) => x.id === moduleId);
  const card = document.querySelector(`#gv-nodes .gv-node[data-id="${moduleId}"]`);
  if (!m || !card) return;
  const n = window.Graph.buildGraph(campaign, { includeRefs: false }).byId[moduleId];
  const cn = card.querySelector('.gv-cn'), cx = card.querySelector('.gv-cx');
  if (cn) cn.textContent = m.name || '(untitled)';
  if (cx && n) cx.textContent = n.excerpt || '';
}

// Keys handled while the Graph tab or its window is up. Returns true if used.
function gvKey(ev) {
  if (ev.key === 'Escape') {
    const menu = document.getElementById('gv-menu');
    if (gvConfirmOpen()) { gvCloseConfirm(); return true; }
    if (menu && menu.style.display !== 'none') { gvCloseMenu(); return true; }
    if ((ui.gvWinModuleId || ui.gvWinEntityId) && !(window.TextFullscreen && window.TextFullscreen.isActive())) { window.app.gvCloseContent(); return true; }
    return false;
  }
  if ((ev.key === 'Delete' || ev.key === 'Backspace') && ui.mode === 'create' && ui.createTab === 'graph' && gvCache) {
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable)) return false;
    const g = gv();
    const ids = g.multi.length ? g.multi.slice() : (g.selected ? [g.selected] : []);
    if (!ids.length) return false;
    ev.preventDefault();
    gvRemoveFromGraph(ids);
    return true;
  }
  const inGraph = ui.mode === 'create' && ui.createTab === 'graph';
  const typing = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
  if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && inGraph) {
    const k = ev.key.toLowerCase();
    if (k === 'z' || k === 'y') {
      if (typing()) return false;
      ev.preventDefault();
      if (k === 'y' || ev.shiftKey) window.app.gvRedo(); else window.app.gvUndo();
      return true;
    }
    if (k === 'a' && gvCache) {
      if (typing()) return false;
      ev.preventDefault();
      const g = gv();
      g.multi = gvCache.graph.nodes.filter((n) => n.kind !== 'milestone' && gvCache.visible.has(n.id)).map((n) => n.id);
      g.selected = null;
      g.note = `Selected ${g.multi.length} node(s).`;
      gvDraw();
      return true;
    }
  }
  return false;
}

function graphActions() {
  return {
    gvSetFocus(v) {
      const g = gv();
      g.focus = v === 'all' ? { kind: 'all' } : { kind: 'node', id: v.slice(2) };
      g.pinned = []; g.selected = null; g.needFit = true;
      renderGraphTab();
    },
    gvSetHops(v) { gv().hops = Number(v) || 1; gv().needFit = true; renderGraphTab(); },
    gvSetTime(v) { gv().time = v || null; renderGraphTab(); },
    gvToggleRefs(on) { gv().showRefs = !!on; gvDrawEdges(); },
    gvToggleOpt(key, on) { gv()[key] = !!on; gvDraw(); },
    gvPlayTime() { if (ui.curTime) { gv().time = ui.curTime; renderGraphTab(); } },
    gvClearSelection() { gv().multi = []; gvDraw(); },
    gvTransferSelection() {
      const ids = gv().multi.filter((id) => campaign.entities[id]);
      if (ids.length) window.app.openTransfer(ids);
    },
    // Jump here from the Library, Entities and Play views.
    showInGraph(id, timeId) {
      const g = gv();
      const isQuest = campaign.entities[id] && campaign.entities[id].type === 'quest';
      g.focus = isQuest ? { kind: 'all' } : { kind: 'node', id };
      g.pinned = []; g.selected = isQuest ? null : id; g.multi = []; g.needFit = true;
      if (timeId) g.time = timeId;
      ui.mode = 'create'; ui.createTab = 'graph';
      renderAll();
    },
    gvToggleLib() { gv().libOpen = !gv().libOpen; renderGraphTab(); },
    gvFit() { gvFit(); },
    gvTidy() {
      gvSnapshot();
      const graph = window.Graph.buildGraph(campaign);
      const st = gvStore();
      const a = window.Graph.alignLanes(graph, st.positions, Infinity).length;
      const b = window.Graph.tidyContent(campaign, graph, st.positions).length;
      scheduleFieldSave('graph-pos');
      gv().note = a || b ? `Tidied: ${b} content card(s) moved beside their owner, ${a} node(s) put back on their lane.` : 'Everything is already tidy.';
      renderGraphTab();
    },
    gvAutoLayout() {
      gvSnapshot();
      const graph = window.Graph.buildGraph(campaign);
      gvStore().positions = window.Graph.autoLayout(campaign, graph);
      gv().needFit = true;
      scheduleFieldSave('graph-pos');
      renderGraphTab();
    },
    async gvToggleSubLoc(on) {
      gvSnapshot();
      campaign.graph.subLocations = on ? true : false;
      if (on) delete campaign.graph.subLocations;
      scheduleFieldSave('graph-pos');
      gv().note = on ? 'Locations that are present inside another location now stand in the Sub-locations column.' : 'Every location stays in the Locations lane.';
      await refresh();
    },
    async gvRedo() {
      const g = gv();
      const snap = (g.redo || []).pop();
      if (!snap) return;
      g.undo.push(JSON.stringify(campaign));
      const restored = JSON.parse(snap);
      Object.keys(campaign).forEach((k) => { delete campaign[k]; });
      Object.assign(campaign, restored);
      g.note = 'Redone.';
      await refresh();
    },
    async gvUndo() {
      const g = gv();
      const snap = g.undo.pop();
      if (!snap) return;
      (g.redo = g.redo || []).push(JSON.stringify(campaign));
      const restored = JSON.parse(snap);
      Object.keys(campaign).forEach((k) => { delete campaign[k]; });
      Object.assign(campaign, restored);
      g.note = 'Undone.';
      await refresh();
    },
    gvToggleNewMs() { gv().newMsOpen = !gv().newMsOpen; renderGraphTab(); },
    async gvCreateMilestone(label) {
      const name = String(label || '').trim();
      if (!name) return;
      gv().newMsOpen = false;
      await gvMutate(() => window.DataModel.createCheckpoint(campaign, { label: name }));
    },
    gvLibSearch(v) { gv().libSearch = v; gvRenderLibList(); },
    gvLibType(v) { gv().libType = v; gvRenderLibList(); },
    gvReveal(id) {
      const g = gv();
      if (gvStore().hidden[id]) { delete gvStore().hidden[id]; scheduleFieldSave('graph-pos'); g.note = 'Brought back into the graph.'; }
      g.pinned = Array.from(new Set([...g.pinned, id]));
      g.selected = id;
      gvDraw();
      const p = gvCache.pos[id];
      const vp = document.getElementById('gv-viewport');
      if (p && vp) { const r = vp.getBoundingClientRect(); g.view.x = r.width / 2 - (p.x + 90) * g.view.k; g.view.y = r.height / 2 - (p.y + 30) * g.view.k; gvApplyView(); }
      const n = gvCache.graph.byId[id];
      if (n && n.kind === 'module') window.app.gvOpenContent(id);
    },
    gvOpenContent(id, focusName) {
      ui.gvWinModuleId = id;
      renderGraphWindow();
      if (focusName) { const i = document.getElementById('gv-win-name'); if (i) { i.focus(); i.select(); } }
    },
    gvCloseContent() { ui.gvWinModuleId = null; ui.gvWinEntityId = null; renderGraphWindow(); },
    gvWinName(id, v) { window.app.onLibraryModuleNameInput(id, v); gvUpdateCardText(id); },
    gvWinField(id, field, v) { window.app.onLibraryModuleFieldInput(id, field, v); gvUpdateCardText(id); },
    async gvWinSetTime(assignmentId, timeId) {
      const a = campaign.assignments.find((x) => x.id === assignmentId);
      if (!a) return;
      if (campaign.assignments.some((x) => x.id !== a.id && x.moduleId === a.moduleId && x.entityId === a.entityId && (x.timeId || null) === (timeId || null))) { gvSetNote('Already connected there at that time.'); renderGraphWindow(); return; }
      await gvMutate(() => window.DataModel.updateAssignmentTimeId(campaign, assignmentId, timeId || null));
    },
    async gvWinUnassign(assignmentId) { await gvMutate(() => window.DataModel.deleteAssignment(campaign, assignmentId)); },
    async gvWinAdd(moduleId) {
      const ent = document.getElementById('gv-win-add-ent').value;
      const time = document.getElementById('gv-win-add-time').value || null;
      if (!ent) return;
      const m = campaign.contentModules.find((x) => x.id === moduleId);
      if (!time && !gvAllowsNoTime(m.type)) { gvSetNote('This kind of content needs a milestone.'); return; }
      gvSnapshot();
      const res = window.DataModel.assignModuleToEntities(campaign, { moduleId, entityIds: [ent], timeId: time });
      if (!res.created.length) { gv().undo.pop(); gvSetNote('Already connected there at that time.'); return; }
      gv().pinned = Array.from(new Set([...gv().pinned, ent]));
      await refresh();
    },
    gvWinRemove(id) { gvRemoveFromGraph([id]); },
    gvOpenEntityWin(id) { ui.gvWinModuleId = null; ui.gvWinEntityId = id; renderGraphWindow(); },
    gvOpenEntityTab(id) { gvOpenEntity(id); },
    gvBlkToggle(id, open) { ui.gvBlkOpen = ui.gvBlkOpen || {}; if (open) ui.gvBlkOpen[id] = true; else delete ui.gvBlkOpen[id]; },
    gvEntField(id, field, value) {
      window.app.onEntityFieldInput(id, field, value);
      if (field === 'name') { const el = document.querySelector(`#gv-nodes .gv-node[data-id="${id}"] .gv-ename`); if (el) el.textContent = value; }
    },
    async gvEntRemovePresence(blockId, npcId) {
      const b = campaign.blocks.find((x) => x.id === blockId);
      if (b) await gvMutate(() => { b.presence = (b.presence || []).filter((id) => id !== npcId); });
    },
    async gvEntAddPresence(entityId) {
      const e = campaign.entities[entityId];
      const time = document.getElementById('gv-ew-pres-time').value;
      const other = e.type === 'location' ? document.getElementById('gv-ew-pres-who').value : document.getElementById('gv-ew-pres-where').value;
      if (!other || !time) { gvSetNote('Pick who or where, and a milestone.'); return; }
      const locId = e.type === 'location' ? entityId : other, whoId = e.type === 'location' ? other : entityId;
      const exists = campaign.blocks.some((b) => b.kind === 'arrival' && b.locationId === locId && b.timeId === time && (b.presence || []).includes(whoId));
      if (exists) { gvSetNote('Already there at that milestone.'); return; }
      await gvMutate(() => { const arrival = ensureArrivalExists(locId, time); arrival.presence = Array.from(new Set([...(arrival.presence || []), whoId])); });
    },
    async gvEntNewContent(entityId, type) {
      const time = document.getElementById('gv-ew-add-time').value || null;
      if (!time && !gvAllowsNoTime(type)) { gvSetNote('This kind of content needs a milestone.'); return; }
      gvSnapshot();
      const m = window.DataModel.createContentModule(campaign, { type, name: `New ${window.Constants.MODULE_TYPE_LABELS[type].toLowerCase()}` });
      window.DataModel.assignModuleToEntities(campaign, { moduleId: m.id, entityIds: [entityId], timeId: time });
      ui.gvBlkOpen = ui.gvBlkOpen || {}; ui.gvBlkOpen[m.id] = true;
      await refresh();
    },
    async gvEntConnectExisting(entityId) {
      const id = document.getElementById('gv-ew-add-existing').value;
      if (!id) return;
      const m = campaign.contentModules.find((x) => x.id === id);
      const time = document.getElementById('gv-ew-add-time').value || null;
      if (!m) return;
      if (!time && !gvAllowsNoTime(m.type)) { gvSetNote('This kind of content needs a milestone.'); return; }
      gvSnapshot();
      const res = window.DataModel.assignModuleToEntities(campaign, { moduleId: id, entityIds: [entityId], timeId: time });
      if (!res.created.length) { gv().undo.pop(); gvSetNote('Already connected there at that time.'); return; }
      delete gvStore().hidden[id];
      ui.gvBlkOpen = ui.gvBlkOpen || {}; ui.gvBlkOpen[id] = true;
      await refresh();
    },
    gvEntHide(id) { gvRemoveFromGraph([id]); },
    gvRemoveSelection() { gvRemoveFromGraph(gv().multi.slice()); },
  };
}
