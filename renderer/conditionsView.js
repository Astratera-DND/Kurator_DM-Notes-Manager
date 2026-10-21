// Conditions in the app: the Play panel, the Conditions tab (Create), and the
// right-click "Make conditional" menu for every text field. The logic itself is
// in src/conditions.js (window.Conditions); this file only draws and wires it.
// Like graphView.js it uses app.js globals (campaign, ui, esc, refresh,
// persistSafely, scheduleFieldSave) at call time, so it can load before app.js.

function cnd() { return window.Conditions; }
function cndCtx() { return { curTimeId: ui.curTime, mode: 'play' }; }

// --- Play panel -----------------------------------------------------------------

function condStateChip(cond) {
  const key = cnd().stateOf(campaign, cond, cndCtx());
  const st = cnd().statesOf(cond).find((s) => s.key === key);
  return `<span class="cond-chip ${st ? 'set' : ''}">${st ? esc(st.label) : 'not rolled'}</span>`;
}

function condPlayRowHTML(c) {
  const id = c.id;
  let ctl = '';
  if (c.kind === 'switch') {
    const cur = cnd().stateOf(campaign, c, cndCtx());
    ctl = `<span class="cond-seg">${cnd().statesOf(c).map((s) => `<button class="${s.key === cur ? 'on' : ''}" onclick="window.app.condSetState('${id}','${s.key}')">${esc(s.label)}</button>`).join('')}</span>`;
  } else if (c.kind === 'dice' && c.linkedCheckId) {
    ctl = `<span class="cond-dice"><span class="cond-hint">DC check</span>${condStateChip(c)}<button class="icon-btn" onclick="window.app.openDCCheckPlay('${c.linkedCheckId}')">Open the check</button></span>`;
  } else if (c.kind === 'dice') {
    const s = c.settings || {};
    const type = (window.Constants.CHECK_TYPES.find((t) => t.key === s.checkType) || {}).label || '';
    ctl = `<span class="cond-dice"><span class="cond-hint">${esc(type)} DC ${esc(String(s.dc))}</span>
      <input type="number" id="cond-roll-${id}" placeholder="total" onkeydown="if(event.key==='Enter')window.app.condRoll('${id}')">
      <button class="icon-btn" onclick="window.app.condRoll('${id}')">Set result</button>
      ${condStateChip(c)}${c.current ? `<button class="mini-btn" title="Forget the result" onclick="window.app.condClear('${id}')">×</button>` : ''}</span>`;
  } else ctl = condStateChip(c);
  return `<div class="cond-row"><span class="cond-name">${esc(c.name)}</span>${ctl}</div>`;
}

// The dock: a button at the bottom right of Play that is always there (also over
// an NPC card or a full page), with every switch and dice roll one click away.
function condDockHTML() {
  const list = cnd().list(campaign);
  if (!list.length) return '';
  const used = list.filter((c) => c.kind === 'switch' || c.kind === 'dice');
  const rest = list.filter((c) => !used.includes(c));
  const pop = ui.condDockOpen ? `<div class="cond-pop">
    <div class="cond-pop-head"><b>Conditions</b><button class="mini-btn" onclick="window.app.condDockToggle()">✕</button></div>
    ${used.map(condPlayRowHTML).join('')}
    ${rest.map((c) => `<div class="cond-row dim"><span class="cond-name">${esc(c.name)}</span>${condStateChip(c)}</div>`).join('')}
    <div class="cond-foot"><button class="icon-btn" onclick="window.app.condResetAll()" title="Switches back to their first state, dice results cleared">Reset all for a new session</button>
    <button class="icon-btn" onclick="ui.mode='create';ui.createTab='conditions';ui.condDockOpen=false;renderAll()">Edit conditions</button></div></div>` : '';
  return `${pop}<button class="cond-dock-btn" onclick="window.app.condDockToggle()" title="Switches and dice rolls">Conditions <span>${list.length}</span></button>`;
}

// One chip row under a text field that contains conditional sections, so the
// conditions behind the markers can be seen and switched right there.
function condStripHTML(text) {
  const seen = new Set();
  const chips = [];
  cnd().referencesIn(text).forEach((r) => {
    if (seen.has(r.cid)) return; seen.add(r.cid);
    const c = cnd().byId(campaign, r.cid);
    if (!c) { chips.push('<span class="cond-strip-chip gone">deleted condition</span>'); return; }
    const cur = cnd().stateOf(campaign, c, { curTimeId: ui.curTime });
    let ctl;
    if (c.kind === 'switch') ctl = `<span class="cond-seg">${cnd().statesOf(c).map((s) => `<button class="${s.key === cur ? 'on' : ''}" onclick="window.app.condSetState('${c.id}','${s.key}')">${esc(s.label)}</button>`).join('')}</span>`;
    else ctl = condStateChip(c);
    chips.push(`<span class="cond-strip-chip"><b>${esc(c.name)}</b> ${ctl}<button class="mini-btn" title="Change what this does here" onclick="window.app.condStripEdit(this,'${c.id}')">${icon('edit')}</button></span>`);
  });
  return chips.join('');
}

function condDecorateField(ta) {
  const has = ta.value.indexOf('[[IF:') !== -1;
  let strip = ta.nextElementSibling && ta.nextElementSibling.classList && ta.nextElementSibling.classList.contains('cond-strip') ? ta.nextElementSibling : null;
  if (!has) { if (strip) strip.remove(); return; }
  if (!strip) { strip = document.createElement('div'); strip.className = 'cond-strip'; ta.insertAdjacentElement('afterend', strip); }
  const html = condStripHTML(ta.value);
  if (strip.innerHTML !== html) strip.innerHTML = html;
}

function condAfterRender() {
  let dock = document.getElementById('cond-dock');
  if (!dock) { dock = document.createElement('div'); dock.id = 'cond-dock'; document.body.appendChild(dock); }
  dock.innerHTML = ui.mode === 'play' ? condDockHTML() : '';
  document.querySelectorAll('textarea.mention-field').forEach(condDecorateField);
}
document.addEventListener('focusin', (ev) => { if (ev.target && ev.target.matches && ev.target.matches('textarea.mention-field')) condDecorateField(ev.target); });
document.addEventListener('input', (ev) => { if (ev.target && ev.target.matches && ev.target.matches('textarea.mention-field')) condDecorateField(ev.target); });

// --- Whole-block condition (shown in a block's editor) ---------------------------------

function condCardControlHTML(m) {
  if (!m) return '';
  const si = m.showIf && m.showIf.conditionId ? m.showIf : null;
  const cond = si ? cnd().byId(campaign, si.conditionId) : null;
  if (!si || !cond) {
    return `<div class="cond-cardrow"><button class="mini-btn txt" title="Hide this whole block in Play until a condition is met. To hide only part of the text, select it and right-click instead." onclick="window.app.condCardDialog('${m.id}')">Show only when…</button></div>`;
  }
  const raw = `${si.negate ? '!' : ''}${(si.states || []).join(',')}`;
  return `<div class="cond-cardrow"><span class="cond-hint">Whole block shown only when <b>${esc(cnd().describeSection(campaign, cond, raw))}</b></span>
    <button class="mini-btn txt" onclick="window.app.condCardDialog('${m.id}')">Change…</button>
    <button class="mini-btn txt" onclick="window.app.condCardCondition('${m.id}','')">Always show</button></div>`;
}

// --- Conditions tab ---------------------------------------------------------------

function condUsageText(c) {
  const u = cnd().usages(campaign, c.id);
  const n = u.modules.length, k = u.combos.length;
  if (!n && !k) return 'not used yet';
  return [n ? `used in ${n} content block${n > 1 ? 's' : ''}` : '', k ? `${k} combination${k > 1 ? 's' : ''}` : ''].filter(Boolean).join(', ');
}

function condEditorHTML(c) {
  const id = c.id, s = c.settings || {};
  let body = '';
  if (c.kind === 'switch') {
    body = `<div class="cond-states">${c.states.map((st) => `<span class="cond-state"><input value="${esc(st.label)}" onchange="window.app.condRenameState('${id}','${st.key}',this.value)">${c.states.length > 2 ? `<button title="Remove state" onclick="window.app.condRemoveState('${id}','${st.key}')">×</button>` : ''}</span>`).join('')}
      <span class="cond-state add"><input id="cond-add-${id}" placeholder="Add state…" onkeydown="if(event.key==='Enter')window.app.condAddState('${id}')"><button onclick="window.app.condAddState('${id}')">+</button></span></div>`;
  } else if (c.kind === 'dice') {
    body = `<div class="cond-form">
      <label>Check <select ${c.linkedCheckId ? 'disabled' : ''} onchange="window.app.condSet('${id}','checkType',this.value)">${window.Constants.CHECK_TYPES.map((t) => `<option value="${t.key}" ${s.checkType === t.key ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
      <label>DC <input type="number" value="${esc(String(s.dc))}" onchange="window.app.condSet('${id}','dc',Number(this.value))"></label>
      <label title="A total this far above (or below) the DC counts as critical. 0 = no critical results.">Critical margin <input type="number" min="0" value="${esc(String(s.critMargin))}" onchange="window.app.condSet('${id}','critMargin',Number(this.value))"></label>
      <label><input type="checkbox" ${s.natCrit ? 'checked' : ''} onchange="window.app.condSet('${id}','natCrit',this.checked)"> Natural 20 / 1 are critical</label>
      ${c.linkedCheckId ? '<span class="cond-hint">Set by the DC check of the same name: roll it from its button in Play.</span>' : ''}
      <span class="cond-hint">Results: ${window.Conditions.DICE_STATES.map((x) => esc(x.label)).join(' · ')}</span></div>`;
  } else if (c.kind === 'milestone') {
    const cps = window.Query.sortedCheckpoints(campaign);
    body = `<div class="cond-form"><label>Reached when Play is at or after <select onchange="window.app.condSet('${id}','checkpointId',this.value)"><option value="">— choose —</option>${cps.map((cp) => `<option value="${cp.id}" ${s.checkpointId === cp.id ? 'selected' : ''}>${esc(cp.label)}</option>`).join('')}</select></label></div>`;
  } else if (c.kind === 'presence') {
    const ents = Object.values(campaign.entities || {}).sort((a, b) => a.name.localeCompare(b.name));
    const locs = ents.filter((e) => e.type === 'location');
    body = `<div class="cond-form"><label>Who <select onchange="window.app.condSet('${id}','entityId',this.value||null)"><option value="">— choose —</option>${ents.map((e) => `<option value="${e.id}" ${s.entityId === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
      <label>is listed as present in <select onchange="window.app.condSet('${id}','locationId',this.value||null)"><option value="">any location</option>${locs.map((e) => `<option value="${e.id}" ${s.locationId === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
      <span class="cond-hint">Checked against the "Present here" list at the milestone Play is on (earlier milestones carry forward).</span></div>`;
  } else if (c.kind === 'item') {
    const ents = Object.values(campaign.entities || {}).sort((a, b) => a.name.localeCompare(b.name));
    body = `<div class="cond-form"><label>Who <select onchange="window.app.condSet('${id}','entityId',this.value||null)"><option value="">anyone</option>${ents.map((e) => `<option value="${e.id}" ${s.entityId === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
      <label>has an item named <input value="${esc(String(s.itemName || ''))}" placeholder="e.g. Keycard" onchange="window.app.condSet('${id}','itemName',this.value)"></label>
      <span class="cond-hint">Looks through the inventory tables; part of a name is enough.</span></div>`;
  } else if (c.kind === 'resolved') {
    const mods = (campaign.contentModules || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    body = `<div class="cond-form"><label>Content <select onchange="window.app.condSet('${id}','moduleId',this.value||null)"><option value="">— choose —</option>${mods.map((m) => `<option value="${m.id}" ${s.moduleId === m.id ? 'selected' : ''}>${esc(`${window.Constants.MODULE_TYPE_LABELS[m.type] || m.type}: ${m.name || '(untitled)'}`)}</option>`).join('')}</select></label>
      <span class="cond-hint">Met once that block is ticked as resolved.</span></div>`;
  } else if (c.kind === 'combo') {
    const others = cnd().list(campaign).filter((o) => o.id !== c.id && cnd().canUse(campaign, c.id, o.id));
    body = `<div class="cond-form"><label>Met when <select onchange="window.app.condSet('${id}','mode',this.value)"><option value="all" ${s.mode !== 'any' ? 'selected' : ''}>all of these hold</option><option value="any" ${s.mode === 'any' ? 'selected' : ''}>any of these holds</option></select></label></div>
      ${(s.rules || []).map((r, i) => { const t = cnd().byId(campaign, r.conditionId); return `<div class="cond-rule"><b>${t ? esc(t.name) : '(deleted)'}</b>
        <select onchange="window.app.condRuleNeg('${id}',${i},this.value==='not')"><option value="is" ${!r.negate ? 'selected' : ''}>is</option><option value="not" ${r.negate ? 'selected' : ''}>is not</option></select>
        ${t ? cnd().statesOf(t).map((st) => `<label class="cond-cb"><input type="checkbox" ${(r.states || []).includes(st.key) ? 'checked' : ''} onchange="window.app.condRuleState('${id}',${i},'${st.key}',this.checked)">${esc(st.label)}</label>`).join('') : ''}
        <button class="mini-btn" onclick="window.app.condRuleRemove('${id}',${i})">×</button></div>`; }).join('')}
      <div class="cond-form"><select id="cond-rule-add-${id}"><option value="">Add a condition…</option>${others.map((o) => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select><button class="mini-btn txt" onclick="window.app.condRuleAdd('${id}')">Add</button></div>`;
  }
  return `<div class="cond-card" data-cond="${id}">
    <div class="cond-head"><input class="cond-title" ${c.linkedCheckId ? 'readonly title="Named after its DC check"' : ''} value="${esc(c.name)}" onchange="window.app.condRename('${id}',this.value)">
      <span class="cond-kind">${esc(cnd().KIND_LABELS[c.kind])}</span><span class="cond-hint">${esc(condUsageText(c))}</span>
      ${c.linkedCheckId ? '<span class="cond-kind">DC check</span>' : `<button class="mini-btn danger" title="Delete this condition" onclick="window.app.condDelete('${id}')">${icon('trash')}</button>`}</div>
    ${body}</div>`;
}

function renderConditionsTab() {
  const body = document.getElementById('create-body');
  const list = cnd().list(campaign);
  body.innerHTML = `<div class="cond-tab">
    <p class="cond-hint">A condition is a named test with a few possible results. Select text in any field, right-click and choose <b>Make conditional</b> to show it only for some of those results. Conditions can be reused anywhere.</p>
    <div class="cond-new"><input id="cond-new-name" placeholder="New condition name…" onkeydown="if(event.key==='Enter')window.app.condCreate()">
      <select id="cond-new-kind">${Object.keys(cnd().KIND_LABELS).map((k) => `<option value="${k}">${esc(cnd().KIND_LABELS[k])}</option>`).join('')}</select>
      <button class="icon-btn" onclick="window.app.condCreate()">Create</button></div>
    ${list.length ? list.map(condEditorHTML).join('') : '<p class="empty-hint">No conditions yet.</p>'}</div>`;
}

// --- Make conditional (right-click) ------------------------------------------------

let condMenuTarget = null; // { ta, start, end, sections }

function condCloseMenu() { const m = document.getElementById('cond-menu'); if (m) m.remove(); }

function condShowMenu(x, y, html) {
  condCloseMenu();
  const m = document.createElement('div');
  m.id = 'cond-menu'; m.className = 'cond-menu'; m.innerHTML = html;
  document.body.appendChild(m);
  // Keep the whole menu on screen (it can be tall); scroll inside it if the window is very small.
  m.style.maxHeight = `${window.innerHeight - 16}px`; m.style.overflowY = 'auto';
  m.style.left = `${Math.max(8, Math.min(x, window.innerWidth - m.offsetWidth - 8))}px`;
  m.style.top = `${Math.max(8, Math.min(y, window.innerHeight - m.offsetHeight - 8))}px`;
}

// Right-click in any text field: every insert and formatting option in one place.
// (Shift+right-click still gives the plain system menu, with spelling suggestions.)
function textMenuItem(act, label, key, extra) {
  return `<button class="cm-item" data-cm="${act}"${extra && extra.disabled ? ' disabled' : ''}><span>${label}</span>${key ? `<span class="cm-key">${key}</span>` : ''}</button>`;
}

document.addEventListener('contextmenu', (ev) => {
  const ta = ev.target && ev.target.closest && ev.target.closest('textarea.mention-field');
  if (!ta || ev.shiftKey) return;
  const start = ta.selectionStart, end = ta.selectionEnd;
  const sections = cnd().sectionsAt(ta.value, start);
  const sel = start !== end;
  ev.preventDefault();
  condMenuTarget = { ta, start, end, sections };
  let html = '<div class="cm-label">Insert</div>';
  html += textMenuItem('t-mention', 'Mention an NPC or location', '@');
  html += textMenuItem('t-say', 'Dialogue line', '" "');
  html += textMenuItem('t-link', 'Link to a section, topic, scene…', 'Ctrl+L');
  html += textMenuItem('t-dc', 'DC check…', 'Alt+D');
  html += textMenuItem('t-dir', 'Director button (scene, music, SFX…)', 'Alt+S');
  html += '<div class="cm-sep"></div><div class="cm-label">Format</div>';
  html += textMenuItem('f-bold', '<b>Bold</b>', 'Ctrl+B');
  html += textMenuItem('f-italic', '<i>Italic</i>', 'Ctrl+I');
  html += textMenuItem('f-strike', '<s>Strikethrough</s>', 'Ctrl+Shift+S');
  html += textMenuItem('f-dm', 'DM comment (only you see it)', 'Ctrl+E');
  html += textMenuItem('f-bullets', 'Bulleted list', '- ');
  html += '<div class="cm-sep"></div><div class="cm-label">Logic</div>';
  if (sel) html += '<button class="cm-item" data-cm="make"><span>Make conditional…</span></button>';
  else html += textMenuItem('make-hint', 'Make conditional… (select text first)', '', { disabled: true });
  sections.forEach((n, i) => {
    const c = cnd().byId(campaign, n.cid);
    html += `<div class="cm-sep"></div><div class="cm-label">${esc(cnd().describeSection(campaign, c, n.raw))}</div>
      <button class="cm-item" data-cm="edit" data-i="${i}">Change this condition…</button>
      <button class="cm-item danger" data-cm="remove" data-i="${i}">Remove condition (keep the text)</button>`;
  });
  html += '<div class="cm-sep"></div>';
  html += textMenuItem('e-cut', 'Cut', 'Ctrl+X', { disabled: !sel });
  html += textMenuItem('e-copy', 'Copy', 'Ctrl+C', { disabled: !sel });
  html += textMenuItem('e-paste', 'Paste', 'Ctrl+V');
  html += textMenuItem('e-all', 'Select all', 'Ctrl+A');
  condShowMenu(ev.clientX, ev.clientY, html);
}, true);

// Runs one of the text-field menu actions on the field it was opened in.
function textMenuRun(act, t) {
  const ta = t.ta;
  ta.focus();
  ta.selectionStart = t.start; ta.selectionEnd = t.end;
  switch (act) {
    case 't-mention': typeTrigger(ta, '@'); break;
    case 't-say': typeTrigger(ta, '""'); break;
    case 't-link': startJumpLink(ta); break;
    case 't-dc': startDCCheck(ta); break;
    case 't-dir': insertDirectorButton(ta, 'choose'); break;
    case 'f-bold': wrapSelectionWithMarker(ta, '**'); break;
    case 'f-italic': wrapSelectionWithMarker(ta, '_'); break;
    case 'f-strike': wrapSelectionWithMarker(ta, '~~'); break;
    case 'f-dm': wrapSelectionWithMarker(ta, '^^'); break;
    case 'f-bullets': toggleBulletLines(ta); break;
    case 'e-cut': document.execCommand('cut'); break;
    case 'e-copy': document.execCommand('copy'); break;
    case 'e-paste':
      if (!document.execCommand('paste') && navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then((txt) => typeTrigger(ta, txt)).catch(() => {});
      }
      break;
    case 'e-all': ta.select(); break;
    default: break;
  }
}

document.addEventListener('mousedown', (ev) => {
  const btn = ev.target && ev.target.closest && ev.target.closest('#cond-menu .cm-item');
  if (btn && btn.dataset.cm === 'setstate') {
    ev.preventDefault();
    const cc = cnd().byId(campaign, btn.dataset.cid), key = btn.dataset.key;
    condCloseMenu();
    if (cc) condMutate(() => { if (key) { if (cc.kind === 'dice') cc.current = key; else cnd().setState(cc, key); } else cnd().clearResult(cc); });
    return;
  }
  if (btn && btn.dataset.cm === 'cardstate') {
    ev.preventDefault();
    const m = (campaign.contentModules || []).find((x) => x.id === btn.dataset.mid);
    const cid = btn.dataset.cid, key = btn.dataset.key;
    condCloseMenu();
    if (m) condMutate(() => { m.showIf = { conditionId: cid, states: [key], negate: false }; });
    return;
  }
  if (btn) {
    ev.preventDefault();
    const t = condMenuTarget, i = Number(btn.dataset.i);
    const act = btn.dataset.cm;
    if (btn.disabled) return;
    condCloseMenu();
    if (!t) return;
    if (/^[tfe]-/.test(act)) { textMenuRun(act, t); return; }
    if (act === 'make') condOpenDialog({ ta: t.ta, start: t.start, end: t.end });
    else if (act === 'edit') condOpenDialog({ ta: t.ta, node: t.sections[i] });
    else if (act === 'remove') condApplyText(t.ta, cnd().unwrapSection(t.ta.value, t.sections[i]));
  } else if (!(ev.target && ev.target.closest && ev.target.closest('#cond-menu'))) condCloseMenu();
}, true);
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') condCloseMenu(); });

function condApplyText(ta, text, selStart, selEnd) {
  ta.value = text;
  ta.focus();
  if (selStart != null) { ta.selectionStart = selStart; ta.selectionEnd = selEnd; }
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

// The dialog: choose (or create) a condition, then the results that show the text.
let condDlg = null;

function condOpenDialog(target) {
  const list = cnd().list(campaign);
  let existing = target.node ? cnd().byId(campaign, target.node.cid) : null;
  let parsed = target.node ? cnd().parseKeys(target.node.raw) : { negate: false, keys: [] };
  if (target.moduleId) {
    const m = (campaign.contentModules || []).find((x) => x.id === target.moduleId);
    const si = m && m.showIf && m.showIf.conditionId ? m.showIf : null;
    existing = si ? cnd().byId(campaign, si.conditionId) : null;
    parsed = si ? { negate: !!si.negate, keys: (si.states || []).slice() } : { negate: false, keys: [] };
    target.node = null; // not a text section
  }
  condDlg = { target, mode: existing ? existing.id : (list[0] ? list[0].id : '__new__'), negate: parsed.negate, keys: parsed.keys.slice(), newKind: 'switch', newName: '', newStates: 'Off, On', newSettings: condDefaultSettings('switch') };
  condRenderDialog();
}

function condDialogStates() {
  const d = condDlg;
  if (d.mode === '__new__') {
    if (d.newKind === 'switch') return d.newStates.split(',').map((s) => s.trim()).filter(Boolean).map((l, i, a) => ({ key: l, label: l }));
    if (d.newKind === 'dccheck') return [];
    return cnd().statesOf({ kind: d.newKind });
  }
  return cnd().statesOf(cnd().byId(campaign, d.mode));
}


// --- Setting up a new condition from the right-click dialog ---------------------------------
// Every kind a condition can be made of, with the details it needs, so nothing has to be
// finished in the Conditions tab afterwards.
const COND_NEW_KINDS = [
  ['switch', 'Switch you flip yourself (e.g. Alarm raised)'],
  ['milestone', 'Milestone reached'],
  ['resolved', 'Content marked as completed'],
  ['dccheck', 'Result of a DC check'],
  ['dice', 'Dice roll (a roll that is not a DC check)'],
  ['presence', 'NPC / entity is present'],
  ['item', 'Someone has an item']
];

function condDefaultSettings(kind) {
  if (kind === 'milestone') { const cps = window.Query.sortedCheckpoints(campaign); return { checkpointId: ui.curTime || (cps[0] && cps[0].id) || null }; }
  if (kind === 'dice') return { checkType: window.Constants.CHECK_TYPES[0].key, dc: 12, critMargin: 0, natCrit: true };
  if (kind === 'resolved') return { moduleId: null };
  if (kind === 'presence') return { entityId: null, locationId: null };
  if (kind === 'item') return { entityId: null, itemName: '' };
  return {};
}

function condModuleLabel(m) {
  const asg = (campaign.assignments || []).find((a) => a.moduleId === m.id);
  const ent = asg && campaign.entities[asg.entityId];
  const name = (m.name && m.name.trim()) || cnd().stripTokens((m.text || m.html || '').replace(/<[^>]*>/g, ' ')).trim().slice(0, 40) || '(untitled)';
  return `${name}${ent ? ` — ${ent.name}` : ''}`;
}

function condEntOptions() {
  return Object.values(campaign.entities || {}).filter((e) => e.type !== 'quest').sort((a, b2) => a.name.localeCompare(b2.name));
}

// The details a kind of condition needs (shared by "new condition" and "edit this condition").
function condSettingsBodyHTML(kind, st) {
  const ents = condEntOptions();
  const pick = (id, options, value, handler, ph) => searchPickHTML(`cd-${id}`, options, value, handler, { placeholder: ph });
  const entOpts = (anyLabel) => [{ value: '', label: anyLabel }].concat(ents.map((e) => ({ value: e.id, label: e.name, group: e.type })));
  const set = (f, v) => `window.app.condDialogSetting('${f}',${v})`;
  if (kind === 'milestone') {
    const cps = window.Query.sortedCheckpoints(campaign);
    return `<label>Reached when Play is at or after ${pick('cp', cps.map((cp) => ({ value: cp.id, label: cp.label })), st.checkpointId, 'condPickCheckpoint', 'Search milestones…')}</label>`;
  }
  if (kind === 'resolved') {
    const mods = (campaign.contentModules || []).filter((m) => (campaign.assignments || []).some((a) => a.moduleId === m.id));
    const opts = mods.map((m) => ({ value: m.id, label: condModuleLabel(m), group: window.Constants.MODULE_TYPE_LABELS[m.type] || m.type })).sort((x, y) => x.group.localeCompare(y.group) || x.label.localeCompare(y.label));
    return `<label>Content ${pick('mod', opts, st.moduleId, 'condPickModule', 'Search your content…')}</label>
      <span class="cond-hint">Met once that block is ticked off (resolved / completed) in Play.</span>`;
  }
  if (kind === 'dice') {
    return `<label>Check ${pick('ct', window.Constants.CHECK_TYPES.map((t) => ({ value: t.key, label: t.label })), st.checkType, 'condPickCheckType', 'Search check types…')}</label>
      <label>Success at DC <input type="number" value="${esc(String(st.dc))}" style="width:64px" onchange="${set('dc', 'Number(this.value)')}"></label>
      <label title="A total this far above (or below) the DC counts as critical. 0 = no margin.">Critical margin <input type="number" min="0" value="${esc(String(st.critMargin))}" style="width:64px" onchange="${set('critMargin', 'Number(this.value)')}"></label>
      <label><input type="checkbox" ${st.natCrit ? 'checked' : ''} onchange="${set('natCrit', 'this.checked')}"> Natural 20 / 1 are critical</label>
      <span class="cond-hint">You enter the roll in the Conditions panel in Play.</span>`;
  }
  if (kind === 'presence') {
    const locs = ents.filter((e) => e.type === 'location');
    return `<label>Who ${pick('pe', entOpts('— choose —'), st.entityId, 'condPickEntity', 'Search people…')}</label>
      <label>is listed as present in ${pick('pl', [{ value: '', label: 'any location' }].concat(locs.map((e) => ({ value: e.id, label: e.name }))), st.locationId, 'condPickLocation', 'Search locations…')}</label>`;
  }
  if (kind === 'item') {
    return `<label>Who ${pick('ie', entOpts('anyone'), st.entityId, 'condPickEntity', 'Search people…')}</label>
      <label>has an item named <input value="${esc(st.itemName || '')}" placeholder="e.g. Keycard" onchange="${set('itemName', 'this.value')}"></label>`;
  }
  return '';
}

function condNewFormHTML(d) {
  const st = d.newSettings || {};
  const kindSel = `<select onchange="window.app.condDialogSet('newKind',this.value)">${COND_NEW_KINDS.map(([k, l]) => `<option value="${k}" ${d.newKind === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const nameIn = `<input id="cond-dlg-name" placeholder="Name, e.g. Goblin notices us" value="${esc(d.newName)}" oninput="window.app.condDialogSet('newName',this.value,true)">`;
  let body = '';
  if (d.newKind === 'switch') {
    body = `<input placeholder="States, separated by commas" value="${esc(d.newStates)}" onchange="window.app.condDialogSet('newStates',this.value)">`;
  } else if (d.newKind === 'dccheck') {
    const checks = campaign.dcChecks || [];
    body = checks.length
      ? `<label>DC check ${searchPickHTML('cd-dcc', checks.map((c) => ({ value: c.id, label: cnd().dcCheckLabel(c) })), '', 'condDialogPickDCCheck', { placeholder: 'Search DC checks…' })}</label><span class="cond-hint">Every DC check already has its own result condition; this picks it. Then choose which results show the text.</span>`
      : '<span class="cond-hint">There is no DC check yet. Create one with Alt+D in a text field, then come back.</span>';
  } else body = condSettingsBodyHTML(d.newKind, st);
  const needsName = d.newKind !== 'dccheck';
  return `<div class="cond-form">${kindSel}${needsName ? nameIn : ''}</div><div class="cond-form">${body}</div>`;
}

// Edit form for the condition already chosen (not a new one): its own settings, in place.
function condExistingFormHTML(c) {
  if (!c) return '';
  if (c.linkedCheckId) {
    return `<div class="cond-form"><span class="cond-hint">These results come from the DC check <b>${esc(c.name)}</b>.</span><button class="mini-btn txt" onclick="window.app.condDialogEditCheck('${c.linkedCheckId}')">Edit the DC check…</button></div>`;
  }
  if (['milestone', 'resolved', 'dice', 'presence', 'item'].includes(c.kind)) {
    return `<div class="cond-form"><input value="${esc(c.name)}" title="Name of this condition" onchange="window.app.condDialogRenameExisting(this.value)"></div><div class="cond-form">${condSettingsBodyHTML(c.kind, c.settings || {})}</div>`;
  }
  return '';
}

// Specific roll values (dice conditions): "15 or more", "exactly 20", "10 to 14".
function condRollValuesHTML(d) {
  const custom = d.keys.filter((k) => cnd().isRollKey(k));
  const chips = custom.map((k) => `<label class="cond-cb"><input type="checkbox" checked onchange="window.app.condDialogKey('${k}',this.checked)">${esc(cnd().rollKeyLabel(k))}</label>`).join('');
  return `<div class="cond-roll"><span class="cond-hint">Or for a specific roll:</span>
    <select id="cond-rk-kind" onchange="window.app.condRollKindChanged(this.value)"><option value="atleast">at least</option><option value="atmost">at most</option><option value="exactly">exactly</option><option value="range">between</option></select>
    <input id="cond-rk-a" type="number" min="0" style="width:64px" placeholder="15"><span id="cond-rk-and" style="display:none">and</span><input id="cond-rk-b" type="number" min="0" style="width:64px;display:none" placeholder="19">
    <button class="mini-btn txt" onclick="window.app.condAddRollKey()">Add</button></div>${chips ? `<div class="cond-cbs">${chips}</div>` : ''}`;
}

function condRenderDialog() {
  let el = document.getElementById('cond-dialog');
  if (!el) { el = document.createElement('div'); el.id = 'cond-dialog'; el.className = 'modal-overlay'; document.body.appendChild(el); }
  const d = condDlg, list = cnd().list(campaign);
  const states = condDialogStates();
  el.innerHTML = `<div class="modal-panel cond-dlg" onmousedown="event.stopPropagation()">
    <div class="modal-head"><span>${d.target.moduleId ? 'Show this whole block only…' : 'Show this text only…'}</span><button class="mini-btn" onclick="window.app.condDialogClose()">✕</button></div>
    <div class="cond-dlg-body">
      <label>Condition ${(() => {
          const dcc = list.filter((c) => c.linkedCheckId), mine = list.filter((c) => !c.linkedCheckId);
          const opts = mine.map((c) => ({ value: c.id, label: `${c.name} (${cnd().KIND_LABELS[c.kind]})`, group: 'Your conditions' }))
            .concat(dcc.map((c) => ({ value: c.id, label: c.name, group: 'DC check results' })))
            .concat([{ value: '__new__', label: '＋ New condition…', group: 'New' }]);
          return searchPickHTML('cd-mode', opts, d.mode, 'condDialogMode', { placeholder: 'Search conditions…' });
        })()}</label>
      ${d.mode === '__new__' ? condNewFormHTML(d) : condExistingFormHTML(cnd().byId(campaign, d.mode))}
      <div class="cond-form"><select onchange="window.app.condDialogSet('negate',this.value==='not')"><option value="is" ${!d.negate ? 'selected' : ''}>when it is</option><option value="not" ${d.negate ? 'selected' : ''}>when it is not</option></select></div>
      <div class="cond-cbs">${states.map((s) => `<label class="cond-cb"><input type="checkbox" ${d.keys.includes(s.key) ? 'checked' : ''} onchange="window.app.condDialogKey('${esc(s.key).replace(/'/g, '&#39;')}',this.checked)">${esc(s.label)}</label>`).join('')}</div>
      ${(() => { const cc = d.mode === '__new__' ? { kind: d.newKind } : cnd().byId(campaign, d.mode); return cc && cc.kind === 'dice' ? `<div class="cond-form"><button class="mini-btn txt" onclick="window.app.condDialogPreset('success')">Any success</button><button class="mini-btn txt" onclick="window.app.condDialogPreset('failure')">Any failure</button></div>${condRollValuesHTML(d)}` : ''; })()}
      <p class="cond-hint">Otherwise the text collapses to one line in Play.</p>
      <div class="cond-foot"><button class="icon-btn primary" onclick="window.app.condDialogOk()">${d.target.node || d.target.moduleId ? 'Save' : 'Make conditional'}</button><button class="icon-btn" onclick="window.app.condDialogClose()">Cancel</button></div>
    </div></div>`;
  el.style.display = 'flex';
  const nm = document.getElementById('cond-dlg-name'); if (nm && d.focusName) { nm.focus(); d.focusName = false; }
}

// Dropping a condition on a card in the graph: ask for the result that shows the card.
function condPickStatesForCard(ev, cid, mid) {
  const c = cnd().byId(campaign, cid); if (!c) return;
  condShowMenu(ev.clientX, ev.clientY, `<div class="cm-label">Show this whole block when ${esc(c.name)} is…</div>${cnd().statesOf(c).map((s) => `<button class="cm-item" data-cm="cardstate" data-cid="${cid}" data-mid="${mid}" data-key="${esc(s.key)}">${esc(s.label)}</button>`).join('')}<div class="cm-sep"></div><div class="cm-label">More results: edit it in the block's editor.</div>`);
}

// --- Actions ------------------------------------------------------------------------

function condMutate(fn, { rerender = true } = {}) {
  fn();
  if (rerender) refresh(); else persistSafely();
}

function conditionActions() {
  return {
    // The small switch icon next to conditional text in Play.
    condToggleAt(ev, id) {
      const cc = cnd().byId(campaign, id); if (!cc) return;
      const sts = cnd().statesOf(cc);
      if (cc.kind === 'switch' && sts.length === 2) { const cur = cnd().stateOf(campaign, cc, cndCtx()); condMutate(() => cnd().setState(cc, (sts.find((s) => s.key !== cur) || sts[0]).key)); return; }
      const cur = cnd().stateOf(campaign, cc, cndCtx());
      condShowMenu(ev.clientX, ev.clientY, `<div class="cm-label">${esc(cc.name)}</div>${sts.map((s) => `<button class="cm-item ${s.key === cur ? 'cm-on' : ''}" data-cm="setstate" data-cid="${cc.id}" data-key="${esc(s.key)}">${s.key === cur ? '✓ ' : ''}${esc(s.label)}</button>`).join('')}${cc.kind === 'dice' ? `<button class="cm-item" data-cm="setstate" data-cid="${cc.id}" data-key="">Not rolled</button>` : ''}`);
    },
    condDockToggle() { ui.condDockOpen = !ui.condDockOpen; condAfterRender(); },
    condSetState(id, key) { const c = cnd().byId(campaign, id); condMutate(() => { if (c) cnd().setState(c, key); }); },
    condRoll(id) {
      const c = cnd().byId(campaign, id); const inp = document.getElementById(`cond-roll-${id}`);
      if (!c || !inp || inp.value === '') return;
      condMutate(() => { cnd().rollDice(c, Number(inp.value)); });
    },
    condClear(id) { const c = cnd().byId(campaign, id); condMutate(() => { if (c) cnd().clearResult(c); }); },
    condResetAll() { condMutate(() => cnd().resetAll(campaign)); },
    condCreate() {
      const name = document.getElementById('cond-new-name').value; const kind = document.getElementById('cond-new-kind').value;
      condMutate(() => { cnd().createCondition(campaign, { name, kind }); });
    },
    condRename(id, v) { const c = cnd().byId(campaign, id); if (c && v.trim()) condMutate(() => { c.name = v.trim(); }); },
    condDelete(id) {
      const c = cnd().byId(campaign, id); if (!c) return;
      const u = cnd().usages(campaign, id);
      const msg = u.modules.length || u.combos.length ? `"${c.name}" is used in ${u.modules.length} content block(s) and ${u.combos.length} combination(s). Their text stays and always shows. Delete the condition?` : `Delete "${c.name}"?`;
      if (window.confirm(msg)) condMutate(() => cnd().deleteCondition(campaign, id));
    },
    condSet(id, field, value) { const c = cnd().byId(campaign, id); condMutate(() => { if (c) c.settings[field] = value; }); },
    condAddState(id) { const c = cnd().byId(campaign, id); const inp = document.getElementById(`cond-add-${id}`); if (c && inp && inp.value.trim()) condMutate(() => cnd().addSwitchState(c, inp.value)); },
    condRenameState(id, key, v) { const c = cnd().byId(campaign, id); const s = c && c.states.find((x) => x.key === key); if (s && v.trim()) condMutate(() => { s.label = v.trim(); }); },
    condRemoveState(id, key) { const c = cnd().byId(campaign, id); if (c) condMutate(() => cnd().removeSwitchState(c, key)); },
    condRuleAdd(id) {
      const c = cnd().byId(campaign, id); const sel = document.getElementById(`cond-rule-add-${id}`);
      if (!c || !sel || !sel.value || !cnd().canUse(campaign, id, sel.value)) return;
      condMutate(() => { c.settings.rules.push({ conditionId: sel.value, states: [], negate: false }); });
    },
    condRuleRemove(id, i) { const c = cnd().byId(campaign, id); condMutate(() => { if (c) c.settings.rules.splice(i, 1); }); },
    condRuleNeg(id, i, neg) { const c = cnd().byId(campaign, id); condMutate(() => { if (c && c.settings.rules[i]) c.settings.rules[i].negate = neg; }); },
    condRuleState(id, i, key, on) {
      const c = cnd().byId(campaign, id); const r = c && c.settings.rules[i]; if (!r) return;
      condMutate(() => { const s = new Set(r.states || []); if (on) s.add(key); else s.delete(key); r.states = Array.from(s); });
    },

    condCardCondition(mid, cid) {
      const m = (campaign.contentModules || []).find((x) => x.id === mid); if (!m) return;
      condMutate(() => { if (cid) m.showIf = { conditionId: cid, states: [], negate: false }; else delete m.showIf; });
    },
    condCardDialog(mid) { condOpenDialog({ moduleId: mid }); },
    condCardNeg(mid, neg) { const m = (campaign.contentModules || []).find((x) => x.id === mid); if (m && m.showIf) condMutate(() => { m.showIf.negate = neg; }); },
    condCardKey(mid, key, on) {
      const m = (campaign.contentModules || []).find((x) => x.id === mid); if (!m || !m.showIf) return;
      condMutate(() => { const s = new Set(m.showIf.states || []); if (on) s.add(key); else s.delete(key); m.showIf.states = Array.from(s); });
    },

    condDialogSet(field, value, quiet) {
      if (!condDlg) return;
      condDlg[field] = value;
      if (field === 'mode' || field === 'newKind') condDlg.keys = [];
      if (field === 'newKind') condDlg.newSettings = condDefaultSettings(value);
      if (field === 'mode' && value === '__new__') condDlg.focusName = true;
      if (!quiet) condRenderDialog();
    },
    condDialogSetting(field, value) {
      if (!condDlg) return;
      if (condDlg.mode === '__new__') { condDlg.newSettings[field] = value; return; }
      const c = cnd().byId(campaign, condDlg.mode);
      if (c && !c.linkedCheckId) { c.settings = c.settings || {}; c.settings[field] = value; persistSafely(); }
    },
    condStripEdit(btn, cid) {
      const strip = btn.closest('.cond-strip'); const ta = strip && strip.previousElementSibling;
      if (!ta || !ta.value) return;
      const all = []; const walk = (ns) => ns.forEach((n) => { all.push(n); walk(n.children); });
      walk(cnd().parseSections(ta.value));
      const node = all.find((n) => n.cid === cid);
      if (node) condOpenDialog({ ta, node });
    },
    condDialogMode(v) { window.app.condDialogSet('mode', v); },
    condPickCheckpoint(v) { window.app.condDialogSetting('checkpointId', v || null); },
    condPickModule(v) { window.app.condDialogSetting('moduleId', v || null); },
    condPickCheckType(v) { window.app.condDialogSetting('checkType', v); },
    condPickEntity(v) { window.app.condDialogSetting('entityId', v || null); },
    condPickLocation(v) { window.app.condDialogSetting('locationId', v || null); },
    condDialogRenameExisting(v) { const c = condDlg && cnd().byId(campaign, condDlg.mode); if (c && v.trim() && !c.linkedCheckId) { c.name = v.trim(); persistSafely(); } },
    condDialogEditCheck(checkId) { window.app.openDCCheckEditor({ checkId }); },
    condRollKindChanged(kind) {
      const b = document.getElementById('cond-rk-b'), and = document.getElementById('cond-rk-and');
      if (b) b.style.display = kind === 'range' ? '' : 'none';
      if (and) and.style.display = kind === 'range' ? '' : 'none';
    },
    condAddRollKey() {
      if (!condDlg) return;
      const kind = document.getElementById('cond-rk-kind').value;
      const a = document.getElementById('cond-rk-a').value, b = document.getElementById('cond-rk-b').value;
      if (a === '' || (kind === 'range' && b === '')) { window.alert('Type the number' + (kind === 'range' ? 's' : '') + ' first.'); return; }
      const key = cnd().makeRollKey(kind, a, b);
      if (!key) return;
      if (!condDlg.keys.includes(key)) condDlg.keys.push(key);
      condRenderDialog();
    },
    condDialogPickDCCheck(checkId) {
      if (!condDlg || !checkId) return;
      const ck = (campaign.dcChecks || []).find((c) => c.id === checkId); if (!ck) return;
      const lc = cnd().ensureDCLink(campaign, ck);
      condDlg.mode = lc.id; condDlg.keys = []; condRenderDialog();
    },
    condDialogPreset(which) { if (!condDlg) return; condDlg.keys = which === 'success' ? ['success', 'critSuccess'] : ['fail', 'critFail']; condRenderDialog(); },
    condDialogKey(key, on) { if (!condDlg) return; const s = new Set(condDlg.keys); if (on) s.add(key); else s.delete(key); condDlg.keys = Array.from(s); },
    condDialogClose() { condDlg = null; const el = document.getElementById('cond-dialog'); if (el) el.remove(); },
    condDialogOk() {
      const d = condDlg; if (!d) return;
      let cond;
      if (d.mode === '__new__') {
        const labels = d.newKind === 'switch' ? d.newStates.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
        if (d.newKind === 'switch' && labels.length < 2) { window.alert('A switch needs at least two states.'); return; }
        // For a new switch the checkbox keys are the typed labels; map them to the keys the switch really gets.
        const ns = d.newSettings || {};
        if (d.newKind === 'dccheck') { window.alert('Choose a DC check first.'); return; }
        if (d.newKind === 'milestone' && !ns.checkpointId) { window.alert('Choose a milestone.'); return; }
        if (d.newKind === 'resolved' && !ns.moduleId) { window.alert('Choose the content that has to be completed.'); return; }
        if (d.newKind === 'presence' && !ns.entityId) { window.alert('Choose who has to be present.'); return; }
        if (d.newKind === 'item' && !String(ns.itemName || '').trim()) { window.alert('Type the name of the item.'); return; }
        let nm = (d.newName || '').trim();
        if (!nm) {
          const cp = (campaign.checkpoints || []).find((c) => c.id === ns.checkpointId);
          const ent = campaign.entities[ns.entityId];
          const mod = (campaign.contentModules || []).find((x) => x.id === ns.moduleId);
          nm = d.newKind === 'milestone' ? `Reached ${cp ? cp.label : 'milestone'}`
            : d.newKind === 'resolved' ? `${mod ? condModuleLabel(mod) : 'Content'} completed`
            : d.newKind === 'presence' ? `${ent ? ent.name : 'Someone'} is present`
            : d.newKind === 'item' ? `Has ${ns.itemName}` : '';
        }
        cond = cnd().createCondition(campaign, { name: nm, kind: d.newKind, stateLabels: labels, settings: ns });
        if (d.newKind === 'switch') d.keys = d.keys.map((k) => (cond.states.find((s) => s.label === k) || {}).key).filter(Boolean);
      } else cond = cnd().byId(campaign, d.mode);
      if (!cond) return;
      if (!d.keys.length) { window.alert('Choose at least one result.'); if (d.mode === '__new__') cnd().deleteCondition(campaign, cond.id); return; }
      const t = d.target;
      if (t.moduleId) {
        const m = (campaign.contentModules || []).find((x) => x.id === t.moduleId);
        if (m) m.showIf = { conditionId: cond.id, states: d.keys.slice(), negate: d.negate };
        window.app.condDialogClose();
        condMutate(() => {});
        return;
      }
      if (t.node) { const fresh = cnd().sectionsAt(t.ta.value, t.node.openStart).find((n) => n.openStart === t.node.openStart); condApplyText(t.ta, cnd().retargetSection(t.ta.value, fresh || t.node, cond.id, d.keys, d.negate)); }
      else { const w = cnd().wrapSelection(t.ta.value, t.start, t.end, cond.id, d.keys, d.negate); condApplyText(t.ta, w.text, w.selStart, w.selEnd); }
      window.app.condDialogClose();
      persistSafely();
    }
  };
}
