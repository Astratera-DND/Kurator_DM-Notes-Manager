// Quests UI: the "Quest" tag in every content editor, a searchable quest chooser,
// the ordered item list on a quest's own page, and drag and drop to reorder it.
// The logic (numbering, moving) lives in src/quests.js; this file only draws and calls it.

function qst() { return window.Quests; }

function questName(id) { const e = campaign.entities[id]; return e ? e.name || '(unnamed quest)' : '(deleted quest)'; }

// The tag shown in a block's editor. Untagged: one button. Tagged: quest, place in it, and ways to change.
function questControlHTML(moduleId) {
  const m = (campaign.contentModules || []).find((x) => x.id === moduleId);
  if (!m) return '';
  if (!m.questId || !campaign.entities[m.questId]) {
    return `<div class="quest-ctl"><button class="icon-btn" title="Mark this block as part of a quest" onclick="window.app.questPick(event,'${m.id}')">${icon('flag')} Quest…</button></div>`;
  }
  const n = qst().itemsOf(campaign, m.questId).length;
  return `<div class="quest-ctl on">
    <span class="quest-chip" title="Quest this block belongs to">${icon('flag')} ${esc(questName(m.questId))}</span>
    <label class="quest-idx" title="Place in the quest. New content is added on top (highest number).">#<input type="number" min="1" max="${n}" value="${m.questIndex || 1}" onchange="window.app.questSetIndex('${m.id}',this.value)"> of ${n}</label>
    <button class="mini-btn" title="Earlier in the quest (lower number)" onclick="window.app.questStep('${m.id}',-1)">${icon('chevronUp')}</button>
    <button class="mini-btn" title="Later in the quest (higher number)" onclick="window.app.questStep('${m.id}',1)">${icon('chevronDown')}</button>
    <button class="mini-btn" title="Choose another quest" onclick="window.app.questPick(event,'${m.id}')">${icon('edit')}</button>
    <button class="mini-btn" title="Remove from the quest" onclick="window.app.questClear('${m.id}')">${icon('x')}</button>
  </div>`;
}

// --- Searchable chooser (quests for a block, or blocks for a quest) ---------------------

let questMenu = null;   // { mode:'quest'|'module', moduleId?, questId?, query, sel }

function questCloseMenu() { const el = document.getElementById('quest-menu'); if (el) el.remove(); questMenu = null; document.removeEventListener('mousedown', questOutside, true); }
function questOutside(ev) { if (!ev.target.closest || !ev.target.closest('#quest-menu')) questCloseMenu(); }

function questMenuRows() {
  const q = (questMenu.query || '').trim().toLowerCase();
  if (questMenu.mode === 'quest') {
    const rows = qst().questList(campaign).filter((e) => !q || e.name.toLowerCase().includes(q))
      .map((e) => ({ id: e.id, label: e.name || '(unnamed quest)', hint: `${qst().itemsOf(campaign, e.id).length} item(s)` }));
    if (q) rows.push({ id: '__new__', label: `New quest “${questMenu.query.trim()}”`, hint: 'create and assign', isNew: true });
    else if (!rows.length) rows.push({ id: '__new__', label: 'New quest…', hint: 'type a name above', isNew: true, disabled: true });
    return rows;
  }
  const labels = window.Constants.MODULE_TYPE_LABELS;
  return (campaign.contentModules || []).filter((m) => m.questId !== questMenu.questId)
    .filter((m) => !q || `${m.name || ''} ${m.text || m.html || ''}`.toLowerCase().includes(q))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '')).slice(0, 60)
    .map((m) => ({ id: m.id, label: m.name || (m.text || m.html || '').replace(/\s+/g, ' ').slice(0, 50) || '(untitled)', hint: labels[m.type] || m.type }));
}

function questMenuRender() {
  const el = document.getElementById('quest-menu-list');
  if (!el || !questMenu) return;
  const rows = questMenuRows();
  questMenu.sel = Math.max(0, Math.min(questMenu.sel || 0, rows.length - 1));
  el.innerHTML = rows.map((r, i) => `<button class="cm-item ${i === questMenu.sel ? 'cm-on' : ''}" ${r.disabled ? 'disabled' : ''} data-qi="${r.id}">${r.isNew ? '+ ' : ''}${esc(r.label)} <span class="cond-hint">${esc(r.hint)}</span></button>`).join('') || '<div class="cm-label">Nothing found</div>';
}

function questOpenMenu(ev, state) {
  questCloseMenu();
  questMenu = Object.assign({ query: '', sel: 0 }, state);
  const m = document.createElement('div');
  m.id = 'quest-menu'; m.className = 'cond-menu quest-menu';
  m.innerHTML = `<div class="cm-label">${questMenu.mode === 'quest' ? 'Mark as part of quest' : 'Add content to this quest'}</div>
    <input type="text" id="quest-menu-search" class="director-search" placeholder="${questMenu.mode === 'quest' ? 'Search quests, or type a new name…' : 'Search content…'}" autocomplete="off">
    <div id="quest-menu-list" class="quest-menu-list"></div>`;
  const r = ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect ? ev.currentTarget.getBoundingClientRect() : { left: 200, bottom: 200 };
  m.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px`;
  m.style.top = `${Math.max(8, Math.min(r.bottom + 4, window.innerHeight - 340))}px`;
  document.body.appendChild(m);
  const inp = document.getElementById('quest-menu-search');
  inp.addEventListener('input', () => { questMenu.query = inp.value; questMenu.sel = 0; questMenuRender(); });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); questCloseMenu(); return; }
    const n = questMenuRows().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); questMenu.sel = Math.min(n - 1, questMenu.sel + 1); questMenuRender(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); questMenu.sel = Math.max(0, questMenu.sel - 1); questMenuRender(); }
    else if (e.key === 'Enter') { e.preventDefault(); const row = questMenuRows()[questMenu.sel]; if (row && !row.disabled) questMenuPick(row.id); }
  });
  document.getElementById('quest-menu-list').addEventListener('click', (e) => { const b = e.target.closest('button[data-qi]'); if (b && !b.disabled) questMenuPick(b.dataset.qi); });
  setTimeout(() => document.addEventListener('mousedown', questOutside, true), 0);
  questMenuRender();
  inp.focus();
}

function questMenuPick(id) {
  const st = questMenu;
  const name = (st.query || '').trim();
  questCloseMenu();
  if (st.mode === 'quest') {
    let qid = id;
    if (id === '__new__') {
      if (!name) return;
      qid = window.DataModel.createEntity(campaign, { type: 'quest', name }).id;
    }
    qst().assign(campaign, st.moduleId, qid);
  } else {
    qst().assign(campaign, id, st.questId);
  }
  refresh();
}

// --- A quest's own page: its content in order, drag to reorder --------------------------

function questPageHTML(questId) {
  const items = qst().itemsOf(campaign, questId);
  const labels = window.Constants.MODULE_TYPE_LABELS;
  const owner = (m) => window.Query.getModuleAssignments(campaign, m.id).filter((a) => a.entity).map((a) => a.entity.name).join(', ');
  return `<div class="section-label">Quest content — in order (1 = first, new content goes on top of the list)</div>
    <p class="hint">Drag the rows to change the order, or edit the number. Any content type can be part of a quest; tag it from its own editor with “Quest…”.</p>
    <div class="quest-list" id="quest-list" data-quest="${questId}">
    ${items.map((m) => `<div class="quest-row" draggable="true" data-mid="${m.id}">
        <span class="mg-grip" title="Drag to reorder">${icon('grip')}</span>
        <input type="number" class="quest-no" min="1" max="${items.length}" value="${m.questIndex}" onchange="window.app.questSetIndex('${m.id}',this.value)">
        <span class="quest-type">${esc(labels[m.type] || m.type)}</span>
        <span class="quest-name">${esc(m.name || (m.text || m.html || '').replace(/\s+/g, ' ').slice(0, 60) || '(untitled)')}</span>
        <span class="cond-hint">${esc(owner(m))}</span>
        <button class="mini-btn" title="Show in the graph" onclick="window.app.showInGraph('${m.id}')">${icon('graph')}</button>
        <button class="mini-btn" title="Remove from this quest" onclick="window.app.questClear('${m.id}')">${icon('x')}</button>
      </div>`).join('') || '<p class="empty-hint">Nothing in this quest yet.</p>'}
    </div>
    <div class="inline"><button class="icon-btn" onclick="window.app.questAddPick(event,'${questId}')">${icon('plus')} Add existing content…</button></div>`;
}

let questDragId = null;
document.addEventListener('dragstart', (ev) => {
  const row = ev.target.closest && ev.target.closest('.quest-row');
  if (!row) return;
  questDragId = row.dataset.mid;
  ev.dataTransfer.effectAllowed = 'move';
  try { ev.dataTransfer.setData('text/quest-row', questDragId); } catch (e) { /* ignore */ }
  row.classList.add('dragging');
});
document.addEventListener('dragend', () => { questDragId = null; document.querySelectorAll('.quest-row').forEach((r) => r.classList.remove('dragging', 'drop-above', 'drop-below')); });
document.addEventListener('dragover', (ev) => {
  const row = ev.target.closest && ev.target.closest('.quest-row');
  if (!questDragId || !row) return;
  ev.preventDefault();
  const r = row.getBoundingClientRect();
  const above = ev.clientY < r.top + r.height / 2;
  document.querySelectorAll('.quest-row').forEach((x) => x.classList.remove('drop-above', 'drop-below'));
  row.classList.add(above ? 'drop-above' : 'drop-below');
});
document.addEventListener('drop', (ev) => {
  const row = ev.target.closest && ev.target.closest('.quest-row');
  if (!questDragId || !row) return;
  ev.preventDefault();
  const r = row.getBoundingClientRect();
  const above = ev.clientY < r.top + r.height / 2;
  const list = Array.from(row.parentElement.querySelectorAll('.quest-row')).map((x) => x.dataset.mid);
  let before = null;
  const i = list.indexOf(row.dataset.mid);
  before = above ? row.dataset.mid : (list[i + 1] || null);
  const id = questDragId; questDragId = null;
  if (before === id) { refresh(); return; }
  qst().moveBefore(campaign, id, before);
  refresh();
});

function questActions() {
  return {
    questPick(ev, moduleId) { ev.stopPropagation(); questOpenMenu(ev, { mode: 'quest', moduleId }); },
    questAddPick(ev, questId) { questOpenMenu(ev, { mode: 'module', questId }); },
    questSetIndex(moduleId, v) { qst().moveTo(campaign, moduleId, v); refresh(); },
    questStep(moduleId, d) { qst().step(campaign, moduleId, d); refresh(); },
    questClear(moduleId) { qst().unassign(campaign, moduleId); refresh(); },
    questAssign(moduleId, questId) { qst().assign(campaign, moduleId, questId); refresh(); }
  };
}
