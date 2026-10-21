// Renderer application logic. Talks to the main process only through
// window.core (exposed by preload.js). No Node integration here.

let campaign = null;
let appSettings = {};
let campaignImagesBaseUrl = null; // refreshed in resetUiForCampaign whenever the active campaign changes
let arrivalSaveTimer = null;
let fieldSaveTimers = {};
let mentionState = { active: false, mode: 'insert', textareaId: null, textareaEl: null, atIndex: -1, query: '', items: [], allItems: [], highlighted: 0 };
let ui = {
  mode: 'play',
  curTime: null,
  curLocation: null,
  openEntityIds: [],
  fullPageEntityId: null,
  createTab: 'entities',
  librarySelectedModuleId: null,
  libraryNewFormOpen: false,
  libraryAssignPickerOpen: false,
  libraryAssignSearchQuery: '',
  libraryAssignSelectedEntityIds: [],
  libraryAssignTypeFilter: '',
  libraryAssignGroupFilter: '',
  libraryAssignHideAssigned: true,
  libraryAssignTimeId: '',
  libraryAssignResultNote: null, // { moduleId, text } — what the last bulk assign did, shown until the next action
  assignFromLibrary: null,
  dcCheckEditor: null,
  dcCheckEditorStack: [],
  dcCheckPlay: null,
  dcCheckPlayStack: [],
  imageCrop: null,
  pendingDeleteInventoryColumn: null,
  presencePicker: null,
  cardModalEntityId: null,
  sbEditorEntityId: null,
  cardSections: { voice: false, persona: false, statblock: false }, // Create-mode card sections start collapsed
  pendingResetStatblock: null,
  presenceOpen: false, // the "Present here" section starts collapsed
  // Manage-groups mode: which entity rows are selected (and the one a
  // Shift-click range extends from), the drag-and-drop controller while
  // the mode is open, and the new-entity form's draft (see the
  // "Draft entities" notes in dataModel.js).
  mgSelected: [],
  mgAnchor: null,
  mgDnd: null,
  newEntityDraft: null,
  notionImport: null,
  createSelectedEntityId: null,
  createContentLocationId: null,
  createContentTimeId: null,
  addingCheckpoint: false,
  checkpointManagerOpen: false,
  activeCampaignId: null,
  activeCampaignName: '',
  campaignList: [],
  campaignSwitcherOpen: false,
  newCampaignFormOpen: false,
  renamingCampaignId: null,
  confirmDeleteId: null,
  lastSceneSpeaker: null,
  pasteReview: null,
  expandedIds: [],
  entitySearchQuery: '',
  groupManagerOpen: false,
  bulkAddOpen: false,
  bulkAddType: 'npc',
  confirmDeleteGroupId: null,
  entitySelectMode: false,
  selectedEntityIds: []
};

// --- tiny inline icon set (no external/CDN dependency, works offline) ----

function icon(name) {
  const paths = {
    idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M14 10h4M14 14h4M6 16c.6-1.6 4.4-1.6 5 0"/>',
    chevronDown: '<path d="M6 9l6 6 6-6"/>',
    chevronUp: '<path d="M18 15l-6-6-6 6"/>',
    chevronRight: '<path d="M9 6l6 6-6 6"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 13l4 4L19 7"/>',
    bookmark: '<path d="M6 3h12v18l-6-4-6 4V3z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 4-6 8-6s8 2 8 6"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    scroll: '<path d="M8 4h10v13a3 3 0 01-3 3H6a3 3 0 003-3V6a2 2 0 00-1-2z"/><path d="M11 9h4M11 13h4"/>',
    mapPin: '<path d="M12 21s7-6.5 7-11a7 7 0 10-14 0c0 4.5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 4.7 1.2c0 1.6-2.2 1.8-2.2 3.3"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    chest: '<rect x="3" y="8" width="18" height="12" rx="1.5"/><path d="M3 12h18"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/><circle cx="12" cy="15" r="1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    arrowLeft: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    maximize: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
    graph: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.3 6.5l7.3 1M7.4 8.1l3.5 7.8M16.9 10.3l-3.5 5.6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    // NPC icon choices
    crown: '<path d="M4 18h16l-1-8-4 3-3-6-3 6-4-3-1 8z"/>',
    skull: '<path d="M12 3a7 7 0 00-7 7c0 3 1.5 4.5 2 6h10c.5-1.5 2-3 2-6a7 7 0 00-7-7z"/><circle cx="9.5" cy="10" r="1.1"/><circle cx="14.5" cy="10" r="1.1"/><path d="M10 16v3M14 16v3"/>',
    ghost: '<path d="M6 20V11a6 6 0 1112 0v9l-2-2-2 2-2-2-2 2-2-2z"/><circle cx="9.5" cy="11" r="0.9"/><circle cx="14.5" cy="11" r="0.9"/>',
    robot: '<rect x="5" y="8" width="14" height="11" rx="2"/><path d="M12 8V4M8 4h8"/><circle cx="9.5" cy="13" r="1.1"/><circle cx="14.5" cy="13" r="1.1"/><path d="M8 17h8"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    shield: '<path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z"/>',
    // Location icon choices
    building: '<rect x="5" y="4" width="14" height="17"/><path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1"/>',
    store: '<path d="M4 9l1-5h14l1 5"/><path d="M4 9v11h16V9"/><path d="M4 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0"/>',
    tent: '<path d="M12 4l9 16H3l9-16z"/><path d="M12 4v16"/>',
    anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M6 13a6 6 0 0012 0M4 13h4M16 13h4"/>',
    rocket: '<path d="M12 2c3 2 5 6 5 10 0 2-1 4-2 5l-3 3-3-3c-1-1-2-3-2-5 0-4 2-8 5-10z"/><circle cx="12" cy="10" r="2"/><path d="M9 17l-3 4M15 17l3 4"/>',
    door: '<rect x="6" y="3" width="12" height="18"/><circle cx="14.5" cy="12" r="1"/>',
    mountain: '<path d="M3 20l6-11 4 6 3-4 5 9H3z"/>'
  };
  return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.user}</svg>`;
}

function entityBadge(entity, size) {
  size = size || 20;
  const c = colorFor(entity.color);
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;min-width:${size}px;border-radius:50%;background:${c.bg};color:${c.fg};flex-shrink:0">${icon(entity.icon)}</span>`;
}

// Only true once there's actually something to show — an empty category
// (or none at all) shouldn't put a chest icon on every single entity
// card as clutter.
function entityHasInventory(entity) {
  return !!(entity && (entity.inventoryCategories || []).some((c) => (c.rows || []).length > 0));
}

// Shared by the location card, NPC card, and NPC full-page view — one
// place for the label-building logic rather than three copies of it.
// Empty string (nothing rendered) if the entity has no session/scene set.
function renderSceneLayoutButton(entity) {
  const sl = entity && entity.sceneLayout;
  if (!sl || !sl.session || !sl.scene) return '';
  const layoutLabel = sl.layout ? ` — ${esc(sl.layout.replace(/\.json$/, ''))}` : '';
  return `<button type="button" class="scene-btn entity-scene-btn" onclick="window.app.triggerDirectorEntityButton('${entity.id}')">Load: ${esc(sl.scene)}${layoutLabel}</button>`;
}

// Renders the Play-mode inventory popup's results for the current search
// query — same simple lowercase substring match used everywhere else in
// the app (entity search, mention/jump pickers), not a different, more
// elaborate search system just for this one view. Searches name, every
// text column, and price together; a category with zero matching rows is
// hidden entirely rather than shown with nothing under it. Category
// collapse state (Create mode) is deliberately ignored here — this is a
// quick reference popup, meant to show everything at a glance regardless
// of how it was left collapsed while editing.
//
// Each category shows its own columns under its own headers: the name,
// however many free-form text columns it has, then the price.
function renderInventoryResults(entityId, query) {
  const resultsEl = document.getElementById('inventory-results');
  if (!resultsEl) return;
  const entity = campaign.entities[entityId];
  const categories = entity ? (entity.inventoryCategories || []) : [];
  const nonEmpty = categories.filter((c) => (c.rows || []).length > 0);
  const q = (query || '').trim().toLowerCase();
  const cellOf = (row, col) => (row.cells && row.cells[col.id]) || '';

  const filtered = nonEmpty
    .map((cat) => {
      const cols = cat.columns || [];
      const rows = q
        ? (cat.rows || []).filter((r) =>
            (r.name || '').toLowerCase().includes(q) ||
            (r.price || '').toLowerCase().includes(q) ||
            cols.some((col) => cellOf(r, col).toLowerCase().includes(q)))
        : cat.rows;
      return { cat, rows };
    })
    .filter(({ rows }) => rows.length > 0);

  if (nonEmpty.length === 0) {
    resultsEl.innerHTML = `<p class="empty-hint">No inventory set.</p>`;
  } else if (filtered.length === 0) {
    resultsEl.innerHTML = `<p class="empty-hint">No items match "${esc(query)}".</p>`;
  } else {
    resultsEl.innerHTML = filtered.map(({ cat, rows }) => {
      const cols = cat.columns || [];
      // Name and price keep fixed shares; the free-form columns split
      // whatever is left evenly, however many there are.
      const textPct = cols.length > 0 ? (100 - 22 - 16) / cols.length : 0;
      return `
      <div class="section-subheading">${esc(cat.name)}</div>
      <table class="inventory-table-display">
        <colgroup><col style="width:22%">${cols.map(() => `<col style="width:${textPct}%">`).join('')}<col style="width:${cols.length > 0 ? 16 : 78}%"></colgroup>
        <thead><tr><th>${esc(cat.nameLabel || 'Name')}</th>${cols.map((col) => `<th>${esc(col.label)}</th>`).join('')}<th>${esc(cat.priceLabel || 'Price')}</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td>${cols.map((col) => `<td>${rich(cellOf(r, col))}</td>`).join('')}<td>${esc(r.price)}</td></tr>`).join('')}</tbody>
      </table>`;
    }).join('');
  }
}

function esc(s) { return window.Query.escapeHtml(s); }
// For display-only text (not inside an editable field): renders [[mention]]
// tokens as clickable pills and lightweight formatting (**bold**, _italic_,
// "quotes") as real markup. Editable textareas deliberately keep using
// esc() instead, since editing should show the raw markdown-ish syntax.
function rich(s) { return window.Query.renderMentions(s, campaign).html; }

function colorFor(key) {
  return window.Constants.COLOR_PALETTE.find((c) => c.key === key) || { bg: '#242220', fg: '#ece8e0' };
}

function locations() { return Object.values(campaign.entities).filter((e) => e.type === 'location'); }
function npcs() { return Object.values(campaign.entities).filter((e) => e.type === 'npc'); }

// Fire-and-forget: if this entity has a Notion link set, open it in the
// local Notion app alongside the normal "open" action. Scoped to Play
// mode's own open actions (switching to a location, opening an entity
// card or full page) — deliberately not triggered by Create mode's entity
// selection, since popping open an external app on every click while
// rapidly editing would be more annoying than useful there.
function maybeOpenNotion(entityId) {
  const entity = campaign.entities[entityId];
  if (!entity || !entity.notionUrl || !entity.notionUrl.trim()) return;
  window.core.openNotionLink(entity.notionUrl.trim()).then((result) => {
    if (!result || !result.ok) {
      console.warn('[notion] could not open link for', entity.name, '-', result && result.error);
    }
  });
}

// Alt+S: ask the Director picker what to insert and put the button's
// token into the text field. mode 'choose' asks first (scene / music / quickfire).
// Session and scene stay empty for "current scene" buttons.
function insertDirectorButton(ta, mode) {
  const insertStart = ta.selectionStart;
  const insertEnd = ta.selectionEnd;
  const enc = (v) => String(v || '').replace(/%/g, '%25').replace(/\]/g, '%5D');
  const bare = (n) => String(n || '').replace(/\.[A-Za-z0-9]+$/, '');
  const scrollTop0 = ta.scrollTop, winY0 = window.scrollY;
  const ancestors = [];
  for (let el = ta.parentElement; el; el = el.parentElement) { if (el.scrollTop > 0) ancestors.push({ el, top: el.scrollTop }); }
  window.app.openDirectorPicker((r) => {
    let token;
    if (r.kind === 'music') {
      token = `[[MUSICBTN:${enc(r.session)}|${enc(r.scene)}|${enc(r.music)}]]Music: ${bare(r.music)}${r.scene ? ` (${r.scene})` : ''}[[/MUSICBTN]]`;
    } else if (['genre', 'playlist', 'playlistoff', 'sfx', 'sfxstop', 'scenesfx', 'notion'].includes(r.kind)) {
      const d = (k, a, b, c, label) => `[[DIRBTN:${k}|${enc(a)}|${enc(b)}|${enc(c)}]]${label}[[/DIRBTN]]`;
      if (r.kind === 'genre') token = d('genre', r.genre, r.music, r.play ? '1' : '0', r.music ? `Genre music: ${bare(r.music)} (${r.genre})` : `Genre: ${r.genre}`);
      else if (r.kind === 'playlist') token = d('playlist', r.playlist, r.music, r.play ? '1' : '0', r.music ? `Playlist track: ${bare(r.music)} (${r.name})` : `Playlist: ${r.name}`);
      else if (r.kind === 'playlistoff') token = d('playlistoff', '', '', '', 'Leave playlist mode');
      else if (r.kind === 'notion') token = d('notion', r.url, '', '', `Notion: ${r.label}`);
      else if (r.kind === 'scenesfx') token = d('scenesfx', r.session, r.scene, r.sfx, `SFX: ${bare(r.sfx)}${r.scene ? ` (${r.scene})` : ''}`);
      else if (r.kind === 'sfx') token = d('sfx', r.category, r.sfx, '', `SFX: ${bare(r.sfx)}${r.category ? ` (${r.category})` : ''}`);
      else token = d('sfxstop', '', '', '', 'Stop SFX');
    } else if (r.kind === 'quickfire') {
      token = `[[QFBTN:${enc(r.session)}|${enc(r.scene)}|${enc(r.quickfire)}|${r.fire ? '1' : '0'}]]${r.fire ? 'Fire' : 'Select'}: ${bare(r.quickfire)}[[/QFBTN]]`;
    } else {
      const layoutLabel = r.layout ? ` — ${r.layout.replace(/\.json$/, '')}` : '';
      token = `[[SCENEBTN:${r.session}|${r.scene}|${r.layout}]]Load: ${r.scene}${layoutLabel}[[/SCENEBTN]]`;
    }
    // Put the token in without moving the view: remember the field's own scroll and
    // every scrolled ancestor (the page, panels), and put them back after the focus
    // and the redraw the input event may trigger.
    const saved = [{ el: ta, top: scrollTop0 }];
    ancestors.forEach((a) => saved.push({ el: a.el, top: a.top }));
    const winY = winY0;
    ta.setRangeText(token, insertStart, insertEnd, 'end');
    try { ta.focus({ preventScroll: true }); } catch { ta.focus(); }
    ta.selectionStart = ta.selectionEnd = insertStart + token.length;
    const restore = () => { saved.forEach((x) => { if (x.el.isConnected) x.el.scrollTop = x.top; }); window.scrollTo(window.scrollX, winY); };
    restore();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    restore();
    requestAnimationFrame(() => { restore(); setTimeout(restore, 60); });
  }, mode);
}

// Notion opens pages locally from a notion:// link: https://app.notion.com/p/… -> notion://app.notion.com/p/…
function toNotionScheme(url) {
  return String(url || '').trim().replace(/^https?:\/\//i, 'notion://');
}
// "…/Mr-Virel-3e9dbb69c392…?source=copy_link" -> "Mr Virel"
function notionTitleOf(url) {
  const m = String(url || '').split('?')[0].split('#')[0].replace(/\/+$/, '').split('/').pop() || '';
  const t = m.replace(/-?[0-9a-f]{32}$/i, '').replace(/-+/g, ' ').trim();
  return decodeURIComponent(t.replace(/%(?![0-9a-f]{2})/gi, '%25'));
}

// Sends a scene/layout-switch command to the Director tool. Failures get
// a visible alert rather than a silent console.warn (unlike Notion above)
// — this is meant to be pressed mid-session, where "nothing happened and
// I don't know why" is a much worse experience than a blocking dialog
// that says exactly what to fix.
function sendDirectorCommandWithFeedback(session, scene, layout) {
  sendDirectorWithFeedback({ session, scene, layout });
}
function sendDirectorWithFeedback(cmd) {
  window.core.sendDirectorCommand(cmd).then((result) => {
    if (!result || !result.ok) {
      window.Health.notice(`Couldn't send to the Director tool: ${(result && result.error) || 'unknown error'}`);
    }
  });
}

// --- persistence -----------------------------------------------------------

// What actually gets written. Normally that's just the campaign — but while
// the new-entity form is open, the entity being drafted, everything assigned
// to it, and the notes/topics made for it must not reach disk until the
// person presses Create (see "Draft entities" in dataModel.js). The draft
// entity itself is already invisible to a copy; this strips the rest.
function persistableCampaign() {
  const draft = ui.newEntityDraft;
  if (!draft || !window.DataModel.isDraftEntity(campaign, draft.id)) return campaign;
  const owned = window.DataModel.getDraftOwnedModuleIds(campaign, draft.id, draft.moduleSnapshot);
  return {
    ...campaign,
    entities: { ...campaign.entities },
    assignments: campaign.assignments.filter((a) => a.entityId !== draft.id),
    contentModules: campaign.contentModules.filter((m) => !owned.has(m.id))
  };
}

async function persist() {
  await window.core.saveCampaign(persistableCampaign());
}

// Saving must never be able to block or break the UI: failures are caught and
// reported (the main process retries on its own), and a slow save no longer
// delays the redraw.
async function persistSafely() {
  try {
    await persist();
  } catch (err) {
    if (window.Health) window.Health.report('persist-failed', { err: window.Health.errorInfo(err) });
  }
}

async function refresh() {
  renderAll();
  await persistSafely();
}

// For continuous-typing fields (oninput, not onchange): updates memory
// immediately (so nothing is ever lost by clicking elsewhere before
// blurring) but debounces the actual disk write per field, keyed so
// multiple fields typing at once don't cancel each other's timers.
function scheduleFieldSave(key) {
  if (fieldSaveTimers[key]) clearTimeout(fieldSaveTimers[key]);
  fieldSaveTimers[key] = setTimeout(() => { persistSafely(); }, 500);
}

// --- Searchable picker (type to filter a long list) -----------------------------------------
// searchPickHTML(id, options, value, handlerName): options = [{ value, label, group? }].
// Choosing calls window.app[handlerName](value) (or a global of that name).
const SP = {};
function searchPickHTML(id, options, value, handler, opts) {
  opts = opts || {};
  SP[id] = { options, handler, hi: 0, shown: [] };
  const cur = options.find((o) => String(o.value) === String(value == null ? '' : value));
  return `<span class="sp" id="sp-${id}"><input class="sp-input" id="sp-in-${id}" autocomplete="off" spellcheck="false" placeholder="${esc(opts.placeholder || 'Type to search…')}" value="${esc(cur ? cur.label : '')}" data-label="${esc(cur ? cur.label : '')}" onfocus="spOpen('${id}')" oninput="spFilter('${id}')" onkeydown="spKey(event,'${id}')" onblur="setTimeout(()=>spClose('${id}'),160)"><div class="sp-list" id="sp-list-${id}" style="display:none"></div></span>`;
}
function spRender(id, q) {
  const st = SP[id], list = document.getElementById(`sp-list-${id}`);
  if (!st || !list) return;
  const words = (q || '').toLowerCase().split(/\s+/).filter(Boolean);
  st.shown = st.options.filter((o) => { const hay = `${o.label} ${o.group || ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
  if (st.hi >= st.shown.length) st.hi = Math.max(0, st.shown.length - 1);
  let html = '', lastGroup = null;
  st.shown.forEach((o, i) => {
    if (o.group && o.group !== lastGroup) { html += `<div class="sp-group">${esc(o.group)}</div>`; lastGroup = o.group; }
    html += `<div class="sp-item ${i === st.hi ? 'hi' : ''}" data-i="${i}" onmousedown="spPick(event,'${id}',${i})">${esc(o.label)}</div>`;
  });
  list.innerHTML = html || '<div class="sp-none">Nothing matches.</div>';
  list.style.display = 'block';
  const hi = list.querySelector('.sp-item.hi'); if (hi && hi.scrollIntoView) hi.scrollIntoView({ block: 'nearest' });
}
function spOpen(id) { const inp = document.getElementById(`sp-in-${id}`); if (!inp) return; if (SP[id]) SP[id].hi = 0; inp.select(); spRender(id, ''); }
function spFilter(id) { const inp = document.getElementById(`sp-in-${id}`); if (SP[id]) SP[id].hi = 0; spRender(id, inp ? inp.value : ''); }
function spClose(id) {
  const list = document.getElementById(`sp-list-${id}`), inp = document.getElementById(`sp-in-${id}`);
  if (list) list.style.display = 'none';
  if (inp) inp.value = inp.dataset.label || '';
}
function spChoose(id, i) {
  const st = SP[id]; if (!st || !st.shown[i]) return;
  const o = st.shown[i], inp = document.getElementById(`sp-in-${id}`), list = document.getElementById(`sp-list-${id}`);
  if (inp) { inp.value = o.label; inp.dataset.label = o.label; }
  if (list) list.style.display = 'none';
  const fn = (window.app && window.app[st.handler]) || window[st.handler];
  if (fn) fn(o.value);
}
function spPick(ev, id, i) { ev.preventDefault(); spChoose(id, i); }
function spKey(ev, id) {
  const st = SP[id], list = document.getElementById(`sp-list-${id}`);
  if (!st) return;
  const open = list && list.style.display !== 'none';
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    if (!open) { spOpen(id); return; }
    st.hi = Math.max(0, Math.min(st.shown.length - 1, st.hi + (ev.key === 'ArrowDown' ? 1 : -1)));
    spRender(id, document.getElementById(`sp-in-${id}`).value);
  } else if (ev.key === 'Enter' && open) {
    ev.preventDefault(); ev.stopPropagation(); spChoose(id, st.hi);
  } else if (ev.key === 'Escape' && open) {
    ev.preventDefault(); ev.stopPropagation(); spClose(id);
  }
}

// --- init --------------------------------------------------------------

async function init() {
  try {
    if (!window.Query || !window.DataModel || !window.Constants) {
      throw new Error(
        'The app\'s own logic files did not load (window.Query/DataModel/Constants are missing).\n\n' +
        'These are generated automatically into renderer/vendor-bundle.js on every launch, ' +
        'sitting next to app.js.\n\n' +
        'Quick fix to try right now: close the app, open a terminal in the project folder, run:\n' +
        '  node scripts/copy-shared.js\n' +
        'then run "npm start" again. If that fails too, the terminal output from either command ' +
        'will show the actual error — that\'s the next thing worth sharing.'
      );
    }
    if (window.core.onSaveStatus && window.Health) window.core.onSaveStatus((st) => window.Health.setSaveStatus(st));
    campaign = await window.core.loadCampaign();
    appSettings = await window.core.getSettings();
    const activeInfo = await window.core.activeCampaignInfo();
    ui.activeCampaignId = activeInfo ? activeInfo.id : null;
    ui.activeCampaignName = activeInfo ? activeInfo.name : 'Campaign';
    await resetUiForCampaign();
    renderAll();
  } catch (err) {
    showFatalError(err);
  }
}

// Resets everything in `ui` that references entities/checkpoints from a
// specific campaign — called on first load and after switching/creating a
// campaign, since none of those references are valid for a different one.
// Also refreshes the cached images base URL, since a different campaign
// means a different images/ folder on disk.
async function resetUiForCampaign() {
  const cps = window.Query.sortedCheckpoints(campaign);
  const locs = locations();
  ui.openEntityIds = [];
  ui.fullPageEntityId = null;
  ui.createSelectedEntityId = null;
  // Continue where the DM left off: the location last edited in the Content tab.
  const lastLoc = campaign.meta.lastContentLocationId && campaign.entities[campaign.meta.lastContentLocationId];
  ui.createContentLocationId = lastLoc && lastLoc.type === 'location' ? lastLoc.id : null;
  // ...and the milestone, text field and caret position it was left at.
  ui.createContentTimeId = campaign.meta.lastContentTimeId && cps.some((c) => c.id === campaign.meta.lastContentTimeId) ? campaign.meta.lastContentTimeId : null;
  const lf = campaign.meta.lastContentField;
  ui.contentRestore = lf && lf.locationId === ui.createContentLocationId && lf.timeId === ui.createContentTimeId ? lf : null;
  ui.addingCheckpoint = false;
  ui.checkpointManagerOpen = false;
  ui.pasteReview = null;
  ui.expandedIds = [];
  ui.entitySearchQuery = '';
  ui.groupManagerOpen = false;
  ui.bulkAddOpen = false;
  ui.confirmDeleteGroupId = null;
  ui.entitySelectMode = false;
  ui.selectedEntityIds = [];
  ui.libraryAssignPickerOpen = false;
  ui.libraryAssignSelectedEntityIds = [];
  ui.libraryAssignResultNote = null;
  ui.pendingDeleteInventoryColumn = null;
  ui.presencePicker = null;
  ui.cardModalEntityId = null;
  ui.sbEditorEntityId = null;
  ui.pendingResetStatblock = null;
  ['character-card-modal', 'statblock-modal'].forEach((id) => { const m = document.getElementById(id); if (m) m.style.display = 'none'; });
  ui.mgSelected = [];
  ui.mgAnchor = null;
  ui.newEntityDraft = null; // the draft lived in the campaign that has just been replaced
  closePicker();
  if (campaign.meta.startBookmark) {
    ui.curLocation = campaign.meta.startBookmark.locationId;
    ui.curTime = campaign.meta.startBookmark.timeId;
  } else {
    ui.curLocation = locs[0] ? locs[0].id : null;
    ui.curTime = cps[0] ? cps[0].id : null;
  }
  campaignImagesBaseUrl = await window.core.getImagesBaseUrl();
}

// A full file:// URL for this entity's uploaded image, or null if it has
// none — null (not a placeholder path) is exactly what lets every render
// site just do `img ? ... : ` without needing its own existence check.
function entityImageUrl(entity) {
  if (!entity || !entity.image || !entity.image.filename || !campaignImagesBaseUrl) return null;
  // The filename never changes across a replace (always <entityId>.jpg),
  // so without a cache-busting suffix the browser's own image cache would
  // keep serving the old bytes for this exact URL even after the file on
  // disk has genuinely changed underneath it.
  const version = entity.image.updatedAt ? `?v=${encodeURIComponent(entity.image.updatedAt)}` : '';
  return `${campaignImagesBaseUrl}/${encodeURIComponent(entity.image.filename)}${version}`;
}

const ENTITY_IMAGE_SIZE_PX = { small: 32, medium: 56, large: 96 };

// Shown to the left of the name only where an entity's own card is
// actually displayed (the opened entity card, the NPC full-page view) —
// never in a presence list or on a mention pill, which keeps the number
// of images ever loaded at once naturally small regardless of campaign
// size. Passes the entity id to the click handler rather than the image
// URL itself: a campaign folder or filename could contain an apostrophe
// (Node's pathToFileURL does not escape those), which would break a raw
// URL embedded as a JS string literal inside the onclick attribute — the
// id is always safe, app-generated and alphanumeric, and the handler
// re-derives the URL itself from it.
function renderEntityImageThumbnailHTML(entity) {
  const url = entityImageUrl(entity);
  if (!url) return '';
  const px = ENTITY_IMAGE_SIZE_PX[(entity.image && entity.image.size) || 'medium'] || ENTITY_IMAGE_SIZE_PX.medium;
  return `<img src="${esc(url)}" class="entity-play-image" style="width:${px}px;height:${px}px" onclick="event.stopPropagation();window.app.openImageLightbox('${entity.id}')" alt="">`;
}

// --- Image crop modal ------------------------------------------------
//
// Opened whenever an image is picked for upload (see uploadEntityImageUI) —
// cropping is always in the loop now, not an optional extra step. The
// original file picked from disk is never itself copied into the
// campaign folder; only this tool's square, re-encoded JPEG output is
// (see image:pickSource / image:saveCropped in main.js). The actual
// math (minimum zoom, valid pan range, which source pixels end up in the
// final crop) lives in the pure, unit-tested src/imageCrop.js — this is
// just the DOM wiring on top of it: loading the picked image, translating
// mouse drags and the zoom slider into that state, and drawing the final
// canvas on Save.

const IMAGE_CROP_VIEWPORT_SIZE = 300; // must match .image-crop-viewport's CSS width/height
const IMAGE_CROP_OUTPUT_SIZE = 320; // the fixed resolution saved to disk, regardless of display size later

function applyImageCropTransform() {
  const state = ui.imageCrop;
  const imgEl = document.getElementById('image-crop-img');
  if (!state || !imgEl) return;
  const displayScale = state.baseScale * state.zoom;
  imgEl.style.width = `${state.naturalWidth * displayScale}px`;
  imgEl.style.height = `${state.naturalHeight * displayScale}px`;
  imgEl.style.left = `${state.offsetX}px`;
  imgEl.style.top = `${state.offsetY}px`;
}

function openImageCropModal(entityId, dataUrl) {
  const modal = document.getElementById('image-crop-modal');
  const imgEl = document.getElementById('image-crop-img');
  const zoomSlider = document.getElementById('image-crop-zoom');
  if (!modal || !imgEl || !zoomSlider) return;

  imgEl.onload = () => {
    const naturalWidth = imgEl.naturalWidth;
    const naturalHeight = imgEl.naturalHeight;
    const baseScale = window.ImageCrop.baseCoverScale(naturalWidth, naturalHeight, IMAGE_CROP_VIEWPORT_SIZE);
    const displayedWidth = naturalWidth * baseScale;
    const displayedHeight = naturalHeight * baseScale;
    ui.imageCrop = {
      entityId, naturalWidth, naturalHeight,
      viewportSize: IMAGE_CROP_VIEWPORT_SIZE,
      baseScale, zoom: 1,
      offsetX: window.ImageCrop.centeredOffset(displayedWidth, IMAGE_CROP_VIEWPORT_SIZE),
      offsetY: window.ImageCrop.centeredOffset(displayedHeight, IMAGE_CROP_VIEWPORT_SIZE),
      dragging: null
    };
    zoomSlider.value = '1';
    applyImageCropTransform();
  };
  // A safety net, not the primary fix for any specific bug — if the
  // image ever fails to load for any reason, this surfaces it clearly
  // instead of leaving an empty grey box with a Save button that
  // silently does nothing (exactly what an earlier CSP gap caused here).
  imgEl.onerror = () => {
    window.app.closeImageCropModal();
    window.Health.notice("Couldn't load that image — it may be corrupted or an unsupported format.");
  };
  imgEl.src = dataUrl;
  modal.style.display = 'flex';
}

// Always attached, not added/removed per drag — a much simpler way to
// handle "the mouse can move outside the image, or even outside the
// window, while still dragging" than dynamically wiring listeners on
// mousedown and unwiring them on mouseup. Both are cheap no-ops whenever
// no crop is actually in progress or nothing is currently being dragged.
document.addEventListener('mousemove', (e) => {
  const state = ui.imageCrop;
  if (!state || !state.dragging) return;
  const displayScale = state.baseScale * state.zoom;
  const displayedWidth = state.naturalWidth * displayScale;
  const displayedHeight = state.naturalHeight * displayScale;
  const dx = e.clientX - state.dragging.startX;
  const dy = e.clientY - state.dragging.startY;
  state.offsetX = window.ImageCrop.clampOffset(state.dragging.startOffsetX + dx, displayedWidth, state.viewportSize);
  state.offsetY = window.ImageCrop.clampOffset(state.dragging.startOffsetY + dy, displayedHeight, state.viewportSize);
  applyImageCropTransform();
});
document.addEventListener('mouseup', () => {
  const state = ui.imageCrop;
  if (!state || !state.dragging) return;
  state.dragging = null;
  const viewport = document.getElementById('image-crop-viewport');
  if (viewport) viewport.classList.remove('dragging');
});

// --- top-level render dispatch -----------------------------------------

// Rebuilding a view replaces its HTML, which collapses the scroll container
// for a moment and throws the page back to the top. In Create mode that meant
// every click on New entity, every dropdown change and Create jumped to the
// top. This puts the scroll position back after a redraw -- but only while
// staying on the same Create tab, so switching tabs or modes still starts at
// the top as before.
let lastScrollKey = null;
let renderingAll = false;
function keepScroll(fn) {
  const sc = document.getElementById('main-scroll');
  const top = sc ? sc.scrollTop : 0;
  fn();
  if (!sc) return;
  sc.scrollTop = top;
  requestAnimationFrame(() => { if (Math.abs(sc.scrollTop - top) > 1) sc.scrollTop = top; });
}

function renderAll() {
  try {
    const key = ui.mode === 'create' ? `create|${ui.createTab}` : `play|${ui.curLocation}|${ui.fullPageEntityId || ''}|${ui.curTime}`;
    const same = key !== null && key === lastScrollKey;
    lastScrollKey = key;
    renderingAll = true;
    try { if (same) keepScroll(renderAllInner); else renderAllInner(); } finally { renderingAll = false; }
    condAfterRender();
    hideFatalError();
  } catch (err) {
    showFatalError(err);
  }
}

function showFatalError(err) {
  console.error(err);
  let el = document.getElementById('fatal-error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'fatal-error';
    el.style.cssText = 'position:fixed;inset:0;background:#1c1a17;color:#f0997b;padding:16px;font-family:monospace;font-size:12px;white-space:pre-wrap;overflow:auto;z-index:9999;';
    document.body.appendChild(el);
  }
  el.style.display = 'block';
  const detail = err && err.stack ? err.stack : String(err);
  el.textContent = 'Something went wrong while rendering.\n\nYour saved data has not been touched — this is a display error, not data loss.\n\n' + detail;
}

function hideFatalError() {
  const el = document.getElementById('fatal-error');
  if (el) el.style.display = 'none';
}

function renderAllInner() {
  // Conditional text collapses while playing and shows everything (labelled) while preparing.
  window.Conditions.syncDCChecks(campaign);
  window.Conditions.setContext({ curTimeId: ui.curTime, mode: ui.mode === 'play' ? 'play' : 'edit', open: ui.condOpen });
  document.getElementById('tab-play').classList.toggle('active', ui.mode === 'play');
  document.getElementById('tab-create').classList.toggle('active', ui.mode === 'create');
  document.getElementById('play-view').style.display = ui.mode === 'play' ? 'block' : 'none';
  document.getElementById('create-view').style.display = ui.mode === 'create' ? 'block' : 'none';
  document.getElementById('selectors').style.display = ui.mode === 'play' ? 'flex' : 'none';

  renderCampaignBar();
  document.getElementById('campaign-switcher').style.display = ui.campaignSwitcherOpen ? 'flex' : 'none';
  if (ui.campaignSwitcherOpen) renderCampaignSwitcherBody();

  renderTitlebarActions();
  if (ui.mode === 'play') {
    renderSelectors();
    renderPlayView();
  } else {
    renderCreateView();
  }
  if (ui.gvWinModuleId || ui.gvWinEntityId) renderGraphWindow();
}

function renderCampaignBar() {
  const el = document.getElementById('campaign-bar');
  el.innerHTML = `
    <button class="campaign-bar-btn" onclick="window.app.openCampaignSwitcher()">
      ${icon('bookmark')} ${esc(ui.activeCampaignName || 'Campaign')} ${icon('chevronDown')}
    </button>
  `;
}

// One place to look every shortcut up, grouped by where it applies —
// added here specifically because the tool had accumulated enough of
// these (formatting, field triggers, navigation, Play-mode-only) that
// there was no single place to check them all.
function renderHelpBody() {
  const row = (key, desc) => `<div class="help-row"><span class="help-key">${esc(key)}</span><span>${esc(desc)}</span></div>`;
  return `
    <p class="hint">Tip: <b>right-click inside any text field</b> for a menu with every insert and formatting option below (Shift+right-click gives the plain system menu).</p>

    <div class="section-label">Text formatting (any text field)</div>
    ${row('Ctrl+B', 'Bold the selected text')}
    ${row('Ctrl+I', 'Italicize the selected text')}
    ${row('Ctrl+E', 'Mark the selected text as a DM comment (shown only to you)')}
    ${row('Ctrl+Shift+S', 'Strike through the selected text')}
    ${row('- ', 'Start a line with a dash for a bullet list; Enter continues the list, Enter on an empty bullet ends it')}
    ${row('Tab / Shift+Tab', 'Indent / outdent the bullet you are on')}
    <p class="hint">With nothing selected, bold/italic/DM comment drop an empty marker with the cursor in the middle, ready to type.</p>

    <div class="section-label">Insert (any text field)</div>
    ${row('@', 'Mention an NPC or location')}
    ${row('""', 'Dialogue: pick the speaker, then type the line. Enter ends it, Shift+Enter breaks the line inside it')}
    ${row('Ctrl+L', 'Link to a section, topic, scene, description, NPC or location')}
    ${row('Alt+D', 'Insert a DC check (or open the one the cursor is in). A check can contain other DC checks')}
    ${row('Alt+S', 'Insert a tool button. It asks what the button should do:')}
    <div class="help-sub"><b>Director tool</b> — scene, music, playlist, atmosphere sound FX, quickfire sound FX, light scenes</div>
    <div class="help-sub"><b>Notion link</b> — a button that opens your locally installed Notion in the background</div>
    ${row('Right-click → Make conditional', 'Select text, then show it only for certain results of a condition')}
    <p class="hint">In the pop-up lists: ↑ ↓ to move, Enter or Tab to choose, Esc to close. Music, quickfire and sound buttons can act on the scene that is active in the Director tool at that moment ("Current scene") or on a specific scene.</p>

    <div class="section-label">Navigation (anywhere)</div>
    ${row('Ctrl/Cmd+K', 'Jump to a location or NPC')}
    ${row('Ctrl/Cmd+K again', 'Switch that search to content search: finds text in descriptions, scenes, sections, notes and topics. Enter jumps to the exact spot; content on several entities asks which one first')}
    ${row('Ctrl/Cmd +', 'Step to the next checkpoint')}
    ${row('Ctrl/Cmd -', 'Step to the previous checkpoint')}
    ${row('Esc', 'Close the open pop-up, search or dialog; leaves a full-screen text field')}

    <div class="section-label">Play mode</div>
    ${row('Hover', 'A mention, quote or "Available here" chip shows a quick card with image and general notes')}
    ${row('Shift+L', "View the current location's loot table")}
    ${row('Middle-click', 'Close an open entity card')}

    <div class="section-label">Create mode</div>
    ${row('Hover a text field', 'A small button in its corner opens it full-screen for long text')}
    ${row('Graph: double-click', 'Create content on empty space')}
    ${row('Graph: drag from a dot', 'Connect a card to an entity; click the dot on a line to set when it applies')}
    ${row('Graph: Shift-drag', 'Select several cards (Ctrl-click adds to the selection)')}
    ${row('Graph: Delete', 'Remove the selected cards from the graph (nothing is deleted from your campaign)')}
    ${row('Graph: Ctrl+Z / Ctrl+Y', 'Undo / redo; Ctrl+A selects all')}
  `;
}

// The Director-tool paths are the only settings with any in-app UI right
// now (Notion's path stays hand-edit-only in settings.json, same as
// before this feature — no reason to build a UI for it just because one
// exists for something else now). "Browse..." uses a native folder
// picker; the text input underneath stays editable by hand too, for a
// path on a different drive/machine or one that isn't browsable from here.
function renderSettingsBody() {
  return `
    <div class="section-label">Director tool integration</div>
    <p class="hint">Both paths are needed for the scene/layout picker on locations and the Alt+S button in text fields. Leave either blank to leave that part of the integration inactive.</p>
    <div class="form-row"><label>Session prep folder</label>
      <div class="inline">
        <input type="text" id="settings-prep-root" value="${esc(appSettings.directorPrepRootPath || '')}" placeholder="Where your sessions/scenes/layouts live" style="flex:1">
        <button class="icon-btn" onclick="window.app.browseSettingsFolder('settings-prep-root')">Browse…</button>
      </div>
    </div>
    <div class="form-row"><label>Director app folder</label>
      <div class="inline">
        <input type="text" id="settings-app-folder" value="${esc(appSettings.directorAppFolderPath || '')}" placeholder="Where main.py or the compiled exe lives" style="flex:1">
        <button class="icon-btn" onclick="window.app.browseSettingsFolder('settings-app-folder')">Browse…</button>
      </div>
    </div>
    <div class="section-label">Artwork</div>
    <p class="hint">Artwork default folder: when a new NPC or location gets a name, images in this folder (and its subfolders) with a matching file name are offered as its image. Matching is forgiving — "Mira Selven" finds MiraSelven.png, mira-selven.jpg, Mira_Selven_02.webp…</p>
    <div class="form-row"><label>Artwork default folder</label>
      <div class="inline">
        <input type="text" id="settings-artwork-folder" value="${esc(appSettings.artworkFolderPath || '')}" placeholder="Folder with your NPC/location artwork" style="flex:1">
        <button class="icon-btn" onclick="window.app.browseSettingsFolder('settings-artwork-folder')">Browse…</button>
      </div>
    </div>
    <button class="icon-btn" onclick="window.app.saveSettingsFromModal()">${icon('check')} Save</button>
    <p class="hint">Sending a command only works while the Director tool is actually running — it polls for changes every ~750ms, so there's a brief moment after clicking before it responds.</p>
  `;
}

// Renders whichever step the shared Director picker (ui.directorPicker)
// is currently on. Called after every state change rather than returning
// a value, since two of the three steps involve an async fetch in
// between — render once immediately with a loading state, then again
// once the list actually arrives.
function renderDirectorPickerBody() {
  const body = document.getElementById('director-picker-body');
  const title = document.getElementById('director-picker-title');
  const p = ui.directorPicker;
  if (!body || !p) return;
  const q = p.mode === 'quickfire';
  const sfxScene = p.mode === 'scenesfx';
  const what = p.mode === 'music' ? 'a music track' : q ? 'a quickfire sound' : sfxScene ? 'an SFX track' : 'a scene';
  const backLink = (label) => `<button class="mini-btn" style="margin-bottom:8px" onclick="window.app.directorPickerBack()">${icon('chevronUp')} ${esc(label)}</button>`;
  const searchBox = (ph) => `<input type="text" id="director-picker-search" class="director-search" autocomplete="off" placeholder="${esc(ph)}" value="${esc(p.query || '')}" oninput="window.app.directorPickerFilter(this.value)" onkeydown="window.app.directorPickerKey(event)">`;
  const list = '<div id="director-picker-list"></div>';
  const btnRow2 = `<button class="icon-btn" style="display:block;width:100%;text-align:left;margin-bottom:4px" onclick="window.app.pickDirectorNotion()">📓 Notion link</button>`;
  const btnRow = (fn, label) => `<button class="icon-btn" style="display:block;width:100%;text-align:left;margin-bottom:4px" onclick="${fn}">${label}</button>`;
  let head = '';
  if (p.step === 'kind') {
    title.textContent = 'What should the button do?';
    body.innerHTML = `<button class="icon-btn" style="display:block;width:100%;text-align:left;margin-bottom:4px" onclick="window.app.pickDirectorKind('scene')">🎬 Load a scene (and layout)</button>
      <button class="icon-btn" style="display:block;width:100%;text-align:left;margin-bottom:4px" onclick="window.app.pickDirectorGroup('musicsrc')">♫ Play a music track…</button>
      <button class="icon-btn" style="display:block;width:100%;text-align:left;margin-bottom:4px" onclick="window.app.pickDirectorKind('quickfire')">⚡ Fire a quickfire sound</button>
      <button class="icon-btn" style="display:block;width:100%;text-align:left;margin-bottom:4px" onclick="window.app.pickDirectorKind('playlist')">☰ Switch playlist</button>
      <button class="icon-btn" style="display:block;width:100%;text-align:left;margin-bottom:4px" onclick="window.app.pickDirectorGroup('sfxsrc')">🔊 Play an SFX track…</button>
      ${btnRow2}
      <p class="hint">Press 1 to 6.</p>`;
    p.visible = [];
    return;
  }
  if (p.step === 'notion') {
    title.textContent = 'Notion link';
    body.innerHTML = backLink('Back') +
      `<p class="hint">Paste the page link (Copy link in Notion). The button opens it in the Notion app.</p>
      <input type="text" id="director-notion-url" class="director-search" autocomplete="off" placeholder="https://app.notion.com/p/…" oninput="window.app.notionPickerInput(this.value)" onkeydown="if(event.key==='Enter'){event.preventDefault();window.app.pickDirectorNotionDone()}else if(event.key==='Escape'){window.app.closeDirectorPicker()}">
      <input type="text" id="director-notion-label" class="director-search" autocomplete="off" placeholder="Button text (optional)" onkeydown="if(event.key==='Enter'){event.preventDefault();window.app.pickDirectorNotionDone()}else if(event.key==='Escape'){window.app.closeDirectorPicker()}">
      <div style="margin-top:8px"><button class="icon-btn" onclick="window.app.pickDirectorNotionDone()">Insert button</button></div>`;
    p.visible = [];
    const u = document.getElementById('director-notion-url'); if (u) u.focus();
    return;
  }
  if (p.step === 'musicsrc' || p.step === 'sfxsrc') {
    const m = p.step === 'musicsrc';
    title.textContent = m ? 'Where does the music come from?' : 'Where does the SFX come from?';
    body.innerHTML = backLink('Back') +
      btnRow(m ? "window.app.pickDirectorKind('music')" : "window.app.pickDirectorKind('scenesfx')", m ? "🎬 A scene's music list" : "🎬 A scene's SFX list") +
      btnRow(m ? "window.app.pickDirectorKind('genre')" : "window.app.pickDirectorKind('sfx')", m ? '📁 A genre folder (music library)' : '📁 The SFX library (folders)') +
      '<p class="hint">Press 1 or 2.</p>';
    p.visible = [];
    return;
  }
  if (['genre', 'genretrack', 'playlist', 'playlisttrack', 'sfxcat', 'sfxfile'].includes(p.step)) {
    const T = {
      genre: ['Choose a genre folder', 'Search genres…'], genretrack: [`Genre — ${p.genre}`, 'Search tracks…'],
      playlist: ['Choose a playlist', 'Search playlists…'], playlisttrack: [`Playlist — ${p.playlistItem ? p.playlistItem.name : ''}`, 'Search tracks…'],
      sfxcat: ['Choose an SFX folder', 'Search SFX folders…'], sfxfile: [`SFX — ${p.sfxCat || 'library root'}`, 'Search SFX…']
    }[p.step];
    title.textContent = T[0];
    head = backLink('Back') + searchBox(T[1]);
  } else if (p.step === 'session') {
    title.textContent = p.mode === 'scene' ? 'Choose a session' : `Choose a session — for ${what}`;
    head = (p.kindChosen ? backLink('Back') : '') + searchBox('Search sessions and scenes…');
  } else if (p.step === 'scene') {
    title.textContent = `Choose a scene — ${p.session}`;
    head = backLink('Back to sessions') + searchBox('Search scenes…');
  } else if (p.step === 'layout') {
    title.textContent = `Choose a layout — ${p.scene}`;
    head = backLink('Back to scenes') + searchBox('Search layouts…');
  } else if (p.step === 'music' || p.step === 'quickfire' || p.step === 'scenesfx') {
    title.textContent = `${q ? 'Choose a quickfire sound' : sfxScene ? 'Choose an SFX track' : 'Choose a music track'} — ${p.scene}`;
    head = backLink('Back to scenes') + searchBox(q ? 'Search quickfire sounds…' : sfxScene ? 'Search SFX…' : 'Search tracks…') +
      (q ? `<label class="gv-check" style="margin:8px 0;display:block"><input type="checkbox" ${p.fire ? 'checked' : ''} onchange="window.app.directorPickerFire(this.checked)"> Play it when the button is pressed (otherwise it only gets selected)</label>` : '');
  } else if (p.step === 'manual') {
    title.textContent = `${q ? 'Quickfire sound' : sfxScene ? 'SFX track' : 'Music track'} — current scene`;
    body.innerHTML = backLink('Back') +
      `<p class="hint">Type the ${q ? 'file name from the scene\'s quickfire folder' : sfxScene ? 'file name from the scene\'s SFX list' : 'track name exactly as the scene\'s music list shows it'} (with its extension).</p>
      ${q ? `<label class="gv-check" style="display:block;margin-bottom:8px"><input type="checkbox" ${p.fire ? 'checked' : ''} onchange="window.app.directorPickerFire(this.checked)"> Play it when the button is pressed</label>` : ''}
      <div style="display:flex;gap:6px"><input type="text" id="director-picker-manual" style="flex:1" placeholder="${q ? 'explosion.wav' : 'theme.mp3'}" onkeydown="if(event.key==='Enter')window.app.pickDirectorManual()"><button class="icon-btn" onclick="window.app.pickDirectorManual()">OK</button></div>`;
    p.visible = [];
    const inp = document.getElementById('director-picker-manual'); if (inp) inp.focus();
    return;
  }
  body.innerHTML = head + list;
  renderDirectorPickerList();
  const sb = document.getElementById('director-picker-search');
  if (sb) { sb.focus(); sb.setSelectionRange(sb.value.length, sb.value.length); }
}

// The rows of the current step, filtered by the search text. Every word typed has to
// appear somewhere in a row (case-insensitive), so "harb wave" finds "Harbour / wave.mp3".
function directorPickerRows(p) {
  const words = String(p.query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const match = (text) => { const t = text.toLowerCase(); return words.every((w) => t.includes(w)); };
  const rows = [];
  if (p.step === 'genre') {
    (p.items || []).filter(match).forEach((g) => rows.push({ label: g, fn: () => window.app.pickDirectorGenre(g) }));
  } else if (p.step === 'genretrack') {
    if (!words.length) {
      rows.push({ label: '▶ Switch the music panel to this genre and start it', fn: () => window.app.finishDirectorExtra({ kind: 'genre', genre: p.genre, music: '', play: true }) });
      rows.push({ label: 'Switch the music panel to this genre (do not start)', fn: () => window.app.finishDirectorExtra({ kind: 'genre', genre: p.genre, music: '', play: false }) });
    }
    (p.items || []).filter(match).forEach((n) => rows.push({ label: n, fn: () => window.app.finishDirectorExtra({ kind: 'genre', genre: p.genre, music: n, play: true }) }));
  } else if (p.step === 'playlist') {
    if (!words.length) rows.push({ label: 'Leave playlist mode (back to the genre list)', fn: () => window.app.finishDirectorExtra({ kind: 'playlistoff' }) });
    (p.items || []).filter((x) => match(x.label)).forEach((x) => rows.push({ label: `${x.label}  (${x.tracks} tracks)`, fn: () => window.app.pickDirectorPlaylist(x) }));
  } else if (p.step === 'playlisttrack') {
    const pl = p.playlistItem;
    if (!words.length) {
      rows.push({ label: '▶ Load this playlist and start it', fn: () => window.app.finishDirectorExtra({ kind: 'playlist', playlist: pl.label, name: pl.name, music: '', play: true }) });
      rows.push({ label: 'Load this playlist (do not start)', fn: () => window.app.finishDirectorExtra({ kind: 'playlist', playlist: pl.label, name: pl.name, music: '', play: false }) });
    }
    (p.items || []).filter(match).forEach((n) => rows.push({ label: n, fn: () => window.app.finishDirectorExtra({ kind: 'playlist', playlist: pl.label, name: pl.name, music: n, play: true }) }));
  } else if (p.step === 'sfxcat') {
    if (!words.length) rows.push({ label: '■ Stop the SFX', fn: () => window.app.finishDirectorExtra({ kind: 'sfxstop' }) });
    (p.items || []).filter((c) => match(c || 'library root')).forEach((c) => rows.push({ label: c || '(library root)', fn: () => window.app.pickDirectorSfxCat(c) }));
  } else if (p.step === 'sfxfile') {
    (p.items || []).filter(match).forEach((n) => rows.push({ label: n, fn: () => window.app.finishDirectorExtra({ kind: 'sfx', category: p.sfxCat, sfx: n }) }));
  } else if (p.step === 'session') {
    if (!words.length && p.mode !== 'scene') rows.push({ label: 'Current scene (whatever is active in the Director tool)', fn: () => window.app.pickDirectorCurrent() });
    p.sessions.filter(match).forEach((sn) => rows.push({ label: sn, fn: () => window.app.pickDirectorSession(sn) }));
    if (words.length) {
      if (p.allScenes === null) rows.push({ label: 'Searching scenes…', fn: null });
      else {
        const all = p.allScenes || [];
        all.filter((x) => match(`${x.session} ${x.scene}`)).slice(0, 60).forEach((x) => rows.push({ label: `${x.session} / ${x.scene}`, fn: () => window.app.pickDirectorSceneIn(x.session, x.scene) }));
        // Layouts are searchable too (scene mode): "session / scene — layout".
        if (p.mode === 'scene') {
          let n = 0;
          all.forEach((x) => (x.layouts || []).forEach((l) => {
            const nm = l.replace(/\.json$/, '');
            if (n < 60 && match(`${x.session} ${x.scene} ${nm}`) && !match(`${x.session} ${x.scene}`)) { n++; rows.push({ label: `${x.session} / ${x.scene} — layout: ${nm}`, fn: () => window.app.pickDirectorLayoutIn(x.session, x.scene, l) }); }
          }));
        }
      }
    }
  } else if (p.step === 'scene') {
    p.scenes.filter(match).forEach((sn) => rows.push({ label: sn, fn: () => window.app.pickDirectorScene(sn) }));
  } else if (p.step === 'layout') {
    if (!words.length) rows.push({ label: '(No specific layout — just switch scene)', fn: () => window.app.pickDirectorLayout('') });
    p.layouts.filter((l) => match(l)).forEach((l) => rows.push({ label: l.replace(/\.json$/, ''), fn: () => window.app.pickDirectorLayout(l) }));
  } else if (p.step === 'music' || p.step === 'quickfire' || p.step === 'scenesfx') {
    (p.items || []).filter(match).forEach((n) => rows.push({ label: n, fn: () => window.app.finishDirectorPick(n) }));
  }
  return rows;
}

function renderDirectorPickerList() {
  const p = ui.directorPicker;
  const box = document.getElementById('director-picker-list');
  if (!p || !box) return;
  const rows = directorPickerRows(p);
  p.visible = rows;
  const loading = (p.step === 'session' && !p.sessions.length && p.loading) || (p.step === 'scene' && p.loading) || (p.step === 'layout' && p.loading) || ((p.step === 'music' || p.step === 'quickfire' || p.step === 'scenesfx') && p.items === null);
  const loadingExtra = ['genre', 'genretrack', 'playlist', 'playlisttrack', 'sfxcat', 'sfxfile'].includes(p.step) && p.items === null;
  const empty = {
    genre: 'No genre folders found. Is the Director app folder set in Settings, and "improv_music_path" in its director_config.json?',
    genretrack: 'No audio files in this genre folder.', playlist: 'No saved playlists found under any scene.', playlisttrack: 'This playlist has no tracks.',
    sfxcat: 'No SFX library found ("improv_sfx_path" in director_config.json).', sfxfile: 'No audio files in this folder.',
    session: 'No sessions found in the prep folder.', scene: 'No scenes found in this session.', layout: 'No layouts found.',
    music: 'No music found for this scene.', scenesfx: 'No SFX found for this scene.', quickfire: 'This scene has no quickfire sounds set up.'
  }[p.step];
  box.innerHTML = (loading || loadingExtra) ? '<p class="empty-hint">Loading…</p>'
    : rows.length ? rows.map((r, i) => `<button class="icon-btn director-row${i === 0 && p.query ? ' first' : ''}" style="display:block;width:100%;text-align:left;margin-bottom:4px" ${r.fn ? `onclick="window.app.directorPickerRow(${i})"` : 'disabled'}>${esc(r.label)}</button>`).join('')
    : `<p class="empty-hint">${p.query ? 'Nothing matches.' : empty}</p>`;
}

function renderTitlebarActions() {
  const el = document.getElementById('play-actions');
  const searchBtn = `<button class="icon-btn" title="Jump to a location or NPC (Ctrl/Cmd+K)" onclick="window.app.openPicker('omni', null)">${icon('search')} <span class="kbd-hint">⌘K</span></button>`;
  const helpBtn = `<button class="icon-btn" title="Keyboard shortcuts" onclick="window.app.openHelp()">${icon('help')}</button>`;
  const settingsBtn = `<button class="icon-btn" title="Settings" onclick="window.app.openSettings()">${icon('settings')}</button>`;

  if (ui.mode !== 'play') { el.innerHTML = searchBtn + helpBtn + settingsBtn; return; }

  const bm = campaign.meta.startBookmark;
  const isHere = bm && bm.locationId === ui.curLocation && bm.timeId === ui.curTime;
  const count = (campaign.meta.completedSinceStart || []).length;
  el.innerHTML = `
    ${searchBtn}
    ${helpBtn}
    ${settingsBtn}
    <button class="icon-btn ${isHere ? 'bookmarked' : ''}" onclick="window.app.setStartHere()">${icon('bookmark')} ${isHere ? 'Start point set' : 'Set as start'}</button>
    ${count > 0 ? `<button class="icon-btn" onclick="window.app.undoSinceStart()">${icon('arrowLeft')} Undo ${count} since start</button>` : ''}
  `;
}

// --- selectors -----------------------------------------------------------

function renderSelectors() {
  const el = document.getElementById('selectors');
  const cp = campaign.checkpoints.find((c) => c.id === ui.curTime);
  const loc = campaign.entities[ui.curLocation];

  el.innerHTML = `
    <button class="selector-btn" id="btn-sel-time" onclick="window.app.openPicker('time','btn-sel-time')">
      <span class="sel-icon">${icon('clock')}</span>
      <span class="sel-value">${cp ? esc(cp.label) : 'Select a time'}</span>
      <span class="chev">${icon('chevronDown')}</span>
    </button>
    <button class="selector-btn" id="btn-sel-place" onclick="window.app.openPicker('place','btn-sel-place')">
      <span class="sel-icon">${icon('mapPin')}</span>
      <span class="sel-value">${loc ? esc(loc.name) : 'Select a place'}</span>
      <span class="chev">${icon('chevronDown')}</span>
    </button>
    <button class="selector-btn" id="btn-sel-npc" onclick="window.app.openPicker('npc','btn-sel-npc')">
      <span class="sel-icon">${icon('user')}</span>
      <span class="sel-value">Jump to NPC</span>
      <span class="chev">${icon('chevronDown')}</span>
    </button>
  `;
}

// --- Play mode -----------------------------------------------------------

// Shared rendering rule, applied consistently to beats, scenes, topics,
// and notes alike: incomplete shows full detail, complete collapses to a
// single crossed-out line. Nothing is ever fully hidden — checking the box
// again always brings the detail straight back. Carried-over content (not
// this checkpoint's own) additionally starts collapsed to just its title
// even while incomplete — pass collapsible:true for that — same pattern
// scenes already use, so a location or entity with a lot of history
// doesn't turn into a wall of text by default.
function renderCompletableRow(opts) {
  const onChange = opts.onChangeAttr;
  const srcHtml = opts.sourceLabel ? ` <span class="src">from ${esc(opts.sourceLabel)}</span>` : '';
  const idAttr = opts.id ? ` id="${opts.id}"` : '';

  if (opts.complete) {
    return `<label class="carried-row"${idAttr}>
      <input type="checkbox" checked ${onChange}>
      <span class="beat-label" style="text-decoration:line-through;color:var(--text-muted)">${rich(opts.label)}${srcHtml}</span>${questTagHTML(opts.id)}
    </label>`;
  }

  if (opts.collapsible) {
    const expanded = ui.expandedIds.includes(opts.id);
    const toggleBtn = `<button class="scene-head-toggle" onclick="window.app.toggleExpanded('${opts.id}')">
      ${icon(expanded ? 'chevronDown' : 'chevronRight')} <span class="scene-head-label">${rich(opts.label)}${srcHtml}</span>${questTagHTML(opts.id)}
    </button>`;
    if (!expanded) {
      return `<div class="expandable-row"${idAttr}>${toggleBtn}</div>`;
    }
    return `<div class="expandable-row"${idAttr}>
      ${toggleBtn}
      ${opts.text ? `<div class="expandable-content">${rich(opts.text)}</div>` : ''}
      <label class="beat-row" style="margin-top:6px">
        <input type="checkbox" ${onChange}>
        <span class="beat-label">${esc(opts.checkboxLabel || 'Mark complete')}</span>
      </label>
    </div>`;
  }

  return `<label class="beat-row"${idAttr}>
    <input type="checkbox" ${onChange}>
    <span class="beat-content">
      <span class="beat-label">${rich(opts.label)}${srcHtml}${questTagHTML(opts.id)}</span>
      ${opts.text ? `<span class="beat-text">${rich(opts.text)}</span>` : ''}
    </span>
  </label>`;
}

function renderPlayView() {
  const el = document.getElementById('play-view');

  if (ui.fullPageEntityId) {
    el.innerHTML = renderFullPageHTML(ui.fullPageEntityId);
    return;
  }

  if (!ui.curLocation || !ui.curTime || locations().length === 0) {
    el.innerHTML = `<p class="empty-hint">No locations yet — switch to Create to add one.</p>`;
    return;
  }

  const view = window.Query.getLocationView(campaign, ui.curLocation, ui.curTime);
  const locEntity = campaign.entities[ui.curLocation];

  let html = '';

  if (locEntity) {
    html += `<div class="inline" style="margin-bottom:10px">
      ${locEntity.notionUrl && locEntity.notionUrl.trim() ? `<button class="icon-btn" title="Open this location's Notion page" onclick="window.app.openEntity('${locEntity.id}')">${entityBadge(locEntity, 14)} ${esc(locEntity.name)} in Notion</button>` : `<span class="card-title">${entityBadge(locEntity, 14)} ${esc(locEntity.name)}</span>`}
      ${entityHasInventory(locEntity) ? `<button class="mini-btn" title="Inventory" onclick="window.app.openInventoryView('${locEntity.id}')">${icon('chest')}</button>` : ''}
      <button class="mini-btn" title="Show this location in the graph, at the current milestone" onclick="window.app.showInGraph('${locEntity.id}','${ui.curTime || ''}')">${icon('graph')}</button>
    </div>`;
  }

  html += renderSceneLayoutButton(locEntity);

  html += renderLocationContentHTML(view);

  // The location's own entity content (general notes, notes for this milestone, topics) always
  // follows the Content-tab text, so both are there however you arrived.
  html += renderLocationEntityContentHTML(locEntity);

  // Inline entity cards for anything currently opened (the current location's is shown above)
  for (const entityId of ui.openEntityIds) {
    if (entityId === ui.curLocation) continue;
    html += renderEntityCardHTML(entityId);
  }

  html += `<div class="section-label">Available here</div>`;
  html += renderPresenceChipsHTML(view.present, { interactive: true });

  el.innerHTML = html;
}

function renderLocationContentHTML(view) {
  let html = '';
  if (view.fallback) {
    html += `<div class="badge-muted">${icon('clock')} Showing last prepared notes (${esc(view.fallbackFrom.label)})</div>`;
  }

  if (view.arrival) {
    if (view.descriptionModuleId) html += questTagLine(view.descriptionModuleId);
    html += `<p class="narrative"${view.descriptionModuleId ? ` data-mod="${view.descriptionModuleId}"` : ''}>${view.html}</p>`;
    if (view.descriptionModuleId) {
      html += `<label class="beat-row" style="margin-bottom:10px">
        <input type="checkbox" ${view.descriptionComplete ? 'checked' : ''} onchange="window.app.toggleModuleComplete('${view.descriptionModuleId}',this.checked)">
        <span class="beat-label">Mark as read</span>
      </label>`;
    }

    if (view.scenes.length > 0) {
      html += view.scenes.map((s) => renderSceneHTML(s)).join('');
    }

    if (view.visibleBeats.length > 0) {
      html += `<div class="beat-list">`;
      html += view.visibleBeats.map((b) => renderCompletableRow({
        id: b.moduleId,
        complete: b.complete,
        label: b.name,
        text: b.text,
        collapsible: true,
        onChangeAttr: `onchange="window.app.toggleModuleComplete('${b.moduleId}',this.checked)"`
      })).join('');
      html += `</div>`;
    }
  } else {
    html += `<p class="empty-hint">No notes prepared for this location yet.</p>`;
  }

  if (view.carried.length > 0) {
    html += `<div class="section-label">Carried over</div>`;
    html += view.carried.map((c) => {
      if (c.kind === 'scene') {
        const sceneModule = campaign.contentModules.find((m) => m.id === c.blockId);
        return sceneModule ? renderSceneHTML({ moduleId: sceneModule.id, name: sceneModule.name, lines: sceneModule.lines, complete: sceneModule.complete }, c.sourceLabel) : '';
      }
      return renderCompletableRow({
        id: c.id,
        complete: false, // query.js already excludes complete beats from `carried`
        label: c.label,
        text: c.text,
        sourceLabel: c.sourceLabel,
        collapsible: true,
        onChangeAttr: `onchange="window.app.toggleModuleComplete('${c.id}',this.checked)"`
      });
    }).join('');
  }
  return html;
}

function renderLocationEntityContentHTML(entity) {
  if (!entity) return '';
  const card = window.Query.getEntityCard(campaign, entity.id, ui.curTime);
  if (!card) return '';
  const { general, currentNotes, carriedNotes, topics } = card;
  if (!general.length && !currentNotes.length && !carriedNotes.length && !topics.length) return '';
  const cp = campaign.checkpoints.find((c) => c.id === ui.curTime);
  let html = `<div class="section-label">${esc(entity.name)} — location notes</div><div class="loc-entity-notes">`;
  if (general.length > 0) html += general.map((n) => `${questTagLine(n.moduleId)}<p class="field-text">${rich(n.text)}</p>`).join('');
  html += renderNotesSectionHTML(currentNotes, carriedNotes, cp ? cp.label : '');
  if (topics.length > 0) html += renderTopicsHTML(topics, false);
  return html + '</div>';
}

// The one place that draws the "Available here" chips: Play mode uses it
// directly, and the Content tab's live preview uses it too, so the preview
// can never drift from what Play mode actually shows. Interactive chips
// open the entity (Play mode); the preview's are visually identical but
// inert.
function renderPresenceChipsHTML(entities, { interactive = false, editJump = false } = {}) {
  if (entities.length === 0) return `<p class="empty-hint">Nothing flagged present at this time.</p>`;
  return `<div class="chip-row">${entities.map((e) => {
    const c = colorFor(e.color);
    const style = `background:${c.bg};color:${c.fg}${interactive || editJump ? '' : ';pointer-events:none'}`;
    const attrs = interactive ? ` data-hover="${e.id}" onclick="window.app.openEntity('${e.id}')"`
      : editJump ? ` title="Open ${esc(e.name)} in the Entities tab" onclick="window.app.editEntityFromPreview('${e.id}')"` : ' tabindex="-1"';
    return `<button class="chip" style="${style}"${attrs}>${icon(e.icon)} ${esc(e.name)}</button>`;
  }).join('')}</div>`;
}

// Active (unresolved) topics stay fully interactive collapsibles. Resolved
// topics lose the collapse/expand behavior entirely — there's nothing left
// to reveal — and render as a single crossed-out line instead, with the
// checkbox still there to bring it back if it was resolved by mistake.
function renderTopicsHTML(topics, openByDefault) {
  const active = topics.filter((t) => !t.complete);
  const resolved = topics.filter((t) => t.complete);
  let html = '';

  html += active.map((t) => `
    <details class="topic" id="${t.moduleId}" ${(campaign.meta.openTopicIds || []).includes(t.moduleId) ? 'open' : ''}>
      <summary onclick="window.app.topicClicked('${t.moduleId}')">${icon('chevronDown')} ${rich(t.name)}${questTagHTML(t.moduleId)}</summary>
      <div class="topic-body">
        <p class="field-text">${rich(t.text)}</p>
        <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary)">
          <input type="checkbox" onchange="window.app.toggleModuleComplete('${t.moduleId}',this.checked)">
          Mark resolved
        </label>
      </div>
    </details>`).join('');

  if (resolved.length > 0) {
    html += `<div class="section-label">Resolved</div>`;
    html += resolved.map((t) => renderCompletableRow({
      id: t.moduleId,
      complete: true,
      label: t.name,
      onChangeAttr: `onchange="window.app.toggleModuleComplete('${t.moduleId}',this.checked)"`
    })).join('');
  }

  return html;
}

// A scene is rendered as a small script: each line tinted with its
// speaker's own color (matching that entity's badge everywhere else),
// narration lines (no speaker) shown plain. One checkbox for the whole
// scene — marking it complete is all-or-nothing, not per line. Same
// completable-row rule as everything else: full dialogue while
// incomplete, collapses to a single crossed-out line once complete.
// Separately, an incomplete scene also starts collapsed to just its
// title — click it to reveal the dialogue, so a location with several
// scenes doesn't turn into a wall of text by default.
function renderSceneHTML(scene, carriedFromLabel) {
  if (scene.complete) {
    return renderCompletableRow({
      id: scene.moduleId,
      complete: true,
      label: scene.name,
      sourceLabel: carriedFromLabel,
      onChangeAttr: `onchange="window.app.toggleModuleComplete('${scene.moduleId}',this.checked)"`
    });
  }

  const expanded = ui.expandedIds.includes(scene.moduleId);
  const srcHtml = carriedFromLabel ? ` <span class="src">from ${esc(carriedFromLabel)}</span>` : '';
  const toggleBtn = `<button class="scene-head-toggle" onclick="window.app.toggleExpanded('${scene.moduleId}')">
    ${icon(expanded ? 'chevronDown' : 'chevronRight')} <span class="scene-head-label">${rich(scene.name)}</span>${srcHtml}${questTagHTML(scene.moduleId)}
  </button>`;

  if (!expanded) {
    return `<div class="scene-block" id="${scene.moduleId}">${toggleBtn}</div>`;
  }

  const lines = scene.lines.map((line) => {
    if (line.speakerId && campaign.entities[line.speakerId]) {
      const speaker = campaign.entities[line.speakerId];
      const c = colorFor(speaker.color);
      return `<div class="scene-line" style="background:${c.bg}">
        <span class="scene-line-speaker" style="color:${c.fg}">${icon(speaker.icon)} ${esc(speaker.name)}</span>
        <span class="scene-line-text">${rich(line.text)}</span>
      </div>`;
    }
    return `<div class="scene-line scene-line-narration"><span class="scene-line-text">${rich(line.text)}</span></div>`;
  }).join('');

  return `<div class="scene-block" id="${scene.moduleId}">
    ${toggleBtn}
    <div class="scene-lines">${lines}</div>
    <label class="scene-complete-row">
      <input type="checkbox" onchange="window.app.toggleModuleComplete('${scene.moduleId}',this.checked)">
      Scene complete
    </label>
  </div>`;
}

// A single time-specific note: full text + resolve checkbox while
// unresolved, collapses to a crossed-out line once resolved (same rule as
// everything else).
function renderTimeNoteRow(n) {
  const preview = n.text.length > 60 ? `${window.Query.truncatePreservingMarkers(n.text, 60)}…` : n.text;
  if (n.complete) {
    return renderCompletableRow({
      id: n.moduleId,
      complete: true,
      label: preview || 'Resolved note',
      onChangeAttr: `onchange="window.app.toggleModuleComplete('${n.moduleId}',this.checked)"`
    });
  }
  return `${questTagLine(n.moduleId)}<p class="field-text">${rich(n.text)}</p>
    <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-secondary);margin:2px 0 8px">
      <input type="checkbox" onchange="window.app.toggleModuleComplete('${n.moduleId}',this.checked)">
      Mark resolved
    </label>`;
}

// Shared by both the inline card and full-page view. Notes now work
// exactly like beats: any number can share a checkpoint (currentNotes),
// and an unresolved one carries forward to every later checkpoint
// (carriedNotes) — collapsed to just a title by default, click to expand,
// same as a location's carried beats and scenes.
function renderNotesSectionHTML(currentNotes, carriedNotes, cpLabel) {
  let html = '';

  if (currentNotes.length > 0) {
    html += `<div class="field-label">${esc(cpLabel)}</div>`;
    html += currentNotes.map((n) => renderTimeNoteRow(n)).join('');
  }

  if (carriedNotes.length > 0) {
    html += `<div class="section-label">Carried over</div>`;
    html += carriedNotes.map((n) => {
      const preview = n.text.length > 60 ? `${window.Query.truncatePreservingMarkers(n.text, 60)}…` : n.text;
      return renderCompletableRow({
        id: n.moduleId,
        complete: false, // query.js already excludes resolved notes from carriedNotes
        label: preview || 'Note',
        text: n.text,
        sourceLabel: n.sourceLabel,
        collapsible: true,
        checkboxLabel: 'Mark resolved',
        onChangeAttr: `onchange="window.app.toggleModuleComplete('${n.moduleId}',this.checked)"`
      });
    }).join('');
  }

  return html;
}

function renderEntityCardHTML(entityId) {
  const card = window.Query.getEntityCard(campaign, entityId, ui.curTime);
  if (!card) return '';
  const { entity, general, currentNotes, carriedNotes, topics } = card;
  const cp = campaign.checkpoints.find((c) => c.id === ui.curTime);

  let html = `<div class="card" title="Middle-click anywhere to close" onmousedown="if(event.button===1){event.preventDefault();window.app.closeEntity('${entity.id}')}">
    <div class="card-head">
      <span class="card-title">${renderEntityImageThumbnailHTML(entity)}${entityBadge(entity, 18)} ${esc(entity.name)}</span>
      ${renderCardChipsHTML(entity)}
      <div class="card-actions">
        ${entityHasInventory(entity) ? `<button class="mini-btn" title="Inventory" onclick="window.app.openInventoryView('${entity.id}')">${icon('chest')}</button>` : ''}
        <button class="mini-btn" title="Show in the graph" onclick="window.app.showInGraph('${entity.id}')">${icon('graph')}</button>
        <button class="mini-btn" title="Open full page" onclick="window.app.openFullPage('${entity.id}')">${icon('maximize')}</button>
        <button class="mini-btn" title="Close" onclick="window.app.closeEntity('${entity.id}')">${icon('x')}</button>
      </div>
    </div>`;

  html += renderSceneLayoutButton(entity);
  html += renderRoleplayStripHTML(entity);

  // A location opened from a mention or a chip shows what the location itself shows
  // (its description, scenes, sections), then its entity notes.
  let locPresent = null;
  if (entity.type === 'location') {
    const lv = window.Query.getLocationView(campaign, entity.id, ui.curTime);
    html += renderLocationContentHTML(lv);
    locPresent = lv.present;
  }

  if (general.length > 0) {
    html += `<div class="field-label">General</div>`;
    html += general.map((n) => `${questTagLine(n.moduleId)}<p class="field-text">${rich(n.text)}</p>`).join('');
  }

  html += renderNotesSectionHTML(currentNotes, carriedNotes, cp ? cp.label : '');

  if (topics.length > 0) {
    html += renderTopicsHTML(topics, false);
  }
  if (locPresent) html += `<div class="section-label">Available here</div>` + renderPresenceChipsHTML(locPresent, { interactive: true });

  html += `</div>`;
  return html;
}

function renderFullPageHTML(entityId) {
  const card = window.Query.getEntityCard(campaign, entityId, ui.curTime);
  if (!card) return '';
  const { entity, general, currentNotes, carriedNotes, topics } = card;
  const cp = campaign.checkpoints.find((c) => c.id === ui.curTime);

  let html = `<button class="back-link" onclick="window.app.backToLocation()">${icon('arrowLeft')} Back</button>
    <div class="card-title" style="font-size:16px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between">
      <span>${renderEntityImageThumbnailHTML(entity)}${entityBadge(entity, 20)} ${esc(entity.name)}</span>
      <span style="display:flex;gap:6px;align-items:center">${renderCardChipsHTML(entity)}${entityHasInventory(entity) ? `<button class="mini-btn" title="Inventory" onclick="window.app.openInventoryView('${entity.id}')">${icon('chest')}</button>` : ''}</span>
    </div>`;

  html += renderSceneLayoutButton(entity);
  html += renderRoleplayStripHTML(entity);

  let locPresent = null;
  if (entity.type === 'location') {
    const lv = window.Query.getLocationView(campaign, entity.id, ui.curTime);
    html += renderLocationContentHTML(lv);
    locPresent = lv.present;
  }

  if (general.length > 0) {
    html += `<div class="field-label">General</div>`;
    html += general.map((n) => `${questTagLine(n.moduleId)}<p class="field-text">${rich(n.text)}</p>`).join('');
  }

  html += renderNotesSectionHTML(currentNotes, carriedNotes, cp ? cp.label : 'Right now');

  if (topics.length > 0) {
    html += renderTopicsHTML(topics, true);
  }
  if (locPresent) html += `<div class="section-label">Available here</div>` + renderPresenceChipsHTML(locPresent, { interactive: true });

  return html;
}

// --- Create mode -----------------------------------------------------------

function renderCreateView() {
  const el = document.getElementById('create-view');
  el.innerHTML = `
    <div class="create-tabs">
      <button id="ct-entities" class="${ui.createTab === 'entities' ? 'active' : ''}" onclick="window.app.setCreateTab('entities')">Entities</button>
      <button id="ct-content" class="${ui.createTab === 'content' ? 'active' : ''}" onclick="window.app.setCreateTab('content')">Scenes &amp; places</button>
      <button id="ct-library" class="${ui.createTab === 'library' ? 'active' : ''}" onclick="window.app.setCreateTab('library')">Library</button>
      <button id="ct-graph" class="${ui.createTab === 'graph' ? 'active' : ''}" onclick="window.app.setCreateTab('graph')">Graph</button>
      <button id="ct-conditions" class="${ui.createTab === 'conditions' ? 'active' : ''}" onclick="window.app.setCreateTab('conditions')">Conditions</button>
    </div>
    <div id="create-body" style="padding:12px"></div>
  `;
  if (ui.createTab === 'entities') renderCreateEntities();
  else if (ui.createTab === 'content') renderCreateContent();
  else if (ui.createTab === 'graph') renderGraphTab();
  else if (ui.createTab === 'conditions') renderConditionsTab();
  else renderContentLibrary();
}

// Called directly (New entity, selecting an entity, ...) it keeps the scroll
// position; inside a full renderAll the decision is made there.
function renderCreateEntities() {
  if (renderingAll) renderCreateEntitiesInner(); else keepScroll(renderCreateEntitiesInner);
}

function renderCreateEntitiesInner() {
  const body = document.getElementById('create-body');
  const groups = (campaign.entityGroups || []).slice().sort((a, b) => a.order - b.order);

  let html = `
    <input type="text" id="entity-search" placeholder="Search entities by name or summary…" value="${esc(ui.entitySearchQuery || '')}" oninput="window.app.onEntitySearchInput(this.value)" style="margin-bottom:10px">
    <div class="inline" style="margin-bottom:10px;flex-wrap:wrap">
      <button class="icon-btn" onclick="window.app.toggleGroupManager()">${icon('clock')} ${ui.groupManagerOpen ? 'Hide' : 'Manage'} groups</button>
      <button class="icon-btn" onclick="window.app.toggleBulkAdd()">${icon('plus')} ${ui.bulkAddOpen ? 'Hide' : 'Bulk add'}</button>
      <button class="icon-btn" onclick="window.app.toggleSelectMode()">${icon('check')} ${ui.entitySelectMode ? 'Done selecting' : 'Select multiple'}</button>
      <button class="icon-btn" onclick="window.app.openNotionImport()">${icon('plus')} Import content</button>
      <button class="icon-btn" onclick="window.app.openTransfer()">${icon('chevronRight')} Transfer to other campaign</button>
    </div>
    ${ui.groupManagerOpen ? renderGroupManagerHTML(groups) : ''}
    ${ui.bulkAddOpen ? renderBulkAddHTML(groups) : ''}
    ${ui.entitySelectMode ? renderSelectToolbarHTML(groups) : ''}
    <div id="entity-list-container"></div>
    <button class="icon-btn" onclick="window.app.newEntityForm()">${icon('plus')} ${ui.newEntityDraft && ui.createSelectedEntityId !== 'new' ? 'Continue new entity' : 'New entity'}</button>
    <div class="divider"></div>
    <div id="entity-editor"></div>
  `;

  body.innerHTML = html;
  renderEntityListOnly();
  attachManageDnd();

  if (ui.createSelectedEntityId === 'new') renderNewEntityForm();
  else if (ui.createSelectedEntityId) renderEntityEditor(ui.createSelectedEntityId);
}

// Builds "Top Group" then indented "  ↳ Subgroup" <option> entries, used
// everywhere a group needs picking from a dropdown (bulk-add, the select
// toolbar, a single entity's own editor) — one nesting-aware builder
// instead of duplicating this logic in four places.
// Builds indented <option> entries for every group at any depth, used
// everywhere a group needs picking from a dropdown.
function groupOptionsHTML(groups, selectedId) {
  const opts = [];
  function walk(group, depth) {
    const indent = '&nbsp;'.repeat(depth * 2);
    const prefix = depth > 0 ? `${indent}↳ ` : '';
    opts.push(`<option value="${group.id}" ${selectedId === group.id ? 'selected' : ''}>${prefix}${esc(group.name)}</option>`);
    groups.filter((c) => c.parentId === group.id).sort((a, b) => a.order - b.order).forEach((c) => walk(c, depth + 1));
  }
  groups.filter((g) => !g.parentId).sort((a, b) => a.order - b.order).forEach((g) => walk(g, 0));
  return opts.join('');
}

// Counts every entity in a group and everywhere beneath it, against the
// current search-filtered list — used to decide whether a group has
// anything worth showing at all, and for its header count.
function countInSubtree(group, groups, list) {
  const direct = list.filter((e) => e.groupId === group.id).length;
  const children = groups.filter((c) => c.parentId === group.id);
  return direct + children.reduce((sum, c) => sum + countInSubtree(c, groups, list), 0);
}

// Purely a targeted update of the entity list itself — called on every
// search keystroke instead of the full renderCreateEntities, so the
// search input (which lives outside this container) is never rebuilt and
// never loses focus mid-typing.
function renderEntityListOnly() {
  const container = document.getElementById('entity-list-container');
  if (!container) return;
  if (ui.groupManagerOpen) { renderManageList(); return; }

  const query = (ui.entitySearchQuery || '').toLowerCase();
  const allList = Object.values(campaign.entities);
  const list = query
    ? allList.filter((e) => e.name.toLowerCase().includes(query) || (e.summary || '').toLowerCase().includes(query))
    : allList;
  const groups = (campaign.entityGroups || []).slice().sort((a, b) => a.order - b.order);
  const topGroups = groups.filter((g) => !g.parentId);
  const validGroupIds = new Set(groups.map((g) => g.id));

  let html = `<div class="entity-list">`;
  topGroups.forEach((g) => {
    html += renderGroupNodeHTML(g, groups, list, 0, !!query);
  });

  const ungrouped = list.filter((e) => !e.groupId || !validGroupIds.has(e.groupId)).sort((a, b) => a.name.localeCompare(b.name));
  if (ungrouped.length > 0) {
    if (groups.length > 0) html += `<div class="section-label">Ungrouped (${ungrouped.length})</div>`;
    html += ungrouped.map((e) => renderEntityRowHTML(e, 0)).join('');
  }
  if (list.length === 0) {
    html += `<p class="empty-hint">${query ? 'No entities match your search.' : 'No entities yet.'}</p>`;
  }
  html += `</div>`;
  container.innerHTML = html;
}

// Renders one group and, if not collapsed, its direct entities and every
// descendant group recursively. Indentation is capped visually at a
// fairly shallow depth so a deep tree doesn't run out of room on a
// narrow window — the data itself has no such limit, this only affects
// how far it keeps indenting. While actively searching, collapse state
// is ignored entirely: a collapsed group can't hide a match you're
// looking for.
function renderGroupNodeHTML(group, groups, list, depth, searchActive, opts = {}) {
  // opts lets another list reuse this same nested, collapsible group
  // rendering (the Content tab's "Present here" picker does) without
  // sharing the Entities tab's collapse state or its row layout. With no
  // opts it behaves exactly as it always has.
  const collapsedKey = opts.collapsedKey || 'collapsedGroupIds';
  const toggleFn = opts.toggleFn || 'toggleGroupCollapsed';
  const renderRow = opts.renderRow || renderEntityRowHTML;

  const total = countInSubtree(group, groups, list);
  if (total === 0) return '';

  const collapsed = !searchActive && (campaign.meta[collapsedKey] || []).includes(group.id);
  const indent = Math.min(depth, 4) * 16;
  // While a search/filter is active the collapse state is ignored, so a
  // header that looks clickable but does nothing would only confuse —
  // lists that opt in show it as a plain label instead.
  const interactive = !(searchActive && opts.staticWhenSearching);

  let html = `<div class="section-label group-header" style="margin-left:${indent}px"${interactive ? ` onclick="window.app.${toggleFn}('${group.id}')"` : ''}>
    ${interactive ? icon(collapsed ? 'chevronRight' : 'chevronDown') : ''} ${esc(group.name)} (${total})${opts.headerExtra ? opts.headerExtra(group) : ''}
  </div>`;

  if (!collapsed) {
    const direct = list.filter((e) => e.groupId === group.id).sort((a, b) => a.name.localeCompare(b.name));
    html += direct.map((e) => renderRow(e, depth + 1)).join('');
    groups.filter((c) => c.parentId === group.id).sort((a, b) => a.order - b.order).forEach((c) => {
      html += renderGroupNodeHTML(c, groups, list, depth + 1, searchActive, opts);
    });
  }
  return html;
}

function renderEntityRowHTML(e, depth) {
  const indent = Math.min(depth || 0, 4) * 16;
  const indentStyle = indent > 0 ? `margin-left:${indent}px` : '';
  if (ui.entitySelectMode) {
    const checked = ui.selectedEntityIds.includes(e.id);
    return `<div class="entity-row" style="${indentStyle}" onclick="window.app.toggleEntitySelected('${e.id}')">
      <input type="checkbox" ${checked ? 'checked' : ''} style="pointer-events:none">
      ${entityBadge(e, 20)}
      <span class="name">${esc(e.name)}</span>
      <span class="type-tag">${e.type}</span>
    </div>`;
  }
  return `<div class="entity-row" style="${indentStyle}" onclick="window.app.selectCreateEntity('${e.id}')">
    ${entityBadge(e, 20)}
    <span class="name">${esc(e.name)}</span>
    <span class="type-tag">${e.type}</span>
  </div>`;
}

// --- Manage groups -----------------------------------------------------------
//
// Opening "Manage groups" turns the entity list into a tree you organize by
// dragging, with every level of the hierarchy in its own color (only while
// this mode is open — closing it brings back the ordinary list, untouched):
//
//   · Drag a group by its handle: drop it on the upper part of another
//     group's row to place it just above that group (as its sibling), on the
//     lower part to put it inside that group, on the strip above the first
//     group to make it the first top-level group, or on the strip below the
//     last one to make it the last. Nothing else is needed to nest or
//     un-nest: where it lands decides its level. A group can never be dropped
//     inside itself or one of its own subgroups.
//   · Click entities to select them — Shift-click selects everything between
//     the last one clicked and this one, Ctrl/Cmd-click adds or removes just
//     one — then drag any of the selected ones onto a group (or "Ungrouped")
//     to move them all there.
//
// The pointer handling lives in treeDnd.js (it scrolls the page itself while
// you drag near the top or bottom edge); this section decides what a press
// picks up, what is under the pointer, and what a drop does.

const MG_LEVELS = 6; // distinct colors before they repeat; see .mg-level-N in styles.css

function mgVisibleEntities() {
  const query = (ui.entitySearchQuery || '').toLowerCase();
  const all = Object.values(campaign.entities);
  return query
    ? all.filter((e) => e.name.toLowerCase().includes(query) || (e.summary || '').toLowerCase().includes(query))
    : all;
}

function renderGroupManagerHTML(groups) {
  const chips = Array.from({ length: MG_LEVELS }, (_, i) => `<span class="mg-legend-chip mg-level-${i}">${i + 1}</span>`).join('');
  return `<div class="scene-editor mg-panel">
    <div class="section-label">Manage groups</div>
    <p class="hint">Drag a group by its handle <span style="white-space:nowrap">(${icon('grip')})</span> to reorder it — drop it on another group's upper half to place it above, or its lower half to nest it inside. Drop it on the strip above the first group for top level. Click entities to select them (<b>Shift</b> = everything between, <b>Ctrl</b> = add or remove one), then drag the selection onto a group. Double-click an entity to open it.</p>
    <div class="mg-legend">Levels: ${chips}</div>
    <div class="inline" style="margin:6px 0">
      <span id="mg-selected-count" class="hint" style="margin:0">0 selected</span>
      <button class="icon-btn" id="mg-clear-btn" disabled onclick="window.app.clearManageSelection()">Clear selection</button>
    </div>
    <div class="form-row" style="margin-top:8px">
      <input type="text" id="new-group-name" placeholder="New top-level group" onkeydown="if(event.key==='Enter'){window.app.confirmNewEntityGroup()}">
      <button class="icon-btn" onclick="window.app.confirmNewEntityGroup()">${icon('plus')} Add group</button>
    </div>
  </div>`;
}

function renderManageEntityRowHTML(e, groupId) {
  return `<div class="mg-entity${ui.mgSelected.includes(e.id) ? ' selected' : ''}" data-entity-id="${e.id}" data-group-id="${groupId || ''}">
    ${entityBadge(e, 20)}
    <span class="name">${esc(e.name)}</span>
    <span class="type-tag">${e.type}</span>
  </div>`;
}

function renderManageGroupHTML(group, groups, list, depth) {
  const collapsed = (campaign.meta.collapsedGroupIds || []).includes(group.id);
  const total = countInSubtree(group, groups, list);
  let header;
  if (ui.confirmDeleteGroupId === group.id) {
    const warning = depth > 0
      ? 'Its entities become ungrouped'
      : 'Its entities become ungrouped, and any subgroups move to its own level';
    header = `<div class="mg-confirm">
      <span class="confirm-row">Delete "${esc(group.name)}"? ${warning} — nothing is deleted.</span>
      <button class="mini-btn" onclick="window.app.confirmDeleteEntityGroup('${group.id}')">${icon('check')}</button>
      <button class="mini-btn" onclick="window.app.cancelDeleteEntityGroup()">${icon('x')}</button>
    </div>`;
  } else {
    header = `<div class="mg-header" data-group-id="${group.id}">
      <span class="mg-grip" title="Drag to move this group">${icon('grip')}</span>
      <button class="mini-btn mg-chevron" title="${collapsed ? 'Expand' : 'Collapse'}" onclick="window.app.toggleGroupCollapsed('${group.id}')">${icon(collapsed ? 'chevronRight' : 'chevronDown')}</button>
      <input type="text" class="mg-name" value="${esc(group.name)}" oninput="window.app.onEntityGroupNameInput('${group.id}',this.value)">
      <span class="mg-count" title="Entities in this group, including its subgroups">${total}</span>
      <button class="mini-btn" title="Add a subgroup" onclick="window.app.addSubgroup('${group.id}')">${icon('plus')}</button>
      <button class="mini-btn" title="Delete group" onclick="window.app.startDeleteEntityGroup('${group.id}')">${icon('trash')}</button>
    </div>`;
  }
  let body = '';
  if (!collapsed) {
    body += list.filter((e) => e.groupId === group.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => renderManageEntityRowHTML(e, group.id)).join('');
    body += groups.filter((c) => c.parentId === group.id)
      .sort((a, b) => a.order - b.order)
      .map((c) => renderManageGroupHTML(c, groups, list, depth + 1)).join('');
  }
  return `<div class="mg-group mg-level-${depth % MG_LEVELS}" data-group-block="${group.id}">${header}${body ? `<div class="mg-body">${body}</div>` : ''}</div>`;
}

function renderManageListHTML() {
  const list = mgVisibleEntities();
  const groups = (campaign.entityGroups || []).slice().sort((a, b) => a.order - b.order);
  const validGroupIds = new Set(groups.map((g) => g.id));
  const ungrouped = list.filter((e) => !e.groupId || !validGroupIds.has(e.groupId)).sort((a, b) => a.name.localeCompare(b.name));

  let html = `<div class="entity-list managing" id="mg-root">`;
  if (groups.length > 0) {
    html += `<div class="mg-strip" data-strip="top"><span>Drop here: top level, first</span></div>`;
    groups.filter((g) => !g.parentId).forEach((g) => { html += renderManageGroupHTML(g, groups, list, 0); });
    html += `<div class="mg-strip mg-strip-end" data-strip="end"><span>Drop here: top level, last</span></div>`;
  } else {
    html += `<p class="empty-hint">No groups yet — add one below, then drag entities into it.</p>`;
  }
  html += `<div class="mg-group mg-ungrouped-block" data-group-block="">
    <div class="mg-ungrouped-header"><span class="mg-title">Ungrouped</span><span class="mg-count">${ungrouped.length}</span></div>
    ${ungrouped.length > 0 ? `<div class="mg-body">${ungrouped.map((e) => renderManageEntityRowHTML(e, '')).join('')}</div>` : ''}
  </div></div>`;
  return html;
}

// Keeps the selection and the count in step with what is on screen. The
// selection can only ever hold rows that are actually showing (a search or a
// collapsed group hides some), so dragging never carries along something you
// can't see.
function mgSyncSelectionUI() {
  const root = document.getElementById('mg-root');
  if (root) {
    const present = new Set(Array.from(root.querySelectorAll('.mg-entity')).map((el) => el.dataset.entityId));
    ui.mgSelected = ui.mgSelected.filter((id) => present.has(id));
    const sel = new Set(ui.mgSelected);
    root.querySelectorAll('.mg-entity').forEach((el) => el.classList.toggle('selected', sel.has(el.dataset.entityId)));
  }
  const label = document.getElementById('mg-selected-count');
  if (label) label.textContent = `${ui.mgSelected.length} selected`;
  const clear = document.getElementById('mg-clear-btn');
  if (clear) clear.disabled = ui.mgSelected.length === 0;
}

function renderManageList() {
  const container = document.getElementById('entity-list-container');
  if (!container) return;
  const scroller = window.TreeDnd.nearestScroller(container);
  const top = scroller.scrollTop;
  container.innerHTML = renderManageListHTML();
  mgSyncSelectionUI();
  scroller.scrollTop = top;
}

function mgExpand(groupId) {
  if (!groupId) return;
  campaign.meta.collapsedGroupIds = (campaign.meta.collapsedGroupIds || []).filter((id) => id !== groupId);
}

// What a press on an entity row does to the selection. Returns a function to
// run if the press turns out to be a plain click rather than the start of a
// drag, or null. Pressing a row that is already selected must not change the
// selection straight away — it may be the start of dragging the whole
// selection — so collapsing to just that row (or removing it, with Ctrl)
// waits until it is clear no drag is happening.
function mgPressEntity(id, e) {
  const additive = e.ctrlKey || e.metaKey;
  const wasSelected = ui.mgSelected.includes(id);
  let ifClick = null;
  if (e.shiftKey) {
    const order = Array.from(document.querySelectorAll('#mg-root .mg-entity')).map((el) => el.dataset.entityId);
    const anchor = ui.mgAnchor && order.includes(ui.mgAnchor)
      ? ui.mgAnchor
      : (ui.mgSelected.find((x) => order.includes(x)) || id);
    const a = order.indexOf(anchor);
    const b = order.indexOf(id);
    const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
    ui.mgSelected = additive ? Array.from(new Set([...ui.mgSelected, ...range])) : range;
    ui.mgAnchor = anchor;
  } else if (additive) {
    if (wasSelected) ifClick = () => { ui.mgSelected = ui.mgSelected.filter((x) => x !== id); };
    else ui.mgSelected = [...ui.mgSelected, id];
    ui.mgAnchor = id;
  } else if (!wasSelected) {
    ui.mgSelected = [id];
    ui.mgAnchor = id;
  } else {
    ifClick = () => { ui.mgSelected = [id]; };
    ui.mgAnchor = id;
  }
  mgSyncSelectionUI();
  return ifClick;
}

function mgBegin(e) {
  // Typing in a group's name, or pressing one of its buttons, is not a drag.
  if (e.target.closest('input, button, select, textarea, a')) return null;
  // Pressing on a row or a handle doesn't move keyboard focus by itself (the
  // press is claimed so it can become a drag), so a group's name field that
  // was being edited would otherwise stay focused and quietly keep taking
  // whatever is typed next.
  const focused = document.activeElement;
  if (focused && focused !== document.body && focused.matches && focused.matches('input, textarea, select')) focused.blur();
  const row = e.target.closest('.mg-entity');
  if (row) {
    const id = row.dataset.entityId;
    const ifClick = mgPressEntity(id, e);
    const ids = ui.mgSelected.includes(id) ? ui.mgSelected.slice() : [id];
    const first = campaign.entities[ids[0]];
    return {
      kind: 'entities',
      ids,
      label: ids.length === 1 ? (first ? first.name : '1 entity') : `${ids.length} entities`,
      onClick: () => { if (ifClick) { ifClick(); mgSyncSelectionUI(); } }
    };
  }
  const header = e.target.closest('.mg-header');
  if (header) {
    const group = (campaign.entityGroups || []).find((g) => g.id === header.dataset.groupId);
    if (group) return { kind: 'group', id: group.id, label: group.name };
  }
  // A press on empty space inside the list drops the selection.
  if (e.target.closest('#mg-root') && ui.mgSelected.length > 0) {
    ui.mgSelected = [];
    mgSyncSelectionUI();
  }
  return null;
}

// What is under the pointer, as a drop target for what is being dragged. Rows
// are looked up by position rather than by which element the browser says is
// under the pointer, so this keeps working in the thin gaps between rows,
// slightly outside the list's left and right edges, and — importantly —
// right after the page has scrolled itself under a pointer that hasn't moved.
function mgTargetAt(x, y, src) {
  const root = document.getElementById('mg-root');
  if (!root) return null;
  const rr = root.getBoundingClientRect();
  if (x < rr.left - 40 || x > rr.right + 40) return null;
  // Only the part of the list that is actually visible counts: rows scrolled
  // out of sight still have positions, and the pointer might be over the
  // toolbar above them.
  const sr = window.TreeDnd.nearestScroller(root).getBoundingClientRect();
  if (y < sr.top || y > sr.bottom) return null;

  let hit = null;
  let near = null;
  let nearDist = 9;
  root.querySelectorAll('.mg-header, .mg-entity, .mg-ungrouped-header, .mg-strip').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (y >= r.top && y < r.bottom) { hit = { el, r }; return; }
    const d = y < r.top ? r.top - y : y - r.bottom;
    if (d < nearDist) { nearDist = d; near = { el, r }; }
  });
  const found = hit || near;
  if (!found) return null;
  const el = found.el;
  const blockOf = (gid) => root.querySelector(`.mg-group[data-group-block="${gid || ''}"]`);

  if (src.kind === 'group') {
    let zone;
    let gid = null;
    if (el.matches('.mg-strip')) {
      zone = el.dataset.strip;
    } else if (el.matches('.mg-header')) {
      gid = el.dataset.groupId;
      zone = (y - found.r.top) / found.r.height < 0.38 ? 'before' : 'inside';
    } else if (el.matches('.mg-entity') && el.dataset.groupId) {
      gid = el.dataset.groupId; // over one of a group's own rows: that group is the target
      zone = 'inside';
    } else {
      return null;
    }
    const placement = window.DataModel.resolveGroupDrop(campaign, zone, gid);
    const valid = !!placement && window.DataModel.canPlaceEntityGroup(campaign, src.id, placement);
    let markEl = el;
    let cls = 'mg-drop-strip';
    if (zone === 'before') cls = 'mg-drop-before';
    else if (zone === 'inside') { markEl = blockOf(gid); cls = 'mg-drop-into'; }
    return { key: `g:${zone}:${gid || ''}`, el: markEl, cls, valid, zone, groupId: gid, placement };
  }

  // Dragging entities: any group row, any entity row (which means its group),
  // or the Ungrouped section.
  let gid;
  if (el.matches('.mg-header') || el.matches('.mg-entity')) gid = el.dataset.groupId;
  else if (el.matches('.mg-ungrouped-header')) gid = '';
  else return null;
  const validGroupIds = new Set((campaign.entityGroups || []).map((g) => g.id));
  const groupOf = (id) => {
    const e = campaign.entities[id];
    return e && e.groupId && validGroupIds.has(e.groupId) ? e.groupId : '';
  };
  if (src.ids.every((id) => groupOf(id) === gid)) return null; // already all there — nothing to do, nothing to highlight
  return { key: `e:${gid}`, el: blockOf(gid), cls: 'mg-drop-into', valid: true, groupId: gid || null };
}

function mgMark(target, on) {
  if (!target || !target.el) return;
  target.el.classList.toggle(target.cls, on);
  target.el.classList.toggle('mg-drop-invalid', on && !target.valid);
}

function mgOnStart(src) {
  document.body.classList.toggle('mg-dragging-group', src.kind === 'group');
  if (src.kind === 'group') {
    const block = document.querySelector(`#mg-root .mg-group[data-group-block="${src.id}"]`);
    if (block) block.classList.add('mg-source-dragging');
  } else {
    const ids = new Set(src.ids);
    document.querySelectorAll('#mg-root .mg-entity').forEach((el) => {
      if (ids.has(el.dataset.entityId)) el.classList.add('mg-source-dragging');
    });
  }
}

function mgOnEnd() {
  document.body.classList.remove('mg-dragging-group');
  document.querySelectorAll('.mg-source-dragging').forEach((el) => el.classList.remove('mg-source-dragging'));
}

async function mgOnDrop(src, target) {
  if (src.kind === 'group') {
    if (!window.DataModel.placeEntityGroup(campaign, src.id, target.placement)) return;
    if (target.zone === 'inside') mgExpand(target.groupId);
  } else {
    window.DataModel.assignEntitiesToGroup(campaign, src.ids, target.groupId);
    mgExpand(target.groupId); // so the entities that just landed there are on screen
  }
  await persistSafely();
  renderManageList();
}

// (Re)attaches the drag-and-drop to the list container — which is rebuilt
// along with the rest of the Entities tab — or tears it down when the mode
// is closed.
function attachManageDnd() {
  if (ui.mgDnd) { ui.mgDnd.destroy(); ui.mgDnd = null; }
  if (!ui.groupManagerOpen) return;
  const container = document.getElementById('entity-list-container');
  if (!container) return;
  ui.mgDnd = window.TreeDnd.create({
    root: container,
    begin: mgBegin,
    targetAt: mgTargetAt,
    mark: mgMark,
    onStart: mgOnStart,
    onDrop: mgOnDrop,
    onEnd: mgOnEnd
  });
  container.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.mg-entity');
    if (row) window.app.selectCreateEntity(row.dataset.entityId);
  });
}

function renderBulkAddHTML(groups) {
  return `<div class="scene-editor">
    <div class="section-label">Bulk add entities</div>
    <div class="form-row"><label>Type</label>
      <select id="bulk-add-type" onchange="window.app.onBulkAddTypeChange(this.value)">
        <option value="npc" ${ui.bulkAddType === 'npc' ? 'selected' : ''}>NPC</option>
        <option value="location" ${ui.bulkAddType === 'location' ? 'selected' : ''}>Location</option>
        <option value="quest" ${ui.bulkAddType === 'quest' ? 'selected' : ''}>Quest</option>
      </select>
    </div>
    <div class="form-row"><label>Group (optional)</label>
      <select id="bulk-add-group">
        <option value="">No group</option>
        ${groupOptionsHTML(groups, window.DataModel.getRememberedGroup(campaign, ui.bulkAddType || 'npc'))}
      </select>
    </div>
    <div class="form-row"><label>Names, comma-separated</label>
      <textarea id="bulk-add-names" placeholder="Grey man, Old sailor, Merchant"></textarea>
    </div>
    <button class="primary icon-btn" onclick="window.app.confirmBulkAdd()">${icon('check')} Add all</button>
  </div>`;
}

// Shown in select-mode: a running count, a group to assign the selection
// to, and quick select-all-visible / clear-selection actions. "Visible"
// respects the current search filter, so searching then "select all" is a
// fast way to bulk-assign just a matching subset.
function renderSelectToolbarHTML(groups) {
  const count = ui.selectedEntityIds.length;
  return `<div class="scene-editor">
    <div class="section-label">${count} selected</div>
    <div class="inline">
      <select id="bulk-assign-group">
        <option value="">Ungrouped</option>
        ${groupOptionsHTML(groups, null)}
      </select>
      <button class="icon-btn" ${count === 0 ? 'disabled' : ''} onclick="window.app.confirmBulkAssignGroup()">${icon('check')} Assign</button>
    </div>
    <div class="inline" style="margin-top:6px">
      <button class="icon-btn" onclick="window.app.selectAllVisibleEntities()">Select all visible</button>
      <button class="icon-btn" onclick="window.app.clearEntitySelection()">Clear selection</button>
    </div>
  </div>`;
}

// The create form is the real entity editor, working on a draft entity that
// doesn't officially exist until Create is pressed — so every field and
// section the editor offers (group, icon, color, image, scene/layout, loot
// table, inventory, notes, topics) is there from the start. See "Draft
// entities" in dataModel.js for how the draft stays out of every list and
// out of the saved file in the meantime.
function renderNewEntityForm() {
  const draft = ui.newEntityDraft;
  if (!draft || !window.DataModel.isDraftEntity(campaign, draft.id)) {
    ui.newEntityDraft = null;
    ui.createSelectedEntityId = null;
    const editor = document.getElementById('entity-editor');
    if (editor) editor.innerHTML = '';
    return;
  }
  renderEntityEditor(draft.id);
}

function startNewEntityDraft(type) {
  const groupId = window.DataModel.getRememberedGroup(campaign, type);
  const entity = window.DataModel.createDraftEntity(campaign, { type, groupId });
  ui.newEntityDraft = {
    id: entity.id,
    // Modules that already exist now are not the draft's to throw away.
    moduleSnapshot: new Set(campaign.contentModules.map((m) => m.id)),
    groupTouched: false,
    focusName: true
  };
}

// Location-only. Each row is edited directly (DC + result, continuous
// save like every other text field), or the whole table can be replaced
// at once by pasting a copied table into the paste zone below it.
// Both NPCs and locations. entity.sceneLayout is an optional {session,
// scene, layout} object — absent entirely on any entity created before
// this feature, same defensive-read convention as lootTable.
function renderSceneLayoutEditorHTML(entity) {
  const sl = entity.sceneLayout || {};
  let html = `<div class="section-label">Scene / Layout (Director tool)</div>`;
  if (!appSettings.directorPrepRootPath) {
    html += `<p class="hint">Set the session prep folder in Settings to pick a scene/layout here.</p>`;
    return html;
  }
  if (sl.session && sl.scene) {
    const layoutLabel = sl.layout ? ` — ${esc(sl.layout.replace(/\.json$/, ''))}` : '';
    html += `<p class="hint">${esc(sl.session)} / ${esc(sl.scene)}${layoutLabel}</p>
    <div class="inline">
      <button class="icon-btn" onclick="window.app.pickEntitySceneLayout('${entity.id}')">Change…</button>
      <button class="mini-btn" title="Clear" onclick="window.app.clearEntitySceneLayout('${entity.id}')">${icon('trash')}</button>
    </div>`;
  } else {
    html += `<button class="icon-btn" onclick="window.app.pickEntitySceneLayout('${entity.id}')">${icon('plus')} Pick a scene/layout</button>`;
  }
  return html;
}

// Available on both NPCs and locations. Shown to the left of the name in
// Play mode only when this entity is the one actually being viewed (its
// own card, or full-page for an NPC) — never in a presence list or on a
// mention pill, keeping the number of images ever loaded at once small
// regardless of campaign size. entity.image is null, or
// {filename, size: 'small'|'medium'|'large'} — the file itself lives on
// disk (src/entityImages.js), never in campaign.json.
function renderEntityImageEditorHTML(entity) {
  const artBtn = `<button class="icon-btn" title="Search the artwork default folder for a file matching this name" onclick="window.app.offerArtwork('${entity.id}',true)">Find in artwork folder</button>`;
  let html = `<div class="section-label">Image</div>`;
  const img = entity.image;
  if (img && img.filename) {
    const url = entityImageUrl(entity);
    html += `
      <div class="entity-image-preview-row">
        ${url ? `<img src="${esc(url)}" class="entity-image-preview" alt="">` : ''}
        <div class="inline" style="flex-wrap:wrap;align-self:center">
          <select onchange="window.app.setEntityImageSizeUI('${entity.id}',this.value)">
            <option value="small" ${img.size === 'small' ? 'selected' : ''}>Small (thumbnail)</option>
            <option value="medium" ${img.size === 'medium' ? 'selected' : ''}>Medium</option>
            <option value="large" ${img.size === 'large' ? 'selected' : ''}>Large</option>
          </select>
          <button class="icon-btn" onclick="window.app.uploadEntityImageUI('${entity.id}')">Replace…</button>
          ${artBtn}
          <button class="mini-btn" title="Remove image" onclick="window.app.removeEntityImageUI('${entity.id}')">${icon('trash')}</button>
        </div>
      </div>`;
  } else {
    const kind = entity.type === 'location' ? 'location' : 'NPC';
    html += `<div class="inline" style="flex-wrap:wrap"><button class="icon-btn" onclick="window.app.uploadEntityImageUI('${entity.id}')">${icon('plus')} Upload image</button>${artBtn}</div>
    <p class="hint">Shown to the left of the name in Play mode when viewing this ${kind} directly — not in presence lists or mention pills.</p>`;
  }
  return html;
}


// --- Character card (NPCs) ---------------------------------------------------
// A 2024 (5.5e) style stat block plus voice and personality notes. The logic
// lives in src/characterCard.js; this is the drawing and editing. An NPC with
// no stat block of its own shows the default Villager (the 2024 Commoner).

function cardNotesHTML(group, fields) {
  const rows = fields.filter((f) => group && group[f.key] && group[f.key].trim());
  return rows.map((f) => `<div class="cc-kv"><span class="cc-k">${esc(f.label)}</span><span class="cc-v${f.key === 'example' ? ' cc-quote' : ''}">${esc(group[f.key])}</span></div>`).join('');
}

// The stat block itself: value, modifier and saving throw for each ability.
// Clicking an ability row reveals the skills that use it; "All skills" opens
// every row at once.
function renderStatblockHTML(statblock) {
  const CC = window.CharacterCard;
  const r = CC.resolve(statblock);
  const sb = r.sb;
  const abilityRows = r.abilities.map((a) => {
    const skills = r.skills.filter((k) => k.ability === a.key);
    return `<tbody class="cc-ab">
      <tr class="cc-ability" onclick="window.app.toggleCardAbility(this)" title="Show the ${esc(a.name)} skills">
        <td class="cc-ab-name"><span class="cc-caret">${icon('chevronRight')}</span>${a.label}</td>
        <td class="cc-num">${a.score}</td>
        <td class="cc-num">${a.modText}</td>
        <td class="cc-num${a.saveProf ? ' cc-prof' : ''}">${a.saveText}</td>
      </tr>
      <tr class="cc-skillrow"><td colspan="4">${skills.map((k) => `<span class="cc-skill${k.level === 1 ? ' prof' : ''}${k.level === 2 ? ' expert' : ''}">${esc(k.name)} <b>${k.bonusText}</b></span>`).join('')}</td></tr>
    </tbody>`;
  }).join('');
  const profLine = r.proficientSkills.length
    ? `<div class="cc-line"><b>Skills</b> ${r.proficientSkills.map((k) => `${esc(k.name)} ${k.bonusText}${k.level === 2 ? ' (expertise)' : ''}`).join(', ')}</div>` : '';
  const senses = [sb.senses && sb.senses.trim(), `Passive Perception ${r.passivePerception}${r.passivePerceptionManual ? '*' : ''}`, `Passive Insight ${r.passiveInsight}${r.passiveInsightManual ? '*' : ''}`].filter(Boolean).join('; ');
  return `<div class="cc-statblock">
    <div class="cc-type">${esc(r.typeLine)}</div>
    <div class="cc-line"><b>AC</b> ${sb.ac} <span class="cc-gap"></span><b>Initiative</b> ${r.initiativeText}</div>
    <div class="cc-line"><b>HP</b> ${esc(r.hpText)} <span class="cc-gap"></span><b>Speed</b> ${esc(sb.speed)}</div>
    <table class="cc-abilities">
      <thead><tr><th></th><th>Score</th><th>Mod</th><th>Save</th></tr></thead>
      ${abilityRows}
    </table>
    <div class="cc-skills-toggle"><button class="mini-btn cc-allbtn" onclick="window.app.toggleCardAllSkills(this)">Tap an ability for its skills · <u>show all</u></button></div>
    ${profLine}
    <div class="cc-line"><b>Senses</b> ${esc(senses)}</div>
    ${sb.languages && sb.languages.trim() ? `<div class="cc-line"><b>Languages</b> ${esc(sb.languages)}</div>` : ''}
    <div class="cc-line"><b>CR</b> ${esc(sb.cr)} <span class="cc-gap"></span><b>PB</b> ${r.pbText}</div>
    ${sb.gear && sb.gear.trim() ? `<div class="cc-line"><b>Gear</b> ${esc(sb.gear)}</div>` : ''}
    ${sb.traits && sb.traits.trim() ? `<div class="cc-block"><div class="cc-h">Traits</div><div class="cc-text">${esc(sb.traits)}</div></div>` : ''}
    ${sb.actions && sb.actions.trim() ? `<div class="cc-block"><div class="cc-h">Actions</div><div class="cc-text">${esc(sb.actions)}</div></div>` : ''}
  </div>`;
}

// What the floating card (Play mode) shows: a portrait and the quick facts
// first, then the DM's voice and personality notes (what you need
// mid-conversation), then the full stat block.
function renderCharacterCardHTML(entity) {
  const CC = window.CharacterCard;
  const card = entity.characterCard || {};
  const persona = card.persona || {};
  const rp = CC.roleplay(entity);
  const url = entityImageUrl(entity);
  const quick = [persona.role && persona.role.trim(), persona.appearance && persona.appearance.trim()].filter(Boolean);
  const voice = cardNotesHTML(card.voice, CC.VOICE_FIELDS);
  const rest = cardNotesHTML(persona, CC.PERSONA_FIELDS.filter((f) => f.key !== 'role' && f.key !== 'appearance'));
  let html = `<div class="cc-top">
    ${url ? `<img class="cc-portrait" src="${esc(url)}" title="Click to enlarge" onclick="window.app.openImageLightbox('${entity.id}')" alt="">` : ''}
    <div class="cc-top-text">
      ${quick.length ? quick.map((q, i) => `<div class="${i === 0 ? 'cc-role' : 'cc-appearance'}">${esc(q)}</div>`).join('') : ''}
      <div class="cc-facts">Passive Perception <b>${rp.passivePerception}</b> · Passive Insight <b>${rp.passiveInsight}</b>${rp.languages ? ` · ${esc(rp.languages)}` : ''}</div>
    </div>
  </div>`;
  html += voice ? `<div class="cc-h">Voice</div><div class="cc-notes">${voice}</div>` : '';
  html += rest ? `<div class="cc-h">Personality</div><div class="cc-notes">${rest}</div>` : '';
  if (!voice && !rest && !quick.length) html += `<p class="hint">No voice or personality notes yet — add them in Create mode.</p>`;
  html += `<div class="cc-h">Stat block${CC.isDefaultStatblock(entity) ? ' <span class="cc-default-tag">default Villager</span>' : ''}</div>`;
  html += renderStatblockHTML(CC.getStatblock(entity));
  return html;
}

// Header button on an NPC's Play-mode card: opens the floating card.
function renderCardChipsHTML(entity) {
  if (!entity || entity.type !== 'npc') return '';
  return `<button class="cc-chipbtn" title="Character card — voice, personality and stat block" onclick="window.app.openCharacterCard('${entity.id}')">${icon('idcard')}</button>`;
}

// Always visible on an NPC's Play-mode card: the stats that matter when you
// are talking to them, not fighting them. Click it for the full card.
function renderRoleplayStripHTML(entity) {
  if (!entity || entity.type !== 'npc') return '';
  const rp = window.CharacterCard.roleplay(entity);
  const skill = (k) => `<span class="cc-rp-chip${k.level ? ' prof' : ''}">${esc(k.name)} <b>${k.bonusText}</b></span>`;
  return `<div class="cc-rp-strip" onclick="window.app.openCharacterCard('${entity.id}')" title="Open the full character card">
    <span class="cc-rp-chip cc-rp-passive${rp.passivePerceptionManual ? ' manual' : ''}"${rp.passivePerceptionManual ? ' title="Set by hand"' : ''}>Passive Perception <b>${rp.passivePerception}</b></span>
    <span class="cc-rp-chip cc-rp-passive${rp.passiveInsightManual ? ' manual' : ''}"${rp.passiveInsightManual ? ' title="Set by hand"' : ''}>Passive Insight <b>${rp.passiveInsight}</b></span>
    ${rp.skills.map(skill).join('')}
    ${rp.languages ? `<span class="cc-rp-chip cc-rp-lang">${esc(rp.languages)}</span>` : ''}
  </div>`;
}

function renderCardTextFieldsHTML(entity, group, fields) {
  const values = (entity.characterCard && entity.characterCard[group]) || {};
  return `<div class="cc-fields">` + fields.map((f) => {
    const attrs = `placeholder="${esc(f.placeholder)}" oninput="window.app.onCardTextInput('${entity.id}','${group}','${f.key}',this.value)"`;
    return `<div class="form-row${f.long ? ' cc-long' : ''}"><label>${esc(f.label)}</label>${f.long
      ? `<textarea style="min-height:44px" ${attrs}>${esc(values[f.key] || '')}</textarea>`
      : `<input type="text" value="${esc(values[f.key] || '')}" ${attrs}>`}</div>`;
  }).join('') + `</div>`;
}

function renderSkillButtonsHTML(entity) {
  const r = window.CharacterCard.resolve(window.CharacterCard.getStatblock(entity));
  return r.skills.map((k) => `<button class="cc-skillbtn${k.level === 1 ? ' prof' : ''}${k.level === 2 ? ' expert' : ''}" title="Click to cycle: none, proficient, expertise" onclick="window.app.cycleCardSkill('${entity.id}','${esc(k.name)}')">
      <span>${esc(k.name)} <small>${k.ability.toUpperCase()}</small></span><b>${k.bonusText}${k.level === 2 ? ' ★' : ''}</b></button>`).join('');
}

function renderStatblockFormHTML(entity) {
  const CC = window.CharacterCard;
  const sb = entity.characterCard.statblock;
  const id = entity.id;
  const text = (field, label, wide) => `<div class="form-row${wide ? ' cc-wide' : ''}"><label>${label}</label><input type="text" value="${esc(sb[field])}" oninput="window.app.onStatblockInput('${id}','${field}',this.value)"></div>`;
  const num = (field, label) => `<div class="form-row"><label>${label}</label><input type="number" value="${sb[field]}" oninput="window.app.onStatblockInput('${id}','${field}',this.value)" onchange="window.app.onStatblockChange('${id}','${field}',this)"></div>`;
  const r = CC.resolve(sb);
  return `<div class="cc-form">
    <div class="cc-grid3">
      <div class="form-row"><label>Size</label><select onchange="window.app.onStatblockInput('${id}','size',this.value)">${CC.SIZES.map((z) => `<option ${sb.size === z ? 'selected' : ''}>${z}</option>`).join('')}</select></div>
      ${text('creatureType', 'Type')}
      ${text('alignment', 'Alignment')}
    </div>
    <div class="cc-grid3">
      ${num('ac', 'Armor class')}
      ${num('hp', 'Hit points')}
      ${text('hpDice', 'HP dice')}
    </div>
    <div class="cc-grid3">
      ${text('speed', 'Speed')}
      ${text('cr', 'Challenge (CR)')}
      <div class="form-row"><label>Proficiency</label><div class="cc-pb" id="cc-pb">${r.pbText}</div></div>
    </div>
    <div class="cc-abil-grid">
      ${r.abilities.map((a) => `<div class="cc-abil">
        <label>${a.label}</label>
        <input type="number" value="${a.score}" min="1" max="30" oninput="window.app.onStatblockInput('${id}','abilities.${a.key}',this.value)" onchange="window.app.onStatblockChange('${id}','abilities.${a.key}',this)">
        <div class="cc-mod" data-key="${a.key}">${a.modText}</div>
        <label class="cc-save"><input type="checkbox" ${a.saveProf ? 'checked' : ''} onchange="window.app.toggleCardSave('${id}','${a.key}',this.checked)"> save <span class="cc-savebonus" data-key="${a.key}">${a.saveText}</span></label>
      </div>`).join('')}
    </div>
    <div class="cc-h">Skills <span class="hint" style="display:inline;margin:0">click to cycle none → proficient → expertise</span></div>
    <div class="cc-skillgrid" id="cc-skills">${renderSkillButtonsHTML(entity)}</div>
    <div class="cc-grid2">
      ${text('senses', 'Senses (besides passive Perception)')}
      ${text('languages', 'Languages')}
    </div>
    <div class="cc-grid2">
      <div class="form-row"><label>Passive Perception <span class="cc-auto" id="cc-auto-pp">${r.passivePerceptionManual ? `(auto ${r.passivePerceptionAuto})` : '(auto)'}</span></label>
        <input type="number" id="cc-pp-input" min="0" max="99" value="${sb.passivePerceptionOverride == null ? '' : sb.passivePerceptionOverride}" placeholder="auto (${r.passivePerceptionAuto})" oninput="window.app.onStatblockInput('${id}','passivePerceptionOverride',this.value)"></div>
      <div class="form-row"><label>Passive Insight <span class="cc-auto" id="cc-auto-pi">${r.passiveInsightManual ? `(auto ${r.passiveInsightAuto})` : '(auto)'}</span></label>
        <input type="number" id="cc-pi-input" min="0" max="99" value="${sb.passiveInsightOverride == null ? '' : sb.passiveInsightOverride}" placeholder="auto (${r.passiveInsightAuto})" oninput="window.app.onStatblockInput('${id}','passiveInsightOverride',this.value)"></div>
    </div>
    <div class="hint" style="margin:-2px 0 6px">Passive scores calculate themselves from the skills. Type a number to override one (story, magic items, other bonuses); clear the field to go back to automatic.</div>
    ${text('gear', 'Gear', true)}
    <div class="form-row"><label>Traits</label><textarea style="min-height:60px" oninput="window.app.onStatblockInput('${id}','traits',this.value)">${esc(sb.traits)}</textarea></div>
    <div class="form-row"><label>Actions</label><textarea style="min-height:60px" oninput="window.app.onStatblockInput('${id}','actions',this.value)">${esc(sb.actions)}</textarea></div>
  </div>`;
}

function cardFilledCount(group, fields) {
  return fields.filter((f) => group && typeof group[f.key] === 'string' && group[f.key].trim()).length;
}

function cardSectionHTML(key, title, meta, bodyHTML) {
  const open = !!ui.cardSections[key];
  return `<div class="cc-section">
    <div class="cc-sec-head" id="cc-sec-head-${key}" onclick="window.app.toggleCardSection('${key}')">
      <span class="cc-sec-caret">${icon(open ? 'chevronDown' : 'chevronRight')}</span><span class="cc-sec-title">${title}</span><span class="cc-sec-meta">${meta}</span>
    </div>
    <div class="cc-sec-body" id="cc-sec-${key}" style="display:${open ? 'block' : 'none'}">${bodyHTML}</div>
  </div>`;
}

// Create-mode section: three collapsed groups (voice, personality, stat
// block). The stat block itself is edited in a floating window.
function renderCharacterCardEditorHTML(entity) {
  if (entity.type !== 'npc') return '';
  const CC = window.CharacterCard;
  const card = entity.characterCard || {};
  const nVoice = cardFilledCount(card.voice, CC.VOICE_FIELDS);
  const nPersona = cardFilledCount(card.persona, CC.PERSONA_FIELDS);
  const sum = CC.summary(entity);
  const r = CC.resolve(CC.getStatblock(entity));
  const meta = (n, total) => (n ? `${n} of ${total} filled` : 'empty');
  return `<div class="section-label">Character card</div>
    ${cardSectionHTML('voice', 'Voice', meta(nVoice, CC.VOICE_FIELDS.length), renderCardTextFieldsHTML(entity, 'voice', CC.VOICE_FIELDS))}
    ${cardSectionHTML('persona', 'Personality', meta(nPersona, CC.PERSONA_FIELDS.length), renderCardTextFieldsHTML(entity, 'persona', CC.PERSONA_FIELDS))}
    ${cardSectionHTML('statblock', 'Stat block', sum.isDefault ? 'Villager (default)' : 'customized', `
      <div class="cc-sb-summary">${sum.isDefault ? 'Default Villager (2024 Commoner)' : 'Customized'} · AC ${sum.ac} · HP ${esc(sum.hpText)} · CR ${esc(sum.cr)} · PB ${r.pbText}</div>
      <div class="inline" style="margin-top:6px"><button class="icon-btn" onclick="window.app.openStatblockEditor('${entity.id}')">Edit stat block…</button></div>`)}`;
}

// The body of the floating stat block editor: the form, a reset button and
// a live preview.
function renderStatblockEditorBody(entity) {
  const CC = window.CharacterCard;
  CC.ensureStatblock(entity);
  const confirming = ui.pendingResetStatblock === entity.id;
  const reset = confirming
    ? `<span class="hint" style="margin:0">Replace this stat block with the default Villager?</span>
       <button class="mini-btn" title="Yes, reset" onclick="window.app.resetStatblock('${entity.id}')">${icon('check')}</button>
       <button class="mini-btn" title="Keep it" onclick="window.app.cancelResetStatblock()">${icon('x')}</button>`
    : `<button class="icon-btn" onclick="window.app.askResetStatblock('${entity.id}')">Reset to Villager</button>`;
  return `${renderStatblockFormHTML(entity)}
    <div class="inline" style="margin:8px 0">${reset}</div>
    <div class="cc-h">Preview</div><div id="cc-preview">${renderStatblockHTML(entity.characterCard.statblock)}</div>`;
}

function redrawStatblockEditor() {
  const entity = campaign.entities[ui.sbEditorEntityId];
  const body = document.getElementById('statblock-body');
  if (entity && body) body.innerHTML = renderStatblockEditorBody(entity);
}

// Updates the live bits of the stat block form (modifiers, saves, skills,
// proficiency bonus and the preview) without rebuilding the inputs, so
// typing never loses its place.
function refreshCardEditorBits(entity) {
  const CC = window.CharacterCard;
  const r = CC.resolve(CC.getStatblock(entity));
  r.abilities.forEach((a) => {
    document.querySelectorAll(`.cc-mod[data-key="${a.key}"]`).forEach((el) => { el.textContent = a.modText; });
    document.querySelectorAll(`.cc-savebonus[data-key="${a.key}"]`).forEach((el) => { el.textContent = a.saveText; });
  });
  const pb = document.getElementById('cc-pb'); if (pb) pb.textContent = r.pbText;
  const setAuto = (id, auto, manual) => { const el = document.getElementById(id); if (el) el.textContent = manual ? `(auto ${auto})` : `(auto)`; };
  setAuto('cc-auto-pp', r.passivePerceptionAuto, r.passivePerceptionManual);
  setAuto('cc-auto-pi', r.passiveInsightAuto, r.passiveInsightManual);
  const ppIn = document.getElementById('cc-pp-input'); if (ppIn) ppIn.placeholder = `auto (${r.passivePerceptionAuto})`;
  const piIn = document.getElementById('cc-pi-input'); if (piIn) piIn.placeholder = `auto (${r.passiveInsightAuto})`;
  // Updated in place rather than rebuilt: leaving a number field fires this
  // between a click's press and release, and replacing the button under the
  // pointer at that moment would swallow the click.
  const skills = document.getElementById('cc-skills');
  if (skills) {
    const buttons = skills.querySelectorAll('.cc-skillbtn');
    if (buttons.length === r.skills.length) {
      r.skills.forEach((k, i) => {
        buttons[i].classList.toggle('prof', k.level === 1);
        buttons[i].classList.toggle('expert', k.level === 2);
        buttons[i].querySelector('b').textContent = `${k.bonusText}${k.level === 2 ? ' ★' : ''}`;
      });
    } else skills.innerHTML = renderSkillButtonsHTML(entity);
  }
  const preview = document.getElementById('cc-preview');
  if (preview) {
    // Keep whichever ability rows were opened while the preview redraws.
    const wasOpen = Array.from(preview.querySelectorAll('.cc-ab')).map((el) => el.classList.contains('open'));
    const wasAll = !!preview.querySelector('.cc-statblock.open-all');
    preview.innerHTML = renderStatblockHTML(CC.getStatblock(entity));
    const sbEl = preview.querySelector('.cc-statblock');
    if (wasAll && sbEl) sbEl.classList.add('open-all');
    preview.querySelectorAll('.cc-ab').forEach((el, i) => { if (wasOpen[i]) el.classList.add('open'); });
  }
}

// Available on both NPCs and locations, unlike the loot table below
// (location-only). entity.inventoryCategories is an optional array of
// categories, each with its own ordered list of free-form text columns
// (columns: [{id, label}]) and rows of {name, price, cells} where cells
// holds each column's text keyed by column id — see dataModel.js. Every
// column between the name and the price is a real, independent field:
// its own header, its own formatting, its own multiple lines. Absent
// entirely on any entity created before this feature, same defensive-read
// convention as lootTable/sceneLayout.
function renderInventoryEditorHTML(entity) {
  const categories = entity.inventoryCategories || [];
  const pending = ui.pendingDeleteInventoryColumn;
  let html = `<div class="section-label">Inventory table</div>`;
  html += `<p class="hint">One or more named categories (e.g. "Weapons", "Potions"), each with its own table: a name, any number of text columns (each supports @ mentions, links, formatting and several lines), and a price. Paste a table from Notion (or Excel/Sheets) to add its rows — into an empty category it takes its columns from the table's header; into one that already has rows, columns are matched by header name and any new ones are added.</p>`;
  if (categories.length === 0) {
    html += `<p class="empty-hint">No categories yet.</p>`;
  }
  categories.forEach((cat) => {
    const cols = cat.columns || [];
    const rows = cat.rows || [];
    const cellOf = (row, col) => (row.cells && row.cells[col.id]) || '';
    // One grid definition shared by the header row and every data row, so
    // all of them line up exactly and every column always fits inside the
    // pane — no horizontal scrolling. The name and price get a small floor
    // so they stay usable; the free-form text columns split everything
    // else evenly, however many there are, and are the ones that give way
    // when space is tight. (Sizing these with a fixed width or minimum is
    // what pushed the columns out of the pane before: the editor's
    // general `.beat-editor-row input[type=text] { width: 100% }` rule
    // outranks any single class, so a plain width on the name input was
    // silently ignored.)
    const gridStyle = `grid-template-columns:minmax(56px, 1.3fr) ${cols.map(() => 'minmax(0, 2fr)').join(' ')} minmax(64px, 1fr) 24px`;
    html += `<div class="beat-editor-row">
      <div class="inline">
        <button class="mini-btn" title="${cat.collapsed ? 'Expand' : 'Collapse'}" onclick="window.app.toggleInventoryCategory('${entity.id}','${cat.id}')">${icon(cat.collapsed ? 'chevronRight' : 'chevronDown')}</button>
        <input type="text" value="${esc(cat.name)}" placeholder="Category name" style="flex:1" oninput="window.app.onInventoryCategoryNameInput('${entity.id}','${cat.id}',this.value)">
        <button class="mini-btn" title="Delete category" onclick="window.app.deleteInventoryCategory('${entity.id}','${cat.id}')">${icon('trash')}</button>
      </div>`;
    if (!cat.collapsed) {
      html += `<div class="inv-edit-table">`;
      const pendingCol = pending && pending.entityId === entity.id && pending.categoryId === cat.id
        ? cols.find((c) => c.id === pending.columnId) : null;
      if (pendingCol) {
        const filled = rows.filter((r) => cellOf(r, pendingCol).trim()).length;
        html += `<div class="inline" style="margin-bottom:6px">
          <span class="confirm-row">Delete the column "${esc(pendingCol.label)}"${filled > 0 ? ` and its text in ${filled} row${filled === 1 ? '' : 's'}` : ''}?</span>
          <button class="mini-btn" title="Yes, delete" onclick="window.app.confirmDeleteInventoryColumn()">${icon('check')}</button>
          <button class="mini-btn" title="Cancel" onclick="window.app.cancelDeleteInventoryColumn()">${icon('x')}</button>
        </div>`;
      }

      // Column headers: the category's own labels, editable — the names
      // come from the pasted table's header but can be renamed freely.
      html += `<div class="inv-edit-row inv-edit-headers" style="${gridStyle}">
        <input type="text" class="inv-edit-name" title="Name column header" value="${esc(cat.nameLabel || 'Name')}" oninput="window.app.onInventoryLabelInput('${entity.id}','${cat.id}','nameLabel',this.value)">
        ${cols.map((col) => `<div class="inv-edit-head-cell">
          <input type="text" title="Column header" value="${esc(col.label)}" oninput="window.app.onInventoryColumnLabelInput('${entity.id}','${cat.id}','${col.id}',this.value)">
          <button class="mini-btn inv-edit-col-delete" title="Delete column" onclick="window.app.startDeleteInventoryColumn('${entity.id}','${cat.id}','${col.id}')">${icon('trash')}</button>
        </div>`).join('')}
        <input type="text" class="inv-edit-price" title="Price column header" value="${esc(cat.priceLabel || 'Price')}" oninput="window.app.onInventoryLabelInput('${entity.id}','${cat.id}','priceLabel',this.value)">
        <span class="inv-edit-spacer"></span>
      </div>`;

      rows.forEach((row, i) => {
        html += `<div class="inv-edit-row" style="${gridStyle}">
          <input type="text" class="inv-edit-name" placeholder="Name" value="${esc(row.name)}" oninput="window.app.onInventoryRowInput('${entity.id}','${cat.id}',${i},'name',this.value)">
          ${cols.map((col) => `<textarea id="inv-cell-${entity.id}-${cat.id}-${i}-${col.id}" class="mention-field loot-result-field inv-edit-text" placeholder="${esc(col.label)} — @ mention, Ctrl+L link, Ctrl+B/I/E format" oninput="window.app.onInventoryCellInput('${entity.id}','${cat.id}',${i},'${col.id}',this.value)">${esc(cellOf(row, col))}</textarea>`).join('')}
          <input type="text" class="inv-edit-price" placeholder="Price" value="${esc(row.price)}" oninput="window.app.onInventoryRowInput('${entity.id}','${cat.id}',${i},'price',this.value)">
          <button class="mini-btn" title="Delete row" onclick="window.app.deleteInventoryRow('${entity.id}','${cat.id}',${i})">${icon('trash')}</button>
        </div>`;
      });
      html += `</div>`;
      html += `<div class="inline" style="margin-top:4px">
        <button class="icon-btn" onclick="window.app.addInventoryRow('${entity.id}','${cat.id}')">${icon('plus')} Add row</button>
        <button class="icon-btn" onclick="window.app.addInventoryColumn('${entity.id}','${cat.id}')">${icon('plus')} Add column</button>
      </div>`;
      html += `<textarea data-no-expand placeholder="Paste a copied table here to add its rows to this category" style="min-height:50px" onpaste="window.app.handleInventoryTablePaste(event,'${entity.id}','${cat.id}')" oninput="this.value=''"></textarea>`;
    }
    html += `</div>`;
  });
  html += `<button class="icon-btn" onclick="window.app.addInventoryCategory('${entity.id}')">${icon('plus')} Add category</button>`;
  return html;
}

function renderLootTableEditorHTML(entity) {
  const rows = entity.lootTable || [];
  let html = `<div class="section-label">Loot table</div>`;
  html += `<p class="hint">Paste a table copied from Notion (or Excel/Sheets) below to add its rows to this table, or edit them directly. Each result supports the same formatting as everything else — @ mentions, Ctrl+L links, Ctrl+B/I/E, manual line breaks.</p>`;
  html += `<div class="scene-editor">`;
  if (rows.length === 0) {
    html += `<p class="empty-hint">No rows yet.</p>`;
  }
  rows.forEach((row, i) => {
    html += `<div class="inline loot-row" style="margin-bottom:6px">
      <input type="text" placeholder="DC" value="${esc(row.dc)}" style="width:56px;flex-shrink:0" oninput="window.app.onLootRowInput('${entity.id}',${i},'dc',this.value)">
      <textarea id="loot-result-${entity.id}-${i}" class="mention-field loot-result-field" placeholder="Result — @ mention, Ctrl+L link, Ctrl+B/I/E format" style="flex:1" oninput="window.app.onLootRowInput('${entity.id}',${i},'result',this.value)">${esc(row.result)}</textarea>
      <button class="mini-btn" title="Delete row" onclick="window.app.deleteLootRow('${entity.id}',${i})">${icon('trash')}</button>
    </div>`;
  });
  html += `<button class="icon-btn" onclick="window.app.addLootRow('${entity.id}')">${icon('plus')} Add row</button>`;
  html += `</div>`;
  html += `<textarea data-no-expand placeholder="Paste a copied table here to add its rows to the ones above" style="min-height:50px" onpaste="window.app.handleLootTablePaste(event,'${entity.id}')" oninput="this.value=''"></textarea>`;
  return html;
}

// Tries the richer HTML <table> structure first (preserves real row/cell
// boundaries regardless of how the source formats things); falls back to
// tab-separated plain text if no table markup is present, which is the
// other clipboard format nearly everything exports a copied table range
// as — Excel and Google Sheets included, not just Notion. Column
// count and header detection are handled by normalizeLootTableRows,
// shared with the test suite. Not verified against a live Notion table
// copy — if the paste doesn't parse correctly, the manual row editor
// above is the fallback while this gets tuned to whatever Notion
// actually produces.
function parseLootTableFromClipboard(clipboardData) {
  const html = clipboardData.getData('text/html');
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    if (table) {
      const rawRows = Array.from(table.querySelectorAll('tr')).map((row) =>
        Array.from(row.querySelectorAll('td, th')).map((c) => (c.textContent || '').trim())
      );
      const normalized = window.Query.normalizeLootTableRows(rawRows);
      if (normalized.length > 0) return normalized;
    }
  }
  const text = clipboardData.getData('text/plain');
  if (text && text.includes('\t')) {
    const rawRows = text.split('\n').map((l) => l.split('\t'));
    return window.Query.normalizeLootTableRows(rawRows);
  }
  return null;
}

function parseInventoryTableFromClipboard(clipboardData) {
  const html = clipboardData.getData('text/html');
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table');
    if (table) {
      const trs = Array.from(table.querySelectorAll('tr'));
      const cellsOf = (tr) => Array.from(tr.querySelectorAll('td, th'));
      // Plain text for telling a header row from a data row and for the
      // header labels themselves — a header is often bold in the source,
      // and a label should never carry formatting markers.
      const plainRows = trs.map((tr) => cellsOf(tr).map((c) => (c.textContent || '').trim()));
      // The name stays plain text, but every other cell is converted the
      // same way a pasted block of text is: line breaks inside a cell
      // (<br>, separate paragraphs) stay real line breaks and bold/italic/
      // bullets carry over as the app's own markup. Reading a cell with
      // textContent instead would silently glue its lines together, and
      // each free-form column is meant to hold multi-line, formatted text.
      const richRows = trs.map((tr) => cellsOf(tr).map((c, i) => (i === 0 ? (c.textContent || '').trim() : htmlToLightMarkdown(c.innerHTML).text)));

      // A first row made entirely of <th> cells is the most reliable
      // signal that it's a real header. Not every source marks it up
      // that way, though — Notion's own table export may use plain <td>
      // for every row — so this falls back to the same content-based
      // heuristic the plain-text path uses (a header is unlikely to
      // contain a currency amount or bare number) rather than assuming
      // no <th> means no header at all.
      const firstRowIsSemanticHeader = trs.length > 0 && trs[0].querySelectorAll('th').length > 0 && trs[0].querySelectorAll('td').length === 0;
      const firstRowLooksLikeHeader = plainRows.length > 1 && window.Query.looksLikeInventoryHeaderRow(plainRows[0]);
      const hasHeader = firstRowIsSemanticHeader || firstRowLooksLikeHeader;
      const parsed = window.Query.parseInventoryTable(hasHeader ? richRows.slice(1) : richRows, hasHeader ? plainRows[0] : undefined);
      if (parsed.rows.length > 0) return parsed;
    }
  }
  const text = clipboardData.getData('text/plain');
  if (text && text.includes('\t')) {
    // Handles any column count the source table actually had, and
    // reassembles a table cell's own internal line break (which a plain-
    // text paste has no way to distinguish from a new row) back into a
    // single cell rather than splitting it into malformed extra rows.
    const { headers, rows } = window.Query.parseTabSeparatedTable(text);
    const parsed = window.Query.parseInventoryTable(rows, headers.length > 0 ? headers : undefined);
    return parsed.rows.length > 0 ? parsed : null;
  }
  return null;
}

function renderEntityEditor(entityId) {
  const entity = campaign.entities[entityId];
  const editor = document.getElementById('entity-editor');
  if (!entity) { editor.innerHTML = ''; return; }
  const c = colorFor(entity.color);
  const icons = window.Constants.ICONS_BY_TYPE[entity.type] || [];

  const notes = window.Query.getAssignedContent(campaign, entityId, 'note');
  const general = notes.filter((n) => !n.timeId).sort((a, b) => a.order - b.order);
  const dayNotes = notes.filter((n) => n.timeId);
  const topics = window.Query.getAssignedContent(campaign, entityId, 'topic');
  const cps = window.Query.sortedCheckpoints(campaign);
  const groups = (campaign.entityGroups || []).slice().sort((a, b) => a.order - b.order);

  // A draft is an entity that doesn't exist yet: the same editor, but with
  // a Type choice and Create / Cancel in place of Delete.
  const draft = ui.newEntityDraft && ui.newEntityDraft.id === entityId && window.DataModel.isDraftEntity(campaign, entityId)
    ? ui.newEntityDraft : null;
  const draftButtons = `<div class="inline">
      <button class="primary icon-btn" onclick="window.app.saveNewEntity()">${icon('check')} Create entity</button>
      <button class="icon-btn" onclick="window.app.cancelNewEntity()">${icon('x')} Cancel</button>
    </div>`;

  let html = `
    <div class="card">
      <div class="card-head">
        <span class="card-title">${entityBadge(entity, 22)} <span id="ee-title">${esc(entity.name) || (draft ? `New ${entity.type === 'location' ? 'location' : entity.type === 'quest' ? 'quest' : 'NPC'}` : '')}</span></span>
        ${draft ? draftButtons : `<span class="inline"><button class="mini-btn" title="Show in the graph" onclick="window.app.showInGraph('${entity.id}')">${icon('graph')}</button><button class="mini-btn" title="Delete entity" onclick="window.app.deleteEntity('${entity.id}')">${icon('trash')}</button></span>`}
      </div>
      ${draft ? `<div class="form-row"><label>Type</label>
        <select onchange="window.app.setDraftType(this.value)">
          <option value="npc" ${entity.type === 'npc' ? 'selected' : ''}>NPC</option>
          <option value="location" ${entity.type === 'location' ? 'selected' : ''}>Location</option>
          <option value="quest" ${entity.type === 'quest' ? 'selected' : ''}>Quest</option>
        </select>
      </div>` : ''}
      <div class="form-row"><label>Name</label><input type="text" id="ee-name" value="${esc(entity.name)}" ${draft ? 'placeholder="Required"' : ''} oninput="window.app.onEntityFieldInput('${entity.id}','name',this.value)" onchange="window.app.offerArtwork('${entity.id}',false)"></div>
      <div class="form-row"><label>Summary</label><textarea id="ee-summary" oninput="window.app.onEntityFieldInput('${entity.id}','summary',this.value)">${esc(entity.summary)}</textarea></div>
      <div class="form-row"><label>Notion link</label><input type="text" value="${esc(entity.notionUrl)}" oninput="window.app.onEntityFieldInput('${entity.id}','notionUrl',this.value)"></div>
      <div class="form-row"><label>Group</label>
        <select onchange="window.app.updateEntityGroup('${entity.id}',this.value)">
          <option value="">Ungrouped</option>
          ${groupOptionsHTML(groups, entity.groupId)}
        </select>
        <div class="hint" style="margin-top:4px">Purely for organizing this list — never shown or used in Play mode.</div>
      </div>
      <div class="form-row"><label>Icon</label>
        <div class="inline" style="flex-wrap:wrap">
          ${icons.map((i) => `<button class="mini-btn" title="${i}" style="${i === entity.icon ? `background:${c.bg};color:${c.fg};border-color:${c.fg}` : ''}" onclick="window.app.updateEntityField('${entity.id}','icon','${i}')">${icon(i)}</button>`).join('')}
        </div>
      </div>
      <div class="form-row"><label>Color</label>
        <div class="inline" style="flex-wrap:wrap">
          ${window.Constants.COLOR_PALETTE.map((p) => `<button class="mini-btn" title="${p.key}" style="background:${p.bg};border-color:${entity.color === p.key ? p.fg : 'var(--border)'}" onclick="window.app.updateEntityField('${entity.id}','color','${p.key}')"></button>`).join('')}
        </div>
      </div>
      <div class="hint">Mention this entity elsewhere by typing <code>[[${entity.id}]]</code> in a content block.</div>
    </div>

    ${entity.type === 'quest' ? questPageHTML(entity.id) : `
    ${renderEntityImageEditorHTML(entity)}
    ${renderSceneLayoutEditorHTML(entity)}
    ${renderCharacterCardEditorHTML(entity)}
    ${entity.type === 'location' ? renderLootTableEditorHTML(entity) : ''}
    ${renderInventoryEditorHTML(entity)}

    <div class="section-label">General notes (always visible)</div>
    ${general.map((n) => `<div class="form-row">
      <div class="inline">
        <textarea id="${n.moduleId}" class="mention-field" style="flex:1" oninput="window.app.onNoteTextInput('${n.moduleId}',this.value)">${esc(n.text)}</textarea>
        <button class="mini-btn" title="Delete note" onclick="window.app.deleteContentModuleUI('${n.moduleId}')">${icon('trash')}</button>
      </div>
      ${questControlHTML(n.moduleId)}${condBlockRowHTML(n.moduleId)}
    </div>`).join('')}
    <div class="inline">
      <button class="icon-btn" onclick="window.app.addGeneralNote('${entity.id}')">${icon('plus')} Add general note</button>
      <button class="icon-btn" onclick="window.app.openAssignFromLibrary({type:'note',entityId:'${entity.id}',timeId:null})">${icon('plus')} From library…</button>
    </div>

    <div class="section-label">Time-specific notes</div>
    ${cps.map((cp) => {
      const notesForCp = dayNotes.filter((n) => n.timeId === cp.id).sort((a, b) => a.order - b.order);
      if (notesForCp.length === 0) return '';
      return `
        <div class="section-subheading">${esc(cp.label)}</div>
        ${notesForCp.map((n, idx) => `
        <div class="beat-editor-row">
          <textarea id="${n.moduleId}" class="mention-field" oninput="window.app.onNoteTextInput('${n.moduleId}',this.value)">${esc(n.text)}</textarea>
          ${questControlHTML(n.moduleId)}${condBlockRowHTML(n.moduleId)}
          <div class="inline">
            <select onchange="window.app.updateNoteTimeId('${n.assignmentId}',this.value)">
              ${cps.map((c) => `<option value="${c.id}" ${n.timeId === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
            </select>
            <button class="mini-btn" title="Move up" ${idx === 0 ? 'disabled' : ''} onclick="window.app.moveAssignmentUI('${n.assignmentId}',-1)">${icon('chevronUp')}</button>
            <button class="mini-btn" title="Move down" ${idx === notesForCp.length - 1 ? 'disabled' : ''} onclick="window.app.moveAssignmentUI('${n.assignmentId}',1)">${icon('chevronDown')}</button>
            <button class="mini-btn" title="Delete note" onclick="window.app.deleteContentModuleUI('${n.moduleId}')">${icon('trash')}</button>
          </div>
        </div>`).join('')}`;
    }).join('')}
    <div class="inline">
      <select id="new-note-time">${cps.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}</select>
      <button class="icon-btn" onclick="window.app.addTimeNote('${entity.id}')">${icon('plus')} Add note for this time</button>
      <button class="icon-btn" onclick="window.app.openAssignFromLibraryForNewNoteTime('${entity.id}')">${icon('plus')} From library…</button>
    </div>

    <div class="section-label">Dialogue topics</div>
    <p class="hint">Optionally scope a topic to appear starting a specific checkpoint — it stays available at every later one too, it just won't show up before then.</p>
    ${topics.slice().sort((a, b) => a.order - b.order).map((t, idx, sortedTopics) => `
      <div class="beat-editor-row">
        <div class="inline qt-row"><input type="text" style="flex:1" value="${esc(t.name)}" oninput="window.app.onTopicLabelInput('${t.moduleId}',this.value)">${questTagHTML(t.moduleId)}</div>
        <textarea id="${t.moduleId}" class="mention-field" oninput="window.app.onTopicTextInput('${t.moduleId}',this.value)">${esc(t.text)}</textarea>
        ${questControlHTML(t.moduleId)}${condBlockRowHTML(t.moduleId)}
        <div class="inline">
          <select onchange="window.app.updateTopicTimeId('${t.assignmentId}',this.value)">
            <option value="" ${!t.timeId ? 'selected' : ''}>Always available</option>
            ${cps.map((c) => `<option value="${c.id}" ${t.timeId === c.id ? 'selected' : ''}>Available from ${esc(c.label)}</option>`).join('')}
          </select>
          <button class="mini-btn" title="Move up" ${idx === 0 ? 'disabled' : ''} onclick="window.app.moveAssignmentUI('${t.assignmentId}',-1)">${icon('chevronUp')}</button>
          <button class="mini-btn" title="Move down" ${idx === sortedTopics.length - 1 ? 'disabled' : ''} onclick="window.app.moveAssignmentUI('${t.assignmentId}',1)">${icon('chevronDown')}</button>
          <button class="mini-btn" title="Delete topic" onclick="window.app.deleteContentModuleUI('${t.moduleId}')">${icon('trash')}</button>
        </div>
      </div>`).join('')}
    <div class="inline">
      <button class="icon-btn" onclick="window.app.addTopic('${entity.id}')">${icon('plus')} Add topic</button>
      <button class="icon-btn" onclick="window.app.openAssignFromLibrary({type:'topic',entityId:'${entity.id}',timeId:null})">${icon('plus')} From library…</button>
    </div>
    `}
    ${draft ? `<div class="divider"></div>${draftButtons}` : ''}
  `;

  editor.innerHTML = html;
  wireMentionAutocomplete(editor);
  wirePasteHandler(editor);
  if (draft && draft.focusName) {
    draft.focusName = false;
    const nameInput = document.getElementById('ee-name');
    if (nameInput) nameInput.focus({ preventScroll: true });
  }
}

// Default order is creation order; this is purely for fixing it up
// afterward (e.g. a checkpoint added out of chronological sequence, like
// realizing you need a "Day 2" checkpoint after already building out Day 3
// and Day 4). Reordering only, deliberately no delete here — removing a
// checkpoint would orphan anything already tagged to it, and that's a
// bigger, separate decision worth its own confirmation step if it's ever
// built.
function renderCheckpointManagerHTML(cps) {
  return `<div style="margin-top:8px">
    ${cps.map((c, idx) => `
      <div class="campaign-row">
        <input type="text" value="${esc(c.label)}" style="flex:1" oninput="window.app.onCheckpointLabelInput('${c.id}',this.value)">
        <div class="campaign-actions">
          <button class="mini-btn" title="Move earlier" ${idx === 0 ? 'disabled' : ''} onclick="window.app.moveCheckpointUI('${c.id}',-1)">${icon('chevronUp')}</button>
          <button class="mini-btn" title="Move later" ${idx === cps.length - 1 ? 'disabled' : ''} onclick="window.app.moveCheckpointUI('${c.id}',1)">${icon('chevronDown')}</button>
        </div>
      </div>`).join('')}
  </div>`;
}

// Location picker: a search box with the full alphabetical list right below
// it. The list filters live as you type, Up/Down moves a highlight through the
// visible rows, Enter picks the highlighted one, a click picks any row.
function locMatches(locs) {
  const q = String(ui.locSearch || '').trim().toLowerCase();
  if (!q) return locs;
  return locs.filter((l) => l.name.toLowerCase().includes(q));
}

function locListHTML(locs) {
  const matches = locMatches(locs);
  if (!matches.length) return '<div class="hint" style="padding:6px 8px;margin:0">No location matches.</div>';
  if (ui.locHighlight == null || !matches.some((l) => l.id === ui.locHighlight)) {
    ui.locHighlight = (matches.find((l) => l.id === ui.createContentLocationId) || matches[0]).id;
  }
  return matches.map((l) => `<div class="entity-row loc-row ${l.id === ui.locHighlight ? 'hl' : ''} ${l.id === ui.createContentLocationId ? 'current' : ''}" data-loc-id="${l.id}" onmousedown="event.preventDefault();window.app.pickContentLocation('${l.id}')">
      ${entityBadge(l, 18)}<span class="name">${esc(l.name)}</span>${l.id === ui.createContentLocationId ? '<span class="type-tag">editing</span>' : ''}
    </div>`).join('');
}

function renderCreateContent() {
  const body = document.getElementById('create-body');
  const locs = locations().slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  const cps = window.Query.sortedCheckpoints(campaign);

  if (locs.length === 0) {
    body.innerHTML = `<p class="empty-hint">Add a location under the Entities tab first.</p>`;
    return;
  }

  if (!ui.createContentLocationId || !locs.some((l) => l.id === ui.createContentLocationId)) ui.createContentLocationId = locs[0].id;
  if (!ui.createContentTimeId && cps.length > 0) ui.createContentTimeId = cps[0].id;

  let html = `
    <p class="hint">Prepare what happens at <b>one location at one milestone</b>: its description, who is present, trackable sections and scenes. A location's own notes and topics live in the Entities tab.</p>
    <div class="form-row"><label>Location</label>
      <input type="text" id="cc-loc-search" placeholder="Search locations… (↑ ↓ to move, Enter to open)" autocomplete="off" value="${esc(ui.locSearch || '')}" style="margin-bottom:6px">
      <div class="presence-list loc-list" id="cc-loc-list">${locListHTML(locs)}</div>
    </div>
    <div class="form-row"><label>Time</label>
      <div class="inline">
        <select id="cc-time">${cps.map((c) => `<option value="${c.id}" ${c.id === ui.createContentTimeId ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select>
        ${ui.addingCheckpoint
          ? `<input type="text" id="new-cp-label" placeholder="e.g. Day 4 · dusk" onkeydown="if(event.key==='Enter'){window.app.confirmNewCheckpoint()}else if(event.key==='Escape'){window.app.cancelNewCheckpoint()}">
             <button class="icon-btn" onclick="window.app.confirmNewCheckpoint()">${icon('check')}</button>
             <button class="icon-btn" onclick="window.app.cancelNewCheckpoint()">${icon('x')}</button>`
          : `<button class="icon-btn" onclick="window.app.addCheckpointPrompt()">${icon('plus')} New checkpoint</button>`}
      </div>
      <button class="icon-btn" style="margin-top:6px;align-self:flex-start" onclick="window.app.toggleCheckpointManager()">${icon('clock')} ${ui.checkpointManagerOpen ? 'Hide' : 'Manage'} checkpoint order</button>
      ${ui.checkpointManagerOpen ? renderCheckpointManagerHTML(cps) : ''}
    </div>
    <div class="divider"></div>
    <div id="content-editor"></div>
  `;
  body.innerHTML = html;

  const locSearch = document.getElementById('cc-loc-search');
  const redrawLocList = () => {
    const list = document.getElementById('cc-loc-list');
    list.innerHTML = locListHTML(locs);
    const hl = list.querySelector('.hl');
    if (hl) hl.scrollIntoView({ block: 'nearest' });
  };
  window.app.pickContentLocation = (id) => { ui.createContentLocationId = id; campaign.meta.lastContentLocationId = id; scheduleFieldSave('content-location'); ui.locSearch = ''; ui.locHighlight = null; ui.pasteReview = null; renderCreateContent(); };
  locSearch.oninput = () => { ui.locSearch = locSearch.value; ui.locHighlight = null; redrawLocList(); };
  locSearch.onkeydown = (e) => {
    const matches = locMatches(locs);
    const i = matches.findIndex((l) => l.id === ui.locHighlight);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!matches.length) return;
      const n = e.key === 'ArrowDown' ? Math.min(matches.length - 1, i + 1) : Math.max(0, i - 1);
      ui.locHighlight = matches[n].id; redrawLocList();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = matches[i] || matches[0];
      if (hit) window.app.pickContentLocation(hit.id);
    } else if (e.key === 'Escape' && ui.locSearch) {
      e.preventDefault(); e.stopPropagation(); ui.locSearch = ''; locSearch.value = ''; ui.locHighlight = null; redrawLocList();
    }
  };
  redrawLocList();
  document.getElementById('cc-time').onchange = (e) => { ui.createContentTimeId = e.target.value; campaign.meta.lastContentTimeId = e.target.value; scheduleFieldSave('content-location'); ui.pasteReview = null; renderCreateContent(); };

  renderContentEditor();
  restoreContentField();
}

// Remember where the DM was working in the Content tab: which text field and where
// in it. Reopened once, the next time the Content tab is drawn after the app starts.
function contentFieldEls() { return Array.from(document.querySelectorAll('#content-editor textarea, #content-editor input[type="text"]')); }

let contentFieldTimer = null;
function rememberContentField(el) {
  if (ui.mode !== 'create' || ui.createTab !== 'content' || !el || !el.closest || !el.closest('#content-editor')) return;
  if (!(el.matches('textarea') || el.matches('input[type="text"]'))) return;
  campaign.meta.lastContentField = {
    locationId: ui.createContentLocationId, timeId: ui.createContentTimeId,
    id: el.id || null, index: contentFieldEls().indexOf(el),
    selStart: el.selectionStart || 0, selEnd: el.selectionEnd || 0, scrollTop: el.scrollTop || 0
  };
  campaign.meta.lastContentTimeId = ui.createContentTimeId;
  clearTimeout(contentFieldTimer);
  contentFieldTimer = setTimeout(() => { persistSafely(); }, 1500);
}
['focusin', 'keyup', 'mouseup', 'input'].forEach((t) => document.addEventListener(t, (ev) => rememberContentField(ev.target)));

function restoreContentField() {
  const r = ui.contentRestore;
  if (!r) return;
  ui.contentRestore = null;
  if (r.locationId !== ui.createContentLocationId || r.timeId !== ui.createContentTimeId) return;
  const els = contentFieldEls();
  const byId = r.id ? document.getElementById(r.id) : null;
  const el = byId && els.includes(byId) ? byId : els[r.index];
  if (!el) return;
  el.focus({ preventScroll: true });
  try { const n = el.value.length; el.setSelectionRange(Math.min(r.selStart, n), Math.min(r.selEnd, n)); } catch (e) { /* not a text control */ }
  el.scrollTop = r.scrollTop || 0;
  el.scrollIntoView({ block: 'center' });
}

// An arrival's only real job now is tracking presence and marking "this
// location became active here" for the Play-mode fallback logic —
// description/beats/completion all live in contentModules+assignments.
// Built directly here (not through createArrivalBlock, which still
// carries html/beats/complete fields left over from before Modular
// Content — harmless since nothing reads them anymore, but no reason to
// manufacture them on every newly-created arrival either). A beat,
// scene, or description assignment is invisible in Play mode until an
// arrival actually exists at that location+checkpoint — getLocationView
// only looks for assigned content once it has an arrival to anchor to
// — so every place that creates this kind of assignment calls this
// first, not just the ones that also touch presence/description text.
function ensureArrivalExists(locationId, timeId) {
  let arrival = campaign.blocks.find((b) => b.kind === 'arrival' && b.locationId === locationId && b.timeId === timeId);
  if (!arrival) {
    arrival = { id: window.DataModel.makeId('blk'), kind: 'arrival', locationId, timeId, presence: [], createdAt: new Date().toISOString() };
    campaign.blocks.push(arrival);
  }
  return arrival;
}

// --- Content tab: the "Present here" picker ---------------------------------
//
// Search, filters, entities grouped under their existing (collapsible)
// groups, and a live preview of how the result shows up in Play mode.
// Search/filter state lives in ui.presencePicker and resets when the
// location or checkpoint being edited changes (a leftover search from the
// last location would only hide entries here). Toggling a checkbox, typing
// in the search box and changing a filter all re-render only the list and
// the preview — never the controls above them — so the search field keeps
// its focus and caret while you type.

function currentPresenceIds() {
  const arrival = campaign.blocks.find(
    (b) => b.kind === 'arrival' && b.locationId === ui.createContentLocationId && b.timeId === ui.createContentTimeId
  );
  return arrival ? (arrival.presence || []) : [];
}

function presencePickerState() {
  const key = `${ui.createContentLocationId}|${ui.createContentTimeId}`;
  if (!ui.presencePicker || ui.presencePicker.key !== key) {
    ui.presencePicker = { key, query: '', type: '', groupId: '', status: 'all', selected: [], anchor: null };
  }
  return ui.presencePicker;
}

function renderPresenceRowHTML(e, depth, presentSet) {
  const indent = Math.min(depth || 0, 4) * 16;
  const present = presentSet.has(e.id);
  const selected = presencePickerState().selected.includes(e.id);
  // The row itself is what you click to select (Shift = range, Ctrl = one
  // more); the checkbox is still a one-click add/remove for a single entity.
  return `<div class="entity-row presence-row${present ? ' present' : ''}${selected ? ' selected' : ''}" data-entity-id="${e.id}" style="margin-left:${indent}px" onclick="window.app.onPresenceRowClick(event,'${e.id}')">
    <input type="checkbox" id="presence-cb-${e.id}" title="${present ? 'Remove from this place' : 'Add to this place'}" ${present ? 'checked' : ''} onclick="event.stopPropagation()" onchange="window.app.togglePresence('${e.id}',this.checked)">
    ${entityBadge(e, 20)}
    <span class="name">${esc(e.name)}</span>
    <span class="type-tag">${e.type}</span>
  </div>`;
}

// "3 selected · [Add 2] [Remove 1] [Clear]". Refilled by syncPresenceSelection
// whenever the selection or the visible rows change.
function presenceSelectionBarHTML() {
  const st = presencePickerState();
  const present = new Set(currentPresenceIds());
  const toAdd = st.selected.filter((id) => !present.has(id)).length;
  const toRemove = st.selected.length - toAdd;
  return `<span class="hint" style="margin:0">${st.selected.length} selected</span>
    <span style="flex:1"></span>
    <button class="icon-btn" ${toAdd ? '' : 'disabled'} onclick="window.app.addPresenceSelected()">${icon('plus')} Add${toAdd ? ` (${toAdd})` : ''}</button>
    <button class="icon-btn" ${toRemove ? '' : 'disabled'} onclick="window.app.removePresenceSelected()">Remove${toRemove ? ` (${toRemove})` : ''}</button>
    <button class="icon-btn" ${st.selected.length ? '' : 'disabled'} onclick="window.app.clearPresenceSelection()">Clear</button>`;
}

// Keeps the selection limited to rows that are actually showing (a search,
// filter or collapsed group hides some) so "Add" never acts on something you
// can't see, and refreshes highlights and the bar.
function syncPresenceSelection() {
  const st = presencePickerState();
  const rows = Array.from(document.querySelectorAll('#presence-list .presence-row'));
  const visible = new Set(rows.map((el) => el.dataset.entityId));
  st.selected = st.selected.filter((id) => visible.has(id));
  const sel = new Set(st.selected);
  rows.forEach((el) => el.classList.toggle('selected', sel.has(el.dataset.entityId)));
  const bar = document.getElementById('presence-selection-bar');
  if (bar) bar.innerHTML = presenceSelectionBarHTML();
}

function presenceHeaderHTML() {
  const n = currentPresenceIds().filter((id) => campaign.entities[id]).length;
  return `${icon(ui.presenceOpen ? 'chevronDown' : 'chevronRight')} Present here${n > 0 ? ` <span class="presence-added-count">· ${n} added</span>` : ''}`;
}

function renderPresenceListHTML() {
  const st = presencePickerState();
  const presentIds = currentPresenceIds();
  const presentSet = new Set(presentIds);
  const list = window.Query.filterPresenceCandidates(campaign, Object.values(campaign.entities), presentIds, st);
  const filtering = !!(st.query.trim() || st.type || st.groupId || st.status !== 'all');
  const groups = (campaign.entityGroups || []).slice().sort((a, b) => a.order - b.order);
  const validGroupIds = new Set(groups.map((g) => g.id));
  const addedInList = list.filter((e) => presentSet.has(e.id));
  const addedTotal = presentIds.filter((id) => campaign.entities[id]).length;
  const collapsedIds = campaign.meta.collapsedPresenceGroups || [];

  const opts = {
    collapsedKey: 'collapsedPresenceGroups',
    toggleFn: 'togglePresenceGroupCollapsed',
    staticWhenSearching: true,
    renderRow: (e, depth) => renderPresenceRowHTML(e, depth, presentSet),
    // Collapsing a group shouldn't hide the fact that people inside it are
    // already added, so each header says how many are.
    headerExtra: (g) => {
      const n = countInSubtree(g, groups, addedInList);
      return n > 0 ? ` <span class="presence-added-count">· ${n} added</span>` : '';
    }
  };

  let rows = '';
  groups.filter((g) => !g.parentId).forEach((g) => {
    rows += renderGroupNodeHTML(g, groups, list, 0, filtering, opts);
  });
  const ungrouped = list.filter((e) => !e.groupId || !validGroupIds.has(e.groupId));
  if (ungrouped.length > 0) {
    if (groups.length > 0) {
      const collapsed = !filtering && collapsedIds.includes('__ungrouped__');
      const n = ungrouped.filter((e) => presentSet.has(e.id)).length;
      rows += `<div class="section-label group-header"${filtering ? '' : ` onclick="window.app.togglePresenceGroupCollapsed('__ungrouped__')"`}>
        ${filtering ? '' : icon(collapsed ? 'chevronRight' : 'chevronDown')} Ungrouped (${ungrouped.length})${n > 0 ? ` <span class="presence-added-count">· ${n} added</span>` : ''}
      </div>`;
      if (!collapsed) rows += ungrouped.map((e) => renderPresenceRowHTML(e, 1, presentSet)).join('');
    } else {
      rows += ungrouped.map((e) => renderPresenceRowHTML(e, 0, presentSet)).join('');
    }
  }
  if (list.length === 0) rows = `<p class="empty-hint">No entities match.</p>`;

  return `<div class="presence-summary">
      <span>${list.length} shown · ${addedTotal} added here</span>
      <span style="flex:1"></span>
      ${groups.length > 0 && !filtering ? `<button class="icon-btn" onclick="window.app.collapseAllPresenceGroups()">Collapse all</button><button class="icon-btn" onclick="window.app.expandAllPresenceGroups()">Expand all</button>` : ''}
    </div>
    <div class="presence-selection-bar inline" id="presence-selection-bar">${presenceSelectionBarHTML()}</div>
    <div class="presence-list" id="presence-list">${rows}</div>`;
}

function renderPresencePreviewHTML() {
  const entities = currentPresenceIds().map((id) => campaign.entities[id]).filter(Boolean);
  return renderPresenceChipsHTML(entities, { interactive: false, editJump: true });
}

// Updates only the list and the preview, keeping the list's scroll position
// and, for keyboard users, focus on the same checkbox.
function renderPresencePickerBody() {
  const body = document.getElementById('presence-picker-body');
  if (!body) return;
  const oldList = document.getElementById('presence-list');
  const scroll = oldList ? oldList.scrollTop : 0;
  const focusedId = document.activeElement && document.activeElement.id && document.activeElement.id.startsWith('presence-cb-')
    ? document.activeElement.id : null;
  body.innerHTML = renderPresenceListHTML();
  const newList = document.getElementById('presence-list');
  if (newList) newList.scrollTop = scroll;
  if (focusedId) {
    const again = document.getElementById(focusedId);
    if (again) again.focus();
  }
  const preview = document.getElementById('presence-preview');
  if (preview) preview.innerHTML = renderPresencePreviewHTML();
  const header = document.getElementById('presence-header');
  if (header) header.innerHTML = presenceHeaderHTML();
  syncPresenceSelection();
}

function renderPresencePickerHTML() {
  const st = presencePickerState();
  const groups = (campaign.entityGroups || [])
    .map((g) => ({ id: g.id, path: window.Query.getGroupPathName(campaign, g.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const types = Object.keys(window.Constants.ICONS_BY_TYPE).filter((t) => t !== 'quest');
  const typeLabel = (t) => (t === 'npc' ? 'NPCs' : t === 'location' ? 'Locations' : t);
  return `
    <div class="section-label group-header" id="presence-header" style="cursor:pointer" onclick="window.app.togglePresenceOpen()">${presenceHeaderHTML()}</div>
    <div id="presence-picker" style="display:${ui.presenceOpen ? 'block' : 'none'}">
      <input type="text" id="presence-search" style="width:100%" placeholder="Search by name, type (npc / location) or group…" value="${esc(st.query)}" oninput="window.app.onPresenceSearchInput(this.value)">
      <div class="inline" style="flex-wrap:wrap;margin:6px 0">
        ${types.length > 1 ? `<select onchange="window.app.setPresenceTypeFilter(this.value)">
          <option value="">All types</option>
          ${types.map((t) => `<option value="${t}" ${st.type === t ? 'selected' : ''}>${typeLabel(t)}</option>`).join('')}
        </select>` : ''}
        <select onchange="window.app.setPresenceGroupFilter(this.value)">
          <option value="">All groups</option>
          <option value="__none__" ${st.groupId === '__none__' ? 'selected' : ''}>No group</option>
          ${groups.map((g) => `<option value="${g.id}" ${st.groupId === g.id ? 'selected' : ''}>${esc(g.path)}</option>`).join('')}
        </select>
        <select onchange="window.app.setPresenceStatusFilter(this.value)">
          <option value="all" ${st.status === 'all' ? 'selected' : ''}>Everyone</option>
          <option value="added" ${st.status === 'added' ? 'selected' : ''}>Added here</option>
          <option value="notAdded" ${st.status === 'notAdded' ? 'selected' : ''}>Not added yet</option>
        </select>
      </div>
      <div id="presence-picker-body">${renderPresenceListHTML()}</div>
    </div>
    <div class="section-label">Preview — how this looks in Play mode</div>
    <div id="presence-preview">${renderPresencePreviewHTML()}</div>`;
}

function renderContentEditor() {
  const editor = document.getElementById('content-editor');
  if (!ui.createContentLocationId || !ui.createContentTimeId) { editor.innerHTML = ''; return; }

  let arrival = campaign.blocks.find(
    (b) => b.kind === 'arrival' && b.locationId === ui.createContentLocationId && b.timeId === ui.createContentTimeId
  );

  const allEntities = Object.values(campaign.entities);
  const npcsList = allEntities.filter((e) => e.type === 'npc');
  const beatsHere = window.Query.getAssignedContent(campaign, ui.createContentLocationId, 'beat')
    .filter((b) => b.timeId === ui.createContentTimeId)
    .sort((a, b) => a.order - b.order);
  const scenesHere = window.Query.getAssignedContent(campaign, ui.createContentLocationId, 'scene')
    .filter((s) => s.timeId === ui.createContentTimeId)
    .sort((a, b) => a.order - b.order);
  const descriptionHere = window.Query.getAssignedContent(campaign, ui.createContentLocationId, 'description')
    .find((d) => d.timeId === ui.createContentTimeId);

  let html = `
    <div id="paste-review-banner">${renderPasteReviewBanner()}</div>
    <div class="form-row">
      <label>Description text — type <code>@</code> to search and insert a mention, type <code>""</code> to start a line of speaker-colored dialogue right here in the text (Enter ends it, Shift+Enter keeps it going across more lines), use the dropdown below, or paste directly from Notion (formatting and known entity names are picked up automatically). Shift+Enter anywhere for a tighter line break within the same paragraph.</label>
      <textarea id="arr-text" class="mention-field" data-paste-context="arrival" rows="6" placeholder="Type @ for a mention, &quot;&quot; for dialogue, Ctrl+L to link, Ctrl+B/I to format" oninput="window.app.onArrivalTextInput(this.value)">${esc(descriptionHere ? descriptionHere.html : '')}</textarea>
      <div class="inline" style="margin-top:6px">
        <select id="arr-mention-picker" onchange="window.app.insertMentionToken()">
          <option value="">Insert mention…</option>
          ${allEntities.map((e) => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}
        </select>
        <span class="hint" style="margin:0">Saves automatically as you type.</span>
      </div>
      ${descriptionHere ? questControlHTML(descriptionHere.moduleId) + condBlockRowHTML(descriptionHere.moduleId) : ''}
    </div>

    ${renderPresencePickerHTML()}

    <div class="section-label">Trackable sections (beats)</div>
    ${beatsHere.length > 0 ? beatsHere.map((b, idx) => `
      <div class="beat-editor-row">
        <div class="inline qt-row"><input type="text" style="flex:1" value="${esc(b.name)}" placeholder="Short label" oninput="window.app.onBeatFieldInput('${b.moduleId}','name',this.value)">${questTagHTML(b.moduleId)}</div>
        <textarea id="${b.moduleId}" class="mention-field" placeholder="Full text (optional, for your own reference) — @ mention, &quot;&quot; dialogue, Ctrl+L link, Ctrl+B/I format" oninput="window.app.onBeatFieldInput('${b.moduleId}','text',this.value)">${esc(b.text)}</textarea>
        ${questControlHTML(b.moduleId)}${condBlockRowHTML(b.moduleId)}
        <div class="inline">
          <label style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" ${b.complete ? 'checked' : ''} onchange="window.app.toggleModuleComplete('${b.moduleId}',this.checked)">Complete</label>
          <button class="mini-btn" title="Move up" ${idx === 0 ? 'disabled' : ''} onclick="window.app.moveAssignmentUI('${b.assignmentId}',-1)">${icon('chevronUp')}</button>
          <button class="mini-btn" title="Move down" ${idx === beatsHere.length - 1 ? 'disabled' : ''} onclick="window.app.moveAssignmentUI('${b.assignmentId}',1)">${icon('chevronDown')}</button>
          <button class="mini-btn" onclick="window.app.deleteContentModuleUI('${b.moduleId}')">${icon('trash')}</button>
        </div>
      </div>`).join('') : '<p class="empty-hint">No sections yet.</p>'}
    <div class="inline">
      <button class="icon-btn" onclick="window.app.addBeatToArrival()">${icon('plus')} Add section</button>
      <button class="icon-btn" onclick="window.app.openAssignFromLibraryForContent('beat')">${icon('plus')} From library…</button>
    </div>

    <div class="section-label">Scene (linear dialogue)</div>
    <p class="hint">A scripted exchange that plays out in order — separate from an NPC's reactive dialogue topics. Marking it complete resolves the whole scene at once, not line by line.</p>
    ${scenesHere.map((scene) => `
      <div class="scene-editor">
        <div class="inline" style="margin-bottom:10px">
          <input type="text" value="${esc(scene.name)}" style="flex:1" oninput="window.app.onSceneLabelInput('${scene.moduleId}',this.value)">${questTagHTML(scene.moduleId)}
          <button class="mini-btn" title="Delete scene" onclick="window.app.deleteContentModuleUI('${scene.moduleId}')">${icon('trash')}</button>
        </div>
        ${questControlHTML(scene.moduleId)}${condBlockRowHTML(scene.moduleId)}
        ${scene.lines.length === 0 ? '<p class="empty-hint">No lines yet — add one below.</p>' : ''}
        ${scene.lines.map((line, idx) => `
          <div class="scene-editor-line">
            <div class="scene-line-toolbar">
              <select onchange="window.app.updateSceneLineSpeaker('${scene.moduleId}','${line.id}',this.value)">
                <option value="">(narration)</option>
                ${npcsList.map((n) => `<option value="${n.id}" ${line.speakerId === n.id ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}
              </select>
              <div class="scene-line-actions">
                <button class="mini-btn" title="Move up" ${idx === 0 ? 'disabled' : ''} onclick="window.app.moveSceneLine('${scene.moduleId}','${line.id}',-1)">${icon('chevronUp')}</button>
                <button class="mini-btn" title="Move down" ${idx === scene.lines.length - 1 ? 'disabled' : ''} onclick="window.app.moveSceneLine('${scene.moduleId}','${line.id}',1)">${icon('chevronDown')}</button>
                <button class="mini-btn" title="Delete line" onclick="window.app.deleteSceneLine('${scene.moduleId}','${line.id}')">${icon('trash')}</button>
              </div>
            </div>
            <textarea class="line-text" oninput="window.app.onSceneLineTextInput('${scene.moduleId}','${line.id}',this.value)">${esc(line.text)}</textarea>
          </div>`).join('')}
        <p class="hint" style="margin:8px 0 4px">Type <code>""</code> at the start of the line below to jump to the speaker picker, then Enter (or the + button) to add it.</p>
        <div class="scene-quick-add">
          <select id="scene-speaker-${scene.moduleId}">
            <option value="">(narration)</option>
            ${npcsList.map((n) => `<option value="${n.id}" ${ui.lastSceneSpeaker === n.id ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}
          </select>
          <input type="text" id="scene-quickadd-${scene.moduleId}" placeholder="Type a line…"
            oninput="window.app.handleSceneQuickAddInput(this,'${scene.moduleId}')"
            onkeydown="window.app.handleSceneQuickAddKey(event,'${scene.moduleId}')">
          <button class="mini-btn" title="Add line" onclick="window.app.commitSceneQuickAdd('${scene.moduleId}')">${icon('plus')}</button>
        </div>
      </div>`).join('')}
    <div class="inline">
      <button class="icon-btn" onclick="window.app.addScene()">${icon('plus')} Add scene</button>
      <button class="icon-btn" onclick="window.app.openAssignFromLibraryForContent('scene')">${icon('plus')} From library…</button>
    </div>
  `;

  editor.innerHTML = html;
  wireMentionAutocomplete(editor);
  wirePasteHandler(editor);
}

// --- Content Library (Modular Content manager) ------------------------
//
// The central place to create content independently of any one entity,
// browse/search/filter everything that exists, and assign the same
// module to more than one entity — the actual new capability Modular
// Content was built for. Everything created through the entity/content
// editors above still works exactly as it did (one module, one
// assignment, created together) — this is the place to do more than
// that: create without assigning yet, or assign one thing to several
// places for "prepare for either path the players take."

function getFilteredLibraryModules() {
  const filters = campaign.meta.contentLibraryFilters;
  let modules = (campaign.contentModules || []).slice();

  if (filters.type) modules = modules.filter((m) => m.type === filters.type);

  if (filters.entityId) {
    modules = modules.filter((m) => campaign.assignments.some((a) => a.moduleId === m.id && a.entityId === filters.entityId));
  }

  if (filters.unassignedOnly) {
    modules = modules.filter((m) => !campaign.assignments.some((a) => a.moduleId === m.id));
  }

  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    modules = modules.filter((m) => {
      const name = (m.name || '').toLowerCase();
      const body = (m.text || m.html || '').toLowerCase();
      return name.includes(q) || body.includes(q);
    });
  }

  if (filters.sort === 'type') {
    modules.sort((a, b) => a.type.localeCompare(b.type) || (a.name || '').localeCompare(b.name || ''));
  } else if (filters.sort === 'newest') {
    modules.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  } else {
    modules.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }

  return modules;
}

// Groups by "assigned to" — a module assigned to more than one entity
// genuinely appears in more than one group (it belongs to each), which
// is the whole point of grouping this way rather than picking just one
// "primary" placement. '__unassigned__' is its own group for anything
// with zero placements, kept separate from real entity groups (an id
// no real entity can ever collide with).
function buildLibraryGroups(modules) {
  const byEntity = {};
  const unassigned = [];
  modules.forEach((m) => {
    const assignments = window.Query.getModuleAssignments(campaign, m.id);
    const validPlacements = assignments.filter((a) => a.entity);
    if (validPlacements.length === 0) {
      unassigned.push(m);
      return;
    }
    validPlacements.forEach((a) => {
      if (!byEntity[a.entityId]) byEntity[a.entityId] = { entity: a.entity, modules: [] };
      if (!byEntity[a.entityId].modules.find((mm) => mm.id === m.id)) byEntity[a.entityId].modules.push(m);
    });
  });
  const sortedGroups = Object.values(byEntity).sort((a, b) => a.entity.name.localeCompare(b.entity.name));
  return { sortedGroups, unassigned };
}

function renderContentLibrary() {
  const body = document.getElementById('create-body');
  const filters = campaign.meta.contentLibraryFilters;
  const allEntities = Object.values(campaign.entities).sort((a, b) => a.name.localeCompare(b.name));
  const typeLabels = window.Constants.MODULE_TYPE_LABELS;

  // The search input gets its own container, never rebuilt by
  // renderLibraryResults (called on every filter change) — rebuilding it
  // on every keystroke was destroying and recreating the input itself,
  // which throws focus and cursor position away each time.
  body.innerHTML = `
    <input type="text" id="lib-search" placeholder="Search by name or text…" value="${esc(filters.search)}" oninput="window.app.setLibraryFilter('search',this.value)" style="margin-bottom:8px">
    <div class="inline" style="flex-wrap:wrap;margin-bottom:10px">
      <select onchange="window.app.setLibraryFilter('type',this.value)">
        <option value="">All types</option>
        ${Object.keys(typeLabels).map((k) => `<option value="${k}" ${filters.type === k ? 'selected' : ''}>${esc(typeLabels[k])}</option>`).join('')}
      </select>
      <select onchange="window.app.setLibraryFilter('entityId',this.value)">
        <option value="">All entities</option>
        ${allEntities.map((e) => `<option value="${e.id}" ${filters.entityId === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
      </select>
      <select onchange="window.app.setLibraryFilter('sort',this.value)">
        <option value="name" ${filters.sort === 'name' ? 'selected' : ''}>Sort: Name A-Z</option>
        <option value="type" ${filters.sort === 'type' ? 'selected' : ''}>Sort: Type</option>
        <option value="newest" ${filters.sort === 'newest' ? 'selected' : ''}>Sort: Newest first</option>
      </select>
      <label style="display:flex;align-items:center;gap:6px;font-size:13px">
        <input type="checkbox" ${filters.unassignedOnly ? 'checked' : ''} onchange="window.app.setLibraryFilter('unassignedOnly',this.checked)">
        Unassigned only
      </label>
      <button class="icon-btn" onclick="window.app.resetLibraryFilters()">Reset filters</button>
    </div>
    <div id="library-results"></div>
    <div id="dc-checks-section" style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border)"></div>
  `;
  renderLibraryResults();
  renderDCChecksLibrarySection();
}

// DC Checks aren't filtered/grouped the same way Modular Content is (no
// "assigned to" -- a check is referenced by token from anywhere, not
// placed on a specific entity), so this is a simple, separate list
// rather than folded into the filters/groups above it.
function renderDCChecksLibrarySection() {
  const el = document.getElementById('dc-checks-section');
  if (!el) return;
  const checks = campaign.dcChecks.slice().sort((a, b) => {
    const labelFor = (c) => {
      if (c.name && c.name.trim()) return c.name;
      const t = window.Constants.CHECK_TYPES.find((tt) => tt.key === c.checkType);
      return t ? t.label : c.checkType;
    };
    return labelFor(a).localeCompare(labelFor(b));
  });

  let html = `<div class="section-label">DC Checks (${checks.length})</div>`;
  html += `<p class="hint">Insertable directly into any text field with Alt+D — this list is for browsing and editing existing ones.</p>`;
  html += `<button class="icon-btn" onclick="window.app.openDCCheckEditor({checkId:null,onInsert:null})">${icon('plus')} New DC Check</button>`;

  if (checks.length === 0) {
    html += `<p class="empty-hint">None yet.</p>`;
  } else {
    html += checks.map((check) => {
      const typeInfo = window.Constants.CHECK_TYPES.find((t) => t.key === check.checkType);
      const typeLabel = typeInfo ? typeInfo.label : check.checkType;
      const displayName = (check.name && check.name.trim()) ? check.name : typeLabel;
      const rowCount = check.table.length;
      const logCount = check.rollLog.length;
      return `<div class="library-row" onclick="window.app.openDCCheckEditor({checkId:'${check.id}'})">
        <span class="library-row-type">${esc(typeLabel)}</span>
        <span class="library-row-name">${esc(displayName)}</span>
        <span class="library-row-summary">${rowCount} row${rowCount === 1 ? '' : 's'}${logCount > 0 ? ` · ${logCount} logged` : ''}</span>
      </div>`;
    }).join('');
  }

  el.innerHTML = html;
}

function renderLibraryResults() {
  const el = document.getElementById('library-results');
  if (!el) return;

  const modules = getFilteredLibraryModules();
  const typeLabels = window.Constants.MODULE_TYPE_LABELS;
  const collapsedKeys = campaign.meta.collapsedLibraryGroups || [];

  let html = `<div class="section-label">${modules.length} content module${modules.length === 1 ? '' : 's'}</div>`;

  if (!ui.libraryNewFormOpen) {
    html += `<button class="icon-btn" onclick="window.app.toggleLibraryNewForm()">${icon('plus')} New content</button>`;
  } else {
    html += `
      <div class="beat-editor-row">
        <input type="text" id="lib-new-name" placeholder="Name">
        <select id="lib-new-type">
          ${Object.keys(typeLabels).map((k) => `<option value="${k}">${esc(typeLabels[k])}</option>`).join('')}
        </select>
        <div class="inline">
          <button class="icon-btn" onclick="window.app.createLibraryModule()">${icon('check')} Create</button>
          <button class="icon-btn" onclick="window.app.toggleLibraryNewForm()">Cancel</button>
        </div>
      </div>
    `;
  }

  if (modules.length > 0) {
    html += `<div class="inline" style="margin:8px 0">
      <button class="icon-btn" onclick="window.app.expandAllLibraryGroups()">Expand all</button>
      <button class="icon-btn" onclick="window.app.collapseAllLibraryGroups()">Collapse all</button>
    </div>`;
  }

  const { sortedGroups, unassigned } = buildLibraryGroups(modules);
  const renderGroup = (key, label, groupModules) => {
    if (groupModules.length === 0) return '';
    const collapsed = collapsedKeys.includes(key);
    let g = `<div class="section-subheading library-group-header" onclick="window.app.toggleLibraryGroupCollapsed('${key}')">
      ${icon(collapsed ? 'chevronRight' : 'chevronDown')} ${esc(label)} (${groupModules.length})
    </div>`;
    if (!collapsed) g += groupModules.map((m) => renderLibraryModuleRowHTML(m)).join('');
    return g;
  };

  html += sortedGroups.map((g) => renderGroup(g.entity.id, g.entity.name, g.modules)).join('');
  html += renderGroup('__unassigned__', 'Unassigned', unassigned);

  if (modules.length === 0) {
    html += `<p class="empty-hint">No content matches these filters.</p>`;
  }

  el.innerHTML = html;
  wireMentionAutocomplete(el);
  wirePasteHandler(el);
}

function renderLibraryModuleRowHTML(m) {
  const assignments = window.Query.getModuleAssignments(campaign, m.id);
  const summary = assignments.length === 0
    ? 'Unassigned'
    : assignments.length === 1
      ? `Assigned to ${esc(assignments[0].entity ? assignments[0].entity.name : '(deleted entity)')}`
      : `Assigned to ${assignments.length} places`;
  const selected = ui.librarySelectedModuleId === m.id;
  let html = `<div class="library-row${selected ? ' selected' : ''}" onclick="window.app.selectLibraryModule('${m.id}')">
    <span class="library-row-type">${esc(window.Constants.MODULE_TYPE_LABELS[m.type] || m.type)}</span>
    <span class="library-row-name">${esc(m.name || '(untitled)')}${questTagHTML(m.id)}</span>
    <span class="library-row-summary">${esc(summary)}${m.complete ? ' · Resolved' : ''}</span>
  </div>`;
  // Rendered directly under this specific row rather than at the bottom
  // of the whole list — with potentially many modules in view, an
  // editor appearing far below whatever was clicked meant scrolling all
  // the way down just to see it.
  if (selected) html += renderLibraryModuleEditorHTML(m);
  return html;
}

function renderLibrarySceneFieldsHTML(module, npcsList) {
  return `
    <div class="section-label">Lines</div>
    ${module.lines.length === 0 ? '<p class="empty-hint">No lines yet — add one below.</p>' : ''}
    ${module.lines.map((line, idx) => `
      <div class="scene-editor-line">
        <div class="scene-line-toolbar">
          <select onchange="window.app.updateSceneLineSpeaker('${module.id}','${line.id}',this.value)">
            <option value="">(narration)</option>
            ${npcsList.map((n) => `<option value="${n.id}" ${line.speakerId === n.id ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}
          </select>
          <div class="scene-line-actions">
            <button class="mini-btn" title="Move up" ${idx === 0 ? 'disabled' : ''} onclick="window.app.moveSceneLine('${module.id}','${line.id}',-1)">${icon('chevronUp')}</button>
            <button class="mini-btn" title="Move down" ${idx === module.lines.length - 1 ? 'disabled' : ''} onclick="window.app.moveSceneLine('${module.id}','${line.id}',1)">${icon('chevronDown')}</button>
            <button class="mini-btn" title="Delete line" onclick="window.app.deleteSceneLine('${module.id}','${line.id}')">${icon('trash')}</button>
          </div>
        </div>
        <textarea class="line-text" oninput="window.app.onSceneLineTextInput('${module.id}','${line.id}',this.value)">${esc(line.text)}</textarea>
      </div>`).join('')}
    <div class="scene-quick-add">
      <select id="scene-speaker-${module.id}">
        <option value="">(narration)</option>
        ${npcsList.map((n) => `<option value="${n.id}" ${ui.lastSceneSpeaker === n.id ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}
      </select>
      <input type="text" id="scene-quickadd-${module.id}" placeholder="Type a line…"
        oninput="window.app.handleSceneQuickAddInput(this,'${module.id}')"
        onkeydown="window.app.handleSceneQuickAddKey(event,'${module.id}')">
      <button class="mini-btn" title="Add line" onclick="window.app.commitSceneQuickAdd('${module.id}')">${icon('plus')}</button>
    </div>
  `;
}

function condBlockRowHTML(moduleId) { return condCardControlHTML((campaign.contentModules || []).find((m) => m.id === moduleId)); }

function renderLibraryModuleEditorHTML(module) {
  const npcsList = Object.values(campaign.entities).filter((e) => e.type === 'npc');
  const assignments = window.Query.getModuleAssignments(campaign, module.id);
  const compatibleTypes = window.Constants.MODULE_TYPE_ENTITY_TYPES[module.type] || [];
  const compatibleEntities = Object.values(campaign.entities).filter((e) => compatibleTypes.includes(e.type));
  const allowsNoTime = module.type === 'note' || module.type === 'topic';

  let html = `<div class="card" style="margin:6px 0 12px">
    <div class="card-head">
      <span class="card-title">${esc(window.Constants.MODULE_TYPE_LABELS[module.type] || module.type)}</span>
      <button class="mini-btn" title="Show in the graph" onclick="window.app.showInGraph('${module.id}')">${icon('graph')}</button>
      <button class="mini-btn" title="Delete this content entirely" onclick="window.app.deleteLibraryModule('${module.id}')">${icon('trash')}</button>
    </div>
    <div class="form-row"><label>Name</label><div class="inline qt-row"><input type="text" style="flex:1" value="${esc(module.name)}" oninput="window.app.onLibraryModuleNameInput('${module.id}',this.value)">${questTagHTML(module.id)}</div></div>`;

  html += condBlockRowHTML(module.id);
  html += questControlHTML(module.id);
  if (module.type === 'scene') {
    html += renderLibrarySceneFieldsHTML(module, npcsList);
  } else if (module.type === 'description') {
    html += `<div class="form-row"><label>Text</label><textarea id="lib-field-${module.id}" class="mention-field" oninput="window.app.onLibraryModuleFieldInput('${module.id}','html',this.value)">${esc(module.html)}</textarea></div>`;
  } else {
    html += `<div class="form-row"><label>Text</label><textarea id="lib-field-${module.id}" class="mention-field" oninput="window.app.onLibraryModuleFieldInput('${module.id}','text',this.value)">${esc(module.text)}</textarea></div>`;
  }

  html += `<label style="display:flex;align-items:center;gap:6px;font-size:13px;margin:8px 0">
    <input type="checkbox" ${module.complete ? 'checked' : ''} onchange="window.app.toggleModuleComplete('${module.id}',this.checked)">
    Resolved (completing here resolves it everywhere it's assigned)
  </label>`;

  html += `<div class="section-label">Assigned to</div>`;
  if (ui.libraryAssignResultNote && ui.libraryAssignResultNote.moduleId === module.id) {
    html += `<p class="hint" style="color:var(--accent-fg)">${esc(ui.libraryAssignResultNote.text)}</p>`;
  }
  if (assignments.length === 0) {
    html += `<p class="empty-hint">Not assigned anywhere yet — it'll only show up here until it is.</p>`;
  } else {
    html += assignments.map((a) => `
      <div class="inline" style="margin-bottom:4px">
        <span style="flex:1">${a.entity ? esc(a.entity.name) : '(deleted entity)'}${a.checkpoint ? ` — ${esc(a.checkpoint.label)}` : (allowsNoTime ? ' — Always available' : '')}</span>
        <button class="mini-btn" title="Unassign from here" onclick="window.app.unassignLibraryModule('${a.assignmentId}')">${icon('x')}</button>
      </div>`).join('');
  }

  if (compatibleEntities.length === 0) {
    html += `<p class="hint">No compatible entities exist yet for this content type.</p>`;
  } else if (!ui.libraryAssignPickerOpen) {
    html += `<button class="icon-btn" onclick="window.app.toggleLibraryAssignPicker()">${icon('plus')} Assign to…</button>`;
  } else {
    html += renderLibraryAssignPickerHTML(module);
  }

  html += `</div>`;
  return html;
}

// The Library's assign picker: search, filter and bulk-select many
// entities at once, then assign this content to all of them in one go.
// Search matches an entity's name, its type ("npc"/"location") and its
// group path, with several terms all required — see
// Query.filterEntitiesForPicker. The search input and the filter
// controls above the list are never rebuilt on keystroke or change
// (only the list/footer below them are), so typing keeps its focus.
//
// The chosen time-scope lives in ui state rather than only in the
// <select> itself: the list below is rebuilt on every selection click,
// and a value held only in a rebuilt element would silently reset to its
// default each time.

function libraryAssignEffectiveTimeId(module, cps) {
  const allowsNoTime = module.type === 'note' || module.type === 'topic';
  const t = ui.libraryAssignTimeId || '';
  if (t && cps.some((c) => c.id === t)) return t;
  return allowsNoTime ? '' : (cps[0] ? cps[0].id : '');
}

// Everything the picker's list, counts and handlers all need to agree
// on, computed in one place: which entities are compatible with this
// content type, which of those pass the current filters, and (when
// hiding already-assigned) which are dropped because they already hold
// this content at exactly the time-scope currently chosen.
function computeLibraryAssignView(module) {
  const compatibleTypes = window.Constants.MODULE_TYPE_ENTITY_TYPES[module.type] || [];
  const compatibleEntities = Object.values(campaign.entities).filter((e) => compatibleTypes.includes(e.type));
  const cps = window.Query.sortedCheckpoints(campaign);
  const allowsNoTime = module.type === 'note' || module.type === 'topic';
  const timeId = libraryAssignEffectiveTimeId(module, cps);

  const matching = window.Query.filterEntitiesForPicker(campaign, compatibleEntities, {
    query: ui.libraryAssignSearchQuery || '',
    type: ui.libraryAssignTypeFilter || '',
    groupId: ui.libraryAssignGroupFilter || ''
  });
  const assignedHere = new Set(
    campaign.assignments.filter((a) => a.moduleId === module.id && (a.timeId || '') === timeId).map((a) => a.entityId)
  );
  const filtered = ui.libraryAssignHideAssigned ? matching.filter((e) => !assignedHere.has(e.id)) : matching;
  return { compatibleEntities, cps, allowsNoTime, timeId, filtered, hiddenAssigned: matching.length - filtered.length };
}

function renderLibraryAssignPickerHTML(module) {
  // Based on what this content type CAN be assigned to, not on what the
  // campaign happens to currently contain — a topic supports both NPCs
  // and locations regardless of whether any locations exist yet, and the
  // filter shouldn't quietly vanish just because none do right now.
  const possibleTypes = window.Constants.MODULE_TYPE_ENTITY_TYPES[module.type] || [];
  const typeLabel = (t) => (t === 'npc' ? 'NPCs' : t === 'location' ? 'Locations' : t);
  const groups = (campaign.entityGroups || [])
    .map((g) => ({ id: g.id, path: window.Query.getGroupPathName(campaign, g.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return `
    <div style="margin-top:6px">
      <input type="text" id="lib-assign-search" placeholder="Search by name, type (npc / location) or group…" value="${esc(ui.libraryAssignSearchQuery || '')}" oninput="window.app.onLibraryAssignSearchInput(this.value)">
      <div class="inline" style="flex-wrap:wrap;margin:6px 0">
        ${possibleTypes.length > 1 ? `<select onchange="window.app.setLibraryAssignTypeFilter(this.value)">
          <option value="">All types</option>
          ${possibleTypes.map((t) => `<option value="${t}" ${ui.libraryAssignTypeFilter === t ? 'selected' : ''}>${typeLabel(t)}</option>`).join('')}
        </select>` : ''}
        <select onchange="window.app.setLibraryAssignGroupFilter(this.value)">
          <option value="">All groups</option>
          <option value="__none__" ${ui.libraryAssignGroupFilter === '__none__' ? 'selected' : ''}>No group</option>
          ${groups.map((g) => `<option value="${g.id}" ${ui.libraryAssignGroupFilter === g.id ? 'selected' : ''}>${esc(g.path)}</option>`).join('')}
        </select>
        <label style="display:flex;align-items:center;gap:4px;font-size:12px">
          <input type="checkbox" ${ui.libraryAssignHideAssigned ? 'checked' : ''} onchange="window.app.setLibraryAssignHideAssigned(this.checked)">
          Hide already assigned
        </label>
      </div>
      <div id="lib-assign-picker-body">
        ${renderLibraryAssignPickerBodyHTML(module)}
      </div>
    </div>
  `;
}

function renderLibraryAssignPickerBodyHTML(module) {
  const { cps, allowsNoTime, timeId, filtered, hiddenAssigned } = computeLibraryAssignView(module);
  const selectedIds = ui.libraryAssignSelectedEntityIds.filter((id) => campaign.entities[id]);
  const selectedSet = new Set(selectedIds);
  const shownSelected = filtered.filter((e) => selectedSet.has(e.id)).length;
  const offList = selectedIds.length - shownSelected;
  const n = selectedIds.length;
  const onlyName = n === 1 ? campaign.entities[selectedIds[0]].name : '';

  const rows = filtered.length === 0
    ? `<p class="empty-hint">No matches${hiddenAssigned > 0 ? ` (${hiddenAssigned} already assigned, hidden)` : ''}.</p>`
    : filtered.map((e) => {
        const checked = selectedSet.has(e.id);
        const groupPath = e.groupId ? window.Query.getGroupPathName(campaign, e.groupId) : '';
        return `<label class="lib-assign-row${checked ? ' selected' : ''}">
          <input type="checkbox" ${checked ? 'checked' : ''} onchange="window.app.toggleLibraryAssignEntity('${e.id}')">
          <span class="lib-assign-row-name">${esc(e.name)}</span>
          <span class="lib-assign-row-meta">${e.type}${groupPath ? ` · ${esc(groupPath)}` : ''}</span>
        </label>`;
      }).join('');

  return `
    <div class="inline" style="flex-wrap:wrap;margin:4px 0">
      <button type="button" class="icon-btn" onclick="window.app.selectAllLibraryAssignShown()" ${filtered.length === 0 ? 'disabled' : ''}>Select all shown (${filtered.length})</button>
      <button type="button" class="icon-btn" onclick="window.app.clearLibraryAssignSelection()" ${n === 0 ? 'disabled' : ''}>Clear selection</button>
      <span class="hint" style="margin:0">${n} selected${offList > 0 ? ` (${offList} not in the current list)` : ''}${hiddenAssigned > 0 && filtered.length > 0 ? ` · ${hiddenAssigned} already assigned, hidden` : ''}</span>
    </div>
    <div id="lib-assign-options" class="lib-assign-list">${rows}</div>
    <div class="inline" style="flex-wrap:wrap;margin-top:6px">
      <select id="lib-assign-time" onchange="window.app.setLibraryAssignTime(this.value)">
        ${allowsNoTime ? `<option value="" ${timeId === '' ? 'selected' : ''}>${module.type === 'topic' ? 'Always available' : 'General (no specific time)'}</option>` : ''}
        ${cps.map((c) => `<option value="${c.id}" ${timeId === c.id ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}
      </select>
      <button class="icon-btn" ${n === 0 ? 'disabled' : ''} onclick="window.app.assignLibraryModule('${module.id}')">${icon('check')} Assign${n === 0 ? '' : (n === 1 ? ` to ${esc(onlyName)}` : ` to ${n} entities`)}</button>
      <button class="icon-btn" onclick="window.app.toggleLibraryAssignPicker()">Cancel</button>
    </div>
  `;
}

// Rebuilds only the list/counts/footer below the search and filter
// controls, never those controls themselves. The list's scroll position
// is carried over: without that, ticking a box halfway down a long list
// would snap it back to the top after every single click, which makes
// selecting many entities in a row miserable.
function refreshLibraryAssignPickerBody() {
  const bodyEl = document.getElementById('lib-assign-picker-body');
  if (!bodyEl) return;
  const module = campaign.contentModules.find((m) => m.id === ui.librarySelectedModuleId);
  if (!module) return;
  const oldList = document.getElementById('lib-assign-options');
  const scrollTop = oldList ? oldList.scrollTop : 0;
  bodyEl.innerHTML = renderLibraryAssignPickerBodyHTML(module);
  const newList = document.getElementById('lib-assign-options');
  if (newList) newList.scrollTop = scrollTop;
}

// --- Assign-from-library modal ------------------------------------------
//
// The counterpart to creating new content directly in an entity/content
// editor: search existing content of a matching type and assign it to
// the current entity (or location+checkpoint) instead of authoring
// something new. Opened from an "Add from library" button next to each
// of the regular "Add X" buttons. The search input gets its own
// container, never rebuilt on keystroke, same focus-preserving pattern
// as everywhere else search shows up in this app.

function renderAssignFromLibraryModal() {
  const titleEl = document.getElementById('assign-from-library-title');
  const bodyEl = document.getElementById('assign-from-library-body');
  const typeLabel = window.Constants.MODULE_TYPE_LABELS[ui.assignFromLibrary.type] || ui.assignFromLibrary.type;
  titleEl.textContent = `Add ${typeLabel.toLowerCase()} from library`;
  bodyEl.innerHTML = `
    <input type="text" id="assign-from-library-search" placeholder="Search by name or text…" oninput="window.app.onAssignFromLibrarySearchInput(this.value)">
    <div id="assign-from-library-results" style="margin-top:8px;max-height:360px;overflow-y:auto"></div>
  `;
  renderAssignFromLibraryResults();
  const searchEl = document.getElementById('assign-from-library-search');
  if (searchEl) searchEl.focus();
}

function renderAssignFromLibraryResults() {
  const resultsEl = document.getElementById('assign-from-library-results');
  if (!resultsEl || !ui.assignFromLibrary) return;
  const { type, entityId, timeId, searchQuery } = ui.assignFromLibrary;

  // Already-assigned-here modules are excluded — picking one that's
  // already on this exact entity+checkpoint would just create a second,
  // redundant assignment of the same module to the same place.
  let modules = campaign.contentModules.filter((m) => {
    if (m.type !== type) return false;
    return !campaign.assignments.some((a) => a.moduleId === m.id && a.entityId === entityId && a.timeId === (timeId || null));
  });

  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    modules = modules.filter((m) => {
      const name = (m.name || '').toLowerCase();
      const body = (m.text || m.html || '').toLowerCase();
      return name.includes(q) || body.includes(q);
    });
  }
  modules.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  if (modules.length === 0) {
    resultsEl.innerHTML = `<p class="empty-hint">${campaign.contentModules.some((m) => m.type === type) ? 'No matches.' : 'No content of this type exists yet — create it directly instead.'}</p>`;
    return;
  }

  resultsEl.innerHTML = modules.map((m) => {
    const assignments = window.Query.getModuleAssignments(campaign, m.id);
    const summary = assignments.length === 0
      ? 'Not assigned anywhere yet'
      : assignments.length === 1
        ? `Also on ${esc(assignments[0].entity ? assignments[0].entity.name : '(deleted entity)')}`
        : `Also on ${assignments.length} other places`;
    return `<div class="library-row" onclick="window.app.pickAssignFromLibraryModule('${m.id}')">
      <span class="library-row-type">${esc(window.Constants.MODULE_TYPE_LABELS[m.type] || m.type)}</span>
      <span class="library-row-name">${esc(m.name || '(untitled)')}</span>
      <span class="library-row-summary">${esc(summary)}</span>
    </div>`;
  }).join('');
}

// --- DC Check editor modal ------------------------------------------------
//
// Opened via Alt+D in any mention-field textarea (see findDCCheckTokenAtCursor/
// handleMentionKeydown), or from the Library. A brand new check starts at
// the 'setup' step (name + type only, since there's nothing to edit yet);
// picking a type and continuing actually creates the campaign.dcChecks[]
// entry and moves to 'edit', the same shape used for an existing check
// either way. Table row and condition text fields use the exact same
// mention-field treatment as a beat's own text — full formatting, mentions,
// SAY quotes, jump links, all of it, not a simplified subset.

// How the check's result is worked out for the rest of the campaign: the check has a
// dice-roll condition of its own (pick it in "Make conditional…" on any text).
// The pass/fail DC with its critical thresholds (kept together: one DC, no contradictions).
function dcPassFailHeaderHTML(check) {
  const link = window.Conditions.ensureDCLink(campaign, check);
  const st = link.settings;
  return `<div class="inline" style="flex-wrap:wrap;gap:12px">
      <label style="font-size:13px;display:flex;align-items:center;gap:6px"><b>Success at DC</b> <input type="number" value="${esc(String(st.dc))}" style="width:64px" oninput="window.app.dcPassDCInput('${check.id}',this.value)"></label>
      <details class="dcc-crit"><summary>Critical results${st.critMargin > 0 || !st.natCrit ? ' (customised)' : ''}</summary>
        <div class="inline" style="flex-wrap:wrap;gap:12px;margin-top:6px">
          <label style="font-size:12px;display:flex;align-items:center;gap:4px" title="A roll this far above (or below) the DC is critical. 0 = no margin.">Critical margin <input type="number" min="0" value="${esc(String(st.critMargin))}" style="width:56px" onchange="window.app.dcLinkSet('${check.id}','critMargin',Number(this.value))"></label>
          <label style="font-size:12px;display:flex;align-items:center;gap:4px"><input type="checkbox" ${st.natCrit ? 'checked' : ''} onchange="window.app.dcLinkSet('${check.id}','natCrit',this.checked)"> Natural 20 / 1 are critical</label>
        </div>
      </details>
    </div>`;
}

// Moves the tier rows into DC order without redrawing them (so nothing loses focus or text).
function resortDCRows(checkId) {
  const box = document.getElementById('dcc-rows');
  const check = campaign.dcChecks.find((c) => c.id === checkId);
  if (!box || !check) return;
  const active = document.activeElement;
  const order = check.table.slice().sort((a, b) => a.dc - b.dc).map((r) => r.id);
  const els = order.map((id) => box.querySelector(`[data-dcrow="${id}"]`)).filter(Boolean);
  if (els.every((el, i) => box.children[i] === el)) return;   // already in order
  els.forEach((el) => box.appendChild(el));
  if (active && box.contains(active) && document.activeElement !== active) active.focus();
}

function renderDCCheckEditorModal() {
  const state = ui.dcCheckEditor;
  const bodyEl = document.getElementById('dc-check-editor-body');
  const footerEl = document.getElementById('dc-check-editor-footer');
  const titleEl = document.getElementById('dc-check-editor-title');
  if (!state || !bodyEl || !footerEl || !titleEl) return;

  if (state.step === 'setup') {
    titleEl.textContent = (ui.dcCheckEditorStack && ui.dcCheckEditorStack.length) ? 'New DC Check (nested)' : 'New DC Check';
    bodyEl.innerHTML = `
      <div class="form-row"><label>Name (optional)</label><input type="text" id="dcc-setup-name" placeholder="e.g. Notice the ambush" value="${esc(state.setupName)}"></div>
      <div class="form-row"><label>Check type</label>
        ${searchPickHTML('dcc-setup-type', window.Constants.CHECK_TYPES.map((t) => ({ value: t.key, label: t.label })), state.setupType, 'dcSetupTypeChanged', { placeholder: 'Type to find a check, e.g. perc…' })}
      </div>
      <div class="form-row"><label>How does this check work?</label>
        <label class="dcc-choice"><input type="radio" name="dcc-setup-mode" value="scale" ${state.setupMode === 'scale' ? 'checked' : ''} onchange="window.app.dcSetupModeChanged('scale')"> <span><b>Scales with the roll</b> — the higher the roll, the more is revealed (Investigation, Perception…)</span></label>
        <label class="dcc-choice"><input type="radio" name="dcc-setup-mode" value="passfail" ${state.setupMode === 'passfail' ? 'checked' : ''} onchange="window.app.dcSetupModeChanged('passfail')"> <span><b>Pass / fail</b> — one DC, the roll succeeds or fails (a Dexterity save, forcing a door…)</span></label>
      </div>
    `;
    footerEl.innerHTML = `<button class="icon-btn" onclick="window.app.createDCCheckFromSetup()">${icon('check')} Continue</button>`;
    return;
  }

  const check = campaign.dcChecks.find((c) => c.id === state.checkId);
  if (!check) { window.app.closeDCCheckEditor(); return; }

  titleEl.textContent = (ui.dcCheckEditorStack && ui.dcCheckEditorStack.length) ? 'Edit DC Check (nested — Done returns to the outer check)' : 'Edit DC Check';
  const sortedTable = check.table.slice().sort((a, b) => a.dc - b.dc);
  const md = window.Conditions.dcCheckMode(check);
  const link = window.Conditions.ensureDCLink(campaign, check);

  let html = `
    <div class="form-row"><label>Name (optional)</label><input type="text" value="${esc(check.name)}" oninput="window.app.onDCCheckFieldInput('${check.id}','name',this.value)"></div>
    <div class="form-row"><label>Check type</label>
      ${searchPickHTML('dcc-edit-type', window.Constants.CHECK_TYPES.map((t) => ({ value: t.key, label: t.label })), check.checkType, 'dcEditTypeChanged', { placeholder: 'Type to find a check…' })}
    </div>

    <div class="section-label">How does this check work?</div>
    <div class="inline" style="flex-wrap:wrap;gap:14px">
      <label class="dcc-choice"><input type="radio" name="dcc-mode" ${md.mode === 'scale' ? 'checked' : ''} onchange="window.app.dcSetMode('${check.id}','scale')"> <span><b>Scales with the roll</b></span></label>
      <label class="dcc-choice"><input type="radio" name="dcc-mode" ${md.mode === 'passfail' ? 'checked' : ''} onchange="window.app.dcSetMode('${check.id}','passfail')"> <span><b>Pass / fail</b></span></label>
      <label style="font-size:12px;display:flex;align-items:center;gap:4px" title="Show both kinds of result for this check. They can overlap, so use it only when you really need both."><input type="checkbox" ${check.allowBoth ? 'checked' : ''} ${(check.table.length && check.conditions.length) ? 'disabled' : ''} onchange="window.app.dcSetAllowBoth('${check.id}',this.checked)"> Advanced: use both</label>
    </div>
    ${md.both && check.table.length && check.conditions.length ? '<p class="hint">This check holds both kinds of result, so both are shown. Delete the tiers or the outcomes you do not need to make it simple again.</p>' : ''}

    ${md.showScale ? `
    <div class="section-label">Results by roll — scales with the DC</div>
    <p class="hint">For checks without a clear success, like Investigation: each tier reveals more as the roll gets higher. In Play, a roll shows the tier it reaches and (unless you turn stacking off) all the lower ones too. Tiers sort themselves by DC. ${md.mode === 'scale' && !check.conditions.some((c) => c.trigger === 'success' || c.trigger === 'failure') && check.table.length ? `The check counts as a success (for conditions elsewhere) from DC ${link.settings.dc}, its lowest tier.` : ''}</p>
    <label style="font-size:12.5px;display:flex;align-items:center;gap:6px;margin:6px 0"><input type="checkbox" ${check.stackTiers !== false ? 'checked' : ''} onchange="window.app.dcSetStack('${check.id}',this.checked)"> Stack the tiers: a roll also shows every lower tier it reaches</label>
    ${sortedTable.length === 0 ? '<p class="empty-hint">No tiers yet.</p>' : ''}
    <div id="dcc-rows">
    ${sortedTable.map((row) => `
      <div class="beat-editor-row" data-dcrow="${row.id}">
        <input type="number" value="${row.dc}" style="width:64px;flex-shrink:0" title="Reached when the roll is at least this" oninput="window.app.onDCTableRowDCInput('${check.id}','${row.id}',this.value)">
        <textarea id="dcc-row-${row.id}" class="mention-field" placeholder="What the roll reveals — @ mention, &quot;&quot; dialogue, Ctrl+L link, Ctrl+B/I/E format" oninput="window.app.onDCTableRowTextInput('${check.id}','${row.id}',this.value)">${esc(row.text)}</textarea>
        <button class="mini-btn" title="Delete tier" onclick="window.app.deleteDCTableRowUI('${check.id}','${row.id}')">${icon('trash')}</button>
      </div>`).join('')}
    </div>
    <button class="icon-btn" onclick="window.app.addDCTableRowUI('${check.id}')">${icon('plus')} Add tier</button>` : ''}

    ${md.showPassFail ? `
    <div class="section-label">Pass / fail — one DC</div>
    <p class="hint">For checks with a clear success, like a Dexterity save. One DC for the whole check; add what happens on failure and success, also for repeats ("the 2nd failure…") and natural 1 / natural 20.</p>
    ${dcPassFailHeaderHTML(check)}
    ${check.conditions.length === 0 ? '<p class="empty-hint">No outcomes yet — add one below.</p>' : ''}
    ${check.conditions.map((cond) => `
      <div class="beat-editor-row">
        <div class="inline" style="flex-wrap:wrap">
          <select onchange="window.app.onDCConditionFieldInput('${check.id}','${cond.id}','trigger',this.value)">
            <option value="failure" ${cond.trigger === 'failure' ? 'selected' : ''}>When it fails</option>
            <option value="success" ${cond.trigger === 'success' ? 'selected' : ''}>When it succeeds</option>
            <option value="nat1" ${cond.trigger === 'nat1' ? 'selected' : ''}>Natural 1</option>
            <option value="nat20" ${cond.trigger === 'nat20' ? 'selected' : ''}>Natural 20</option>
          </select>
          <label style="font-size:12px;display:flex;align-items:center;gap:4px" title="1 = the first time it happens, 2 = the second time, and so on">the <input type="number" min="1" value="${cond.occurrence}" style="width:48px" oninput="window.app.onDCConditionFieldInput('${check.id}','${cond.id}','occurrence',this.value)"> time it happens</label>
          <button class="mini-btn" title="Delete outcome" onclick="window.app.deleteDCConditionUI('${check.id}','${cond.id}')">${icon('trash')}</button>
        </div>
        <textarea id="dcc-cond-${cond.id}" class="mention-field" placeholder="What happens — same full formatting support as everywhere else" oninput="window.app.onDCConditionTextInput('${check.id}','${cond.id}',this.value)">${esc(cond.text)}</textarea>
      </div>`).join('')}
    <div class="inline" style="flex-wrap:wrap">
      <button class="icon-btn" onclick="window.app.addDCConditionUI('${check.id}','failure')">${icon('plus')} On failure</button>
      <button class="icon-btn" onclick="window.app.addDCConditionUI('${check.id}','success')">${icon('plus')} On success</button>
      <button class="icon-btn" onclick="window.app.addDCConditionUI('${check.id}','nat1')">${icon('plus')} Natural 1</button>
      <button class="icon-btn" onclick="window.app.addDCConditionUI('${check.id}','nat20')">${icon('plus')} Natural 20</button>
    </div>` : ''}

    <p class="hint" style="margin-top:14px">Rolling this check also sets a condition called <b>${esc(link.name)}</b> (Critical failure · Failure · Success · Critical success). Select any text, right-click and Make conditional to show it only for some results.</p>

    ${check.rollLog.length > 0 ? `
      <div class="section-label">Roll log (${check.rollLog.length})</div>
      <p class="hint">${check.rollLog.map((r) => esc(String(r.value))).join(', ')}</p>
    ` : ''}
  `;

  bodyEl.innerHTML = html;
  wireMentionAutocomplete(bodyEl);
  wirePasteHandler(bodyEl);

  if (state.confirming === 'delete') {
    footerEl.innerHTML = `
      <span class="confirm-row">Delete this check entirely? Any [[DCCHECK]] token elsewhere that references it will show as unresolved.</span>
      <button class="mini-btn" onclick="window.app.confirmDeleteDCCheck('${check.id}')">${icon('check')}</button>
      <button class="mini-btn" onclick="window.app.cancelDCCheckEditorConfirm()">${icon('x')}</button>
    `;
  } else if (state.confirming === 'clearLog') {
    footerEl.innerHTML = `
      <span class="confirm-row">Clear the roll log? This cannot be undone.</span>
      <button class="mini-btn" onclick="window.app.confirmClearDCRollLogUI('${check.id}')">${icon('check')}</button>
      <button class="mini-btn" onclick="window.app.cancelDCCheckEditorConfirm()">${icon('x')}</button>
    `;
  } else {
    footerEl.innerHTML = `
      <button class="icon-btn" onclick="window.app.finishDCCheckEditor()">${icon('check')} Done</button>
      <button class="mini-btn txt" onclick="window.app.startDeleteDCCheck('${check.id}')">Delete this check</button>
      ${check.rollLog.length > 0 ? `<button class="mini-btn txt" onclick="window.app.startClearDCRollLogUI('${check.id}')">Clear log</button>` : ''}
    `;
  }
}

// --- DC Check Play-mode popup ---------------------------------------------
//
// Opened by clicking a DC Check button in rendered Play-mode text (see
// renderDCCheckInlineHTML in query.js, which wires the button's onclick to
// openDCCheckPlay). The Rolled input live-filters the table as you type —
// empty shows every row, a value narrows to just the tier it resolves to —
// entirely separate from logging: only Enter actually appends to the roll
// log. Table/condition text renders through the same rich() pipeline as
// every other piece of Play-mode content, not a plain-text shortcut.

function describeOrdinal(n) {
  if (n === 1) return '1st';
  if (n === 2) return '2nd';
  if (n === 3) return '3rd';
  return `${n}th`;
}

function describeDCConditionTrigger(condition) {
  if (condition.trigger === 'nat1') return 'Natural 1';
  if (condition.trigger === 'nat20') return 'Natural 20';
  const kind = condition.trigger === 'failure' ? 'fail' : 'success';
  return `${describeOrdinal(condition.occurrence)} ${kind}`;
}

function renderDCCheckPlayModal() {
  const state = ui.dcCheckPlay;
  const titleEl = document.getElementById('dc-check-play-title');
  const bodyEl = document.getElementById('dc-check-play-body');
  const footerEl = document.getElementById('dc-check-play-footer');
  if (!state || !titleEl || !bodyEl || !footerEl) return;

  const check = campaign.dcChecks.find((c) => c.id === state.checkId);
  if (!check) { window.app.closeDCCheckPlay(); return; }

  const typeInfo = window.Constants.CHECK_TYPES.find((t) => t.key === check.checkType);
  const typeLabel = typeInfo ? typeInfo.label : check.checkType;
  const displayName = (check.name && check.name.trim()) ? check.name : typeLabel;
  titleEl.textContent = `${displayName} (${typeLabel})`;

  bodyEl.innerHTML = `
    <div class="form-row">
      <label>Rolled</label>
      <input type="number" id="dc-play-rolled" placeholder="Type a value, Enter to log" value="${esc(state.rolledDraft || '')}"
        oninput="window.app.onDCPlayRolledInput(this.value)"
        onkeydown="window.app.onDCPlayRolledKeydown(event)">
    </div>
    <div id="dc-play-table"></div>
    <div id="dc-play-conditions"></div>
    <div id="dc-play-log"></div>
  `;
  renderDCCheckPlayTable();
  renderDCCheckPlayConditions();
  renderDCCheckPlayLog();

  footerEl.innerHTML = state.confirmingClearLog
    ? `<span class="confirm-row">Clear the roll log? This cannot be undone.</span>
       <button class="mini-btn" onclick="window.app.confirmClearDCRollLogPlayUI('${check.id}')">${icon('check')}</button>
       <button class="mini-btn" onclick="window.app.cancelDCPlayConfirm()">${icon('x')}</button>`
    : `<button class="mini-btn txt" onclick="window.app.startClearDCRollLogPlay('${check.id}')">Clear log</button>`;

  const input = document.getElementById('dc-play-rolled');
  if (input) input.focus();
}

// Collapsed row: label + first words. Open when the typed roll selects it, or when
// the DM clicked it to peek at the outcome before the players roll.
function dcPlayFoldHTML(key, label, text, open, hit) {
  const st = ui.dcCheckPlay;
  const isOpen = open || (st.peek && st.peek[key]);
  const preview = String(text || '').replace(/\s+/g, ' ').slice(0, 60);
  return `<div class="dc-play-fold ${isOpen ? 'open' : ''} ${hit ? 'dc-play-row-resolved' : ''}" onclick="window.app.toggleDCPlayPeek('${key}')">
      <div class="dc-play-fold-head"><span class="dc-play-row-dc">${esc(label)}</span>${isOpen ? '' : `<span class="dc-play-fold-preview">${esc(preview)}${(text || '').length > 60 ? '…' : ''}</span>`}<span class="dc-play-fold-caret">${isOpen ? '▾' : '▸'}</span></div>
      ${isOpen ? `<div class="dc-play-row-text">${rich(text || '')}</div>` : ''}
    </div>`;
}

// Rebuilt on every keystroke in the Rolled input — kept in its own
// container, separate from the input itself, so filtering never touches
// (and never steals focus from) the field being typed into.
function renderDCCheckPlayTable() {
  const state = ui.dcCheckPlay;
  const tableEl = document.getElementById('dc-play-table');
  if (!state || !tableEl) return;
  const check = campaign.dcChecks.find((c) => c.id === state.checkId);
  if (!check) return;
  if (!state.peek) state.peek = {};

  const draft = state.rolledDraft;
  const numericDraft = (draft !== '' && draft !== null && draft !== undefined) ? parseInt(draft, 10) : null;
  const hasRoll = numericDraft !== null && !Number.isNaN(numericDraft);
  const md = window.Conditions.dcCheckMode(check);
  const link = window.Conditions.ensureDCLink(campaign, check);
  let html = '';

  if (md.showScale) {
    const sortedTable = check.table.slice().sort((a, b) => a.dc - b.dc);
    const resolvedRows = hasRoll ? window.Query.resolveDCCheckTableRows(check, numericDraft) : [];
    const resolvedIds = new Set(resolvedRows.map((r) => r.id));
    html += `<div class="section-label">Results by roll</div>`;
    if (sortedTable.length === 0) html += `<p class="empty-hint">No tiers defined for this check.</p>`;
    else {
      html += sortedTable.map((row) => {
        const hit = resolvedIds.has(row.id);
        return dcPlayFoldHTML('t' + row.id, `DC ${row.dc}`, row.text, hit, hit);
      }).join('');
      if (hasRoll && resolvedRows.length === 0) html += `<p class="empty-hint">Rolled ${esc(String(numericDraft))} doesn't reach the lowest DC (${sortedTable[0].dc}).</p>`;
    }
  }

  if (md.showPassFail) {
    // Which outcome(s) the typed roll would trigger (before it is logged).
    const hitIds = new Set();
    if (hasRoll) {
      const prior = (t) => check.rollLog.filter((r) => {
        const v = r.value;
        if (t === 'nat1') return v === 1;
        if (t === 'nat20') return v === 20;
        return t === 'success' ? v >= link.settings.dc : v < link.settings.dc;
      }).length;
      const triggers = [numericDraft >= link.settings.dc ? 'success' : 'failure'];
      if (numericDraft === 1) triggers.push('nat1');
      if (numericDraft === 20) triggers.push('nat20');
      triggers.forEach((t) => {
        const n = prior(t) + 1;
        const cands = check.conditions.filter((c) => c.trigger === t && c.occurrence <= n);
        if (!cands.length) return;
        const top = Math.max(...cands.map((c) => c.occurrence));
        cands.filter((c) => c.occurrence === top).forEach((c) => hitIds.add(c.id));
      });
    }
    html += `<div class="section-label">Pass / fail — DC ${esc(String(link.settings.dc))}</div>`;
    if (check.conditions.length === 0) html += `<p class="empty-hint">No outcomes defined for this check.</p>`;
    else html += check.conditions.map((c) => dcPlayFoldHTML('c' + c.id, describeDCConditionTrigger(c), c.text, hitIds.has(c.id), hitIds.has(c.id))).join('');
  }
  tableEl.innerHTML = html;
}

// Shows the concise "current applicable state" per independent trigger
// group (see currentDCCheckConditionOutcomes in query.js) — the most
// escalated reached outcome per group. Rebuilt whenever the roll log changes.
function renderDCCheckPlayConditions() {
  const state = ui.dcCheckPlay;
  const el = document.getElementById('dc-play-conditions');
  if (!state || !el) return;
  const check = campaign.dcChecks.find((c) => c.id === state.checkId);
  if (!check || check.conditions.length === 0) { el.innerHTML = ''; return; }

  const current = window.Query.currentDCCheckConditionOutcomes(check);
  let html = `<div class="section-label">Triggered so far</div>`;
  html += current.length === 0
    ? `<p class="empty-hint">None triggered yet.</p>`
    : current.map((o) => `
      <div class="dc-play-row">
        <span class="dc-play-row-dc">${esc(describeDCConditionTrigger(o.condition))}</span>
        <span class="dc-play-row-text">${rich(o.condition.text)}</span>
      </div>`).join('');
  el.innerHTML = html;
}

function renderDCCheckPlayLog() {
  const state = ui.dcCheckPlay;
  const el = document.getElementById('dc-play-log');
  if (!state || !el) return;
  const check = campaign.dcChecks.find((c) => c.id === state.checkId);
  if (!check) return;

  let html = `<div class="section-label">Roll log</div>`;
  if (check.rollLog.length === 0) {
    html += `<p class="empty-hint">Nothing logged yet.</p>`;
  } else {
    const newestFirst = check.rollLog.slice().reverse();
    html += `<p class="dc-play-log-list">${newestFirst.map((r) => esc(String(r.value))).join(', ')}</p>`;
  }
  el.innerHTML = html;
}

// --- Notion paste-and-detect -----------------------------------------------
// Converts pasted rich text (from Notion or anywhere else that puts real
// HTML on the clipboard) into the app's lightweight markdown-ish format —
// **bold**, _italic_, plain "quotes" — which query.js's renderMentions
// already knows how to render as real formatting. Block-level <blockquote>
// elements are pulled out separately as scene-line candidates rather than
// inlined, since a blockquote in Notion is normally a deliberate quote or
// line of dialogue, not just quoted material inside a sentence.
//
// Built against general knowledge of how Notion (and browsers generally)
// structure copied HTML, not against a live test of Notion's clipboard —
// I don't have a way to actually copy from Notion in this environment. If
// real pasted content doesn't parse the way you'd expect, that's the most
// likely place something needs adjusting.
function htmlToLightMarkdown(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'li', 'ul', 'ol', 'div', 'section', 'article', 'tr', 'table']);

  // Bold/italic via semantic tags (<strong>/<b>, <em>/<i>) OR inline style
  // attributes (font-weight/font-style) — a lot of real-world clipboard
  // HTML (Google Docs, Word, various web editors, possibly this very chat
  // interface) styles text with spans rather than semantic tags, and
  // missing that was why formatting wasn't coming through.
  function styledWrap(el, inner) {
    const style = (el.getAttribute && el.getAttribute('style')) || '';
    return window.Query.wrapPastedInline(el.tagName, style, inner);
  }

  // Renders a node's content as one continuous run of inline text —
  // recurses through inline wrappers (span, a, font, strong, em, etc.)
  // WITHOUT ever starting a new paragraph, since those are inline by
  // definition. Only <br> inserts a line break here.
  function inlineText(node) {
    let out = '';
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') { out += '\n'; return; }
        out += styledWrap(child, inlineText(child));
      }
    });
    return out;
  }

  const paragraphs = [];
  let buffer = '';

  function flush() {
    const t = buffer.trim();
    if (t) paragraphs.push(t);
    buffer = '';
  }

  // Walks top-down, only breaking into a new paragraph at genuine block
  // boundaries (p, div, li, headings, blockquote). Everything else —
  // spans, links, bare formatting tags sitting at the top level — gets
  // accumulated into the current running paragraph instead of each
  // becoming its own line. This is the fix for the "newline after every
  // word" bug: sibling inline elements (e.g. one <span> per differently
  // -styled word) were previously each treated as a separate block.
  function walk(nodes) {
    nodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        buffer += node.textContent;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName.toLowerCase();

      if (tag === 'br') { buffer += '\n'; return; }

      if (tag === 'blockquote') {
        flush();
        const t = inlineText(node).trim();
        // Stays right here, in the same text field it was pasted into —
        // wrapped in plain quote marks so renderMentions' existing inline
        // -quote styling picks it up. Not extracted into a structured
        // Scene: that used to happen here, but moving a Notion quote out
        // of the paragraph it was part of wasn't the intent — someone
        // pasting a quote mid-description wants it to *stay* mid
        // -description. A specific speaker can still be assigned to it
        // afterward by wrapping it with the "" shortcut.
        if (t) paragraphs.push(`"${t}"`);
        return;
      }
      if (tag === 'ul' || tag === 'ol') {
        flush();
        Array.from(node.children).forEach((li) => {
          const t = inlineText(li).trim();
          if (t) paragraphs.push(`- ${t}`);
        });
        return;
      }
      if (BLOCK_TAGS.has(tag)) {
        flush();
        const hasBlockChildren = Array.from(node.children).some((c) => BLOCK_TAGS.has(c.tagName.toLowerCase()));
        if (hasBlockChildren) {
          walk(Array.from(node.childNodes));
          flush();
        } else {
          const t = inlineText(node).trim();
          if (t) paragraphs.push(t);
        }
        return;
      }

      // Inline-level element sitting at this position — part of the
      // current running paragraph, not a paragraph of its own.
      buffer += styledWrap(node, inlineText(node));
    });
  }

  walk(Array.from(doc.body.childNodes));
  flush();

  return { text: paragraphs.join('\n\n') };
}

function handlePaste(event) {
  const html = event.clipboardData && event.clipboardData.getData('text/html');
  if (!html || !html.trim()) return; // no rich content on the clipboard — let the default plain-text paste happen

  event.preventDefault();
  const { text: rawText } = htmlToLightMarkdown(html);
  const ta = event.target;

  const tagged = window.Query.autoTagEntityNames(rawText, campaign);

  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.value = ta.value.slice(0, start) + tagged.text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + tagged.text.length;
  ta.dispatchEvent(new Event('input', { bubbles: true })); // triggers the field's own save handler — persists exactly like normal typing, nothing extra needed here

  // Only the arrival/description field ever shows the "tagged" review
  // banner, and only once there's actually something to show. Updating
  // just that one banner element — never the textarea itself — is what
  // keeps focus, cursor position, and the field's own expanded-while-
  // focused height untouched by a paste. A full refresh() used to run
  // unconditionally here, rebuilding the whole editor (including this
  // very textarea) from scratch on every paste — which is exactly what
  // was throwing focus and collapsing the field back to its unfocused
  // size right after pasting into it.
  if (tagged.taggedIds.length > 0 && ta.dataset.pasteContext === 'arrival') {
    ui.pasteReview = { taggedIds: [...new Set(tagged.taggedIds)] };
    const bannerEl = document.getElementById('paste-review-banner');
    if (bannerEl) bannerEl.innerHTML = renderPasteReviewBanner();
  }
}

function wirePasteHandler(scopeEl) {
  scopeEl.querySelectorAll('.mention-field').forEach((ta) => {
    ta.addEventListener('paste', handlePaste);
  });
}

function renderPasteReviewBanner() {
  const r = ui.pasteReview;
  if (!r) return '';
  const names = r.taggedIds.map((id) => campaign.entities[id]).filter(Boolean).map((e) => e.name);
  if (names.length === 0) return '';
  return `<div class="badge-muted" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;width:100%;box-sizing:border-box">
    <span>Tagged: ${esc(names.join(', '))}.</span>
    <span style="display:flex;gap:6px;flex-shrink:0">
      <button class="icon-btn" onclick="window.app.markPastedEntitiesPresent()">${icon('check')} Mark present here</button>
      <button class="mini-btn" onclick="window.app.dismissPasteReview()">${icon('x')}</button>
    </span>
  </div>`;
}

// --- Notion import modal -----------------------------------------------
//
// Two steps: paste text + pick a checkpoint, then review the proposed
// plan (see src/notionImport.js for the actual parsing/classification/
// merge-planning/commit logic — this is purely the DOM wiring on top of
// it). The plan tree is rendered generically: a location, an NPC, and a
// topic all share the same {name, status, key, proposedText,
// existingText} shape from buildPlanItem, so one recursive renderer
// handles every level; a group header is the one exception, since it
// carries no plan/status of its own (see classifyImportTree).

function summarizeNotionImportPlan(plan) {
  const counts = { new: 0, unchanged: 0, conflict: 0 };
  window.NotionImport.listPlanItems(plan).forEach((item) => {
    counts[item.status] = (counts[item.status] || 0) + 1;
  });
  return counts;
}

function renderNotionImportConflictHTML(item, state) {
  const edit = state.edits.get(item.key);
  const finalValue = (edit && edit.text != null) ? edit.text : item.existingText;
  const rows = item.kind === 'inventory' ? 8 : 4;
  return `
    <div class="notion-import-conflict">
      <div class="notion-import-conflict-col">
        <div class="section-label">In Notion</div>
        <div class="notion-import-conflict-text">${esc(item.proposedText)}</div>
      </div>
      <div class="notion-import-conflict-col">
        <div class="section-label">Already in campaign</div>
        <div class="notion-import-conflict-text">${esc(item.existingText)}</div>
      </div>
    </div>
    <div class="form-row">
      <label>Final text to save — starts as what's already there; edit in whatever you want to bring over from Notion</label>
      <textarea rows="${rows}"${item.kind === 'inventory' ? ' wrap="off" style="font-family:monospace;font-size:12px"' : ''} onchange="window.app.editNotionImportField('${item.key}','text',this.value)">${esc(finalValue)}</textarea>
    </div>
  `;
}

// A checkbox unchecked by default only for 'unchanged' items (nothing to
// do, so it's disabled entirely) — 'new' and 'conflict' both default to
// included, since excluding is the exception the person opts into, not
// the default they'd have to opt out of for every single row.
function renderNotionImportRow(item, depth, state) {
  const indent = depth * 18;
  if (item.kind === 'groupHeader') {
    let html = `<div class="notion-import-row notion-import-group" style="margin-left:${indent}px">
      ${icon('user')} ${esc(item.name)} <span class="hint" style="margin:0">(group — organizational only, not imported itself)</span>
    </div>`;
    item.npcs.forEach((n) => { html += renderNotionImportRow(n, depth + 1, state); });
    return html;
  }

  const excluded = state.excluded.has(item.key);
  const disabled = item.status === 'unchanged';
  const nameEdit = state.edits.get(item.key);
  const nameValue = (nameEdit && nameEdit.name != null) ? nameEdit.name : item.name;
  const statusLabel = { new: 'New', unchanged: 'Up to date', conflict: 'Differs' }[item.status];

  let html = `<div class="notion-import-row" style="margin-left:${indent}px">
    <input type="checkbox" ${excluded ? '' : 'checked'} ${disabled ? 'disabled' : ''} onchange="window.app.toggleNotionImportExclude('${item.key}')">
    <span class="badge-status ${item.status}">${statusLabel}</span>
    <input type="text" class="notion-import-name" value="${esc(nameValue)}" ${disabled ? 'disabled' : ''} onchange="window.app.editNotionImportField('${item.key}','name',this.value)">
  </div>`;

  if (item.status === 'conflict') {
    const expanded = state.expandedConflicts.has(item.key);
    html += `<div style="margin-left:${indent + 18}px">
      <button class="mini-btn" onclick="window.app.toggleNotionImportConflictExpand('${item.key}')">${expanded ? 'Hide' : 'Review'} conflict</button>
      ${expanded ? renderNotionImportConflictHTML(item, state) : ''}
    </div>`;
  } else if (item.status === 'new' && item.proposedText) {
    const textEdit = state.edits.get(item.key);
    const textValue = (textEdit && textEdit.text != null) ? textEdit.text : item.proposedText;
    const rows = item.kind === 'inventory' ? 8 : 3;
    html += `<div style="margin-left:${indent + 18}px">
      <textarea rows="${rows}"${item.kind === 'inventory' ? ' wrap="off" style="font-family:monospace;font-size:12px"' : ''} onchange="window.app.editNotionImportField('${item.key}','text',this.value)">${esc(textValue)}</textarea>
    </div>`;
  }

  if (item.inventory) {
    html += renderNotionImportRow(item.inventory, depth + 1, state);
  }
  if (item.topics) {
    item.topics.forEach((t) => { html += renderNotionImportRow(t, depth + 1, state); });
  }
  return html;
}

function renderNotionImportModal() {
  const state = ui.notionImport;
  const bodyEl = document.getElementById('notion-import-body');
  const footerEl = document.getElementById('notion-import-footer');
  if (!state || !bodyEl || !footerEl) return;

  if (state.step === 'paste') {
    const checkpoints = window.Query.sortedCheckpoints(campaign);
    bodyEl.innerHTML = `
      <div class="form-row">
        <label>Paste the outline for ONE location below — everything nested under its first bullet (an "NPC" section, dialogue topics, DC Checks in the agreed Win/Fail or DC-table format).</label>
        <textarea id="notion-import-paste" rows="16" placeholder="Paste from Notion here…"></textarea>
      </div>
      <div class="form-row">
        <label>Apply the location's description at:</label>
        <select id="notion-import-checkpoint">
          ${checkpoints.map((cp) => `<option value="${cp.id}">${esc(cp.label)}</option>`).join('')}
        </select>
      </div>
    `;
    footerEl.innerHTML = `<button class="icon-btn" onclick="window.app.parseNotionImportPreview()">${icon('check')} Parse &amp; preview</button>`;
    return;
  }

  const { plan } = state;
  const counts = summarizeNotionImportPlan(plan);
  let html = `<div class="notion-import-summary">
    <span>${counts.new} new</span>
    <span>${counts.unchanged} already up to date</span>
    ${counts.conflict > 0 ? `<span style="color:#f5b642">${counts.conflict} to review</span>` : ''}
  </div>`;
  if (plan.extraTopLevelNodes.length > 0) {
    html += `<div class="badge-muted" style="display:block">${plan.extraTopLevelNodes.length} item(s) after the location (${esc(plan.extraTopLevelNodes.map((n) => n.text).join(', '))}) were not imported — only the first top-level item in the paste is treated as the location.</div>`;
  }
  html += renderNotionImportRow(plan.location, 0, state);
  plan.npcs.forEach((n) => { html += renderNotionImportRow(n, 0, state); });

  bodyEl.innerHTML = html;
  footerEl.innerHTML = `
    <button class="icon-btn" onclick="window.app.commitNotionImportUI()">${icon('check')} Import</button>
    <button class="mini-btn txt" onclick="window.app.backToNotionImportPaste()">Back</button>
  `;
}

// --- @ mention autocomplete ------------------------------------------------
// Wired onto any textarea with class="mention-field" after each render that
// creates one. Detects an active "@query" run ending at the cursor, shows a
// --- @ mention autocomplete / "" inline dialogue ---------------------------
// Wired onto any textarea with class="mention-field" after each render that
// creates one.
//
// Two triggers share the same popup and keyboard navigation, distinguished
// by mentionState.mode:
//   '@' typed  -> mode 'insert': picks an entity, inserts a [[id]] mention.
//   "" typed   -> mode 'say': picks an NPC, opens a [[SAY:id]] span right
//     there in the text. Enter closes the span with [[/SAY]] and continues
//     normally on a new line — inline dialogue *within* an otherwise
//     ordinary field, distinct from a structured Scene.

let openSaySpans = {}; // textarea id -> true while a [[SAY:..]] is open and unclosed

function wireMentionAutocomplete(scopeEl) {
  const fields = scopeEl.querySelectorAll('.mention-field');
  fields.forEach((ta) => {
    ta.addEventListener('input', () => handleMentionInput(ta));
    ta.addEventListener('keydown', (e) => handleMentionKeydown(e, ta));
    ta.addEventListener('blur', () => {
      setTimeout(closeMentionSuggest, 150);
      if (openSaySpans[ta.id]) {
        // Safety net if they click away mid-dialogue without pressing
        // Enter — better an oddly-placed closing tag than a permanently
        // broken, unclosed span.
        ta.value += '[[/SAY]]';
        delete openSaySpans[ta.id];
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
  });
}

// Gathers everything Ctrl+L can link to: the current arrival's own
// sections, the location entity's own topics, and the topics of every
// NPC currently marked present here. Scoped to Content tab's current
// location+time — there's no equivalent "current location" concept
// anywhere else in Create mode, so Ctrl+L is a no-op outside it.
// Scans raw text for [[DCCHECK:id]] tokens and returns the one the
// cursor is inside (or immediately touching either edge of), or null.
// Cheap enough to run on every Alt+D press given the field sizes this
// app deals with — no need to cache or index this.
function findDCCheckTokenAtCursor(text, cursorPos) {
  const regex = /\[\[DCCHECK:([a-zA-Z0-9_]+)\]\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (cursorPos >= start && cursorPos <= end) return { id: match[1], start, end };
  }
  return null;
}

// Every beat, topic, scene, and description anywhere in the campaign is
// a valid jump target, not just the ones on whatever location/entity is
// currently being edited — linking from Location A's description to a
// specific piece of content on Location B (or any NPC) is exactly the
// point of this. sourceLabel carries the item's own entity + checkpoint
// context so two similarly-named things on different locations/times
// stay distinguishable in the list.
function gatherJumpLinkItems() {
  const items = [];
  const typeLabels = { beat: 'Section', topic: 'Topic', scene: 'Scene', description: 'Description' };

  (campaign.contentModules || []).forEach((module) => {
    if (!['beat', 'topic', 'scene', 'description'].includes(module.type)) return;
    window.Query.getModuleAssignments(campaign, module.id).forEach((a) => {
      if (!a.entity) return; // dangling assignment to a deleted entity -- skip
      const milestonePart = a.checkpoint ? ` - ${a.checkpoint.label}` : '';
      // Explicitly names the content type ("Section", "Description", ...)
      // rather than relying on the icon alone -- with several pieces of
      // content on the same entity at the same checkpoint (a location's
      // description and one of its sections, say), the icon distinguishes
      // them visually but doesn't say so in words, and the primary label
      // (the content's own name/preview) can get visually truncated
      // before it's enough to tell them apart on its own.
      const sourceLabel = `${a.entity.name} - ${typeLabels[module.type]}${milestonePart}`;
      let label;
      if (module.type === 'description') {
        // Descriptions are rarely named (that field is manager-only and
        // usually left blank) -- fall back to a short text preview so
        // there's still something recognizable to pick from.
        label = (module.name && module.name.trim())
          ? module.name
          : (window.Query.truncatePreservingMarkers(module.html || '', 40) || 'Description');
      } else {
        label = (module.name && module.name.trim()) || `(untitled ${module.type})`;
      }
      items.push({ id: module.id, kind: module.type, label, sourceLabel });
    });
  });

  // Every NPC and location, as a direct link — not just the ones present
  // here. Picking one of these opens a second step to optionally anchor
  // the link to a specific milestone; sections/topics/scenes/descriptions
  // skip that, since they already carry their own time context.
  Object.values(campaign.entities).forEach((e) => {
    if (e.type === 'npc') {
      items.push({ id: e.id, kind: 'npc', label: e.name, sourceLabel: 'NPC' });
    } else if (e.type === 'location') {
      items.push({ id: e.id, kind: 'location', label: e.name, sourceLabel: 'Location' });
    }
  });

  // Sorted by source (so everything from the same entity/checkpoint
  // groups together) then by the item's own label — predictable and
  // alphabetically browsable, rather than the accidental order content
  // happened to be created in (which, for a campaign with more entries
  // than the suggestion list shows at once, could otherwise bury an
  // item where it's never actually seen without already knowing to
  // search for it by name).
  items.sort((a, b) => (a.sourceLabel || '').localeCompare(b.sourceLabel || '') || a.label.localeCompare(b.label));

  return items;
}

function handleMentionInput(ta) {
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);

  // A jump-link picker opened via Ctrl+L keeps live-filtering as more
  // characters are typed, same idea as @ and "" but without a trigger
  // character to search after — the search starts from wherever the
  // cursor was when Ctrl+L was pressed (or, in jump-time, from wherever
  // step 2 started once an NPC/location was picked in step 1).
  if (mentionState.active && (mentionState.mode === 'jump' || mentionState.mode === 'jump-time') && mentionState.textareaEl === ta) {
    const typed = before.slice(mentionState.atIndex);
    if (/[\s\n]/.test(typed)) {
      closeMentionSuggest();
    } else {
      mentionState.query = typed;
      renderMentionSuggest(ta);
    }
    return;
  }

  const sayIdx = before.lastIndexOf('""');
  if (sayIdx !== -1) {
    const between = before.slice(sayIdx + 2);
    if (!/[\s\n]/.test(between)) {
      mentionState = { active: true, mode: 'say', textareaId: ta.id, textareaEl: ta, atIndex: sayIdx, query: between, items: [], highlighted: 0 };
      renderMentionSuggest(ta);
      return;
    }
  }

  const atIdx = before.lastIndexOf('@');
  if (atIdx !== -1) {
    const between = before.slice(atIdx + 1);
    if (!/[\s\n]/.test(between)) {
      mentionState = { active: true, mode: 'insert', textareaId: ta.id, textareaEl: ta, atIndex: atIdx, query: between, items: [], highlighted: 0 };
      renderMentionSuggest(ta);
      return;
    }
  }

  closeMentionSuggest();
}

function renderMentionSuggest(ta) {
  let matches;
  if (mentionState.mode === 'jump' || mentionState.mode === 'jump-time') {
    const q = (mentionState.query || '').toLowerCase();
    // Jump mode can have far more candidates now that every beat/topic/
    // scene/description in the whole campaign is included, not just
    // entities — capped higher than the other modes, but the box already
    // scrolls (see .mention-suggest's max-height), so a generous cap here
    // just means "reachable by scrolling" rather than "invisible unless
    // you already know to search for it by name".
    matches = mentionState.allItems.filter((it) => it.label.toLowerCase().includes(q) || (it.sourceLabel || '').toLowerCase().includes(q)).slice(0, 50);
  } else {
    const q = mentionState.query.toLowerCase();
    let pool = Object.values(campaign.entities);
    pool = pool.filter((e) => e.type !== 'quest');
    if (mentionState.mode === 'say') pool = pool.filter((e) => e.type === 'npc');
    matches = pool.filter((e) => e.name.toLowerCase().includes(q)).slice(0, 6);
  }
  mentionState.items = matches;

  let box = document.getElementById('mention-suggest-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'mention-suggest-box';
    box.className = 'mention-suggest';
    document.body.appendChild(box);
  }
  if (matches.length === 0) { box.style.display = 'none'; return; }

  const rect = ta.getBoundingClientRect();
  const isJumpMode = mentionState.mode === 'jump' || mentionState.mode === 'jump-time';
  // Jump-mode entries carry a full "Entity - Content type - Milestone"
  // label alongside the content's own name/preview — both need real
  // room, unlike the plain entity names @ mention/"" dialogue show.
  const maxWidth = isJumpMode ? 460 : 280;
  const width = Math.min(Math.max(rect.width, 180), maxWidth);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 12));
  box.style.left = `${left}px`;
  box.style.top = `${rect.bottom + 4}px`;
  box.style.width = `${width}px`;
  box.style.display = 'block';

  if (mentionState.mode === 'jump' || mentionState.mode === 'jump-time') {
    const iconForKind = (kind) => {
      if (kind === 'beat' || kind === 'scene') return 'bookmark';
      if (kind === 'description') return 'edit';
      if (kind === 'location') return 'mapPin';
      if (kind === 'time') return 'clock';
      return 'user'; // topic or npc
    };
    box.innerHTML = matches.map((it, i) => `<div class="mention-suggest-item ${i === mentionState.highlighted ? 'hl' : ''}" onmousedown="event.preventDefault();window.app.pickMention(${i})">
      ${icon(iconForKind(it.kind))}
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(it.label)}</span>
      ${it.sourceLabel ? `<span style="color:var(--text-muted);font-size:10px;flex-shrink:0">${esc(it.sourceLabel)}</span>` : ''}
    </div>`).join('');
    return;
  }

  box.innerHTML = matches.map((e, i) => {
    const c = colorFor(e.color);
    return `<div class="mention-suggest-item ${i === mentionState.highlighted ? 'hl' : ''}" onmousedown="event.preventDefault();window.app.pickMention(${i})">
      <span style="display:inline-flex;width:16px;height:16px;border-radius:50%;background:${c.bg};color:${c.fg};align-items:center;justify-content:center;flex-shrink:0">${icon(e.icon)}</span>
      ${esc(e.name)}
    </div>`;
  }).join('');
}

function closeMentionSuggest() {
  mentionState.active = false;
  const box = document.getElementById('mention-suggest-box');
  if (box) box.style.display = 'none';
}

// Wraps the current selection in a marker pair (used for bold, italic,
// and DM comment alike) — or, with nothing selected, inserts an empty
// pair with the cursor placed right in the middle, ready to type.
function wrapSelectionWithMarker(ta, delimiter) {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const value = ta.value;
  if (start === end) {
    ta.value = value.slice(0, start) + delimiter + delimiter + value.slice(end);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = start + delimiter.length;
  } else {
    const wrapped = `${delimiter}${value.slice(start, end)}${delimiter}`;
    ta.value = value.slice(0, start) + wrapped + value.slice(end);
    ta.focus();
    ta.selectionStart = start;
    ta.selectionEnd = start + wrapped.length;
  }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// The things the shortcuts (and the right-click menu) do, as plain functions.
function startJumpLink(ta) {
  const items = gatherJumpLinkItems();
  if (items.length === 0) { closeMentionSuggest(); window.Health.notice('Nothing to link to yet — create a section, topic, scene or description first.'); return; }
  mentionState = { active: true, mode: 'jump', textareaId: ta.id, textareaEl: ta, atIndex: ta.selectionStart, query: '', items: [], allItems: items, highlighted: 0 };
  renderMentionSuggest(ta);
}

// Alt+D: edit the DC check the cursor is in, otherwise create one and drop its token here.
function startDCCheck(ta) {
  const existing = findDCCheckTokenAtCursor(ta.value, ta.selectionStart);
  if (existing) {
    window.app.openDCCheckEditor({ checkId: existing.id });
    return;
  }
  const insertStart = ta.selectionStart;
  const insertEnd = ta.selectionEnd;
  window.app.openDCCheckEditor({
    checkId: null,
    onInsert: (checkId) => {
      const token = `[[DCCHECK:${checkId}]]`;
      const value = ta.value;
      ta.value = value.slice(0, insertStart) + token + value.slice(insertEnd);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = insertStart + token.length;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

// Types a trigger (@ or "") at the cursor, exactly as if it had been typed, so the
// normal search popup opens.
function typeTrigger(ta, text) {
  ta.focus();
  const a = ta.selectionStart, b = ta.selectionEnd;
  ta.value = ta.value.slice(0, a) + text + ta.value.slice(b);
  ta.selectionStart = ta.selectionEnd = a + text.length;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// Bulleted list: puts "- " in front of every line the selection touches, or takes
// them off again when every one of those lines already has it.
function toggleBulletLines(ta) {
  const v = ta.value;
  const a = ta.selectionStart, b = ta.selectionEnd;
  const from = v.lastIndexOf('\n', a - 1) + 1;
  let to = v.indexOf('\n', b);
  if (to === -1) to = v.length;
  const lines = v.slice(from, to).split('\n');
  const allBullets = lines.every((l) => /^\t*- /.test(l));
  const out = lines.map((l) => (allBullets ? l.replace(/^(\t*)- /, '$1') : (/^\t*- /.test(l) ? l : '- ' + l))).join('\n');
  ta.focus();
  ta.value = v.slice(0, from) + out + v.slice(to);
  ta.selectionStart = from;
  ta.selectionEnd = from + out.length;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function handleMentionKeydown(e, ta) {
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    wrapSelectionWithMarker(ta, '**');
    return;
  }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'i') {
    e.preventDefault();
    wrapSelectionWithMarker(ta, '_');
    return;
  }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'e') {
    e.preventDefault();
    wrapSelectionWithMarker(ta, '^^');
    return;
  }

  if (e.ctrlKey && e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    wrapSelectionWithMarker(ta, '~~');
    return;
  }

  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    startJumpLink(ta);
    return;
  }

  // Alt+S: insert a Director-tool scene/layout button. Uses the same
  // shared picker modal as the location entity field (a 3-step cascade
  // doesn't fit the inline mentionState popup @/""/Ctrl+L use, which is
  // built for a single flat filterable list, not sequential steps) —
  // reusing it here rather than building a second, parallel picker.
  // Deliberately Alt, not Shift — Shift+S is how a capital "S" gets
  // typed, so that combination would've hijacked every one typed in any
  // text field, not just the intended shortcut trigger.
  if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 's') {
    e.preventDefault();
    insertDirectorButton(ta, 'choose');
    return;
  }

  // Alt+D: insert (or edit) a DC Check. If the cursor is already inside
  // an existing [[DCCHECK:id]] token, opens that check's own editor
  // directly rather than starting a new one — the "easy way to edit
  // from direct text" a raw textarea can support, since the token text
  // itself can't be a clickable element the way a rendered button can.
  // Otherwise opens the create flow; the token gets inserted into this
  // exact textarea only once that flow actually finishes (the onInsert
  // callback below), never before — closing the editor without
  // finishing leaves the field untouched.
  if (e.altKey && !e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    startDCCheck(ta);
    return;
  }

  // The autocomplete popup (either mode) takes priority when open — Enter
  // selects the highlighted item regardless of shift state.
  if (mentionState.active && mentionState.items.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      mentionState.highlighted = (mentionState.highlighted + 1) % mentionState.items.length;
      renderMentionSuggest(ta);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      mentionState.highlighted = (mentionState.highlighted - 1 + mentionState.items.length) % mentionState.items.length;
      renderMentionSuggest(ta);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      window.app.pickMention(mentionState.highlighted);
    } else if (e.key === 'Escape') {
      closeMentionSuggest();
    }
    return;
  }

  // Tab/Shift+Tab: adjust the current line's indent level if it's a
  // bullet line ("- ..." with zero or more leading tabs), matching what
  // the renderer looks for when turning it into a nested list on
  // display. Not a bullet line — just insert a literal tab character,
  // the standard text-editor fallback, rather than tabbing out of the
  // field (which is rarely what's wanted mid-edit in a multi-line field).
  // Scoped to the current line only — selecting several lines and
  // indenting them all at once isn't supported.
  if (e.key === 'Tab') {
    e.preventDefault();
    const value = ta.value;
    const pos = ta.selectionStart;
    const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
    let lineEnd = value.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = value.length;
    const currentLine = value.slice(lineStart, lineEnd);
    const bulletMatch = currentLine.match(/^(\t*)- (.*)$/);

    if (bulletMatch) {
      if (e.shiftKey) {
        if (bulletMatch[1].length > 0) {
          ta.value = value.slice(0, lineStart) + currentLine.slice(1) + value.slice(lineEnd);
          ta.selectionStart = ta.selectionEnd = Math.max(lineStart, pos - 1);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } else {
        ta.value = value.slice(0, lineStart) + '\t' + currentLine + value.slice(lineEnd);
        ta.selectionStart = ta.selectionEnd = pos + 1;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else if (!e.shiftKey) {
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      ta.value = value.slice(0, start) + '\t' + value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + 1;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
  }

  if (e.key !== 'Enter') return;

  const pos = ta.selectionStart;

  if (openSaySpans[ta.id]) {
    if (e.shiftKey) {
      // Soft break within the open dialogue span — the line continues,
      // still the same speaker, still the same [[SAY]] span.
      e.preventDefault();
      ta.value = ta.value.slice(0, pos) + '\n' + ta.value.slice(pos);
      ta.selectionStart = ta.selectionEnd = pos + 1;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // Plain Enter ends the dialogue.
      e.preventDefault();
      const closeTag = '[[/SAY]]';
      ta.value = ta.value.slice(0, pos) + closeTag + '\n\n' + ta.value.slice(pos);
      ta.selectionStart = ta.selectionEnd = pos + closeTag.length + 2;
      delete openSaySpans[ta.id];
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
  }

  // Auto-continue a bullet list on Enter. Checks the *whole* current
  // line, not just the part before the cursor, so pressing Enter in the
  // middle of a bullet's text correctly splits it into two items rather
  // than only working at the end of the line.
  {
    const beforeCursor = ta.value.slice(0, pos);
    const afterCursor = ta.value.slice(pos);
    const lineStart = beforeCursor.lastIndexOf('\n') + 1;
    const nlAfter = afterCursor.indexOf('\n');
    const lineEnd = nlAfter === -1 ? ta.value.length : pos + nlAfter;
    const fullLine = ta.value.slice(lineStart, lineEnd);
    const bulletMatch = fullLine.match(/^(\t*)- (.*)$/);

    if (bulletMatch) {
      e.preventDefault();
      const indent = bulletMatch[1];
      const isEmpty = bulletMatch[2].trim() === '';

      if (!e.shiftKey && isEmpty) {
        // An empty bullet — exit the list instead of continuing it
        // forever, the same "empty item ends the list" convention most
        // list editors use. Clears the whole line, indent included.
        ta.value = ta.value.slice(0, lineStart) + ta.value.slice(lineEnd);
        ta.selectionStart = ta.selectionEnd = lineStart;
      } else if (e.shiftKey) {
        // Soft break within the same bullet item — same indent as the
        // bullet itself, so the continuation lines up visually with its
        // text while editing, but no "- " marker (that would start a
        // new item instead of continuing this one).
        const insertion = `\n${indent}`;
        ta.value = beforeCursor + insertion + afterCursor;
        ta.selectionStart = ta.selectionEnd = pos + insertion.length;
      } else {
        // Fresh bullet at the same indent level as the one being
        // continued.
        const insertion = `\n${indent}- `;
        ta.value = beforeCursor + insertion + afterCursor;
        ta.selectionStart = ta.selectionEnd = pos + insertion.length;
      }
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
  }

  // No open span, no popup: the general hard/soft break distinction —
  // Enter reads as a new paragraph (more visual space), Shift+Enter as a
  // line break within the same paragraph (tighter), matching Notion's own
  // convention. Applies to every field this autocomplete is wired to.
  e.preventDefault();
  const insertion = e.shiftKey ? '\n' : '\n\n';
  ta.value = ta.value.slice(0, pos) + insertion + ta.value.slice(pos);
  ta.selectionStart = ta.selectionEnd = pos + insertion.length;
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}



// --- Searchable picker (selector buttons + omnisearch) ---------------------
// One shared implementation powers three anchored, floating pickers (the
// Time/Place/NPC-jump buttons in the selector bar) and the centered
// Ctrl/Cmd+K omnisearch modal. Same search box, same arrow-key navigation,
// same selection logic — only where it's positioned and what selecting an
// item does differs by mode.

let pickerState = { open: false, mode: null, query: '', items: [], filtered: [], highlighted: 0, anchorId: null, sub: 'entities', step: null };

function pickerSourceItems(mode) {
  if (mode === 'time') {
    return window.Query.sortedCheckpoints(campaign).map((c) => ({ id: c.id, name: c.label, kind: 'time' }));
  }
  if (mode === 'place') return locations().map((e) => ({ id: e.id, name: e.name, kind: 'entity', entity: e }));
  if (mode === 'npc') return npcs().map((e) => ({ id: e.id, name: e.name, kind: 'entity', entity: e }));
  if (mode === 'omni') {
    return [...locations(), ...npcs()].map((e) => ({ id: e.id, name: e.name, kind: 'entity', entity: e }));
  }
  return [];
}

// Goes to the entity a piece of content is assigned to and lands on that exact
// section: switches to its checkpoint when needed, expands it, scrolls it into
// view and flashes it.
function jumpToContent(moduleId, assignment) {
  const entity = campaign.entities[assignment.entityId];
  const module = campaign.contentModules.find((m) => m.id === moduleId);
  if (!entity || !module) return;
  if (ui.mode === 'create') {
    ui.createTab = 'entities';
    ui.createSelectedEntityId = entity.id;
  } else {
    const target = assignment.timeId ? campaign.checkpoints.find((c) => c.id === assignment.timeId) : null;
    const cur = campaign.checkpoints.find((c) => c.id === ui.curTime);
    // Topics stay visible at later checkpoints, so only move forward for those.
    if (target && (module.type !== 'topic' || !cur || target.order > cur.order)) ui.curTime = target.id;
    if (module.type === 'topic') {
      const ids = new Set(campaign.meta.openTopicIds || []);
      ids.add(moduleId);
      campaign.meta.openTopicIds = Array.from(ids);
    } else if (module.type !== 'description' && !ui.expandedIds.includes(moduleId)) {
      ui.expandedIds.push(moduleId);
    }
    if (entity.type === 'location') {
      ui.fullPageEntityId = null;
      ui.curLocation = entity.id;
      ui.openEntityIds = [];
    } else {
      ui.fullPageEntityId = entity.id;
    }
  }
  renderAll();
  requestAnimationFrame(() => {
    const el = document.getElementById(moduleId) || document.querySelector(`[data-mod="${moduleId}"]`);
    if (!el) return;
    if ('open' in el) el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('search-flash');
    setTimeout(() => el.classList.remove('search-flash'), 2200);
  });
}

function openPicker(mode, anchorId) {
  const box = document.getElementById('picker-float-box');
  if (box) box.style.display = 'none';
  const modal = document.getElementById('omnisearch-modal');
  if (modal) modal.style.display = 'none';

  pickerState = { open: true, mode, query: '', items: pickerSourceItems(mode), filtered: [], highlighted: 0, anchorId: anchorId || null, sub: 'entities', step: null };
  renderPicker();
  if (mode === 'omni' && modal) modal.style.display = 'flex';
  const input = document.getElementById(mode === 'omni' ? 'omnisearch-input' : 'picker-float-input');
  if (input) { input.value = ''; input.focus(); }
}

function closePicker() {
  pickerState.open = false;
  const box = document.getElementById('picker-float-box');
  if (box) box.style.display = 'none';
  const modal = document.getElementById('omnisearch-modal');
  if (modal) modal.style.display = 'none';
}

function renderPickerItemHTML(it, i) {
  const hl = i === pickerState.highlighted ? 'hl' : '';
  if (it.kind === 'entity') {
    return `<div class="picker-item ${hl}" onmousedown="event.preventDefault();window.app.selectPickerItem(${i})">
      ${entityBadge(it.entity, 18)}
      <span class="name">${esc(it.name)}</span>
      <span class="type-tag">${it.entity.type}</span>
    </div>`;
  }
  return `<div class="picker-item ${hl}" onmousedown="event.preventDefault();window.app.selectPickerItem(${i})">
    ${icon('clock')}<span class="name">${esc(it.name)}</span>
  </div>`;
}

const CONTENT_TYPE_LABELS = { description: 'Description', scene: 'Scene', beat: 'Beat', note: 'Note', topic: 'Topic' };

function contentSnippetHTML(sn) {
  if (!sn) return '';
  return `${esc(sn.pre)}${sn.hit ? `<mark>${esc(sn.hit)}</mark>` : ''}${esc(sn.post)}`;
}

function renderContentPickerItemHTML(r, i) {
  const hl = i === pickerState.highlighted ? 'hl' : '';
  const one = r.assignments.length === 1;
  const ent = one ? campaign.entities[r.assignments[0].entityId] : null;
  const where = one && ent
    ? `${entityBadge(ent, 16)} <span class="cs-where-name">${esc(ent.name)}</span>`
    : `<span class="cs-multi">${r.assignments.length} entities ›</span>`;
  const title = r.name ? `<span class="name">${rich(r.name)}</span>` : '';
  return `<div class="picker-item cs-item ${hl}" onmousedown="event.preventDefault();window.app.selectPickerItem(${i})">
    <div class="cs-main">
      <div class="cs-top"><span class="cs-type cs-type-${r.type}">${esc(CONTENT_TYPE_LABELS[r.type] || r.type)}</span>${title}</div>
      <div class="cs-snippet">${contentSnippetHTML(r.snippet)}</div>
    </div>
    <div class="cs-where">${where}</div>
  </div>`;
}

function renderContentPickerStepItemHTML(a, i) {
  const hl = i === pickerState.highlighted ? 'hl' : '';
  const ent = campaign.entities[a.entityId];
  const cp = a.timeId ? campaign.checkpoints.find((c) => c.id === a.timeId) : null;
  return `<div class="picker-item ${hl}" onmousedown="event.preventDefault();window.app.selectPickerItem(${i})">
    ${entityBadge(ent, 18)}<span class="name">${esc(ent.name)}</span>
    <span class="type-tag">${esc(ent.type)}</span>
    <span class="type-tag">${cp ? esc(cp.label) : 'always'}</span>
  </div>`;
}

function setOmniChrome() {
  const input = document.getElementById('omnisearch-input');
  const bar = document.getElementById('omnisearch-mode');
  if (!input || !bar) return;
  const content = pickerState.sub === 'content';
  const panel = input.closest('.modal-panel');
  if (panel) { panel.style.width = content ? 'min(720px, 92vw)' : ''; panel.style.maxWidth = content ? '720px' : ''; }
  input.placeholder = content ? 'Search all content — titles and text…' : 'Jump to a location or NPC…';
  const step = pickerState.step;
  bar.innerHTML = step
    ? `<span class="omni-step">Where should “${esc(step.name || (CONTENT_TYPE_LABELS[step.type] || 'content'))}” open? ↑↓ Enter · Esc to go back</span>`
    : `<span class="omni-tab ${content ? '' : 'on'}">Entities</span><span class="omni-tab ${content ? 'on' : ''}">Content</span><span class="omni-hint">Ctrl+K switches</span>`;
}

function renderPicker() {
  if (!pickerState.open) return;
  if (pickerState.mode === 'omni' && pickerState.sub === 'content') {
    setOmniChrome();
    let html;
    if (pickerState.step) {
      pickerState.filtered = pickerState.step.assignments;
      html = pickerState.filtered.map((a, i) => renderContentPickerStepItemHTML(a, i)).join('');
    } else {
      pickerState.filtered = pickerState.query.trim() ? window.Query.searchContent(campaign, pickerState.query) : [];
      html = pickerState.query.trim()
        ? (pickerState.filtered.length ? pickerState.filtered.map((r, i) => renderContentPickerItemHTML(r, i)).join('') : `<div class="picker-empty">No content matches</div>`)
        : `<div class="picker-empty">Type to search the title and text of all content</div>`;
    }
    if (pickerState.highlighted >= pickerState.filtered.length) pickerState.highlighted = Math.max(0, pickerState.filtered.length - 1);
    document.getElementById('omnisearch-results').innerHTML = html;
    const hlEl = document.querySelector('#omnisearch-results .picker-item.hl');
    if (hlEl && hlEl.scrollIntoView) hlEl.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (pickerState.mode === 'omni') setOmniChrome();
  const q = pickerState.query.toLowerCase();
  const filtered = pickerState.items.filter((it) => it.name.toLowerCase().includes(q));
  pickerState.filtered = filtered;
  if (pickerState.highlighted >= filtered.length) pickerState.highlighted = Math.max(0, filtered.length - 1);

  const resultsHtml = filtered.length === 0
    ? `<div class="picker-empty">No matches</div>`
    : filtered.map((it, i) => renderPickerItemHTML(it, i)).join('');

  if (pickerState.mode === 'omni') {
    document.getElementById('omnisearch-results').innerHTML = resultsHtml;
    return;
  }

  let box = document.getElementById('picker-float-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'picker-float-box';
    box.className = 'picker-float';
    box.innerHTML = `<input type="text" id="picker-float-input" placeholder="Search…" oninput="window.app.onPickerInput(this.value)" onkeydown="window.app.onPickerKeydown(event)">
      <div id="picker-float-results" class="picker-results" style="margin-top:0"></div>`;
    document.body.appendChild(box);
  }
  const anchor = document.getElementById(pickerState.anchorId);
  if (anchor) {
    const rect = anchor.getBoundingClientRect();
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.bottom + 4}px`;
    box.style.width = `${Math.max(rect.width, 200)}px`;
  }
  box.style.display = 'flex';
  document.getElementById('picker-float-results').innerHTML = resultsHtml;
}



function renderCampaignSwitcherBody() {
  const el = document.getElementById('campaign-switcher-body');
  let html = '';

  html += ui.campaignList.map((c) => {
    const isActive = c.id === ui.activeCampaignId;

    if (ui.renamingCampaignId === c.id) {
      return `<div class="campaign-row ${isActive ? 'active' : ''}">
        <input type="text" id="rename-input-${c.id}" value="${esc(c.name)}" style="flex:1"
          onkeydown="if(event.key==='Enter'){window.app.confirmRenameCampaign('${c.id}')}else if(event.key==='Escape'){window.app.cancelRenameCampaign()}">
        <div class="campaign-actions">
          <button class="mini-btn" onclick="window.app.confirmRenameCampaign('${c.id}')">${icon('check')}</button>
          <button class="mini-btn" onclick="window.app.cancelRenameCampaign()">${icon('x')}</button>
        </div>
      </div>`;
    }

    if (ui.confirmDeleteId === c.id) {
      return `<div class="campaign-row ${isActive ? 'active' : ''}">
        <span class="confirm-row">Delete "${esc(c.name)}"? It moves to a recoverable folder, not gone for good.</span>
        <div class="campaign-actions">
          <button class="mini-btn" onclick="window.app.confirmDeleteCampaign('${c.id}')">${icon('check')}</button>
          <button class="mini-btn" onclick="window.app.cancelDeleteCampaign()">${icon('x')}</button>
        </div>
      </div>`;
    }

    return `<div class="campaign-row ${isActive ? 'active' : ''}">
      <span class="name" onclick="window.app.selectCampaign('${c.id}')" title="${isActive ? 'Current campaign' : 'Switch to this campaign'}">
        ${isActive ? icon('check') + ' ' : ''}${esc(c.name)}
      </span>
      <div class="campaign-actions">
        <button class="mini-btn" title="Rename" onclick="window.app.startRenameCampaign('${c.id}')">${icon('edit')}</button>
        <button class="mini-btn" title="Delete" onclick="window.app.startDeleteCampaign('${c.id}')">${icon('trash')}</button>
      </div>
    </div>`;
  }).join('');

  html += `<div class="divider"></div>`;

  if (ui.newCampaignFormOpen) {
    html += `<div class="form-row">
      <input type="text" id="new-campaign-name" placeholder="Campaign name"
        onkeydown="if(event.key==='Enter'){window.app.confirmNewCampaign()}else if(event.key==='Escape'){window.app.cancelNewCampaignForm()}">
      <div class="inline" style="margin-top:6px">
        <button class="primary icon-btn" onclick="window.app.confirmNewCampaign()">${icon('check')} Create</button>
        <button class="icon-btn" onclick="window.app.cancelNewCampaignForm()">${icon('x')} Cancel</button>
      </div>
    </div>`;
  } else {
    html += `<button class="icon-btn" onclick="window.app.startNewCampaignForm()">${icon('plus')} New campaign</button>`;
  }

  el.innerHTML = html;

  if (ui.newCampaignFormOpen) {
    const input = document.getElementById('new-campaign-name');
    if (input) input.focus();
  }
  if (ui.renamingCampaignId) {
    const input = document.getElementById(`rename-input-${ui.renamingCampaignId}`);
    if (input) { input.focus(); input.select(); }
  }
}

window.app = {
  openPicker(mode, anchorId) { openPicker(mode, anchorId); },
  closePicker() { closePicker(); },
  onPickerInput(value) {
    pickerState.query = value;
    pickerState.highlighted = 0;
    pickerState.step = null;
    renderPicker();
  },
  onPickerKeydown(e) {
    const n = pickerState.filtered.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (n > 0) pickerState.highlighted = (pickerState.highlighted + 1) % n;
      renderPicker();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (n > 0) pickerState.highlighted = (pickerState.highlighted - 1 + n) % n;
      renderPicker();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      window.app.selectPickerItem(pickerState.highlighted);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (pickerState.mode === 'omni' && pickerState.step) { pickerState.step = null; pickerState.highlighted = 0; renderPicker(); return; }
      closePicker();
    }
  },
  selectPickerItem(index) {
    const it = pickerState.filtered[index];
    if (!it) return;
    const mode = pickerState.mode;
    if (mode === 'omni' && pickerState.sub === 'content') {
      if (pickerState.step) {
        const moduleId = pickerState.step.moduleId;
        closePicker();
        jumpToContent(moduleId, it);
      } else if (it.assignments.length > 1) {
        pickerState.step = it;
        pickerState.highlighted = 0;
        renderPicker();
      } else {
        closePicker();
        jumpToContent(it.moduleId, it.assignments[0]);
      }
      return;
    }
    closePicker();

    if (mode === 'time') {
      window.app.selectTime(it.id);
    } else if (mode === 'place') {
      window.app.selectLocation(it.id);
    } else if (mode === 'npc') {
      window.app.jumpNpc(it.id);
    } else if (mode === 'omni') {
      if (ui.mode === 'create') {
        ui.createTab = 'entities';
        ui.createSelectedEntityId = it.id;
        renderAll();
      } else if (it.entity.type === 'location') {
        window.app.selectLocation(it.id);
      } else {
        window.app.jumpNpc(it.id);
      }
    }
  },

  pickMention(idx) {
    const ta = mentionState.textareaEl;
    const item = mentionState.items[idx];
    if (!ta || !item) return;
    const text = ta.value;
    const pos = ta.selectionStart;
    const before = text.slice(0, mentionState.atIndex);
    const after = text.slice(pos);

    if (mentionState.mode === 'jump') {
      if (item.kind === 'npc' || item.kind === 'location') {
        // Strip whatever was typed to search step 1, collapse the cursor
        // back to the original trigger point, then open step 2.
        ta.value = before + after;
        ta.selectionStart = ta.selectionEnd = before.length;
        const cps = window.Query.sortedCheckpoints(campaign);
        const timeItems = [{ id: '', kind: 'time', label: 'Current milestone (default)', sourceLabel: '' }]
          .concat(cps.map((c) => ({ id: c.id, kind: 'time', label: c.label, sourceLabel: 'Milestone' })));
        mentionState = {
          active: true, mode: 'jump-time', textareaId: ta.id, textareaEl: ta,
          atIndex: before.length, query: '', items: timeItems, allItems: timeItems,
          highlighted: 0, pendingJumpTarget: item
        };
        renderMentionSuggest(ta);
        return;
      }
      const token = `[[JUMP:${item.id}]]${item.label}[[/JUMP]]`;
      ta.value = before + token + after;
      const newPos = before.length + token.length;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = newPos;
      closeMentionSuggest();
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    if (mentionState.mode === 'jump-time') {
      const target = mentionState.pendingJumpTarget;
      const timeSuffix = item.id ? `:${item.id}` : '';
      const token = `[[JUMP:${target.id}${timeSuffix}]]${target.label}[[/JUMP]]`;
      ta.value = before + token + after;
      const newPos = before.length + token.length;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = newPos;
      closeMentionSuggest();
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const entity = item;
    if (mentionState.mode === 'say') {
      const openTag = `[[SAY:${entity.id}]]`;
      ta.value = before + openTag + after;
      const newPos = before.length + openTag.length;
      ta.focus();
      ta.selectionStart = ta.selectionEnd = newPos;
      closeMentionSuggest();
      openSaySpans[ta.id] = true; // Enter (or blur, as a safety net) closes it with [[/SAY]]
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    const token = `[[${entity.id}]]`;
    ta.value = before + token + after;
    const newPos = before.length + token.length;
    ta.focus();
    ta.selectionStart = ta.selectionEnd = newPos;
    closeMentionSuggest();
    ta.dispatchEvent(new Event('input', { bubbles: true })); // triggers the field's own save handler too
  },

  // Deliberately a separate, explicit step from auto-tagging itself —
  // being mentioned in text is not the same as being present (see the
  // presence-vs-mention distinction throughout this app). This just makes
  // the common case ("yes, they're actually here") a single click instead
  // of finding each one in the presence checklist by hand.
  async markPastedEntitiesPresent() {
    if (!ui.pasteReview) return;
    const arrival = ensureArrivalExists(ui.createContentLocationId, ui.createContentTimeId);
    for (const id of ui.pasteReview.taggedIds) {
      if (!arrival.presence.includes(id)) arrival.presence.push(id);
    }
    ui.pasteReview = null;
    await refresh();
  },
  dismissPasteReview() {
    ui.pasteReview = null;
    renderContentEditor();
  },

  switchMode(mode) { ui.mode = mode; renderAll(); },

  async openCampaignSwitcher() {
    ui.campaignList = await window.core.listCampaigns();
    ui.campaignSwitcherOpen = true;
    ui.newCampaignFormOpen = false;
    ui.renamingCampaignId = null;
    ui.confirmDeleteId = null;
    renderAll();
  },
  closeCampaignSwitcher() {
    ui.campaignSwitcherOpen = false;
    ui.newCampaignFormOpen = false;
    ui.renamingCampaignId = null;
    ui.confirmDeleteId = null;
    renderAll();
  },
  async selectCampaign(id) {
    if (id === ui.activeCampaignId) { window.app.closeCampaignSwitcher(); return; }
    campaign = await window.core.switchCampaign(id);
    ui.activeCampaignId = id;
    const entry = ui.campaignList.find((c) => c.id === id);
    ui.activeCampaignName = entry ? entry.name : 'Campaign';
    await resetUiForCampaign();
    window.app.closeCampaignSwitcher();
  },
  startRenameCampaign(id) {
    ui.renamingCampaignId = id;
    ui.confirmDeleteId = null;
    renderCampaignSwitcherBody();
  },
  cancelRenameCampaign() {
    ui.renamingCampaignId = null;
    renderCampaignSwitcherBody();
  },
  async confirmRenameCampaign(id) {
    const input = document.getElementById(`rename-input-${id}`);
    const name = input ? input.value.trim() : '';
    if (!name) return;
    await window.core.renameCampaign(id, name);
    if (id === ui.activeCampaignId) ui.activeCampaignName = name;
    ui.renamingCampaignId = null;
    ui.campaignList = await window.core.listCampaigns();
    renderAll();
  },
  startNewCampaignForm() {
    ui.newCampaignFormOpen = true;
    ui.renamingCampaignId = null;
    ui.confirmDeleteId = null;
    renderCampaignSwitcherBody();
  },
  cancelNewCampaignForm() {
    ui.newCampaignFormOpen = false;
    renderCampaignSwitcherBody();
  },
  async confirmNewCampaign() {
    const input = document.getElementById('new-campaign-name');
    const name = input ? input.value.trim() : '';
    if (!name) return;
    const result = await window.core.createCampaign(name);
    campaign = result.campaign;
    ui.activeCampaignId = result.entry.id;
    ui.activeCampaignName = result.entry.name;
    await resetUiForCampaign();
    ui.newCampaignFormOpen = false;
    window.app.closeCampaignSwitcher();
  },
  startDeleteCampaign(id) {
    ui.confirmDeleteId = id;
    ui.renamingCampaignId = null;
    renderCampaignSwitcherBody();
  },
  cancelDeleteCampaign() {
    ui.confirmDeleteId = null;
    renderCampaignSwitcherBody();
  },
  async confirmDeleteCampaign(id) {
    const list = await window.core.deleteCampaign(id);
    ui.campaignList = list;
    ui.confirmDeleteId = null;
    if (id === ui.activeCampaignId) {
      campaign = await window.core.loadCampaign();
      const activeInfo = await window.core.activeCampaignInfo();
      ui.activeCampaignId = activeInfo ? activeInfo.id : null;
      ui.activeCampaignName = activeInfo ? activeInfo.name : 'Campaign';
      await resetUiForCampaign();
    }
    renderAll();
  },

  selectTime(id) { ui.curTime = id; renderAll(); },
  selectLocation(id) { ui.curLocation = id; ui.openEntityIds = []; renderAll(); maybeOpenNotion(id); },
  jumpNpc(id) { ui.fullPageEntityId = id; renderAll(); maybeOpenNotion(id); },
  stepCheckpoint(direction) {
    const cps = window.Query.sortedCheckpoints(campaign);
    if (cps.length === 0) return;
    const idx = cps.findIndex((c) => c.id === ui.curTime);
    const newIdx = idx === -1 ? 0 : Math.min(cps.length - 1, Math.max(0, idx + direction));
    ui.curTime = cps[newIdx].id;
    renderAll();
  },

  openEntity(id) {
    if (!ui.openEntityIds.includes(id)) ui.openEntityIds.push(id);
    renderAll();
    maybeOpenNotion(id);
  },
  // Clicking a JUMP cross-reference link. Searches beats first (every
  // arrival's own list), then topics. Navigates to wherever the target
  // actually lives, forces it open regardless of its current
  // collapsed/complete state, and scrolls it into view once the DOM has
  // caught up with the new render.
  jumpToReference(itemId, timeId) {
    const beatModule = campaign.contentModules.find((m) => m.id === itemId && m.type === 'beat');
    const beatAssignment = beatModule && campaign.assignments.find((a) => a.moduleId === beatModule.id);
    if (beatAssignment) {
      ui.fullPageEntityId = null;
      ui.curLocation = beatAssignment.entityId;
      ui.curTime = beatAssignment.timeId;
      if (!ui.expandedIds.includes(itemId)) ui.expandedIds.push(itemId);
      renderAll();
      maybeOpenNotion(beatAssignment.entityId);
      requestAnimationFrame(() => {
        const el = document.getElementById(itemId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }

    const sceneModule = campaign.contentModules.find((m) => m.id === itemId && m.type === 'scene');
    const sceneAssignment = sceneModule && campaign.assignments.find((a) => a.moduleId === sceneModule.id);
    if (sceneAssignment) {
      ui.fullPageEntityId = null;
      ui.curLocation = sceneAssignment.entityId;
      ui.curTime = sceneAssignment.timeId;
      if (!ui.expandedIds.includes(itemId)) ui.expandedIds.push(itemId);
      renderAll();
      maybeOpenNotion(sceneAssignment.entityId);
      requestAnimationFrame(() => {
        const el = document.getElementById(itemId);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      return;
    }

    const descriptionModule = campaign.contentModules.find((m) => m.id === itemId && m.type === 'description');
    const descriptionAssignment = descriptionModule && campaign.assignments.find((a) => a.moduleId === descriptionModule.id);
    if (descriptionAssignment) {
      // No expand/scroll step needed — the description is always shown
      // at the top of the location card, immediately visible on arrival.
      ui.fullPageEntityId = null;
      ui.curLocation = descriptionAssignment.entityId;
      ui.curTime = descriptionAssignment.timeId;
      renderAll();
      maybeOpenNotion(descriptionAssignment.entityId);
      return;
    }

    const topicModule = campaign.contentModules.find((m) => m.id === itemId && m.type === 'topic');
    const topicAssignment = topicModule && campaign.assignments.find((a) => a.moduleId === topicModule.id);
    if (topicAssignment) {
      if (ui.fullPageEntityId && ui.fullPageEntityId !== topicAssignment.entityId) ui.fullPageEntityId = null;
      // If the topic is scoped to a later checkpoint than where we
      // currently are, jump forward to it — otherwise it'd stay filtered
      // out by getEntityCard and the link would open the card to nothing.
      if (topicAssignment.timeId) {
        const topicCp = campaign.checkpoints.find((c) => c.id === topicAssignment.timeId);
        const curCp = campaign.checkpoints.find((c) => c.id === ui.curTime);
        if (topicCp && (!curCp || topicCp.order > curCp.order)) ui.curTime = topicAssignment.timeId;
      }
      if (!ui.openEntityIds.includes(topicAssignment.entityId)) ui.openEntityIds.push(topicAssignment.entityId);
      renderAll();
      maybeOpenNotion(topicAssignment.entityId);
      requestAnimationFrame(() => {
        const el = document.getElementById(itemId);
        if (el) {
          if ('open' in el) el.open = true;
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      return;
    }

    const entity = campaign.entities[itemId];
    if (entity) {
      if (entity.type === 'location') {
        // A location link behaves exactly like picking it from the Place
        // picker or omnisearch — same underlying action, just reached a
        // different way. The optional milestone just sets curTime first.
        if (timeId && campaign.checkpoints.find((c) => c.id === timeId)) {
          ui.curTime = timeId;
        }
        window.app.selectLocation(itemId);
      } else {
        // An NPC link behaves exactly like clicking a mention pill for
        // them — opens the card inline, doesn't navigate anywhere.
        window.app.openEntity(itemId);
      }
      return;
    }

    console.warn('[jump] could not find referenced item (it may have been deleted):', itemId);
  },
  triggerDirectorButton(btn) {
    sendDirectorCommandWithFeedback(btn.dataset.session, btn.dataset.scene, btn.dataset.layout);
  },
  triggerDirectorMusic(btn) {
    // Music only: with a scene named, the Director tool finds the track in that scene's own
    // settings and plays it without switching scene (switch_scene:false). "Current scene"
    // buttons carry no scene and simply act on the active one.
    const cmd = { music: btn.dataset.music };
    if (btn.dataset.session && btn.dataset.scene) Object.assign(cmd, { session: btn.dataset.session, scene: btn.dataset.scene, switch_scene: false });
    sendDirectorWithFeedback(cmd);
  },
  triggerDirectorQuickfire(btn) {
    const cmd = { quickfire: btn.dataset.quickfire, quickfire_fire: btn.dataset.fire === '1' };
    if (btn.dataset.session && btn.dataset.scene) Object.assign(cmd, { session: btn.dataset.session, scene: btn.dataset.scene, switch_scene: false });
    sendDirectorWithFeedback(cmd);
  },
  triggerDirectorGeneric(btn) {
    const k = btn.dataset.dkind, a = btn.dataset.a, b = btn.dataset.b, play = btn.dataset.c === '1';
    let cmd = null;
    if (k === 'genre') cmd = b ? { music_genre: a, music: b } : { music_genre: a, play };
    else if (k === 'playlist') cmd = b ? { playlist: a, music: b } : { playlist: a, play };
    else if (k === 'playlistoff') cmd = { playlist_off: true };
    else if (k === 'sfx') cmd = { sfx_category: a, sfx: b };
    else if (k === 'scenesfx') { cmd = { sfx: btn.dataset.c }; if (a && b) Object.assign(cmd, { session: a, scene: b, switch_scene: false }); }
    else if (k === 'sfxstop') cmd = { sfx_stop: true };
    else if (k === 'notion') {
      window.core.openNotionLink(toNotionScheme(a)).then((res) => { if (!res || !res.ok) window.Health.notice(`Couldn't open Notion: ${(res && res.error) || 'unknown error'}`); });
      return;
    }
    if (cmd) sendDirectorWithFeedback(cmd);
  },
  triggerDirectorEntityButton(entityId) {
    const entity = campaign.entities[entityId];
    const sl = entity && entity.sceneLayout;
    if (!sl || !sl.session || !sl.scene) return;
    sendDirectorCommandWithFeedback(sl.session, sl.scene, sl.layout || '');
  },
  closeEntity(id) {
    ui.openEntityIds = ui.openEntityIds.filter((x) => x !== id);
    renderAll();
  },
  openFullPage(id) { ui.fullPageEntityId = id; renderAll(); maybeOpenNotion(id); },
  backToLocation() { ui.fullPageEntityId = null; renderAll(); },

  async setStartHere() {
    window.Query.setBookmark(campaign, ui.curLocation, ui.curTime);
    await refresh();
  },
  async undoSinceStart() {
    window.Query.undoSinceStart(campaign);
    await refresh();
  },

  async toggleModuleComplete(moduleId, checked) {
    window.Query.markModuleComplete(campaign, moduleId, checked);
    await refresh();
  },
  toggleExpanded(id) {
    const idx = ui.expandedIds.indexOf(id);
    if (idx === -1) ui.expandedIds.push(id); else ui.expandedIds.splice(idx, 1);
    renderAll();
  },

  setCreateTab(tab) {
    ui.createTab = tab; ui.createSelectedEntityId = null; renderAll();
    const sc = document.getElementById('main-scroll');
    if (sc) sc.scrollTop = 0; // a different tab starts at the top
  },

  // --- Content Library handlers ---------------------------------------
  setLibraryFilter(field, value) {
    campaign.meta.contentLibraryFilters[field] = value;
    renderLibraryResults();
    scheduleFieldSave('library-filters');
  },
  async resetLibraryFilters() {
    campaign.meta.contentLibraryFilters = { search: '', type: '', entityId: '', unassignedOnly: false, sort: 'name' };
    await refresh();
  },
  toggleLibraryNewForm() {
    ui.libraryNewFormOpen = !ui.libraryNewFormOpen;
    renderLibraryResults();
  },
  async createLibraryModule() {
    const nameInput = document.getElementById('lib-new-name');
    const typeSelect = document.getElementById('lib-new-type');
    const name = nameInput ? nameInput.value.trim() : '';
    const type = typeSelect ? typeSelect.value : 'note';
    const module = window.DataModel.createContentModule(campaign, { type, name: name || 'Untitled' });
    ui.libraryNewFormOpen = false;
    ui.librarySelectedModuleId = module.id;
    await refresh();
  },
  selectLibraryModule(moduleId) {
    ui.librarySelectedModuleId = ui.librarySelectedModuleId === moduleId ? null : moduleId;
    ui.libraryAssignPickerOpen = false;
    ui.libraryAssignResultNote = null;
    renderLibraryResults();
  },
  onLibraryModuleNameInput(moduleId, value) {
    const module = campaign.contentModules.find((m) => m.id === moduleId);
    if (module) module.name = value;
    scheduleFieldSave(`lib-name-${moduleId}`);
  },
  onLibraryModuleFieldInput(moduleId, field, value) {
    const module = campaign.contentModules.find((m) => m.id === moduleId);
    if (module) module[field] = value;
    scheduleFieldSave(`lib-field-${moduleId}-${field}`);
  },
  async deleteLibraryModule(moduleId) {
    window.DataModel.deleteContentModule(campaign, moduleId);
    if (ui.librarySelectedModuleId === moduleId) ui.librarySelectedModuleId = null;
    await refresh();
  },
  // Opening the picker starts from a clean slate — filters and
  // selection from a previous piece of content don't carry over, since a
  // leftover type/group filter would otherwise look like entities were
  // missing rather than filtered out.
  toggleLibraryAssignPicker() {
    ui.libraryAssignPickerOpen = !ui.libraryAssignPickerOpen;
    ui.libraryAssignSearchQuery = '';
    ui.libraryAssignSelectedEntityIds = [];
    ui.libraryAssignTypeFilter = '';
    ui.libraryAssignGroupFilter = '';
    ui.libraryAssignHideAssigned = true;
    ui.libraryAssignTimeId = '';
    ui.libraryAssignResultNote = null;
    renderLibraryResults();
  },
  async assignLibraryModule(moduleId) {
    const module = campaign.contentModules.find((m) => m.id === moduleId);
    if (!module) return;
    const entityIds = ui.libraryAssignSelectedEntityIds.filter((id) => campaign.entities[id]);
    if (entityIds.length === 0) return;

    const { timeId: effectiveTimeId } = computeLibraryAssignView(module);
    const timeId = effectiveTimeId || null;
    // Beats, scenes and descriptions are only visible in Play mode when
    // an arrival exists to anchor them — same requirement as assigning
    // to a single entity, just applied to each one.
    if ((module.type === 'beat' || module.type === 'scene' || module.type === 'description') && timeId) {
      entityIds.forEach((id) => ensureArrivalExists(id, timeId));
    }
    const result = window.DataModel.assignModuleToEntities(campaign, { moduleId, entityIds, timeId });

    const parts = [`Assigned to ${result.created.length} ${result.created.length === 1 ? 'entity' : 'entities'}.`];
    if (result.skipped.length > 0) {
      parts.push(`Skipped ${result.skipped.length} that already had it at that time.`);
    }
    ui.libraryAssignResultNote = { moduleId, text: parts.join(' ') };

    ui.libraryAssignPickerOpen = false;
    ui.libraryAssignSearchQuery = '';
    ui.libraryAssignSelectedEntityIds = [];
    await refresh();
  },
  async unassignLibraryModule(assignmentId) {
    window.DataModel.deleteAssignment(campaign, assignmentId);
    await refresh();
  },
  toggleLibraryGroupCollapsed(key) {
    const ids = campaign.meta.collapsedLibraryGroups;
    const idx = ids.indexOf(key);
    if (idx === -1) ids.push(key); else ids.splice(idx, 1);
    renderLibraryResults();
    scheduleFieldSave(`library-group-collapse-${key}`);
  },
  async expandAllLibraryGroups() {
    campaign.meta.collapsedLibraryGroups = [];
    await refresh();
  },
  async collapseAllLibraryGroups() {
    const modules = getFilteredLibraryModules();
    const { sortedGroups, unassigned } = buildLibraryGroups(modules);
    const keys = sortedGroups.map((g) => g.entity.id);
    if (unassigned.length > 0) keys.push('__unassigned__');
    campaign.meta.collapsedLibraryGroups = keys;
    await refresh();
  },
  // Each of these rebuilds only the list/counts/footer below the search
  // and filter controls, never the controls themselves — same
  // focus-preservation reasoning as the filter bar's own search field.
  onLibraryAssignSearchInput(value) {
    ui.libraryAssignSearchQuery = value;
    refreshLibraryAssignPickerBody();
  },
  setLibraryAssignTypeFilter(value) {
    ui.libraryAssignTypeFilter = value;
    refreshLibraryAssignPickerBody();
  },
  setLibraryAssignGroupFilter(value) {
    ui.libraryAssignGroupFilter = value;
    refreshLibraryAssignPickerBody();
  },
  setLibraryAssignHideAssigned(checked) {
    ui.libraryAssignHideAssigned = checked;
    refreshLibraryAssignPickerBody();
  },
  setLibraryAssignTime(value) {
    ui.libraryAssignTimeId = value;
    refreshLibraryAssignPickerBody();
  },
  toggleLibraryAssignEntity(entityId) {
    const ids = ui.libraryAssignSelectedEntityIds;
    const idx = ids.indexOf(entityId);
    if (idx === -1) ids.push(entityId); else ids.splice(idx, 1);
    refreshLibraryAssignPickerBody();
  },
  // Adds everything currently shown to the selection (never removes
  // anything already selected) — so a selection can be built up across
  // several different searches/filters, exactly the "build a list of
  // NPCs" workflow this exists for.
  selectAllLibraryAssignShown() {
    const module = campaign.contentModules.find((m) => m.id === ui.librarySelectedModuleId);
    if (!module) return;
    const { filtered } = computeLibraryAssignView(module);
    const ids = ui.libraryAssignSelectedEntityIds;
    filtered.forEach((e) => { if (!ids.includes(e.id)) ids.push(e.id); });
    refreshLibraryAssignPickerBody();
  },
  clearLibraryAssignSelection() {
    ui.libraryAssignSelectedEntityIds = [];
    refreshLibraryAssignPickerBody();
  },

  // opts: { type, entityId, timeId }. timeId is null for general
  // notes/always-available topics, or a checkpoint id for anything
  // time-scoped (time-specific notes, beats, scenes).
  openAssignFromLibrary(opts) {
    ui.assignFromLibrary = { type: opts.type, entityId: opts.entityId, timeId: opts.timeId || null, searchQuery: '' };
    document.getElementById('assign-from-library-modal').style.display = 'flex';
    renderAssignFromLibraryModal();
  },
  // Time-specific notes share the "new-note-time" select with the
  // regular Add button — whichever checkpoint is currently chosen there
  // is what a library pick gets assigned to as well.
  openAssignFromLibraryForNewNoteTime(entityId) {
    const timeSelect = document.getElementById('new-note-time');
    if (!timeSelect || !timeSelect.value) return;
    window.app.openAssignFromLibrary({ type: 'note', entityId, timeId: timeSelect.value });
  },
  // Beats/scenes always use the Content tab's own current location+
  // checkpoint selection, same as addBeatToArrival/addScene themselves.
  openAssignFromLibraryForContent(type) {
    if (!ui.createContentLocationId || !ui.createContentTimeId) return;
    window.app.openAssignFromLibrary({ type, entityId: ui.createContentLocationId, timeId: ui.createContentTimeId });
  },
  closeAssignFromLibrary() {
    ui.assignFromLibrary = null;
    document.getElementById('assign-from-library-modal').style.display = 'none';
  },
  onAssignFromLibrarySearchInput(value) {
    if (!ui.assignFromLibrary) return;
    ui.assignFromLibrary.searchQuery = value;
    renderAssignFromLibraryResults();
  },
  async pickAssignFromLibraryModule(moduleId) {
    if (!ui.assignFromLibrary) return;
    const { type, entityId, timeId } = ui.assignFromLibrary;
    if ((type === 'beat' || type === 'scene' || type === 'description') && entityId && timeId) {
      ensureArrivalExists(entityId, timeId);
    }
    window.DataModel.createAssignment(campaign, { moduleId, entityId, timeId });
    ui.assignFromLibrary = null;
    document.getElementById('assign-from-library-modal').style.display = 'none';
    await refresh();
  },

  // --- DC Check editor -------------------------------------------------
  // opts: { checkId } to edit an existing check, or { checkId: null,
  // onInsert } to create a new one — onInsert(newCheckId) fires only
  // once the flow actually finishes (Done), never on close/cancel.
  // The editor is one shared modal, but checks nest (a DC check's own text can
  // hold another DC check). Opening an editor while one is already open pushes
  // the open one onto ui.dcCheckEditorStack instead of replacing it; closing
  // or finishing the inner one pops back to it, so its pending "insert my
  // token" callback and its place in the flow survive.
  openDCCheckEditor(opts) {
    if (ui.dcCheckEditor) (ui.dcCheckEditorStack = ui.dcCheckEditorStack || []).push(ui.dcCheckEditor);
    if (opts.checkId) {
      ui.dcCheckEditor = { step: 'edit', checkId: opts.checkId, isNew: false, onInsert: null, confirming: null };
    } else {
      ui.dcCheckEditor = {
        step: 'setup', checkId: null, isNew: true,
        setupName: '', setupType: window.Constants.CHECK_TYPES[0].key, setupMode: window.Conditions.defaultDCCheckMode(window.Constants.CHECK_TYPES[0].key), setupModeTouched: false,
        onInsert: opts.onInsert || null, confirming: null
      };
    }
    document.getElementById('dc-check-editor-modal').style.display = 'flex';
    renderDCCheckEditorModal();
  },
  closeDCCheckEditor() {
    const parent = ui.dcCheckEditorStack && ui.dcCheckEditorStack.pop();
    if (parent) {
      // Back to the check this one was opened from.
      ui.dcCheckEditor = parent;
      renderDCCheckEditorModal();
      return;
    }
    ui.dcCheckEditor = null;
    const modal = document.getElementById('dc-check-editor-modal');
    if (modal) modal.style.display = 'none';
    renderDCChecksLibrarySection(); // reflects anything created/edited while the modal was open, if the Library happens to be visible behind it
  },
  createDCCheckFromSetup() {
    const nameInput = document.getElementById('dcc-setup-name');
    const name = nameInput ? nameInput.value.trim() : '';
    const type = (ui.dcCheckEditor && ui.dcCheckEditor.setupType) || window.Constants.CHECK_TYPES[0].key;
    const radio = document.querySelector('input[name="dcc-setup-mode"]:checked');
    const check = window.DataModel.createDCCheck(campaign, { name, checkType: type, mode: radio ? radio.value : window.Conditions.defaultDCCheckMode(type) });
    window.Conditions.syncDCChecks(campaign);
    ui.dcCheckEditor.step = 'edit';
    ui.dcCheckEditor.checkId = check.id;
    persistSafely();
    renderDCCheckEditorModal();
  },
  // The only place the calling textarea actually gets its token inserted
  // — closing or navigating away from the modal any other way leaves it
  // untouched, so an abandoned "New DC Check" never leaves a broken
  // half-authored token behind.
  finishDCCheckEditor() {
    const state = ui.dcCheckEditor;
    if (state && state.isNew && state.onInsert && state.checkId) {
      state.onInsert(state.checkId);
    }
    window.app.closeDCCheckEditor();
  },
  startDeleteDCCheck(checkId) {
    if (!ui.dcCheckEditor) return;
    ui.dcCheckEditor.confirming = 'delete';
    renderDCCheckEditorModal();
  },
  cancelDCCheckEditorConfirm() {
    if (!ui.dcCheckEditor) return;
    ui.dcCheckEditor.confirming = null;
    renderDCCheckEditorModal();
  },
  async confirmDeleteDCCheck(checkId) {
    window.DataModel.deleteDCCheck(campaign, checkId);
    window.app.closeDCCheckEditor();
    await refresh();
  },
  // Only a click by the person counts (the browser also reports toggles it makes itself
  // while drawing the page). Topics start collapsed; the ones left open are remembered,
  // also after a restart.
  topicClicked(id) {
    setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const ids = new Set(campaign.meta.openTopicIds || []);
      if (el.open) ids.add(id); else ids.delete(id);
      campaign.meta.openTopicIds = Array.from(ids);
      scheduleFieldSave('topic-open');
    }, 0);
  },
  dcLinkSet(checkId, field, value) {
    const ck = campaign.dcChecks.find((c) => c.id === checkId);
    if (!ck) return;
    window.Conditions.ensureDCLink(campaign, ck).settings[field] = value;
    persistSafely();
  },
  onDCCheckFieldInput(checkId, field, value) {
    window.DataModel.updateDCCheckField(campaign, checkId, field, value);
    window.Conditions.syncDCChecks(campaign);
    if (field === 'checkType') { persistSafely(); return; } // a <select> onchange, not continuous typing -- safe and unnecessary to re-render, the select already shows its own new value natively
    scheduleFieldSave(`dcc-${checkId}-${field}`);
  },
  dcSetupTypeChanged(type) {
    const st = ui.dcCheckEditor;
    if (!st) return;
    st.setupType = type;
    if (!st.setupModeTouched) { st.setupMode = window.Conditions.defaultDCCheckMode(type); const nm = document.getElementById('dcc-setup-name'); const keep = nm ? nm.value : ''; renderDCCheckEditorModal(); const nm2 = document.getElementById('dcc-setup-name'); if (nm2) nm2.value = keep; }
  },
  dcEditTypeChanged(type) { const ck = ui.dcCheckEditor && campaign.dcChecks.find((c) => c.id === ui.dcCheckEditor.checkId); if (ck) window.app.onDCCheckFieldInput(ck.id, 'checkType', type); },
  dcSetStack(checkId, on) { const ck = campaign.dcChecks.find((c) => c.id === checkId); if (!ck) return; ck.stackTiers = !!on; persistSafely(); renderDCCheckEditorModal(); },
  dcSetupModeChanged(mode) { const st = ui.dcCheckEditor; if (st) { st.setupMode = mode; st.setupModeTouched = true; } },
  dcSetMode(checkId, mode) {
    const ck = campaign.dcChecks.find((c) => c.id === checkId); if (!ck) return;
    ck.mode = mode;
    window.Conditions.refreshLinkDC(campaign, ck);
    persistSafely();
    renderDCCheckEditorModal();
  },
  dcSetAllowBoth(checkId, on) {
    const ck = campaign.dcChecks.find((c) => c.id === checkId); if (!ck) return;
    ck.allowBoth = !!on;
    persistSafely();
    renderDCCheckEditorModal();
  },
  dcPassDCInput(checkId, value) {
    const ck = campaign.dcChecks.find((c) => c.id === checkId); if (!ck) return;
    window.Conditions.setPassDC(campaign, ck, parseInt(value, 10));
    scheduleFieldSave(`dcc-passdc-${checkId}`);
  },
  onDCTableRowDCInput(checkId, rowId, value) {
    const num = parseInt(value, 10);
    window.DataModel.updateDCTableRow(campaign, checkId, rowId, 'dc', Number.isNaN(num) ? 0 : num);
    { const ck = campaign.dcChecks.find((c) => c.id === checkId); if (ck) window.Conditions.refreshLinkDC(campaign, ck); }
    scheduleFieldSave(`dcc-row-dc-${rowId}`);
    // Re-sort once typing pauses: the rows are moved in place (not redrawn), so the
    // field being typed in keeps its focus and every other field keeps its text.
    clearTimeout(window.__dccResortTimer);
    window.__dccResortTimer = setTimeout(() => resortDCRows(checkId), 450);
    // Deliberately no re-render here even though rows sort by DC for
    // display -- re-sorting mid-keystroke would yank the row out from
    // under the input being typed into, the same focus-loss failure
    // mode fixed elsewhere in this app. The display catches up next
    // time the modal naturally re-renders (add/delete a row, reopen).
  },
  onDCTableRowTextInput(checkId, rowId, value) {
    window.DataModel.updateDCTableRow(campaign, checkId, rowId, 'text', value);
    scheduleFieldSave(`dcc-row-text-${rowId}`);
  },
  addDCTableRowUI(checkId) {
    { const ck = campaign.dcChecks.find((c) => c.id === checkId); const last = ck && ck.table.length ? Math.max(...ck.table.map((r) => r.dc)) : 5; window.DataModel.addDCTableRow(campaign, checkId, { dc: last + 5, text: '' }); }
    renderDCCheckEditorModal();
    persistSafely();
  },
  deleteDCTableRowUI(checkId, rowId) {
    window.DataModel.deleteDCTableRow(campaign, checkId, rowId);
    { const ck = campaign.dcChecks.find((c) => c.id === checkId); if (ck) window.Conditions.refreshLinkDC(campaign, ck); }
    renderDCCheckEditorModal();
    persistSafely();
  },
  onDCConditionFieldInput(checkId, condId, field, value) {
    let parsed = value;
    if (field === 'dc' || field === 'occurrence') {
      const num = parseInt(value, 10);
      parsed = Number.isNaN(num) ? (field === 'occurrence' ? 1 : 0) : num;
    }
    window.DataModel.updateDCCondition(campaign, checkId, condId, field, parsed);
    if (field === 'trigger') {
      // The DC input only shows for failure/success -- needs a
      // re-render to appear/disappear correctly. Safe here: a <select>
      // onchange, not continuous typing.
      renderDCCheckEditorModal();
      persistSafely();
      return;
    }
    scheduleFieldSave(`dcc-cond-${condId}-${field}`);
  },
  onDCConditionTextInput(checkId, condId, value) {
    window.DataModel.updateDCCondition(campaign, checkId, condId, 'text', value);
    scheduleFieldSave(`dcc-cond-text-${condId}`);
  },
  addDCConditionUI(checkId, trigger) {
    const ck = campaign.dcChecks.find((c) => c.id === checkId);
    const passDC = ck ? window.Conditions.ensureDCLink(campaign, ck).settings.dc : 10;
    const same = ck ? ck.conditions.filter((c) => c.trigger === trigger).length : 0;
    window.DataModel.addDCCondition(campaign, checkId, { trigger, dc: passDC, occurrence: (trigger === 'nat1' || trigger === 'nat20') ? 1 : same + 1, text: '' });
    if (ck) window.Conditions.refreshLinkDC(campaign, ck);
    renderDCCheckEditorModal();
    persistSafely();
  },
  deleteDCConditionUI(checkId, condId) {
    window.DataModel.deleteDCCondition(campaign, checkId, condId);
    renderDCCheckEditorModal();
    persistSafely();
  },
  startClearDCRollLogUI(checkId) {
    if (!ui.dcCheckEditor) return;
    ui.dcCheckEditor.confirming = 'clearLog';
    renderDCCheckEditorModal();
  },
  async confirmClearDCRollLogUI(checkId) {
    window.DataModel.clearDCRollLog(campaign, checkId);
    if (ui.dcCheckEditor) ui.dcCheckEditor.confirming = null;
    renderDCCheckEditorModal();
    await refresh();
  },

  // --- DC Check Play-mode popup -----------------------------------------
  openDCCheckPlay(checkId) {
    if (ui.dcCheckPlay) (ui.dcCheckPlayStack = ui.dcCheckPlayStack || []).push(ui.dcCheckPlay);   // nested check: closing returns to the outer one
    ui.dcCheckPlay = { checkId, rolledDraft: '', confirmingClearLog: false };
    document.getElementById('dc-check-play-modal').style.display = 'flex';
    renderDCCheckPlayModal();
  },
  closeDCCheckPlay() {
    const parent = ui.dcCheckPlayStack && ui.dcCheckPlayStack.pop();
    if (parent) { ui.dcCheckPlay = parent; renderDCCheckPlayModal(); return; }
    ui.dcCheckPlay = null;
    const modal = document.getElementById('dc-check-play-modal');
    if (modal) modal.style.display = 'none';
  },
  // Live-filters the table only -- never touches the roll log, and never
  // rebuilds the input itself, so nothing here can steal focus mid-type.
  toggleDCPlayPeek(key) {
    const st = ui.dcCheckPlay; if (!st) return;
    st.peek = st.peek || {};
    st.peek[key] = !st.peek[key];
    renderDCCheckPlayTable();
  },
  onDCPlayRolledInput(value) {
    if (!ui.dcCheckPlay) return;
    ui.dcCheckPlay.rolledDraft = value;
    renderDCCheckPlayTable();
  },
  // The only place a value actually gets logged. A full modal re-render
  // afterward is deliberate here, not an oversight: the input needs to
  // visibly clear for the next entry, and the underlying Play-mode text
  // (wherever this check's token is used) needs to pick up the new roll
  // in its own inline resolved-outcome preview.
  async onDCPlayRolledKeydown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const state = ui.dcCheckPlay;
    if (!state) return;
    const num = parseInt(state.rolledDraft, 10);
    if (Number.isNaN(num)) return;
    window.DataModel.appendDCRollLogEntry(campaign, state.checkId, num);
    const rolled = campaign.dcChecks.find((c) => c.id === state.checkId);
    if (rolled) window.Conditions.applyDCRoll(campaign, rolled, num);
    state.rolledDraft = '';
    await refresh();
    renderDCCheckPlayModal();
  },
  startClearDCRollLogPlay(checkId) {
    if (!ui.dcCheckPlay) return;
    ui.dcCheckPlay.confirmingClearLog = true;
    renderDCCheckPlayModal();
  },
  cancelDCPlayConfirm() {
    if (!ui.dcCheckPlay) return;
    ui.dcCheckPlay.confirmingClearLog = false;
    renderDCCheckPlayModal();
  },
  async confirmClearDCRollLogPlayUI(checkId) {
    window.DataModel.clearDCRollLog(campaign, checkId);
    { const ck = campaign.dcChecks.find((c) => c.id === checkId); if (ck) window.Conditions.clearDCResult(campaign, ck); }
    if (ui.dcCheckPlay) ui.dcCheckPlay.confirmingClearLog = false;
    await refresh();
    renderDCCheckPlayModal();
  },

  // Content tab, "Present here" preview: jump to that entity's editor.
  editEntityFromPreview(id) { ui.createTab = 'entities'; ui.createSelectedEntityId = id; ui.mode = 'create'; renderAll(); },
  selectCreateEntity(id) { ui.createSelectedEntityId = id; renderCreateEntities(); },
  // Opens the create form. If an unfinished one is already waiting (the
  // person wandered off to look at another entity), it is picked up again
  // rather than thrown away — only Create or Cancel ends a draft.
  newEntityForm() {
    if (!ui.newEntityDraft || !window.DataModel.isDraftEntity(campaign, ui.newEntityDraft.id)) startNewEntityDraft('npc');
    ui.createSelectedEntityId = 'new';
    renderCreateEntities();
  },

  // Create: the draft becomes a real entity, and the group it was given is
  // remembered as the default for the next one of its type.
  async saveNewEntity() {
    const draft = ui.newEntityDraft;
    const entity = draft && campaign.entities[draft.id];
    if (!entity) return;
    if (!entity.name.trim()) {
      // Everything else on the form is optional; a name isn't.
      const input = document.getElementById('ee-name');
      if (input) {
        input.classList.add('invalid');
        input.focus();
        input.scrollIntoView({ block: 'center' });
        input.addEventListener('input', () => input.classList.remove('invalid'), { once: true });
      }
      return;
    }
    entity.name = entity.name.trim();
    window.DataModel.commitDraftEntity(campaign, draft.id);
    window.DataModel.rememberEntityGroup(campaign, entity.type, entity.groupId);
    ui.newEntityDraft = null;
    ui.createSelectedEntityId = entity.id;
    await refresh();
  },

  // Cancel: the draft, everything made for it, and any image uploaded to it
  // are removed as if it had never been started.
  async cancelNewEntity() {
    const draft = ui.newEntityDraft;
    if (!draft) return;
    const imageFile = window.DataModel.discardDraftEntity(campaign, draft.id, draft.moduleSnapshot);
    if (imageFile) {
      try { await window.core.removeEntityImageFile(imageFile); } catch (err) { console.warn('[new entity] could not remove the draft\'s image file', err); }
    }
    ui.newEntityDraft = null;
    ui.createSelectedEntityId = null;
    await refresh();
  },

  // Changing the type of an unfinished entity changes which icons it can
  // have, and which group is offered by default — unless a group has already
  // been picked by hand, which is left alone.
  async setDraftType(type) {
    const draft = ui.newEntityDraft;
    const entity = draft && campaign.entities[draft.id];
    if (!entity || entity.type === type) return;
    entity.type = type;
    if (type === 'npc') window.CharacterCard.ensureStatblock(entity);
    if (!(window.Constants.ICONS_BY_TYPE[type] || []).includes(entity.icon)) entity.icon = window.Constants.DEFAULT_ICON[type];
    if (!draft.groupTouched) entity.groupId = window.DataModel.getRememberedGroup(campaign, type);
    await refresh();
  },

  // Continuous save for the typed fields specifically (name/summary/
  // notionUrl) — same fix as everywhere else this bug showed up. Icon and
  // color stay on updateEntityField below since those are discrete button
  // clicks, not typing, so an immediate full refresh is exactly right there.
  onEntityFieldInput(id, field, value) {
    const entity = campaign.entities[id];
    if (entity) entity[field] = value;
    if (field === 'name' && entity) {
      const title = document.getElementById('ee-title');
      const isDraft = ui.newEntityDraft && ui.newEntityDraft.id === id;
      if (title) title.textContent = value || (isDraft ? `New ${entity.type === 'location' ? 'location' : entity.type === 'quest' ? 'quest' : 'NPC'}` : '');
    }
    scheduleFieldSave(`entity-${id}-${field}`);
  },
  async updateEntityField(id, field, value) {
    campaign.entities[id][field] = value;
    await refresh();
  },
  async updateEntityGroup(id, groupId) {
    const entity = campaign.entities[id];
    if (entity) entity.groupId = groupId || null;
    if (ui.newEntityDraft && ui.newEntityDraft.id === id) ui.newEntityDraft.groupTouched = true;
    await refresh();
  },
  pickEntitySceneLayout(entityId) {
    window.app.openDirectorPicker((result) => {
      const entity = campaign.entities[entityId];
      if (!entity) return;
      entity.sceneLayout = result;
      refresh();
    });
  },
  async clearEntitySceneLayout(entityId) {
    const entity = campaign.entities[entityId];
    if (entity) delete entity.sceneLayout;
    await refresh();
  },
  // Looks the entity's name up in the artwork default folder. Automatic offers
  // (after typing a name on a new entity) happen once per name and stay silent
  // when nothing matches; the manual button always answers.
  async offerArtwork(entityId, manual) {
    const entity = campaign.entities[entityId];
    if (!entity || !entity.name.trim() || entity.type === 'quest') return;
    if (!manual) {
      const isDraft = ui.newEntityDraft && ui.newEntityDraft.id === entityId;
      if (!isDraft || (entity.image && entity.image.filename) || !appSettings.artworkFolderPath) return;
      if (ui.artworkOffered === entity.id + '|' + entity.name.trim().toLowerCase()) return;
    }
    ui.artworkOffered = entity.id + '|' + entity.name.trim().toLowerCase();
    const res = await window.core.findArtwork(entity.name.trim());
    if (res.noFolder) { if (manual) window.Health.notice('The artwork default folder in Settings is not set or can\'t be found. Set it under Settings → Artwork.'); return; }
    if (!res.matches.length) { if (manual) window.Health.notice(`No artwork matching "${entity.name.trim()}" found in the artwork folder.`); return; }
    ui.artwork = { entityId, matches: res.matches };
    const one = res.matches.length === 1;
    document.getElementById('artwork-modal-title').textContent = one ? 'Artwork found' : `${res.matches.length} artworks found`;
    document.getElementById('artwork-modal-hint').textContent = one
      ? `Use this image for ${entity.name}? You can still crop it.` : `Pick the image to use for ${entity.name}. You can still crop it.`;
    document.getElementById('artwork-modal-grid').innerHTML = res.matches.map((m, i) =>
      `<button class="artwork-card" onclick="window.app.useArtwork(${i})"><img src="${esc(m.url)}" alt=""><span>${esc(m.name)}</span></button>`).join('');
    document.getElementById('artwork-modal').style.display = 'flex';
  },
  closeArtworkModal() {
    ui.artwork = null;
    const m = document.getElementById('artwork-modal');
    if (m) m.style.display = 'none';
  },
  async useArtwork(index) {
    const st = ui.artwork;
    const m = st && st.matches[index];
    if (!m) return;
    const res = await window.core.readArtwork(m.path);
    window.app.closeArtworkModal();
    if (!res || res.error) { window.Health.notice(`Couldn't open that image: ${(res && res.error) || 'unknown error'}`); return; }
    openImageCropModal(st.entityId, res.dataUrl);
  },
  async uploadEntityImageUI(entityId) {
    const result = await window.core.pickImageSource();
    if (!result || result.cancelled) return;
    if (result.error) {
      // Effectively unreachable in practice — the native file picker
      // already filters to image extensions — but surfaced rather than
      // silently ignored on the off chance a file gets through some
      // other way. Matches this app's existing convention for rare IPC
      // failures (see maybeOpenNotion / the Director-tool send handler).
      window.Health.notice(`Couldn't open that image: ${result.error}`);
      return;
    }
    openImageCropModal(entityId, result.dataUrl);
  },
  startImageCropDrag(e) {
    const state = ui.imageCrop;
    if (!state) return;
    state.dragging = { startX: e.clientX, startY: e.clientY, startOffsetX: state.offsetX, startOffsetY: state.offsetY };
    const viewport = document.getElementById('image-crop-viewport');
    if (viewport) viewport.classList.add('dragging');
    e.preventDefault();
  },
  onImageCropZoomInput(value) {
    const state = ui.imageCrop;
    if (!state) return;
    state.zoom = parseFloat(value) || 1;
    // Re-clamp the pan offset: zooming can push a previously-valid
    // offset out of bounds (e.g. zoom back out after panning to an edge
    // at a tighter zoom, where that same offset would now reveal empty
    // space at the new, larger displayed size).
    const displayScale = state.baseScale * state.zoom;
    state.offsetX = window.ImageCrop.clampOffset(state.offsetX, state.naturalWidth * displayScale, state.viewportSize);
    state.offsetY = window.ImageCrop.clampOffset(state.offsetY, state.naturalHeight * displayScale, state.viewportSize);
    applyImageCropTransform();
  },
  closeImageCropModal() {
    ui.imageCrop = null;
    const modal = document.getElementById('image-crop-modal');
    if (modal) modal.style.display = 'none';
  },
  async saveImageCrop() {
    const state = ui.imageCrop;
    const imgEl = document.getElementById('image-crop-img');
    if (!state || !imgEl) return;

    const displayScale = state.baseScale * state.zoom;
    const region = window.ImageCrop.computeCropRegion({
      viewportSize: state.viewportSize, displayScale, offsetX: state.offsetX, offsetY: state.offsetY
    });

    const canvas = document.createElement('canvas');
    canvas.width = IMAGE_CROP_OUTPUT_SIZE;
    canvas.height = IMAGE_CROP_OUTPUT_SIZE;
    canvas.getContext('2d').drawImage(
      imgEl, region.x, region.y, region.size, region.size, 0, 0, IMAGE_CROP_OUTPUT_SIZE, IMAGE_CROP_OUTPUT_SIZE
    );
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);

    const entityId = state.entityId;
    const result = await window.core.saveCroppedEntityImage(entityId, dataUrl);
    if (!result || result.error) {
      window.Health.notice(`Couldn't save that image: ${(result && result.error) || 'unknown error'}`);
      return;
    }
    window.DataModel.setEntityImage(campaign, entityId, result.filename);
    window.app.closeImageCropModal();
    await refresh();
  },
  openNotionImport() {
    ui.notionImport = { step: 'paste' };
    document.getElementById('notion-import-modal').style.display = 'flex';
    renderNotionImportModal();
  },
  closeNotionImport() {
    ui.notionImport = null;
    const modal = document.getElementById('notion-import-modal');
    if (modal) modal.style.display = 'none';
  },
  backToNotionImportPaste() {
    ui.notionImport = { step: 'paste' };
    renderNotionImportModal();
  },
  parseNotionImportPreview() {
    const textEl = document.getElementById('notion-import-paste');
    const cpEl = document.getElementById('notion-import-checkpoint');
    if (!textEl || !cpEl) return;
    const rawText = textEl.value;
    const timeId = cpEl.value;
    if (!rawText.trim()) return;

    const tree = window.NotionImport.parseOutlineText(rawText);
    const classified = window.NotionImport.classifyImportTree(tree);
    if (!classified.location) {
      window.Health.notice('Could not find anything to import in that text.');
      return;
    }
    const plan = window.NotionImport.planImport(campaign, classified, timeId);

    // Pre-seed every conflict's final text with what's already in the
    // campaign — "never overwrite by default" means leaving a conflict
    // untouched should genuinely leave the existing content alone, not
    // silently fall through to Notion's version just because no edit was
    // recorded for it.
    const edits = window.NotionImport.seedConflictEdits(plan);

    ui.notionImport = { step: 'preview', plan, timeId, excluded: new Set(), edits, expandedConflicts: new Set() };
    renderNotionImportModal();
  },
  toggleNotionImportExclude(key) {
    const state = ui.notionImport;
    if (!state) return;
    if (state.excluded.has(key)) state.excluded.delete(key); else state.excluded.add(key);
    renderNotionImportModal();
  },
  toggleNotionImportConflictExpand(key) {
    const state = ui.notionImport;
    if (!state) return;
    if (state.expandedConflicts.has(key)) state.expandedConflicts.delete(key); else state.expandedConflicts.add(key);
    renderNotionImportModal();
  },
  // Deliberately no re-render here: these are onchange fields (fire on
  // blur, not per-keystroke), so there's no focus-loss risk either way,
  // but nothing else on screen depends on the edited value until commit.
  editNotionImportField(key, field, value) {
    const state = ui.notionImport;
    if (!state) return;
    const existing = state.edits.get(key) || {};
    existing[field] = value;
    state.edits.set(key, existing);
  },
  async commitNotionImportUI() {
    const state = ui.notionImport;
    if (!state || state.step !== 'preview') return;
    window.NotionImport.commitImportPlan(
      campaign, state.plan, { timeId: state.timeId, excluded: state.excluded, edits: state.edits },
      window.DataModel, window.Query
    );
    ui.notionImport = null;
    const modal = document.getElementById('notion-import-modal');
    if (modal) modal.style.display = 'none';
    await refresh();
  },
  async removeEntityImageUI(entityId) {
    const entity = campaign.entities[entityId];
    if (!entity || !entity.image) return;
    await window.core.removeEntityImageFile(entity.image.filename);
    window.DataModel.removeEntityImage(campaign, entityId);
    await refresh();
  },
  async setEntityImageSizeUI(entityId, size) {
    window.DataModel.setEntityImageSize(campaign, entityId, size);
    await refresh();
  },
  openImageLightbox(entityId) {
    const entity = campaign.entities[entityId];
    const url = entity && entityImageUrl(entity);
    if (!url) return;
    const modal = document.getElementById('image-lightbox-modal');
    const img = document.getElementById('image-lightbox-img');
    if (!modal || !img) return;
    img.src = url;
    modal.style.display = 'flex';
  },
  closeImageLightbox() {
    const modal = document.getElementById('image-lightbox-modal');
    if (modal) modal.style.display = 'none';
  },
  onLootRowInput(entityId, index, field, value) {
    const entity = campaign.entities[entityId];
    if (!entity) return;
    if (!Array.isArray(entity.lootTable)) entity.lootTable = [];
    if (!entity.lootTable[index]) entity.lootTable[index] = { dc: '', result: '' };
    entity.lootTable[index][field] = value;
    scheduleFieldSave(`loot-${entityId}-${index}-${field}`);
  },
  async addLootRow(entityId) {
    const entity = campaign.entities[entityId];
    if (!entity) return;
    if (!Array.isArray(entity.lootTable)) entity.lootTable = [];
    entity.lootTable.push({ dc: '', result: '' });
    await refresh();
  },
  async deleteLootRow(entityId, index) {
    const entity = campaign.entities[entityId];
    if (!entity || !Array.isArray(entity.lootTable)) return;
    entity.lootTable.splice(index, 1);
    await refresh();
  },
  async handleLootTablePaste(event, entityId) {
    event.preventDefault();
    const entity = campaign.entities[entityId];
    if (!entity) return;
    const parsed = parseLootTableFromClipboard(event.clipboardData);
    if (!parsed || parsed.length === 0) {
      console.warn('[loot table] could not find a recognizable table in the pasted content');
      return;
    }
    entity.lootTable = (entity.lootTable || []).concat(parsed);
    await refresh();
  },
  async addInventoryCategory(entityId) {
    const entity = campaign.entities[entityId];
    if (!entity) return;
    if (!Array.isArray(entity.inventoryCategories)) entity.inventoryCategories = [];
    entity.inventoryCategories.push(window.DataModel.createInventoryCategory());
    await refresh();
  },
  onInventoryCategoryNameInput(entityId, categoryId, value) {
    const entity = campaign.entities[entityId];
    const cat = entity && (entity.inventoryCategories || []).find((c) => c.id === categoryId);
    if (cat) cat.name = value;
    scheduleFieldSave(`inv-cat-name-${entityId}-${categoryId}`);
  },
  async deleteInventoryCategory(entityId, categoryId) {
    const entity = campaign.entities[entityId];
    if (!entity || !Array.isArray(entity.inventoryCategories)) return;
    entity.inventoryCategories = entity.inventoryCategories.filter((c) => c.id !== categoryId);
    await refresh();
  },
  toggleInventoryCategory(entityId, categoryId) {
    const entity = campaign.entities[entityId];
    const cat = entity && (entity.inventoryCategories || []).find((c) => c.id === categoryId);
    if (!cat) return;
    cat.collapsed = !cat.collapsed;
    refresh();
    scheduleFieldSave(`inv-cat-collapse-${entityId}-${categoryId}`);
  },
  // Name and price only — the free-form text columns have their own
  // handler below, since they're keyed by column id rather than a fixed
  // field name.
  onInventoryRowInput(entityId, categoryId, index, field, value) {
    const entity = campaign.entities[entityId];
    const cat = entity && (entity.inventoryCategories || []).find((c) => c.id === categoryId);
    if (!cat || (field !== 'name' && field !== 'price')) return;
    if (!Array.isArray(cat.rows)) cat.rows = [];
    if (!cat.rows[index]) cat.rows[index] = window.DataModel.createInventoryRow();
    cat.rows[index][field] = value;
    scheduleFieldSave(`inv-row-${entityId}-${categoryId}-${index}-${field}`);
  },
  onInventoryCellInput(entityId, categoryId, index, columnId, value) {
    const entity = campaign.entities[entityId];
    const cat = entity && (entity.inventoryCategories || []).find((c) => c.id === categoryId);
    if (!cat) return;
    if (!Array.isArray(cat.rows)) cat.rows = [];
    if (!cat.rows[index]) cat.rows[index] = window.DataModel.createInventoryRow();
    if (!cat.rows[index].cells) cat.rows[index].cells = {};
    cat.rows[index].cells[columnId] = value;
    scheduleFieldSave(`inv-cell-${entityId}-${categoryId}-${index}-${columnId}`);
  },
  // The two fixed columns' headers (nameLabel / priceLabel).
  onInventoryLabelInput(entityId, categoryId, field, value) {
    const entity = campaign.entities[entityId];
    const cat = entity && (entity.inventoryCategories || []).find((c) => c.id === categoryId);
    if (!cat || (field !== 'nameLabel' && field !== 'priceLabel')) return;
    cat[field] = value;
    scheduleFieldSave(`inv-label-${entityId}-${categoryId}-${field}`);
  },
  onInventoryColumnLabelInput(entityId, categoryId, columnId, value) {
    const entity = campaign.entities[entityId];
    const cat = entity && (entity.inventoryCategories || []).find((c) => c.id === categoryId);
    const col = cat && (cat.columns || []).find((c) => c.id === columnId);
    if (!col) return;
    col.label = value;
    scheduleFieldSave(`inv-collabel-${entityId}-${categoryId}-${columnId}`);
  },
  async addInventoryColumn(entityId, categoryId) {
    const entity = campaign.entities[entityId];
    const cat = entity && (entity.inventoryCategories || []).find((c) => c.id === categoryId);
    if (!cat) return;
    window.DataModel.addInventoryColumn(cat, 'Column');
    await refresh();
  },
  // Deleting a column discards its text from every row, so it asks first
  // (in the UI itself, like the app's other deletions — not a native
  // dialog) rather than happening on a single click.
  startDeleteInventoryColumn(entityId, categoryId, columnId) {
    ui.pendingDeleteInventoryColumn = { entityId, categoryId, columnId };
    refresh();
  },
  cancelDeleteInventoryColumn() {
    ui.pendingDeleteInventoryColumn = null;
    refresh();
  },
  async confirmDeleteInventoryColumn() {
    const pending = ui.pendingDeleteInventoryColumn;
    ui.pendingDeleteInventoryColumn = null;
    if (!pending) { await refresh(); return; }
    const entity = campaign.entities[pending.entityId];
    const cat = entity && (entity.inventoryCategories || []).find((c) => c.id === pending.categoryId);
    if (cat) window.DataModel.deleteInventoryColumn(cat, pending.columnId);
    await refresh();
  },
  async addInventoryRow(entityId, categoryId) {
    const entity = campaign.entities[entityId];
    const cat = entity && (entity.inventoryCategories || []).find((c) => c.id === categoryId);
    if (!cat) return;
    if (!Array.isArray(cat.rows)) cat.rows = [];
    cat.rows.push(window.DataModel.createInventoryRow());
    await refresh();
  },
  async deleteInventoryRow(entityId, categoryId, index) {
    const entity = campaign.entities[entityId];
    const cat = entity && (entity.inventoryCategories || []).find((c) => c.id === categoryId);
    if (!cat || !Array.isArray(cat.rows)) return;
    cat.rows.splice(index, 1);
    await refresh();
  },
  async handleInventoryTablePaste(event, entityId, categoryId) {
    event.preventDefault();
    const entity = campaign.entities[entityId];
    const cat = entity && (entity.inventoryCategories || []).find((c) => c.id === categoryId);
    if (!cat) return;
    const parsed = parseInventoryTableFromClipboard(event.clipboardData);
    if (!parsed || parsed.rows.length === 0) {
      console.warn('[inventory table] could not find a recognizable table in the pasted content');
      return;
    }
    window.DataModel.mergeInventoryTableIntoCategory(cat, parsed);
    await refresh();
  },
  openLootTableView() {
    const entity = campaign.entities[ui.curLocation];
    const modal = document.getElementById('loot-table-modal');
    const body = document.getElementById('loot-table-body');
    const title = document.getElementById('loot-table-title');
    if (!modal || !body || !title) return;
    title.textContent = entity ? `Loot table — ${entity.name}` : 'Loot table';
    const rows = entity ? (entity.lootTable || []) : [];
    if (rows.length === 0) {
      body.innerHTML = `<p class="empty-hint">No loot table set for this location.</p>`;
    } else {
      body.innerHTML = `<table class="loot-table-display">
        <thead><tr><th>DC</th><th>Result</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(r.dc)}</td><td>${rich(r.result)}</td></tr>`).join('')}</tbody>
      </table>`;
    }
    modal.style.display = 'flex';
  },
  closeLootTableView() {
    const modal = document.getElementById('loot-table-modal');
    if (modal) modal.style.display = 'none';
  },
  // --- Character card -----------------------------------------------
  openCharacterCard(entityId) {
    const entity = campaign.entities[entityId];
    const modal = document.getElementById('character-card-modal');
    if (!entity || !modal) return;
    ui.cardModalEntityId = entityId;
    document.getElementById('character-card-title').innerHTML = `${entityBadge(entity, 20)} ${esc(entity.name)}`;
    document.getElementById('character-card-body').innerHTML = renderCharacterCardHTML(entity);
    modal.style.display = 'flex';
  },
  closeCharacterCard() {
    const modal = document.getElementById('character-card-modal');
    if (modal) modal.style.display = 'none';
    ui.cardModalEntityId = null;
  },
  editCharacterCard() {
    const id = ui.cardModalEntityId;
    if (!id || !campaign.entities[id]) return;
    window.app.closeCharacterCard();
    ui.mode = 'create'; ui.createTab = 'entities'; ui.createSelectedEntityId = id;
    renderAll();
  },
  toggleCardAbility(row) { const body = row.closest('tbody'); if (body) body.classList.toggle('open'); },
  toggleCardAllSkills(btn) {
    const sb = btn.closest('.cc-statblock');
    if (!sb) return;
    const on = sb.classList.toggle('open-all');
    sb.querySelectorAll('.cc-ab').forEach((el) => el.classList.toggle('open', on));
  },
  onCardTextInput(id, group, field, value) {
    const entity = campaign.entities[id];
    if (!entity) return;
    const CC = window.CharacterCard;
    CC.ensureCard(entity)[group][field] = value;
    // The section header's "n of m filled" follows what you type.
    const fields = group === 'voice' ? CC.VOICE_FIELDS : CC.PERSONA_FIELDS;
    const n = cardFilledCount(entity.characterCard[group], fields);
    const meta = document.querySelector(`#cc-sec-head-${group === 'voice' ? 'voice' : 'persona'} .cc-sec-meta`);
    if (meta) meta.textContent = n ? `${n} of ${fields.length} filled` : 'empty';
    scheduleFieldSave(`cc-${group}-${id}-${field}`);
  },
  toggleCardSection(key) {
    ui.cardSections[key] = !ui.cardSections[key];
    const body = document.getElementById(`cc-sec-${key}`);
    if (body) body.style.display = ui.cardSections[key] ? 'block' : 'none';
    const caret = document.querySelector(`#cc-sec-head-${key} .cc-sec-caret`);
    if (caret) caret.innerHTML = icon(ui.cardSections[key] ? 'chevronDown' : 'chevronRight');
  },
  openStatblockEditor(id) {
    const entity = campaign.entities[id];
    const modal = document.getElementById('statblock-modal');
    if (!entity || !modal) return;
    ui.sbEditorEntityId = id;
    ui.pendingResetStatblock = null;
    document.getElementById('statblock-title').innerHTML = `${entityBadge(entity, 20)} ${esc(entity.name || 'New NPC')} — stat block`;
    document.getElementById('statblock-body').innerHTML = renderStatblockEditorBody(entity);
    modal.style.display = 'flex';
  },
  closeStatblockEditor() {
    const modal = document.getElementById('statblock-modal');
    if (modal) modal.style.display = 'none';
    ui.sbEditorEntityId = null;
    ui.pendingResetStatblock = null;
    // The Create editor's summary line follows whatever was just changed.
    if (ui.mode === 'create' && ui.createTab === 'entities' && document.getElementById('entity-editor')) renderCreateEntities();
  },
  askResetStatblock(id) { ui.pendingResetStatblock = id; redrawStatblockEditor(); },
  cancelResetStatblock() { ui.pendingResetStatblock = null; redrawStatblockEditor(); },
  async resetStatblock(id) {
    const entity = campaign.entities[id];
    ui.pendingResetStatblock = null;
    if (entity) window.CharacterCard.resetStatblock(entity);
    redrawStatblockEditor();
    await persistSafely();
  },
  // Typing in a stat block field: store what was typed, update the live
  // numbers. Out-of-range numbers are corrected when the field is left.
  onStatblockInput(id, field, value) {
    const entity = campaign.entities[id];
    if (!entity || !entity.characterCard || !entity.characterCard.statblock) return;
    const sb = entity.characterCard.statblock;
    if (field === 'passivePerceptionOverride' || field === 'passiveInsightOverride') {
      // Empty = automatic again; otherwise a whole number, 0-99.
      const n = Math.round(Number(value));
      sb[field] = value === '' || !Number.isFinite(n) ? null : Math.max(0, Math.min(99, n));
      refreshCardEditorBits(entity);
      scheduleFieldSave(`cc-sb-${id}-${field}`);
      return;
    }
    const numeric = field === 'ac' || field === 'hp' || field.startsWith('abilities.');
    let v = value;
    if (numeric) { v = Math.round(Number(value)); if (value === '' || !Number.isFinite(v)) return; }
    if (field.startsWith('abilities.')) sb.abilities[field.slice(10)] = v; else sb[field] = v;
    refreshCardEditorBits(entity);
    scheduleFieldSave(`cc-sb-${id}-${field}`);
  },
  onStatblockChange(id, field, el) {
    const entity = campaign.entities[id];
    if (!entity || !entity.characterCard || !entity.characterCard.statblock) return;
    const sb = entity.characterCard.statblock;
    const clean = window.CharacterCard.sanitizeStatblock(sb);
    const key = field.startsWith('abilities.') ? field.slice(10) : null;
    const before = key ? sb.abilities[key] : sb[field];
    const after = key ? clean.abilities[key] : clean[field];
    if (before === after && String(el.value) === String(after)) return; // nothing to correct
    if (key) sb.abilities[key] = after; else sb[field] = after;
    el.value = after;
    refreshCardEditorBits(entity);
    scheduleFieldSave(`cc-sb-${id}-${field}`);
  },
  toggleCardSave(id, key, checked) {
    const entity = campaign.entities[id];
    if (!entity || !entity.characterCard || !entity.characterCard.statblock) return;
    entity.characterCard.statblock.saveProf[key] = !!checked;
    refreshCardEditorBits(entity);
    scheduleFieldSave(`cc-save-${id}-${key}`);
  },
  cycleCardSkill(id, name) {
    const entity = campaign.entities[id];
    if (!entity || !entity.characterCard || !entity.characterCard.statblock) return;
    const skills = entity.characterCard.statblock.skills;
    const next = ((skills[name] || 0) + 1) % 3;
    if (next === 0) delete skills[name]; else skills[name] = next;
    refreshCardEditorBits(entity);
    scheduleFieldSave(`cc-skill-${id}-${name}`);
  },
  openInventoryView(entityId) {
    const entity = campaign.entities[entityId];
    const modal = document.getElementById('inventory-modal');
    const body = document.getElementById('inventory-body');
    const title = document.getElementById('inventory-title');
    if (!modal || !body || !title) return;
    title.textContent = entity ? `Inventory — ${entity.name}` : 'Inventory';
    ui.inventoryModalEntityId = entityId;
    body.innerHTML = `
      <input type="text" id="inventory-search" placeholder="Search by name, effect, or price…" oninput="window.app.filterInventoryView(this.value)" style="margin-bottom:10px">
      <div id="inventory-results"></div>
    `;
    renderInventoryResults(entityId, '');
    modal.style.display = 'flex';
    const searchInput = document.getElementById('inventory-search');
    if (searchInput) searchInput.focus();
  },
  filterInventoryView(query) {
    renderInventoryResults(ui.inventoryModalEntityId, query);
  },
  closeInventoryView() {
    const modal = document.getElementById('inventory-modal');
    if (modal) modal.style.display = 'none';
  },
  openHelp() {
    const body = document.getElementById('help-body');
    const modal = document.getElementById('help-modal');
    if (!body || !modal) return;
    body.innerHTML = renderHelpBody();
    modal.style.display = 'flex';
  },
  closeHelp() {
    const modal = document.getElementById('help-modal');
    if (modal) modal.style.display = 'none';
  },
  openSettings() {
    const body = document.getElementById('settings-body');
    const modal = document.getElementById('settings-modal');
    if (!body || !modal) return;
    body.innerHTML = renderSettingsBody();
    modal.style.display = 'flex';
  },
  closeSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) modal.style.display = 'none';
  },
  async browseSettingsFolder(inputId) {
    const chosen = await window.core.pickFolder();
    if (!chosen) return; // cancelled
    const input = document.getElementById(inputId);
    if (input) input.value = chosen;
  },
  async saveSettingsFromModal() {
    const prepRoot = document.getElementById('settings-prep-root');
    const appFolder = document.getElementById('settings-app-folder');
    const artFolder = document.getElementById('settings-artwork-folder');
    const updated = {
      artworkFolderPath: artFolder ? artFolder.value.trim() : '',
      directorPrepRootPath: prepRoot ? prepRoot.value.trim() : '',
      directorAppFolderPath: appFolder ? appFolder.value.trim() : ''
    };
    appSettings = await window.core.saveSettings(updated);
    window.app.closeSettings();
  },

  // --- Director scene/layout picker (shared by the location entity field
  // and the Alt+S text-field shortcut — see openDirectorPicker below) ---
  async openDirectorPicker(onComplete, mode = 'scene') {
    // mode 'choose' first asks what the button should do (scene / music / quickfire).
    if (!appSettings.directorPrepRootPath && mode !== 'choose') {
      window.Health.notice('Set the session prep folder in Settings first.');
      return;
    }
    ui.directorPicker = { step: mode === 'choose' ? 'kind' : 'session', mode: mode === 'choose' ? 'scene' : mode, kindChosen: mode === 'choose', query: '', visible: [], allScenes: null, loading: true, fire: true, items: null, sessions: [], scenes: [], layouts: [], session: null, scene: null, onComplete };
    document.getElementById('director-picker-modal').style.display = 'flex';
    renderDirectorPickerBody();
    const pk = ui.directorPicker;
    pk.sessions = await window.core.listDirectorSessions();
    pk.loading = false;
    if (ui.directorPicker === pk) { renderDirectorPickerBody(); }
    window.core.listDirectorAllScenes().then((all) => { pk.allScenes = all; if (ui.directorPicker === pk && pk.step === 'session') renderDirectorPickerList(); });
  },
  pickDirectorNotion() {
    const p = ui.directorPicker; if (!p) return;
    p.step = 'notion'; p.parent = null; renderDirectorPickerBody();
  },
  notionPickerInput(v) {
    const l = document.getElementById('director-notion-label');
    if (l && !l.dataset.touched) l.placeholder = `Button text (optional) — default: ${notionTitleOf(v) || 'Notion'}`;
  },
  pickDirectorNotionDone() {
    const p = ui.directorPicker; if (!p) return;
    const url = (document.getElementById('director-notion-url').value || '').trim();
    if (!url) return;
    if (!/^(https?|notion):\/\//i.test(url)) { window.Health.notice('That does not look like a link (it should start with https://).'); return; }
    const label = (document.getElementById('director-notion-label').value || '').trim() || notionTitleOf(url) || 'Notion page';
    window.app.finishDirectorExtra({ kind: 'notion', url, label });
  },
  pickDirectorGroup(step) {
    const p = ui.directorPicker;
    if (!p) return;
    p.parent = step; p.step = step; p.query = '';
    renderDirectorPickerBody();
  },
  async pickDirectorKind(kind) {
    const p = ui.directorPicker;
    if (!p) return;
    if (p.step === 'kind') p.parent = null;
    if (!appSettings.directorPrepRootPath) { window.Health.notice('Set the session prep folder in Settings first.'); return; }
    p.mode = kind; p.query = ''; p.items = null;
    const first = { genre: ['genre', 'listDirectorGenres'], playlist: ['playlist', 'listDirectorPlaylists'], sfx: ['sfxcat', 'listDirectorSfxCategories'] }[kind];
    if (first) {
      p.step = first[0];
      renderDirectorPickerBody();
      const items = await window.core[first[1]]();
      if (ui.directorPicker === p && p.step === first[0]) { p.items = items; renderDirectorPickerBody(); }
      return;
    }
    p.step = 'session';
    renderDirectorPickerBody();
  },
  async pickDirectorGenre(g) {
    const p = ui.directorPicker; if (!p) return;
    p.genre = g; p.step = 'genretrack'; p.query = ''; p.items = null; renderDirectorPickerBody();
    const items = await window.core.listDirectorGenreTracks(g);
    if (ui.directorPicker === p && p.step === 'genretrack') { p.items = items; renderDirectorPickerBody(); }
  },
  async pickDirectorPlaylist(x) {
    const p = ui.directorPicker; if (!p) return;
    p.playlistItem = x; p.step = 'playlisttrack'; p.query = ''; p.items = null; renderDirectorPickerBody();
    const items = await window.core.listDirectorPlaylistTracks({ session: x.session, scene: x.scene, file: x.file });
    if (ui.directorPicker === p && p.step === 'playlisttrack') { p.items = items; renderDirectorPickerBody(); }
  },
  async pickDirectorSfxCat(c) {
    const p = ui.directorPicker; if (!p) return;
    p.sfxCat = c; p.step = 'sfxfile'; p.query = ''; p.items = null; renderDirectorPickerBody();
    const items = await window.core.listDirectorSfxFiles(c);
    if (ui.directorPicker === p && p.step === 'sfxfile') { p.items = items; renderDirectorPickerBody(); }
  },
  finishDirectorExtra(result) {
    const p = ui.directorPicker; if (!p) return;
    const onComplete = p.onComplete;
    window.app.closeDirectorPicker();
    if (onComplete) onComplete(result);
  },
  directorPickerFilter(v) {
    const p = ui.directorPicker;
    if (!p) return;
    p.query = v;
    renderDirectorPickerList();
  },
  directorPickerRow(i) {
    const p = ui.directorPicker;
    const r = p && p.visible && p.visible[i];
    if (r && r.fn) r.fn();
  },
  directorPickerKey(e) {
    const p = ui.directorPicker;
    if (!p) return;
    if (e.key === 'Enter') { e.preventDefault(); window.app.directorPickerRow(0); }
    else if (e.key === 'Escape') { e.preventDefault(); window.app.closeDirectorPicker(); }
    else if (e.key === 'Backspace' && !e.target.value) { e.preventDefault(); window.app.directorPickerBack(); }
  },
  closeDirectorPicker() {
    ui.directorPicker = null;
    const modal = document.getElementById('director-picker-modal');
    if (modal) modal.style.display = 'none';
  },
  async pickDirectorSession(session) {
    const p = ui.directorPicker;
    if (!p) return;
    p.session = session;
    p.step = 'scene'; p.query = ''; p.loading = true;
    p.scenes = [];
    renderDirectorPickerBody();
    p.scenes = await window.core.listDirectorScenes(session);
    p.loading = false;
    if (ui.directorPicker === p && p.step === 'scene') renderDirectorPickerBody();
  },
  async pickDirectorScene(scene) {
    const p = ui.directorPicker;
    if (!p) return;
    p.scene = scene; p.query = '';
    if (p.mode === 'music' || p.mode === 'quickfire' || p.mode === 'scenesfx') {
      p.step = p.mode;
      p.items = null;
      renderDirectorPickerBody();
      const items = p.mode === 'music' ? await window.core.listDirectorMusic(p.session, scene) : p.mode === 'scenesfx' ? await window.core.listDirectorSceneSfx(p.session, scene) : await window.core.listDirectorQuickfire(p.session, scene);
      if (ui.directorPicker !== p || p.step !== p.mode) return;
      p.items = items;
      renderDirectorPickerBody();
      return;
    }
    p.step = 'layout'; p.loading = true;
    p.layouts = [];
    renderDirectorPickerBody();
    p.layouts = await window.core.listDirectorLayouts(p.session, scene);
    p.loading = false;
    if (ui.directorPicker === p && p.step === 'layout') renderDirectorPickerBody();
  },
  async pickDirectorSceneIn(session, scene) {
    const p = ui.directorPicker;
    if (!p) return;
    p.session = session;
    await window.app.pickDirectorScene(scene);
  },
  pickDirectorLayoutIn(session, scene, layout) {
    const p = ui.directorPicker;
    if (!p) return;
    p.session = session; p.scene = scene;
    window.app.pickDirectorLayout(layout);
  },
  pickDirectorCurrent() {
    const p = ui.directorPicker;
    if (!p) return;
    p.session = ''; p.scene = ''; p.query = '';
    p.step = 'manual';
    renderDirectorPickerBody();
  },
  directorPickerFire(on) { if (ui.directorPicker) ui.directorPicker.fire = !!on; },
  pickDirectorItem(i) {
    const p = ui.directorPicker;
    if (!p || !p.items || !p.items[i]) return;
    window.app.finishDirectorPick(p.items[i]);
  },
  pickDirectorManual() {
    const inp = document.getElementById('director-picker-manual');
    if (inp && inp.value.trim()) window.app.finishDirectorPick(inp.value.trim());
  },
  finishDirectorPick(name) {
    const p = ui.directorPicker;
    if (!p) return;
    const result = p.mode === 'music'
      ? { kind: 'music', session: p.session || '', scene: p.scene || '', music: name }
      : p.mode === 'scenesfx'
      ? { kind: 'scenesfx', session: p.session || '', scene: p.scene || '', sfx: name }
      : { kind: 'quickfire', session: p.session || '', scene: p.scene || '', quickfire: name, fire: !!p.fire };
    const onComplete = p.onComplete;
    window.app.closeDirectorPicker();
    if (onComplete) onComplete(result);
  },
  pickDirectorLayout(layout) {
    const p = ui.directorPicker;
    if (!p) return;
    const result = { kind: 'scene', session: p.session, scene: p.scene, layout: layout || '' };
    const onComplete = p.onComplete;
    window.app.closeDirectorPicker();
    if (onComplete) onComplete(result);
  },
  directorPickerBack() {
    const p = ui.directorPicker;
    if (!p) return;
    p.query = '';
    if (p.step === 'genretrack') { p.step = 'genre'; p.items = null; window.core.listDirectorGenres().then((it) => { p.items = it; if (ui.directorPicker === p && p.step === 'genre') renderDirectorPickerBody(); }); }
    else if (p.step === 'playlisttrack') { p.step = 'playlist'; p.items = null; window.core.listDirectorPlaylists().then((it) => { p.items = it; if (ui.directorPicker === p && p.step === 'playlist') renderDirectorPickerBody(); }); }
    else if (p.step === 'sfxfile') { p.step = 'sfxcat'; p.items = null; window.core.listDirectorSfxCategories().then((it) => { p.items = it; if (ui.directorPicker === p && p.step === 'sfxcat') renderDirectorPickerBody(); }); }
    else if (['genre', 'playlist', 'sfxcat'].includes(p.step)) { p.step = p.kindChosen ? (p.parent || 'kind') : p.step; if (p.step === 'kind') p.parent = null; }
    else if (p.step === 'musicsrc' || p.step === 'sfxsrc' || p.step === 'notion') { p.step = 'kind'; p.parent = null; }
    else if (p.step === 'layout' || p.step === 'music' || p.step === 'quickfire' || p.step === 'scenesfx') { p.step = 'scene'; }
    else if (p.step === 'manual') { p.step = 'session'; p.session = null; p.scene = null; }
    else if (p.step === 'scene') { p.step = 'session'; p.session = null; }
    else if (p.step === 'session' && p.kindChosen) { p.step = p.parent && (p.mode === 'music' || p.mode === 'scenesfx') ? p.parent : 'kind'; if (p.step === 'kind') p.parent = null; }
    renderDirectorPickerBody();
  },

  onEntitySearchInput(value) {
    ui.entitySearchQuery = value;
    renderEntityListOnly();
  },
  toggleGroupManager() {
    ui.groupManagerOpen = !ui.groupManagerOpen;
    if (ui.groupManagerOpen) ui.bulkAddOpen = false;
    ui.mgSelected = [];
    ui.mgAnchor = null;
    renderCreateEntities();
  },
  toggleGroupCollapsed(groupId) {
    if (!Array.isArray(campaign.meta.collapsedGroupIds)) campaign.meta.collapsedGroupIds = [];
    const ids = campaign.meta.collapsedGroupIds;
    const idx = ids.indexOf(groupId);
    if (idx === -1) ids.push(groupId); else ids.splice(idx, 1);
    renderEntityListOnly();
    scheduleFieldSave(`group-collapse-${groupId}`);
  },
  toggleBulkAdd() {
    ui.bulkAddOpen = !ui.bulkAddOpen;
    if (ui.bulkAddOpen) ui.groupManagerOpen = false;
    renderCreateEntities();
  },
  // Always creates a top-level group: where it sits afterwards is a matter of
  // dragging it (or use the + on an existing group to add one inside it).
  async confirmNewEntityGroup() {
    const input = document.getElementById('new-group-name');
    const name = input ? input.value.trim() : '';
    if (!name) return;
    window.DataModel.createEntityGroup(campaign, { name, parentId: null });
    await refresh();
  },
  async addSubgroup(parentId) {
    const group = window.DataModel.createEntityGroup(campaign, { name: 'New group', parentId });
    mgExpand(parentId);
    await persistSafely();
    renderManageList();
    // Ready to type the real name straight away.
    const input = document.querySelector(`#mg-root .mg-header[data-group-id="${group.id}"] .mg-name`);
    if (input) { input.focus(); input.select(); input.scrollIntoView({ block: 'nearest' }); }
  },
  clearManageSelection() {
    ui.mgSelected = [];
    ui.mgAnchor = null;
    mgSyncSelectionUI();
  },
  toggleSelectMode() {
    ui.entitySelectMode = !ui.entitySelectMode;
    if (!ui.entitySelectMode) ui.selectedEntityIds = [];
    ui.groupManagerOpen = false;
    ui.bulkAddOpen = false;
    renderCreateEntities();
  },
  toggleEntitySelected(id) {
    const idx = ui.selectedEntityIds.indexOf(id);
    if (idx === -1) ui.selectedEntityIds.push(id); else ui.selectedEntityIds.splice(idx, 1);
    renderCreateEntities();
  },
  selectAllVisibleEntities() {
    const query = (ui.entitySearchQuery || '').toLowerCase();
    const allList = Object.values(campaign.entities);
    const visible = query
      ? allList.filter((e) => e.name.toLowerCase().includes(query) || (e.summary || '').toLowerCase().includes(query))
      : allList;
    ui.selectedEntityIds = visible.map((e) => e.id);
    renderCreateEntities();
  },
  clearEntitySelection() {
    ui.selectedEntityIds = [];
    renderCreateEntities();
  },
  async confirmBulkAssignGroup() {
    const sel = document.getElementById('bulk-assign-group');
    const groupId = sel && sel.value ? sel.value : null;
    window.DataModel.assignEntitiesToGroup(campaign, ui.selectedEntityIds, groupId);
    ui.selectedEntityIds = [];
    await refresh();
  },
  onEntityGroupNameInput(groupId, value) {
    const group = (campaign.entityGroups || []).find((g) => g.id === groupId);
    if (group) group.name = value;
    scheduleFieldSave(`group-${groupId}`);
    // In manage mode the name being typed is itself part of the list, so
    // redrawing the list here would pull it out from under the cursor.
    if (!ui.groupManagerOpen) renderEntityListOnly();
  },
  startDeleteEntityGroup(groupId) {
    ui.confirmDeleteGroupId = groupId;
    renderCreateEntities();
  },
  cancelDeleteEntityGroup() {
    ui.confirmDeleteGroupId = null;
    renderCreateEntities();
  },
  async confirmDeleteEntityGroup(groupId) {
    window.DataModel.deleteEntityGroup(campaign, groupId);
    ui.confirmDeleteGroupId = null;
    await refresh();
  },
  async confirmBulkAdd() {
    const typeSel = document.getElementById('bulk-add-type');
    const groupSel = document.getElementById('bulk-add-group');
    const namesInput = document.getElementById('bulk-add-names');
    const type = typeSel ? typeSel.value : 'npc';
    const groupId = groupSel && groupSel.value ? groupSel.value : null;
    const namesText = namesInput ? namesInput.value : '';
    if (!namesText.trim()) return;
    window.DataModel.createEntitiesBulk(campaign, { type, namesText, groupId });
    window.DataModel.rememberEntityGroup(campaign, type, groupId);
    ui.bulkAddOpen = false;
    await refresh();
  },
  // The group offered follows the type: NPCs and locations each remember
  // their own.
  onBulkAddTypeChange(type) {
    ui.bulkAddType = type;
    const sel = document.getElementById('bulk-add-group');
    if (sel) sel.value = window.DataModel.getRememberedGroup(campaign, type) || '';
  },

  async deleteEntity(id) {
    if (window.Quests && window.Quests.isQuest(campaign.entities[id])) window.Quests.releaseQuest(campaign, id);
    delete campaign.entities[id];
    campaign.blocks = campaign.blocks.filter((b) => b.entityId !== id && b.locationId !== id);
    // Only the assignment is removed, not the module itself — a deleted
    // entity's content becomes unassigned rather than vanishing outright,
    // matching Modular Content's own "content can exist independently of
    // where it's placed" design (it would show up as unassigned in the
    // future manager, not be lost).
    campaign.assignments = campaign.assignments.filter((a) => a.entityId !== id);
    if (ui.createSelectedEntityId === id) ui.createSelectedEntityId = null;
    if (ui.curLocation === id) ui.curLocation = locations()[0] ? locations()[0].id : null;
    await refresh();
  },

  addGeneralNote(entityId) {
    const module = window.DataModel.createContentModule(campaign, { type: 'note', name: '', text: '' });
    window.DataModel.createAssignment(campaign, { moduleId: module.id, entityId, timeId: null });
    refresh();
  },
  addTimeNote(entityId) {
    const timeId = document.getElementById('new-note-time').value;
    const module = window.DataModel.createContentModule(campaign, { type: 'note', name: '', text: '' });
    window.DataModel.createAssignment(campaign, { moduleId: module.id, entityId, timeId });
    refresh();
  },
  // Continuous save — same fix as the arrival text and scene fields got
  // earlier. onchange (blur-triggered) was the root cause of pasted text
  // "disappearing": handlePaste inserts text and dispatches a synthetic
  // 'input' event, which onchange never listens for, so the underlying
  // campaign data was never actually updated — the next re-render then
  // rebuilt the field from the (unchanged) old data, wiping the paste.
  onNoteTextInput(moduleId, value) {
    const module = campaign.contentModules.find((m) => m.id === moduleId);
    if (module) module.text = value;
    scheduleFieldSave(`note-${moduleId}`);
  },

  addTopic(entityId) {
    const module = window.DataModel.createContentModule(campaign, { type: 'topic', name: 'New topic', text: '' });
    window.DataModel.createAssignment(campaign, { moduleId: module.id, entityId, timeId: null });
    refresh();
  },
  onTopicLabelInput(moduleId, value) {
    const module = campaign.contentModules.find((m) => m.id === moduleId);
    if (module) module.name = value;
    scheduleFieldSave(`topic-label-${moduleId}`);
  },
  onTopicTextInput(moduleId, value) {
    const module = campaign.contentModules.find((m) => m.id === moduleId);
    if (module) module.text = value;
    scheduleFieldSave(`topic-text-${moduleId}`);
  },
  async updateTopicTimeId(assignmentId, value) {
    window.DataModel.updateAssignmentTimeId(campaign, assignmentId, value || null);
    await refresh();
  },
  async updateNoteTimeId(assignmentId, value) {
    window.DataModel.updateAssignmentTimeId(campaign, assignmentId, value || null);
    await refresh();
  },
  // Shared by notes, topics, beats, and scenes — one reorder function
  // for every assignable content type, since order always lives on the
  // assignment now regardless of what it's assigning.
  moveAssignmentUI(assignmentId, direction) {
    window.DataModel.moveAssignment(campaign, assignmentId, direction);
    refresh();
  },
  async deleteBlock(blockId) {
    campaign.blocks = campaign.blocks.filter((b) => b.id !== blockId);
    await refresh();
  },
  // Deletes the module entirely (cascading to every assignment of it),
  // not just one placement — matches the pre-Modular-Content behavior
  // exactly, since every module created through this editor still only
  // ever has the one assignment the editor itself created. Multi-place
  // "unassign from just here, keep it assigned elsewhere" is the future
  // Modular Content manager's job, not this editor's.
  async deleteContentModuleUI(moduleId) {
    window.DataModel.deleteContentModule(campaign, moduleId);
    await refresh();
  },

  addCheckpointPrompt() {
    ui.addingCheckpoint = true;
    renderCreateContent();
    const input = document.getElementById('new-cp-label');
    if (input) input.focus();
  },
  cancelNewCheckpoint() {
    ui.addingCheckpoint = false;
    renderCreateContent();
  },
  async confirmNewCheckpoint() {
    const input = document.getElementById('new-cp-label');
    const label = input ? input.value.trim() : '';
    if (!label) return;
    const cp = window.DataModel.createCheckpoint(campaign, { label });
    ui.createContentTimeId = cp.id;
    ui.addingCheckpoint = false;
    await refresh();
  },
  toggleCheckpointManager() {
    ui.checkpointManagerOpen = !ui.checkpointManagerOpen;
    renderCreateContent();
  },
  async moveCheckpointUI(checkpointId, direction) {
    window.DataModel.moveCheckpoint(campaign, checkpointId, direction);
    await refresh();
  },
  onCheckpointLabelInput(checkpointId, value) {
    const cp = campaign.checkpoints.find((c) => c.id === checkpointId);
    if (cp) cp.label = value;
    scheduleFieldSave(`checkpoint-${checkpointId}`);
  },

  async saveArrivalText() {
    // Kept for any other callers; flushes immediately rather than debouncing.
    const textarea = document.getElementById('arr-text');
    if (textarea) window.app.onArrivalTextInput(textarea.value);
    await persistSafely();
    renderContentEditor();
  },

  onArrivalTextInput(value) {
    const arrival = ensureArrivalExists(ui.createContentLocationId, ui.createContentTimeId);
    const existingAsg = campaign.assignments.find((a) => {
      const m = campaign.contentModules.find((mm) => mm.id === a.moduleId);
      return m && m.type === 'description' && a.entityId === arrival.locationId && a.timeId === arrival.timeId;
    });
    if (existingAsg) {
      const module = campaign.contentModules.find((m) => m.id === existingAsg.moduleId);
      module.html = value;
    } else if (value.trim()) {
      // Only creates a module once there's actually something to save —
      // same rule migrateToModularContent itself uses (an empty arrival
      // never manufactures a description).
      const module = window.DataModel.createContentModule(campaign, { type: 'description', name: '', html: value });
      window.DataModel.createAssignment(campaign, { moduleId: module.id, entityId: arrival.locationId, timeId: arrival.timeId });
    }
    if (arrivalSaveTimer) clearTimeout(arrivalSaveTimer);
    arrivalSaveTimer = setTimeout(() => { persistSafely(); }, 500);
  },

  refreshContentEditor() { renderContentEditor(); },

  insertMentionToken() {
    const picker = document.getElementById('arr-mention-picker');
    const id = picker.value;
    if (!id) return;
    const textarea = document.getElementById('arr-text');
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const token = `[[${id}]]`;
    textarea.value = textarea.value.slice(0, start) + token + textarea.value.slice(end);
    textarea.focus();
    textarea.selectionStart = textarea.selectionEnd = start + token.length;
    picker.value = '';
    window.app.onArrivalTextInput(textarea.value);
  },

  togglePresence(entityId, checked) {
    const arrival = ensureArrivalExists(ui.createContentLocationId, ui.createContentTimeId);
    if (checked && !arrival.presence.includes(entityId)) arrival.presence.push(entityId);
    if (!checked) arrival.presence = arrival.presence.filter((x) => x !== entityId);
    // Re-renders only the picker's list and preview (never the whole
    // editor, which would rebuild the search box and description text
    // mid-edit); the list's scroll position is carried across. The list
    // does need to refresh now — the preview, the "added" counts on
    // collapsed groups, and an "Added here" filter all depend on this.
    renderPresencePickerBody();
    scheduleFieldSave(`presence-${arrival.id}`);
  },
  togglePresenceOpen() {
    ui.presenceOpen = !ui.presenceOpen;
    const box = document.getElementById('presence-picker');
    if (box) box.style.display = ui.presenceOpen ? 'block' : 'none';
    const header = document.getElementById('presence-header');
    if (header) header.innerHTML = presenceHeaderHTML();
  },
  // Click = just this one, Ctrl/Cmd+click = add or remove one, Shift+click =
  // everything between the last clicked row and this one (as it is shown).
  onPresenceRowClick(e, id) {
    const st = presencePickerState();
    const additive = e.ctrlKey || e.metaKey;
    if (e.shiftKey) {
      const order = Array.from(document.querySelectorAll('#presence-list .presence-row')).map((el) => el.dataset.entityId);
      const anchor = st.anchor && order.includes(st.anchor) ? st.anchor : (st.selected.find((x) => order.includes(x)) || id);
      const a = order.indexOf(anchor);
      const b = order.indexOf(id);
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      st.selected = additive ? Array.from(new Set([...st.selected, ...range])) : range;
      st.anchor = anchor;
      if (window.getSelection) window.getSelection().removeAllRanges();
    } else if (additive) {
      st.selected = st.selected.includes(id) ? st.selected.filter((x) => x !== id) : [...st.selected, id];
      st.anchor = id;
    } else {
      st.selected = st.selected.length === 1 && st.selected[0] === id ? [] : [id];
      st.anchor = id;
    }
    syncPresenceSelection();
  },
  addPresenceSelected() {
    const st = presencePickerState();
    const arrival = ensureArrivalExists(ui.createContentLocationId, ui.createContentTimeId);
    st.selected.forEach((id) => { if (!arrival.presence.includes(id)) arrival.presence.push(id); });
    st.selected = [];
    renderPresencePickerBody();
    scheduleFieldSave(`presence-${arrival.id}`);
  },
  removePresenceSelected() {
    const st = presencePickerState();
    const arrival = ensureArrivalExists(ui.createContentLocationId, ui.createContentTimeId);
    const drop = new Set(st.selected);
    arrival.presence = arrival.presence.filter((id) => !drop.has(id));
    st.selected = [];
    renderPresencePickerBody();
    scheduleFieldSave(`presence-${arrival.id}`);
  },
  clearPresenceSelection() {
    const st = presencePickerState();
    st.selected = [];
    st.anchor = null;
    syncPresenceSelection();
  },
  onPresenceSearchInput(value) {
    presencePickerState().query = value;
    renderPresencePickerBody();
  },
  setPresenceTypeFilter(value) { presencePickerState().type = value; renderPresencePickerBody(); },
  setPresenceGroupFilter(value) { presencePickerState().groupId = value; renderPresencePickerBody(); },
  setPresenceStatusFilter(value) { presencePickerState().status = value; renderPresencePickerBody(); },
  togglePresenceGroupCollapsed(key) {
    if (!Array.isArray(campaign.meta.collapsedPresenceGroups)) campaign.meta.collapsedPresenceGroups = [];
    const ids = campaign.meta.collapsedPresenceGroups;
    const idx = ids.indexOf(key);
    if (idx === -1) ids.push(key); else ids.splice(idx, 1);
    renderPresencePickerBody();
    scheduleFieldSave(`presence-group-collapse-${key}`);
  },
  expandAllPresenceGroups() {
    campaign.meta.collapsedPresenceGroups = [];
    renderPresencePickerBody();
    scheduleFieldSave('presence-group-collapse-all');
  },
  collapseAllPresenceGroups() {
    campaign.meta.collapsedPresenceGroups = [...(campaign.entityGroups || []).map((g) => g.id), '__ungrouped__'];
    renderPresencePickerBody();
    scheduleFieldSave('presence-group-collapse-all');
  },

  async addBeatToArrival() {
    const arrival = ensureArrivalExists(ui.createContentLocationId, ui.createContentTimeId);
    const module = window.DataModel.createContentModule(campaign, { type: 'beat', name: 'New section', text: '' });
    window.DataModel.createAssignment(campaign, { moduleId: module.id, entityId: arrival.locationId, timeId: arrival.timeId });
    await refresh();
  },
  onBeatFieldInput(moduleId, field, value) {
    const module = campaign.contentModules.find((m) => m.id === moduleId);
    if (module) module[field] = value;
    scheduleFieldSave(`beat-${moduleId}-${field}`);
  },

  async addScene() {
    ensureArrivalExists(ui.createContentLocationId, ui.createContentTimeId);
    const module = window.DataModel.createContentModule(campaign, { type: 'scene', name: 'New scene', lines: [] });
    window.DataModel.createAssignment(campaign, { moduleId: module.id, entityId: ui.createContentLocationId, timeId: ui.createContentTimeId });
    await refresh();
  },
  // Continuous save (in-memory update on every keystroke, debounced disk
  // write) rather than onchange/blur — same fix as the arrival-text field
  // got earlier, so nothing here can be lost by clicking straight from one
  // field to a button without blurring first.
  onSceneLabelInput(moduleId, value) {
    const module = campaign.contentModules.find((m) => m.id === moduleId);
    if (module) module.name = value;
    scheduleFieldSave(`scene-label-${moduleId}`);
  },
  onSceneLineTextInput(moduleId, lineId, value) {
    const module = campaign.contentModules.find((m) => m.id === moduleId);
    const line = module && module.lines.find((l) => l.id === lineId);
    if (line) line.text = value;
    scheduleFieldSave(`scene-line-${lineId}`);
  },
  async updateSceneLineSpeaker(moduleId, lineId, value) {
    const module = campaign.contentModules.find((m) => m.id === moduleId);
    const line = module && module.lines.find((l) => l.id === lineId);
    if (line) line.speakerId = value || null;
    await refresh();
  },
  async deleteSceneLine(moduleId, lineId) {
    const module = campaign.contentModules.find((m) => m.id === moduleId);
    if (module) module.lines = module.lines.filter((l) => l.id !== lineId);
    await refresh();
  },
  async moveSceneLine(moduleId, lineId, direction) {
    const module = campaign.contentModules.find((m) => m.id === moduleId);
    if (!module) return;
    const idx = module.lines.findIndex((l) => l.id === lineId);
    const newIdx = idx + direction;
    if (idx === -1 || newIdx < 0 || newIdx >= module.lines.length) return;
    const [item] = module.lines.splice(idx, 1);
    module.lines.splice(newIdx, 0, item);
    await refresh();
  },
  // Typing "" at the start of the quick-add field is a shortcut straight to
  // the speaker picker — the practical, reliable equivalent of the original
  // Notion-style shortcut idea, without needing a full rich-text editor to
  // support genuine inline transformation of flowing text.
  handleSceneQuickAddInput(inputEl) {
    if (inputEl.value === '""' || inputEl.value === '“”') {
      inputEl.value = '';
      const moduleId = inputEl.id.replace('scene-quickadd-', '');
      const sel = document.getElementById(`scene-speaker-${moduleId}`);
      if (sel) sel.focus();
    }
  },
  handleSceneQuickAddKey(event, moduleId) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    window.app.commitSceneQuickAdd(moduleId);
  },
  // Shared by both the Enter-key shortcut and the explicit + button, so
  // there's always a visible, unambiguous way to add a line, not just a
  // keyboard shortcut someone has to discover on their own.
  async commitSceneQuickAdd(moduleId) {
    const input = document.getElementById(`scene-quickadd-${moduleId}`);
    const text = input ? input.value.trim() : '';
    if (!text) return;
    const sel = document.getElementById(`scene-speaker-${moduleId}`);
    const speakerId = sel && sel.value ? sel.value : null;
    const module = campaign.contentModules.find((m) => m.id === moduleId);
    if (!module) return;
    if (!Array.isArray(module.lines)) module.lines = [];
    window.DataModel.addSceneLine(module, { speakerId, text });
    ui.lastSceneSpeaker = speakerId;
    await refresh();
    const freshInput = document.getElementById(`scene-quickadd-${moduleId}`);
    if (freshInput) freshInput.focus();
  }
};

// --- Transfer to other campaign ---------------------------------------------
//
// A floating window: pick NPCs/locations (grouped, filterable, Ctrl/Shift
// multi-select), "Add" them to a collected list where each entity can leave
// out kinds of content, choose one or more target campaigns, and press
// Transfer. The engine lives in src/transfer.js, the disk work in main.js.

function trState() { return ui.transfer; }

function trFreshState() {
  return { query: '', type: '', groupId: '', selected: [], anchor: null, entries: [], targetIds: [], targets: null,
    targetsOpen: false, dups: {}, result: null, running: false, error: '' };
}

function trEntryIds() { return trState().entries.map((e) => e.id); }

function trVisibleList() {
  const st = trState();
  return window.Query.filterPresenceCandidates(campaign, Object.values(campaign.entities), [], { query: st.query, type: st.type, groupId: st.groupId, status: 'all' });
}

function trRowHTML(e, depth) {
  const st = trState();
  const indent = Math.min(depth || 0, 4) * 16;
  const added = trEntryIds().includes(e.id);
  const selected = st.selected.includes(e.id);
  return `<div class="entity-row presence-row tr-row ${selected ? 'selected' : ''} ${added ? 'tr-added' : ''}" data-entity-id="${e.id}" style="margin-left:${indent}px" onclick="window.app.trRowClick(event,'${e.id}')">
    ${entityBadge(e, 20)}
    <span class="name">${esc(e.name)}</span>
    ${added ? '<span class="presence-added-count">· collected</span>' : ''}
    <span class="type-tag">${e.type}</span>
  </div>`;
}

function trListHTML() {
  const st = trState();
  const list = trVisibleList();
  const filtering = !!(st.query.trim() || st.type || st.groupId);
  const groups = (campaign.entityGroups || []).slice().sort((a, b) => a.order - b.order);
  const validGroupIds = new Set(groups.map((g) => g.id));
  const opts = { collapsedKey: 'collapsedTransferGroups', toggleFn: 'trToggleGroup', staticWhenSearching: true, renderRow: trRowHTML };
  let rows = '';
  groups.filter((g) => !g.parentId).forEach((g) => { rows += renderGroupNodeHTML(g, groups, list, 0, filtering, opts); });
  const ungrouped = list.filter((e) => !e.groupId || !validGroupIds.has(e.groupId));
  if (ungrouped.length) {
    if (groups.length) {
      const collapsed = !filtering && (campaign.meta.collapsedTransferGroups || []).includes('__ungrouped__');
      rows += `<div class="section-label group-header"${filtering ? '' : ` onclick="window.app.trToggleGroup('__ungrouped__')"`}>${filtering ? '' : icon(collapsed ? 'chevronRight' : 'chevronDown')} Ungrouped (${ungrouped.length})</div>`;
      if (!collapsed) rows += ungrouped.map((e) => trRowHTML(e, 1)).join('');
    } else rows += ungrouped.map((e) => trRowHTML(e, 0)).join('');
  }
  return rows || '<div class="hint">Nothing matches.</div>';
}

function trPickBarHTML() {
  const st = trState();
  const have = new Set(trEntryIds());
  const n = st.selected.filter((id) => !have.has(id)).length;
  return `<span class="hint" style="margin:0">${st.selected.length} selected</span><span style="flex:1"></span>
    <button class="icon-btn" id="tr-add-btn" ${n ? '' : 'disabled'} onclick="window.app.trAddSelected()">${icon('plus')} Add${n ? ` (${n})` : ''}</button>
    <button class="icon-btn" ${st.selected.length ? '' : 'disabled'} onclick="window.app.trClearSelection()">Clear</button>`;
}

function trPickerHTML() {
  const st = trState();
  const groups = (campaign.entityGroups || []).map((g) => ({ id: g.id, path: window.Query.getGroupPathName(campaign, g.id) })).sort((a, b) => a.path.localeCompare(b.path));
  return `<div class="section-label">1 · Pick NPCs and locations</div>
    <input type="text" id="tr-search" style="width:100%" placeholder="Search by name, type or group…" value="${esc(st.query)}" oninput="window.app.trSearch(this.value)">
    <div class="inline" style="flex-wrap:wrap;margin:6px 0">
      <select onchange="window.app.trSetType(this.value)">
        <option value="">All types</option>
        <option value="npc" ${st.type === 'npc' ? 'selected' : ''}>NPCs</option>
        <option value="location" ${st.type === 'location' ? 'selected' : ''}>Locations</option>
      </select>
      <select onchange="window.app.trSetGroup(this.value)">
        <option value="">All groups</option>
        <option value="__none__" ${st.groupId === '__none__' ? 'selected' : ''}>No group</option>
        ${groups.map((g) => `<option value="${g.id}" ${st.groupId === g.id ? 'selected' : ''}>${esc(g.path)}</option>`).join('')}
      </select>
      <button class="icon-btn" onclick="window.app.trSelectAllVisible()">Select all shown</button>
    </div>
    <div class="hint">Click to select · Ctrl-click adds or removes one · Shift-click selects a range.</div>
    <div class="presence-selection-bar inline" id="tr-pick-bar">${trPickBarHTML()}</div>
    <div class="presence-list tr-list" id="tr-list">${trListHTML()}</div>`;
}

function trExcludeBoxesHTML(entry) {
  const counts = window.Transfer.describeContent(campaign, entry.id);
  const boxes = window.Transfer.CONTENT_TYPES.filter((t) => counts[t.key]).map((t) => `
    <label class="tr-ex"><input type="checkbox" ${entry.exclude[t.key] ? 'checked' : ''} onchange="window.app.trToggleExclude('${entry.id}','${t.key}',this.checked)"> ${t.label}${counts[t.key] > 1 ? ` (${counts[t.key]})` : ''}</label>`).join('');
  return boxes ? `<div class="tr-excludes"><span class="hint" style="margin:0">Exclude:</span> ${boxes}</div>`
    : '<div class="hint" style="margin:0">Nothing but the basics to copy.</div>';
}

function trCuratedHTML() {
  const st = trState();
  let html = `<div class="section-label">2 · Collected for transfer (${st.entries.length})</div>`;
  if (!st.entries.length) return html + '<div class="hint">Nothing yet — select entities above and press Add.</div>';
  html += '<div class="tr-collected">' + st.entries.map((entry) => {
    const e = campaign.entities[entry.id];
    if (!e) return '';
    const path = e.groupId ? window.Query.getGroupPathName(campaign, e.groupId) : '';
    return `<div class="tr-entry">
      <div class="inline" style="gap:8px">${entityBadge(e, 20)}<strong style="flex:1">${esc(e.name)}</strong>
        <span class="type-tag">${e.type}${path ? ` · ${esc(path)}` : ''}</span>
        <button class="mini-btn" title="Remove from the list" onclick="window.app.trRemove('${e.id}')">✕</button></div>
      ${trExcludeBoxesHTML(entry)}
    </div>`;
  }).join('') + '</div>';
  const missing = window.Transfer.findMissingDependencies(campaign, st.entries);
  if (missing.length) {
    html += `<div class="tr-warn"><strong>${missing.length} linked ${missing.length === 1 ? 'entity is' : 'entities are'} not in the list.</strong>
      Without ${missing.length === 1 ? 'it' : 'them'}, mentions, jump links, speakers and present-here entries pointing there turn into plain text or are left out.
      <div class="tr-deps">${missing.map((d) => `<div class="inline" style="gap:6px"><span class="name" style="flex:1">${esc(d.name)} <span class="type-tag">${d.type} · used by ${esc(d.neededBy.join(', '))}</span></span>
        <button class="mini-btn" onclick="window.app.trAddDependency('${d.id}')">${icon('plus')}</button></div>`).join('')}</div>
      <button class="icon-btn" onclick="window.app.trAddAllDependencies()">${icon('plus')} Add all dependencies (and theirs)</button></div>`;
  }
  return html;
}

function trTargetNames() {
  const st = trState();
  return (st.targets || []).filter((t) => st.targetIds.includes(t.id)).map((t) => t.name);
}

function trHeaderHTML() {
  const st = trState();
  const names = trTargetNames();
  return `<div class="section-label">Target campaigns</div>
    <div class="inline">
      <button class="icon-btn" onclick="window.app.trOpenTargets()">${icon('chevronRight')} ${names.length ? 'Change campaigns' : 'Choose campaigns'}</button>
      <span class="hint" style="margin:0">${names.length ? esc(names.join(', ')) : (st.targets && !st.targets.length ? 'There is no other campaign yet.' : 'None chosen yet.')}</span>
    </div>`;
}

function trFooterHTML() {
  const st = trState();
  if (st.result) return `<span style="flex:1"></span><button class="icon-btn" onclick="window.app.closeTransfer()">Close</button>`;
  const dupNames = Array.from(new Set(Object.values(st.dups).flat()));
  const ready = st.entries.length > 0 && st.targetIds.length > 0 && !st.running;
  return `${st.error ? `<div class="confirm-row" style="color:var(--danger,#e66)">${esc(st.error)}</div>` : ''}
    ${dupNames.length ? `<div class="confirm-row hint">Already in a target (will be merged, not duplicated): ${esc(dupNames.join(', '))}.</div>` : ''}
    <button class="icon-btn tr-go" id="tr-go-btn" ${ready ? '' : 'disabled'} onclick="window.app.trRun()">${st.running ? 'Transferring…' : `Transfer ${st.entries.length || ''} ${st.entries.length === 1 ? 'entity' : 'entities'} to ${st.targetIds.length || ''} ${st.targetIds.length === 1 ? 'campaign' : 'campaigns'}`}</button>`;
}

function trResultHTML() {
  const rows = trState().result.map((r) => {
    if (!r.ok) return `<div class="tr-entry"><strong>${esc(r.name)}</strong> — <span style="color:var(--danger,#e66)">failed: ${esc(r.error || 'unknown error')}</span></div>`;
    const p = r.report;
    const bits = [`${p.entities} new ${p.entities === 1 ? 'entity' : 'entities'}`];
    if (p.merged) bits.push(`${p.merged} merged into existing`);
    bits.push(`${p.modules} new content item${p.modules === 1 ? '' : 's'}`);
    if (p.skippedContent) bits.push(`${p.skippedContent} already there`);
    if (p.presenceLists) bits.push(`${p.presenceLists} present-here list${p.presenceLists === 1 ? '' : 's'}`);
    if (p.dcChecks) bits.push(`${p.dcChecks} DC check${p.dcChecks === 1 ? '' : 's'}`);
    const extra = [];
    if (p.groupsCreated.length) extra.push(`New groups: ${esc(p.groupsCreated.join(', '))}`);
    if (p.checkpointsCreated.length) extra.push(`New checkpoints: ${esc(p.checkpointsCreated.join(', '))}`);
    p.warnings.forEach((w) => extra.push(esc(w)));
    return `<div class="tr-entry"><strong>${esc(r.name)}</strong> — copied ${bits.join(', ')}.${extra.map((x) => `<div class="hint">${x}</div>`).join('')}</div>`;
  }).join('');
  return `<div class="section-label">Transfer finished</div>${rows}
    <div class="hint">A backup of each target campaign was made first. This campaign was not changed.</div>`;
}

function trTargetsModalHTML() {
  const st = trState();
  const list = st.targets || [];
  return `<div class="modal-panel" onclick="event.stopPropagation()">
    <div class="modal-head"><span>Choose target campaigns</span><button class="mini-btn" onclick="window.app.trCloseTargets()">✕</button></div>
    ${list.length ? list.map((t) => `<label class="entity-row tr-target"><input type="checkbox" ${st.targetIds.includes(t.id) ? 'checked' : ''} onchange="window.app.trToggleTarget('${t.id}',this.checked)">
        <span class="name">${esc(t.name)}</span><span class="type-tag">${t.counts ? `${t.counts.npcs} NPCs · ${t.counts.locations} locations` : 'unreadable'}</span></label>`).join('')
      : '<div class="hint">There is no other campaign. Create one from the campaign menu first.</div>'}
    <div class="modal-footer"><span style="flex:1"></span><button class="icon-btn" onclick="window.app.trCloseTargets()">Done</button></div>
  </div>`;
}

function renderTransferModal() {
  const st = trState();
  if (!st) return;
  const body = document.getElementById('transfer-body');
  const foot = document.getElementById('transfer-footer');
  if (!body || !foot) return;
  if (st.result) { body.innerHTML = trResultHTML(); foot.innerHTML = trFooterHTML(); return; }
  body.innerHTML = `<div id="tr-target-head">${trHeaderHTML()}</div><div id="tr-picker">${trPickerHTML()}</div><div id="tr-curated">${trCuratedHTML()}</div>`;
  foot.innerHTML = trFooterHTML();
}

function trRefreshList() {
  const list = document.getElementById('tr-list');
  if (!list) return;
  const top = list.scrollTop;
  list.innerHTML = trListHTML();
  list.scrollTop = top;
  const bar = document.getElementById('tr-pick-bar');
  if (bar) bar.innerHTML = trPickBarHTML();
}

function trRefreshCollected() {
  const c = document.getElementById('tr-curated');
  if (c) {
    const scroller = document.getElementById('transfer-body');
    const top = scroller ? scroller.scrollTop : 0;
    c.innerHTML = trCuratedHTML();
    if (scroller) scroller.scrollTop = top;
  }
  const h = document.getElementById('tr-target-head');
  if (h) h.innerHTML = trHeaderHTML();
  const f = document.getElementById('transfer-footer');
  if (f) f.innerHTML = trFooterHTML();
  trRefreshList();
  trQueueDupCheck();
}

let trDupTimer = null;
function trQueueDupCheck() {
  clearTimeout(trDupTimer);
  trDupTimer = setTimeout(async () => {
    const st = trState();
    if (!st || st.result) return;
    if (!st.entries.length || !st.targetIds.length) { st.dups = {}; const f = document.getElementById('transfer-footer'); if (f) f.innerHTML = trFooterHTML(); return; }
    try {
      const res = await window.core.transferPreview(st.targetIds, st.entries.map((e) => ({ id: e.id })));
      const cur = trState();
      if (!cur || cur !== st) return;
      st.dups = {};
      (res || []).forEach((r) => { if (r.duplicates && r.duplicates.length) st.dups[r.id] = r.duplicates; });
      const f = document.getElementById('transfer-footer');
      if (f && !st.result) f.innerHTML = trFooterHTML();
    } catch { /* the preview is only a courtesy */ }
  }, 150);
}

// Adds ids to the collected list (those not in it yet).
function trAddIds(ids) {
  const st = trState();
  const have = new Set(trEntryIds());
  ids.forEach((id) => { if (campaign.entities[id] && !have.has(id)) { st.entries.push({ id, exclude: {} }); have.add(id); } });
}

function trVisibleOrder() {
  return Array.from(document.querySelectorAll('#tr-list .tr-row')).map((el) => el.dataset.entityId);
}

Object.assign(window.app, {
  async openTransfer(preselectIds) {
    await persistSafely();
    ui.transfer = trFreshState();
    if (Array.isArray(preselectIds)) trAddIds(preselectIds);
    document.getElementById('transfer-modal').style.display = 'flex';
    renderTransferModal();
    try { ui.transfer.targets = await window.core.transferTargets(); } catch { ui.transfer.targets = []; }
    if (ui.transfer) { const h = document.getElementById('tr-target-head'); if (h) h.innerHTML = trHeaderHTML(); }
  },
  closeTransfer() {
    ui.transfer = null;
    const m = document.getElementById('transfer-modal'); if (m) m.style.display = 'none';
    const t = document.getElementById('transfer-targets-modal'); if (t) t.style.display = 'none';
  },
  trSearch(v) { trState().query = v; trRefreshList(); },
  trSetType(v) { trState().type = v; trRefreshList(); },
  trSetGroup(v) { trState().groupId = v; trRefreshList(); },
  trToggleGroup(id) {
    const key = 'collapsedTransferGroups';
    const cur = campaign.meta[key] || [];
    campaign.meta[key] = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    trRefreshList();
  },
  trRowClick(e, id) {
    const st = trState();
    const additive = e.ctrlKey || e.metaKey;
    if (e.shiftKey) {
      const order = trVisibleOrder();
      const anchor = st.anchor && order.includes(st.anchor) ? st.anchor : (st.selected.find((x) => order.includes(x)) || id);
      const a = order.indexOf(anchor), b = order.indexOf(id);
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      st.selected = additive ? Array.from(new Set([...st.selected, ...range])) : range;
      st.anchor = anchor;
    } else if (additive) {
      st.selected = st.selected.includes(id) ? st.selected.filter((x) => x !== id) : [...st.selected, id];
      st.anchor = id;
    } else {
      st.selected = (st.selected.length === 1 && st.selected[0] === id) ? [] : [id];
      st.anchor = id;
    }
    trRefreshList();
  },
  trSelectAllVisible() { const st = trState(); st.selected = trVisibleOrder(); trRefreshList(); },
  trClearSelection() { trState().selected = []; trRefreshList(); },
  trAddSelected() {
    const st = trState();
    trAddIds(st.selected);
    st.selected = [];
    trRefreshCollected();
  },
  trRemove(id) { const st = trState(); st.entries = st.entries.filter((e) => e.id !== id); trRefreshCollected(); },
  trToggleExclude(id, key, on) {
    const entry = trState().entries.find((e) => e.id === id);
    if (!entry) return;
    if (on) entry.exclude[key] = true; else delete entry.exclude[key];
    // Leaving content out can remove dependencies, so redraw the warning
    // (the checkboxes themselves keep their state).
    trRefreshCollected();
  },
  trAddDependency(id) { trAddIds([id]); trRefreshCollected(); },
  trAddAllDependencies() {
    const st = trState();
    trAddIds(window.Transfer.findMissingDependencies(campaign, st.entries, { closure: true }).map((d) => d.id));
    trRefreshCollected();
  },
  trOpenTargets() {
    const m = document.getElementById('transfer-targets-modal');
    m.innerHTML = trTargetsModalHTML();
    m.style.display = 'flex';
  },
  trCloseTargets() {
    const m = document.getElementById('transfer-targets-modal'); if (m) m.style.display = 'none';
    const h = document.getElementById('tr-target-head'); if (h && trState()) h.innerHTML = trHeaderHTML();
    const f = document.getElementById('transfer-footer'); if (f && trState()) f.innerHTML = trFooterHTML();
    trQueueDupCheck();
  },
  trToggleTarget(id, on) {
    const st = trState();
    st.targetIds = on ? Array.from(new Set([...st.targetIds, id])) : st.targetIds.filter((x) => x !== id);
  },
  async trRun() {
    const st = trState();
    if (!st || st.running || !st.entries.length || !st.targetIds.length) return;
    st.running = true; st.error = '';
    const f = document.getElementById('transfer-footer'); if (f) f.innerHTML = trFooterHTML();
    try {
      await persistSafely();
      const res = await window.core.transferRun(st.targetIds, st.entries.map((e) => ({ id: e.id, exclude: Object.assign({}, e.exclude) })));
      st.result = res;
    } catch (err) {
      st.error = `Transfer failed: ${err && err.message ? err.message : err}`;
    }
    st.running = false;
    renderTransferModal();
  }
});

Object.assign(window.app, graphActions());
Object.assign(window.app, conditionActions());
Object.assign(window.app, questActions());

if (window.TextFullscreen) window.TextFullscreen.setPopupCheck(() => mentionState.active || pickerState.open || !!ui.directorPicker || !!document.getElementById('quest-menu'));

// Record which action ran last and report slow ones to the diagnostics log.
if (window.Health) {
  window.Health.wrapActions(window.app);
  window.Health.setContextProvider(() => ({
    mode: ui.mode,
    createTab: ui.createTab,
    selectedEntity: ui.selectedEntityId || null,
    manageGroups: !!ui.manageGroups,
    entities: campaign ? Object.keys(campaign.entities).length : 0
  }));
}

// --- Global shortcuts --------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (gvKey(e) === true) return;
  if (e.key === 'Escape' && ui.transfer && !(window.TextFullscreen && window.TextFullscreen.isActive())) {
    const tm = document.getElementById('transfer-targets-modal');
    if (tm && tm.style.display !== 'none') window.app.trCloseTargets(); else window.app.closeTransfer();
    return;
  }
  if (e.key === 'Escape' && (ui.cardModalEntityId || ui.sbEditorEntityId) && !mentionState.active && !pickerState.open) {
    const fs = window.TextFullscreen && window.TextFullscreen.isActive();
    if (!fs) {
      if (ui.sbEditorEntityId) window.app.closeStatblockEditor(); else window.app.closeCharacterCard();
      return;
    }
  }
  if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === 'l' && ui.mode === 'play') {
    const active = document.activeElement;
    const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
    if (!isTyping) {
      e.preventDefault();
      window.app.openLootTableView();
      return;
    }
  }

  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return;

  if (e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (pickerState.open && pickerState.mode === 'omni') {
      // Second press: switch between the entity jump and the content search.
      pickerState.sub = pickerState.sub === 'content' ? 'entities' : 'content';
      pickerState.step = null; pickerState.highlighted = 0;
      renderPicker();
      const input = document.getElementById('omnisearch-input');
      if (input) input.focus();
    } else if (pickerState.open) closePicker(); else openPicker('omni', null);
    return;
  }
  if (e.key === '+' || e.key === '=') {
    e.preventDefault();
    window.app.stepCheckpoint(1);
    return;
  }
  if (e.key === '-' || e.key === '_') {
    e.preventDefault();
    window.app.stepCheckpoint(-1);
  }
});

// Click-outside-to-close for the anchored picker (the omnisearch modal
// handles this itself via its overlay's own click handler).
document.addEventListener('mousedown', (e) => {
  if (!pickerState.open || pickerState.mode === 'omni') return;
  const box = document.getElementById('picker-float-box');
  const anchor = pickerState.anchorId ? document.getElementById(pickerState.anchorId) : null;
  if (box && box.contains(e.target)) return;
  if (anchor && anchor.contains(e.target)) return;
  closePicker();
});

document.addEventListener('DOMContentLoaded', init);

// Director picker: 1/2/3 on the first step, Escape anywhere in it.
document.addEventListener('keydown', (e) => {
  const p = ui && ui.directorPicker;
  if (!p) return;
  if (p.step === 'kind' && ['1', '2', '3', '4', '5', '6'].includes(e.key)) {
    e.preventDefault();
    const k = ['scene', 'musicsrc', 'quickfire', 'playlist', 'sfxsrc', 'notion'][Number(e.key) - 1];
    if (k === 'notion') window.app.pickDirectorNotion(); else if (k === 'musicsrc' || k === 'sfxsrc') window.app.pickDirectorGroup(k); else window.app.pickDirectorKind(k);
  }
  if ((p.step === 'musicsrc' || p.step === 'sfxsrc') && ['1', '2'].includes(e.key)) {
    e.preventDefault();
    window.app.pickDirectorKind(p.step === 'musicsrc' ? ['music', 'genre'][Number(e.key) - 1] : ['scenesfx', 'sfx'][Number(e.key) - 1]);
  }
  else if (e.key === 'Escape') { e.preventDefault(); window.app.closeDirectorPicker(); }
}, true);


// --- Hover card for mentions and quotes (Play mode) ----------------------------------------
// Pointing at a mention pill or a spoken quote shows a small card: image, name and the
// entity's general notes (the summary when it has none).
let hoverTimer = null;
let hoverEl = null;
function hideHoverCard() {
  clearTimeout(hoverTimer); hoverTimer = null;
  if (hoverEl && hoverEl.dataset.t !== undefined) { hoverEl.setAttribute('title', hoverEl.dataset.t); delete hoverEl.dataset.t; }
  hoverEl = null;
  const c = document.getElementById('hover-card');
  if (c) c.remove();
}
function showHoverCard(target) {
  const entity = campaign.entities[target.dataset.hover];
  if (!entity || ui.mode !== 'play') return;
  const card = window.Query.getEntityCard(campaign, entity.id, ui.curTime);
  const general = card ? card.general : [];
  const url = entityImageUrl(entity);
  const body = general.length
    ? general.map((n) => `${questTagLine(n.moduleId)}<p class="field-text">${rich(n.text)}</p>`).join('')
    : (entity.summary ? `<p class="field-text">${esc(entity.summary)}</p>` : '<p class="empty-hint">No notes yet.</p>');
  const el = document.createElement('div');
  el.id = 'hover-card'; el.className = 'hover-card';
  el.innerHTML = `<div class="hover-head">${url ? `<img src="${esc(url)}" alt="">` : ''}${entityBadge(entity, 18)}<span class="hover-name">${esc(entity.name)}</span></div><div class="hover-body">${body}</div>`;
  document.body.appendChild(el);
  const r = target.getBoundingClientRect();
  const w = el.offsetWidth, h = el.offsetHeight;
  let x = Math.min(r.left, window.innerWidth - w - 12);
  let y = r.bottom + 8;
  if (y + h > window.innerHeight - 8) y = Math.max(8, r.top - h - 8);
  el.style.left = `${Math.max(8, x)}px`; el.style.top = `${y}px`;
}
document.addEventListener('mouseover', (ev) => {
  const t = ev.target.closest && ev.target.closest('[data-hover]');
  if (!t) return;
  if (t === hoverEl) return;
  hideHoverCard();
  hoverEl = t;
  if (t.hasAttribute('title')) { t.dataset.t = t.getAttribute('title'); t.removeAttribute('title'); }   // our card replaces the browser tooltip
  hoverTimer = setTimeout(() => showHoverCard(t), 280);
});
document.addEventListener('mouseout', (ev) => {
  const t = ev.target.closest && ev.target.closest('[data-hover]');
  if (!t || t.contains(ev.relatedTarget)) return;
  hideHoverCard();
});
document.addEventListener('mousedown', hideHoverCard, true);
