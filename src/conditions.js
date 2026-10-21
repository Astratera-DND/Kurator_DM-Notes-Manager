// Conditions: a condition is a named test with a few possible results
// ("states"). Text can be marked so that it only shows for some states:
//
//   [[IF:conditionId:state1,state2]] text [[/IF]]     shows in those states
//   [[IF:conditionId:!state1,state2]] text [[/IF]]    shows in every other state
//
// Sections can be nested (both must hold). Nothing is rewritten when a
// condition changes: sections simply show or collapse to one line.
//
// Kinds:
//   switch     states are named by the DM (default Off / On); the DM picks one.
//   dice       Critical failure / Failure / Success / Critical success, set by a roll.
//   milestone  Not reached yet / Reached, derived from the current milestone in Play.
//   combo      Met / Not met, derived from other conditions (all or any).
//   presence   Present / Not present: is an entity in the "Present here" list of a location
//              (or of any location) at the milestone Play is at?
//   item       Has it / Doesn't have it: does an entity's inventory hold an item of that name?
//   resolved   Resolved / Not resolved: has a content block been ticked as resolved?
//
// Everything is wrapped in an IIFE; only window.Conditions is visible.
(function () {

const DICE_STATES = [
  { key: 'critFail', label: 'Critical failure' },
  { key: 'fail', label: 'Failure' },
  { key: 'success', label: 'Success' },
  { key: 'critSuccess', label: 'Critical success' }
];
const MILESTONE_STATES = [{ key: 'before', label: 'Not reached yet' }, { key: 'reached', label: 'Reached' }];
const COMBO_STATES = [{ key: 'met', label: 'Met' }, { key: 'unmet', label: 'Not met' }];
const PRESENCE_STATES = [{ key: 'here', label: 'Present' }, { key: 'away', label: 'Not present' }];
const ITEM_STATES = [{ key: 'has', label: 'Has it' }, { key: 'lacks', label: 'Doesn\'t have it' }];
const RESOLVED_STATES = [{ key: 'done', label: 'Resolved' }, { key: 'open', label: 'Not resolved' }];
const KIND_LABELS = { switch: 'Switch', dice: 'Dice roll', milestone: 'Milestone', combo: 'Combination', presence: 'Present here', item: 'Has item', resolved: 'Content resolved' };

const TOKEN_RE = /\[\[IF:([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_,!]*))?\]\]|\[\[\/IF\]\]/g;

// What the renderer needs to know to evaluate conditions: the milestone Play is
// at, and whether text is shown for playing ('play': unmet sections collapse)
// or for preparing ('edit': everything shows, sections carry a small label).
let _ctx = { curTimeId: null, mode: 'play' };
function setContext(ctx) { _ctx = Object.assign({ curTimeId: null, mode: 'play' }, ctx || {}); }
function getContext() { return _ctx; }

function _constants() { return (typeof module !== 'undefined' && module.exports) ? require('./constants') : window.Constants; }

function newId() { return `cnd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }

function list(campaign) { return Array.isArray(campaign.conditions) ? campaign.conditions : []; }
function byId(campaign, id) { return list(campaign).find((c) => c.id === id) || null; }

function slugKey(label, taken) {
  let base = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'state';
  let key = base, n = 2;
  while (taken.includes(key)) key = `${base}_${n++}`;
  return key;
}

function statesOf(cond) {
  if (!cond) return [];
  if (cond.kind === 'dice') return DICE_STATES;
  if (cond.kind === 'milestone') return MILESTONE_STATES;
  if (cond.kind === 'combo') return COMBO_STATES;
  if (cond.kind === 'presence') return PRESENCE_STATES;
  if (cond.kind === 'item') return ITEM_STATES;
  if (cond.kind === 'resolved') return RESOLVED_STATES;
  return Array.isArray(cond.states) && cond.states.length ? cond.states : [{ key: 'off', label: 'Off' }, { key: 'on', label: 'On' }];
}

function createCondition(campaign, { name, kind = 'switch', stateLabels, settings } = {}) {
  if (!Array.isArray(campaign.conditions)) campaign.conditions = [];
  const cond = { id: newId(), name: (name || '').trim() || 'New condition', kind, states: [], current: null, settings: {}, rollLog: [] };
  if (kind === 'switch') {
    const labels = (stateLabels && stateLabels.length ? stateLabels : ['Off', 'On']);
    labels.forEach((l) => cond.states.push({ key: slugKey(l, cond.states.map((s) => s.key)), label: l }));
    cond.current = cond.states[0].key;
  } else if (kind === 'dice') {
    cond.settings = { checkType: 'perception', dc: 12, critMargin: 10 };
  } else if (kind === 'milestone') {
    cond.settings = { checkpointId: null };
  } else if (kind === 'combo') {
    cond.settings = { mode: 'all', rules: [] };
  } else if (kind === 'presence') {
    cond.settings = { entityId: null, locationId: null };
  } else if (kind === 'item') {
    cond.settings = { entityId: null, itemName: '' };
  } else if (kind === 'resolved') {
    cond.settings = { moduleId: null };
  }
  Object.assign(cond.settings, settings || {});
  campaign.conditions.push(cond);
  return cond;
}

function deleteCondition(campaign, id) {
  campaign.conditions = list(campaign).filter((c) => c.id !== id);
  // Combinations that used it simply lose that rule.
  list(campaign).forEach((c) => { if (c.kind === 'combo' && c.settings && Array.isArray(c.settings.rules)) c.settings.rules = c.settings.rules.filter((r) => r.conditionId !== id); });
}

function addSwitchState(cond, label) {
  const l = String(label || '').trim();
  if (!l || cond.kind !== 'switch') return null;
  const state = { key: slugKey(l, cond.states.map((s) => s.key)), label: l };
  cond.states.push(state);
  return state;
}

// A state that is in use cannot silently vanish: sections naming it just stop matching.
function removeSwitchState(cond, key) {
  if (cond.kind !== 'switch' || cond.states.length <= 2) return false;
  cond.states = cond.states.filter((s) => s.key !== key);
  if (cond.current === key) cond.current = cond.states[0].key;
  return true;
}

function setState(cond, key) {
  if (cond.kind !== 'switch') return false;
  if (!cond.states.some((s) => s.key === key)) return false;
  cond.current = key;
  return true;
}

function diceOutcome(cond, total, natural) {
  // A DC check counts a natural 20 / natural 1 as critical (settings.natCrit).
  if (cond.settings.natCrit && natural === 20) return 'critSuccess';
  if (cond.settings.natCrit && natural === 1) return 'critFail';
  const dc = Number(cond.settings.dc) || 0;
  const margin = Math.max(0, Number(cond.settings.critMargin) || 0);
  if (margin > 0 && total >= dc + margin) return 'critSuccess';
  if (total >= dc) return 'success';
  if (margin > 0 && total <= dc - margin) return 'critFail';
  return 'fail';
}

function rollDice(cond, total, natural) {
  if (cond.kind !== 'dice' || !Number.isFinite(Number(total))) return null;
  const value = Number(total);
  const key = diceOutcome(cond, value, natural);
  cond.current = key;
  if (!Array.isArray(cond.rollLog)) cond.rollLog = [];
  cond.rollLog.push({ value, outcome: key, at: new Date().toISOString() });
  return key;
}

// --- DC checks as conditions -------------------------------------------------
// Every DC check has a dice-roll condition of its own (check.conditionId), named
// like the check. Rolling the check sets that condition's result, so any text in the
// campaign can depend on how the check went. The check itself is unchanged.

function dcCheckLabel(check) {
  if (check.name && check.name.trim()) return check.name.trim();
  const t = (_constants().CHECK_TYPES || []).find((x) => x.key === check.checkType);
  return t ? t.label : 'DC check';
}

function dcPassDC(check) {
  const c = (check.conditions || []).find((x) => (x.trigger === 'success' || x.trigger === 'failure') && Number.isFinite(Number(x.dc)));
  if (c) return Number(c.dc);
  const rows = (check.table || []).map((r) => Number(r.dc)).filter(Number.isFinite);
  return rows.length ? Math.min(...rows) : 10;
}

function ensureDCLink(campaign, check) {
  let cond = check.conditionId ? byId(campaign, check.conditionId) : null;
  if (!cond) {
    cond = createCondition(campaign, { name: dcCheckLabel(check), kind: 'dice', settings: { checkType: check.checkType, dc: dcPassDC(check), critMargin: 0, natCrit: true } });
    check.conditionId = cond.id;
    const last = (check.rollLog || [])[(check.rollLog || []).length - 1];
    if (last) cond.current = diceOutcome(cond, last.value, last.value);
  }
  cond.linkedCheckId = check.id;
  cond.name = dcCheckLabel(check);
  cond.settings.checkType = check.checkType;
  return cond;
}

function syncDCChecks(campaign) {
  const checks = campaign.dcChecks || [];
  checks.forEach((c) => ensureDCLink(campaign, c));
  campaign.conditions = list(campaign).filter((c) => !c.linkedCheckId || checks.some((k) => k.id === c.linkedCheckId));
}

function applyDCRoll(campaign, check, value) {
  const cond = ensureDCLink(campaign, check);
  rollDice(cond, value, value);
  return cond;
}

function clearDCResult(campaign, check) {
  const cond = check.conditionId ? byId(campaign, check.conditionId) : null;
  if (cond) cond.current = null;
}

function clearResult(cond) { if (cond.kind === 'dice') cond.current = null; }

function checkpointOrder(campaign, id) {
  const cp = (campaign.checkpoints || []).find((c) => c.id === id);
  return cp ? (cp.order || 0) : null;
}

// Who is listed as present at `locationId` at milestone `timeId` (the arrival of that
// milestone, else the latest earlier one - the same rule Play uses).
function presentIdsAt(campaign, locationId, timeId) {
  const cps = campaign.checkpoints || [];
  const cur = cps.find((c) => c.id === timeId);
  if (!cur) return [];
  const arrivals = (campaign.blocks || []).filter((b) => b.kind === 'arrival' && b.locationId === locationId);
  let a = arrivals.find((x) => x.timeId === timeId);
  if (!a) {
    const earlier = cps.filter((c) => (c.order || 0) < (cur.order || 0)).sort((x, y) => (y.order || 0) - (x.order || 0));
    for (const cp of earlier) { const f = arrivals.find((x) => x.timeId === cp.id); if (f) { a = f; break; } }
  }
  return a ? (a.presence || []) : [];
}

function holdsItem(entity, name) {
  const want = String(name || '').trim().toLowerCase();
  if (!entity || !want) return false;
  return (entity.inventoryCategories || []).some((cat) => (cat.rows || []).some((r) => String(r.name || '').trim().toLowerCase().includes(want)));
}

// The current state key of a condition, or null when it has none yet (an
// unrolled dice roll). ctx = { curTimeId }.
function stateOf(campaign, cond, ctx, depth = 0) {
  if (!cond || depth > 8) return null;
  if (cond.kind === 'switch') return statesOf(cond).some((s) => s.key === cond.current) ? cond.current : statesOf(cond)[0].key;
  if (cond.kind === 'dice') return DICE_STATES.some((s) => s.key === cond.current) ? cond.current : null;
  if (cond.kind === 'milestone') {
    const target = checkpointOrder(campaign, cond.settings && cond.settings.checkpointId);
    const now = ctx && ctx.curTimeId ? checkpointOrder(campaign, ctx.curTimeId) : null;
    if (target == null || now == null) return 'before';
    return now >= target ? 'reached' : 'before';
  }
  if (cond.kind === 'presence') {
    const st = cond.settings || {};
    const timeId = ctx && ctx.curTimeId;
    if (!st.entityId || !timeId) return 'away';
    const locs = st.locationId ? [st.locationId] : Array.from(new Set((campaign.blocks || []).filter((b) => b.kind === 'arrival').map((b) => b.locationId)));
    return locs.some((l) => presentIdsAt(campaign, l, timeId).includes(st.entityId)) ? 'here' : 'away';
  }
  if (cond.kind === 'item') {
    const st = cond.settings || {};
    const ents = st.entityId ? [(campaign.entities || {})[st.entityId]] : Object.values(campaign.entities || {});
    return ents.some((e) => holdsItem(e, st.itemName)) ? 'has' : 'lacks';
  }
  if (cond.kind === 'resolved') {
    const m = (campaign.contentModules || []).find((x) => x.id === (cond.settings && cond.settings.moduleId));
    return m && m.complete ? 'done' : 'open';
  }
  if (cond.kind === 'combo') {
    const rules = (cond.settings && cond.settings.rules) || [];
    if (!rules.length) return 'unmet';
    const ok = rules.map((r) => {
      const target = byId(campaign, r.conditionId);
      if (!target) return false;
      const s = stateOf(campaign, target, ctx, depth + 1);
      const hit = s != null && (r.states || []).includes(s);
      return r.negate ? !hit : hit;
    });
    return ((cond.settings.mode === 'any') ? ok.some(Boolean) : ok.every(Boolean)) ? 'met' : 'unmet';
  }
  return null;
}

// Does `combo` (directly or through other combinations) depend on `targetId`?
function dependsOn(campaign, comboId, targetId, seen = new Set()) {
  if (comboId === targetId) return true;
  if (seen.has(comboId)) return false;
  seen.add(comboId);
  const c = byId(campaign, comboId);
  if (!c || c.kind !== 'combo') return false;
  return ((c.settings && c.settings.rules) || []).some((r) => dependsOn(campaign, r.conditionId, targetId, seen));
}

// A rule "combo uses target" is allowed only when it would not create a loop.
function canUse(campaign, comboId, targetId) { return !dependsOn(campaign, targetId, comboId); }

function parseKeys(raw) {
  const negate = !!raw && raw.startsWith('!');
  const keys = (raw || '').replace(/^!/, '').split(',').map((s) => s.trim()).filter(Boolean);
  return { negate, keys };
}

function sectionShows(campaign, cond, raw, ctx) {
  if (!cond) return true; // a deleted condition never hides text
  const { negate, keys } = parseKeys(raw);
  const s = stateOf(campaign, cond, ctx);
  const hit = s != null && keys.includes(s);
  return negate ? !hit : hit;
}

function describeSection(campaign, cond, raw) {
  if (!cond) return 'Deleted condition';
  const { negate, keys } = parseKeys(raw);
  const labels = keys.map((k) => { const s = statesOf(cond).find((x) => x.key === k); return s ? s.label : k; });
  return `${cond.name} ${negate ? 'is not' : 'is'} ${labels.join(' or ') || '…'}`;
}

// Matched tokens as a tree of sections. Unmatched tokens are left as plain text.
function parseSections(text) {
  const toks = [];
  let m; TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text))) toks.push({ open: !!m[1], cid: m[1] || null, raw: m[2] || '', start: m.index, end: m.index + m[0].length });
  const roots = [];
  const stack = [];
  toks.forEach((t) => {
    if (t.open) { const node = { cid: t.cid, raw: t.raw, openStart: t.start, openEnd: t.end, children: [] }; (stack.length ? stack[stack.length - 1].children : roots).push(node); stack.push(node); }
    else if (stack.length) { const node = stack.pop(); node.closeStart = t.start; node.closeEnd = t.end; }
  });
  // Opens that never closed are not sections (they stay as visible text), but
  // sections nested inside them still count.
  const clean = (nodes) => nodes.reduce((acc, n) => {
    const kids = clean(n.children);
    if (n.closeStart != null) { n.children = kids; acc.push(n); } else acc.push(...kids);
    return acc;
  }, []);
  return clean(roots);
}

// Replace every section with what Play should show. hidden(node, innerRaw)
// returns the replacement for a section whose condition is not met; met
// sections just lose their markers (their text flows on as normal text).
function resolveText(text, campaign, ctx, hidden, shown) {
  if (!text || text.indexOf('[[IF:') === -1) return text || '';
  const sections = parseSections(text);
  const render = (from, to, nodes) => {
    let out = '', pos = from;
    nodes.forEach((n) => {
      out += text.slice(pos, n.openStart);
      const cond = byId(campaign, n.cid);
      const inner = render(n.openEnd, n.closeStart, n.children);
      const label = describeSection(campaign, cond, n.raw);
      out += sectionShows(campaign, cond, n.raw, ctx) ? (shown ? shown({ cond, raw: n.raw, label }, inner) : inner) : hidden({ cond, raw: n.raw, label: describeSection(campaign, cond, n.raw) }, text.slice(n.openEnd, n.closeStart));
      pos = n.closeEnd;
    });
    return out + text.slice(pos, to);
  };
  return render(0, text.length, sections);
}

// For excerpts, search and the graph: the text with all markers removed.
function stripTokens(text) { return (text || '').replace(TOKEN_RE, ''); }

// Sections around a text position (outermost first) for the editor.
function sectionsAt(text, pos) {
  const found = [];
  const walk = (nodes) => nodes.forEach((n) => { if (pos >= n.openStart && pos <= n.closeEnd) { found.push(n); walk(n.children); } });
  walk(parseSections(text));
  return found;
}

function wrapSelection(text, start, end, cid, keys, negate) {
  const open = `[[IF:${cid}:${negate ? '!' : ''}${keys.join(',')}]]`;
  return { text: text.slice(0, start) + open + text.slice(start, end) + '[[/IF]]' + text.slice(end), selStart: start, selEnd: end + open.length + 7 };
}

function unwrapSection(text, node) {
  return text.slice(0, node.openStart) + text.slice(node.openEnd, node.closeStart) + text.slice(node.closeEnd);
}

function retargetSection(text, node, cid, keys, negate) {
  const open = `[[IF:${cid}:${negate ? '!' : ''}${keys.join(',')}]]`;
  return text.slice(0, node.openStart) + open + text.slice(node.openEnd);
}

// Every [[IF:...]] reference in a piece of text: [{ cid, raw }]
function referencesIn(text) {
  const out = [];
  let m; TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text || ''))) if (m[1]) out.push({ cid: m[1], raw: m[2] || '' });
  return out;
}

// Every text a content module owns.
function moduleTexts(module) {
  const t = [module.html, module.text];
  (module.lines || []).forEach((l) => t.push(l.text));
  return t.filter(Boolean);
}

function conditionIdsOfModule(module) {
  const ids = new Set();
  moduleTexts(module).forEach((s) => referencesIn(s).forEach((r) => ids.add(r.cid)));
  if (module.showIf && module.showIf.conditionId) ids.add(module.showIf.conditionId);
  return ids;
}

// Dice conditions of the DC checks whose [[DCCHECK:id]] button sits in this module.
function dcConditionIdsOfModule(campaign, module) {
  const ids = new Set();
  const checks = campaign.dcChecks || [];
  if (!checks.length) return ids;
  const re = /\[\[DCCHECK:([a-zA-Z0-9_]+)\]\]/g;
  moduleTexts(module).forEach((s) => { let m; re.lastIndex = 0; while ((m = re.exec(s))) { const k = checks.find((c) => c.id === m[1]); if (k && k.conditionId) ids.add(k.conditionId); } });
  return ids;
}

// Where a condition is used: module ids (sections) and combinations.
function usages(campaign, cid) {
  const modules = (campaign.contentModules || []).filter((m) => conditionIdsOfModule(m).has(cid)).map((m) => m.id);
  const combos = list(campaign).filter((c) => c.kind === 'combo' && ((c.settings && c.settings.rules) || []).some((r) => r.conditionId === cid)).map((c) => c.id);
  return { modules, combos };
}

// Whole-card condition (module.showIf = { conditionId, states, negate }).
function cardShows(campaign, module, ctx) {
  const s = module && module.showIf;
  if (!s || !s.conditionId) return true;
  return sectionShows(campaign, byId(campaign, s.conditionId), `${s.negate ? '!' : ''}${(s.states || []).join(',')}`, ctx);
}

function resetAll(campaign) {
  list(campaign).forEach((c) => {
    if (c.kind === 'switch') c.current = c.states[0] ? c.states[0].key : null;
    if (c.kind === 'dice') c.current = null;
  });
}

const api = {
  DICE_STATES, MILESTONE_STATES, COMBO_STATES, PRESENCE_STATES, ITEM_STATES, RESOLVED_STATES, presentIdsAt, holdsItem, KIND_LABELS, TOKEN_RE,
  setContext, getContext, list, byId, statesOf, createCondition, deleteCondition, addSwitchState, removeSwitchState, setState,
  diceOutcome, rollDice, clearResult, stateOf, dependsOn, canUse, parseKeys, sectionShows, describeSection,
  parseSections, resolveText, stripTokens, sectionsAt, wrapSelection, unwrapSection, retargetSection,
  ensureDCLink, syncDCChecks, applyDCRoll, clearDCResult, dcCheckLabel, referencesIn, conditionIdsOfModule, dcConditionIdsOfModule, usages, cardShows, resetAll
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else window.Conditions = api;
})();
