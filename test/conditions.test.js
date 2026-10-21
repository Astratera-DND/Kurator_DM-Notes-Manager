const assert = require('assert');
const DM = require('../src/dataModel');
const C = require('../src/conditions');

let failures = 0;
function test(name, fn) { try { fn(); console.log(`ok  - ${name}`); } catch (e) { failures++; console.log(`FAIL - ${name}\n  ${e.stack}`); } }
const hidden = (info, inner) => `{HIDDEN:${info.label}:${inner}}`;

function setup() {
  const c = DM.emptyCampaign();
  const alert = C.createCondition(c, { name: 'Alert level', kind: 'switch', stateLabels: ['Calm', 'Suspicious', 'Alarmed'] });
  const noticed = C.createCondition(c, { name: 'Goblin notices', kind: 'dice', settings: { dc: 14, critMargin: 10 } });
  return { c, alert, noticed };
}

test('a switch can have more than two states and starts on the first', () => {
  const { alert } = setup();
  assert.deepStrictEqual(alert.states.map((s) => s.key), ['calm', 'suspicious', 'alarmed']);
  assert.strictEqual(alert.current, 'calm');
  assert.ok(C.setState(alert, 'alarmed'));
  assert.ok(!C.setState(alert, 'nope'));
  C.addSwitchState(alert, 'Lockdown');
  assert.strictEqual(C.statesOf(alert).length, 4);
});

test('dice outcomes: success, failure and both criticals', () => {
  const { noticed } = setup();
  assert.strictEqual(C.diceOutcome(noticed, 14), 'success');
  assert.strictEqual(C.diceOutcome(noticed, 13), 'fail');
  assert.strictEqual(C.diceOutcome(noticed, 24), 'critSuccess');
  assert.strictEqual(C.diceOutcome(noticed, 4), 'critFail');
  noticed.settings.critMargin = 0;
  assert.strictEqual(C.diceOutcome(noticed, 40), 'success');
  assert.strictEqual(C.diceOutcome(noticed, 1), 'fail');
});

test('an unrolled dice condition has no state: positive sections hide, negated ones show', () => {
  const { c, noticed } = setup();
  const t = `a [[IF:${noticed.id}:fail,critFail]]ESC[[/IF]] b [[IF:${noticed.id}:!fail,critFail]]QUIET[[/IF]]`;
  assert.strictEqual(C.resolveText(t, c, {}, hidden), `a {HIDDEN:Goblin notices is Failure or Critical failure:ESC} b QUIET`);
  C.rollDice(noticed, 8);
  assert.strictEqual(C.resolveText(t, c, {}, hidden), 'a ESC b {HIDDEN:Goblin notices is not Failure or Critical failure:QUIET}');
  assert.strictEqual(noticed.rollLog.length, 1);
});

test('nested sections need both; an unclosed marker stays visible but its nested sections still work', () => {
  const { c, alert, noticed } = setup();
  C.rollDice(noticed, 20);
  const t = `[[IF:${noticed.id}:success]]A[[IF:${alert.id}:alarmed]]B[[/IF]]C[[/IF]]`;
  assert.strictEqual(C.resolveText(t, c, {}, hidden), `A{HIDDEN:Alert level is Alarmed:B}C`);
  C.setState(alert, 'alarmed');
  assert.strictEqual(C.resolveText(t, c, {}, hidden), 'ABC');
  C.rollDice(noticed, 1);
  assert.strictEqual(C.resolveText(t, c, {}, hidden), `{HIDDEN:Goblin notices is Success:A[[IF:${alert.id}:alarmed]]B[[/IF]]C}`.replace(/\[\[IF:[^\]]*\]\]|\[\[\/IF\]\]/g, (m) => m));
  const open = `x [[IF:${alert.id}:alarmed]] y [[IF:${alert.id}:calm]]z[[/IF]]`;
  assert.ok(C.resolveText(open, c, {}, hidden).includes('[[IF:'), 'the unclosed marker stays in the text');
  assert.ok(C.resolveText(open, c, {}, hidden).includes('{HIDDEN:Alert level is Calm:z}'));
});

test('a deleted condition never hides text', () => {
  const { c, alert } = setup();
  const t = `[[IF:${alert.id}:alarmed]]keep me[[/IF]]`;
  C.deleteCondition(c, alert.id);
  assert.strictEqual(C.resolveText(t, c, {}, hidden), 'keep me');
});

test('milestone conditions follow the current milestone', () => {
  const { c } = setup();
  const dawn = DM.createCheckpoint(c, { label: 'Dawn' });
  const noon = DM.createCheckpoint(c, { label: 'Noon' });
  const m = C.createCondition(c, { name: 'After dawn', kind: 'milestone', settings: { checkpointId: noon.id } });
  assert.strictEqual(C.stateOf(c, m, { curTimeId: dawn.id }), 'before');
  assert.strictEqual(C.stateOf(c, m, { curTimeId: noon.id }), 'reached');
});

test('combinations read other conditions (all / any, negation) and refuse loops', () => {
  const { c, alert, noticed } = setup();
  const both = C.createCondition(c, { name: 'Trouble', kind: 'combo', settings: { mode: 'all', rules: [{ conditionId: alert.id, states: ['alarmed'] }, { conditionId: noticed.id, states: ['fail', 'critFail'] }] } });
  assert.strictEqual(C.stateOf(c, both, {}), 'unmet');
  C.setState(alert, 'alarmed'); C.rollDice(noticed, 3);
  assert.strictEqual(C.stateOf(c, both, {}), 'met');
  both.settings.mode = 'any'; C.setState(alert, 'calm');
  assert.strictEqual(C.stateOf(c, both, {}), 'met');
  both.settings.rules[1].negate = true;
  assert.strictEqual(C.stateOf(c, both, {}), 'unmet');
  const outer = C.createCondition(c, { name: 'Outer', kind: 'combo', settings: { mode: 'all', rules: [{ conditionId: both.id, states: ['met'] }] } });
  assert.ok(!C.canUse(c, both.id, outer.id), 'both -> outer would loop');
  assert.ok(C.canUse(c, outer.id, alert.id));
  assert.ok(!C.canUse(c, both.id, both.id));
  // a loop that slipped in anyway cannot hang evaluation
  both.settings.rules.push({ conditionId: outer.id, states: ['met'] });
  C.stateOf(c, outer, {});
});

test('editor helpers: wrap, find, retarget and unwrap a section', () => {
  const { alert } = setup();
  const text = 'The guard sees you.';
  const w = C.wrapSelection(text, 4, 9, alert.id, ['alarmed'], false);
  assert.strictEqual(w.text, `The [[IF:${alert.id}:alarmed]]guard[[/IF]] sees you.`);
  const at = C.sectionsAt(w.text, 5 + `[[IF:${alert.id}:alarmed]]`.length);
  assert.strictEqual(at.length, 1);
  const re = C.retargetSection(w.text, at[0], alert.id, ['calm'], true);
  assert.ok(re.includes(`[[IF:${alert.id}:!calm]]guard`));
  assert.strictEqual(C.unwrapSection(w.text, at[0]), text);
  assert.strictEqual(C.stripTokens(w.text), text);
});

test('usages and card-level conditions', () => {
  const { c, alert } = setup();
  const m = DM.createContentModule(c, { type: 'note', name: 'N', text: `[[IF:${alert.id}:alarmed]]x[[/IF]]` });
  const card = DM.createContentModule(c, { type: 'note', name: 'Card', text: 'whole card' });
  card.showIf = { conditionId: alert.id, states: ['alarmed'], negate: false };
  const u = C.usages(c, alert.id);
  assert.deepStrictEqual(u.modules.sort(), [m.id, card.id].sort());
  assert.ok(!C.cardShows(c, card, {}));
  C.setState(alert, 'alarmed');
  assert.ok(C.cardShows(c, card, {}));
  C.resetAll(c);
  assert.strictEqual(alert.current, 'calm');
});

const Query = require('../src/query');
test('Play collapses unmet sections to one line (still openable); Create shows everything with a label', () => {
  const { c, alert } = setup();
  const t = `Before [[IF:${alert.id}:alarmed]]**Run!** [[/IF]]after`;
  C.setContext({ mode: 'play' });
  let html = Query.renderMentions(t, c).html;
  assert.ok(html.includes('cond-collapsed') && html.includes('If: Alert level is Alarmed') && html.includes('<strong>Run!</strong>'));
  assert.ok(!html.includes('[[IF'));
  C.setState(alert, 'alarmed');
  html = Query.renderMentions(t, c).html;
  assert.ok(!html.includes('cond-collapsed') && html.includes('<strong>Run!</strong>') && !html.includes('[[IF'));
  C.setState(alert, 'calm');
  C.setContext({ mode: 'edit' });
  html = Query.renderMentions(t, c).html;
  assert.ok(html.includes('cond-badge unmet') && html.includes('Run!') && !html.includes('cond-collapsed'));
  C.setContext({ mode: 'play' });
});

test('loading repairs broken conditions', () => {
  const Storage = require('../src/storage');
  const c = DM.emptyCampaign();
  c.conditions = [null, { id: 'x', kind: 'bogus' }, { id: 'cnd_a', kind: 'switch', name: 'A', states: [], current: 'zzz' }, { id: 'cnd_b', kind: 'combo' }];
  Storage.normalizeCampaign(c);
  assert.strictEqual(c.conditions.length, 2);
  assert.strictEqual(c.conditions[0].current, 'off');
  assert.deepStrictEqual(c.conditions[1].settings.rules, []);
});

test('a card-level condition collapses the whole block in Play (title hidden) and leaves Create untouched', () => {
  const { c, alert } = setup();
  const m = DM.createContentModule(c, { type: 'note', name: 'Second patrol', text: 'More goblins arrive.' });
  const loc = DM.createEntity(c, { type: 'location', name: 'Camp' });
  DM.createAssignment(c, { moduleId: m.id, entityId: loc.id, timeId: null });
  m.showIf = { conditionId: alert.id, states: ['alarmed'], negate: false };
  C.setContext({ mode: 'play' });
  let item = Query.getAssignedContent(c, loc.id, 'note')[0];
  assert.strictEqual(item.name, '[[GREY]]Conditional content: Second patrol[[/GREY]]');
  const titleHtml = Query.renderMentions(item.name, c).html;
  assert.ok(titleHtml.includes('cond-locked') && titleHtml.includes('Second patrol') && !titleHtml.includes('[['));
  assert.ok(Query.renderMentions(item.text, c).html.includes('cond-collapsed'));
  C.setState(alert, 'alarmed');
  item = Query.getAssignedContent(c, loc.id, 'note')[0];
  assert.strictEqual(item.name, 'Second patrol');
  assert.ok(!Query.renderMentions(item.text, c).html.includes('cond-collapsed'));
  C.setContext({ mode: 'edit' });
  C.setState(alert, 'calm');
  item = Query.getAssignedContent(c, loc.id, 'note')[0];
  assert.strictEqual(item.text, 'More goblins arrive.');
  assert.strictEqual(m.text, 'More goblins arrive.');
  C.setContext({ mode: 'play' });
});

test('while playing, conditional text carries a switch icon for switches and dice, not for derived conditions', () => {
  const { c, alert, noticed } = setup();
  const ms = C.createCondition(c, { name: 'Dawn', kind: 'milestone' });
  C.setContext({ mode: 'play' });
  const html = (cond, keys) => Query.renderMentions(`[[IF:${cond.id}:${keys}]]x[[/IF]]`, c).html;
  assert.ok(html(alert, 'alarmed').includes(`condToggleAt(event,'${alert.id}')`), 'collapsed line');
  C.setState(alert, 'alarmed');
  assert.ok(html(alert, 'alarmed').includes(`condToggleAt(event,'${alert.id}')`), 'met label');
  assert.ok(html(noticed, 'fail').includes('condToggleAt'));
  assert.ok(!html(ms, 'reached').includes('condToggleAt'));
  C.setContext({ mode: 'edit' });
  assert.ok(!html(alert, 'alarmed').includes('condToggleAt'));
  C.setContext({ mode: 'play' });
});

test('loading repairs the remembered Content-tab milestone and field', () => {
  const Storage = require('../src/storage');
  const c = DM.emptyCampaign();
  c.meta.lastContentTimeId = 5; c.meta.lastContentField = [1];
  Storage.normalizeCampaign(c);
  assert.strictEqual(c.meta.lastContentTimeId, null);
  assert.strictEqual(c.meta.lastContentField, null);
  c.meta.lastContentField = { id: 'arr-text', selStart: 3 };
  Storage.normalizeCampaign(c);
  assert.strictEqual(c.meta.lastContentField.id, 'arr-text');
});

test('every DC check has a linked dice-roll condition that follows its rolls', () => {
  const c = DM.emptyCampaign();
  const check = DM.createDCCheck(c, { name: 'Spot the wire', checkType: 'perception' });
  DM.addDCCondition(c, check.id, { trigger: 'failure', dc: 14, occurrence: 1, text: 'x' });
  DM.appendDCRollLogEntry(c, check.id, 15);
  C.syncDCChecks(c);
  const cond = C.byId(c, check.conditionId);
  assert.ok(cond && cond.kind === 'dice' && cond.linkedCheckId === check.id);
  assert.strictEqual(cond.name, 'Spot the wire');
  assert.strictEqual(cond.settings.dc, 14, 'pass DC taken from the check');
  assert.strictEqual(cond.current, 'success', 'an earlier roll is picked up when the link is made');
  C.applyDCRoll(c, check, 9);
  assert.strictEqual(cond.current, 'fail');
  C.applyDCRoll(c, check, 20);
  assert.strictEqual(cond.current, 'critSuccess', 'a natural 20 is critical');
  C.applyDCRoll(c, check, 1);
  assert.strictEqual(cond.current, 'critFail');
  C.clearDCResult(c, check);
  assert.strictEqual(cond.current, null);
  check.name = 'Renamed';
  C.syncDCChecks(c);
  assert.strictEqual(cond.name, 'Renamed');
  assert.strictEqual(C.syncDCChecks(c), undefined);
  assert.strictEqual(c.conditions.length, 1, 'syncing again adds nothing');
  DM.deleteDCCheck(c, check.id);
  C.syncDCChecks(c);
  assert.strictEqual(c.conditions.length, 0, 'the condition goes with its check');
});

test('a collapsed line that was opened stays open when the page is drawn again', () => {
  const { c, alert } = setup();
  const t = `[[IF:${alert.id}:alarmed]]secret[[/IF]]`;
  C.setContext({ mode: 'play' });
  const first = Query.renderMentions(t, c).html;
  const key = /\['(c[a-z0-9]+)'\]/.exec(first)[1];
  assert.ok(!/<details class="cond-collapsed" open/.test(first));
  C.setContext({ mode: 'play', open: { [key]: true } });
  assert.ok(/<details class="cond-collapsed" open/.test(Query.renderMentions(t, c).html));
  C.setContext({ mode: 'play' });
});

test('Present here: follows the "Present here" list at the current milestone, earlier ones carry forward', () => {
  const c = DM.emptyCampaign();
  const a = DM.createCheckpoint(c, { label: 'Dawn' }), b = DM.createCheckpoint(c, { label: 'Dusk' });
  const hall = DM.createEntity(c, { type: 'location', name: 'Hall' }), yard = DM.createEntity(c, { type: 'location', name: 'Yard' });
  const guard = DM.createEntity(c, { type: 'npc', name: 'Guard' });
  c.blocks.push({ id: 'p1', kind: 'arrival', locationId: hall.id, timeId: a.id, presence: [guard.id] });
  c.blocks.push({ id: 'p2', kind: 'arrival', locationId: hall.id, timeId: b.id, presence: [] });
  const inHall = C.createCondition(c, { name: 'Guard in hall', kind: 'presence', settings: { entityId: guard.id, locationId: hall.id } });
  const anywhere = C.createCondition(c, { name: 'Guard anywhere', kind: 'presence', settings: { entityId: guard.id } });
  const inYard = C.createCondition(c, { name: 'Guard in yard', kind: 'presence', settings: { entityId: guard.id, locationId: yard.id } });
  assert.strictEqual(C.stateOf(c, inHall, { curTimeId: a.id }), 'here');
  assert.strictEqual(C.stateOf(c, inHall, { curTimeId: b.id }), 'away');
  assert.strictEqual(C.stateOf(c, anywhere, { curTimeId: a.id }), 'here');
  assert.strictEqual(C.stateOf(c, inYard, { curTimeId: a.id }), 'away');
  assert.strictEqual(C.stateOf(c, inHall, {}), 'away');
  c.blocks.pop();                                    // no Dusk list: Dawn's carries forward
  assert.strictEqual(C.stateOf(c, inHall, { curTimeId: b.id }), 'here');
  assert.deepStrictEqual(C.statesOf(inHall).map((x) => x.key), ['here', 'away']);
});

test('Has item: reads the inventory tables; Content resolved: follows the tick', () => {
  const c = DM.emptyCampaign();
  const npc = DM.createEntity(c, { type: 'npc', name: 'Smuggler' });
  const other = DM.createEntity(c, { type: 'npc', name: 'Clerk' });
  const cat = DM.createInventoryCategory({ name: 'Pockets' });
  const row = DM.createInventoryRow(); row.name = 'Brass Keycard (level 2)';
  cat.rows.push(row); npc.inventoryCategories = [cat];
  const has = C.createCondition(c, { name: 'Smuggler has keycard', kind: 'item', settings: { entityId: npc.id, itemName: 'keycard' } });
  const anyone = C.createCondition(c, { name: 'Anyone has keycard', kind: 'item', settings: { itemName: 'KEYCARD' } });
  const clerk = C.createCondition(c, { name: 'Clerk has keycard', kind: 'item', settings: { entityId: other.id, itemName: 'keycard' } });
  const blank = C.createCondition(c, { name: 'No name', kind: 'item', settings: { entityId: npc.id, itemName: '' } });
  assert.strictEqual(C.stateOf(c, has, {}), 'has');
  assert.strictEqual(C.stateOf(c, anyone, {}), 'has');
  assert.strictEqual(C.stateOf(c, clerk, {}), 'lacks');
  assert.strictEqual(C.stateOf(c, blank, {}), 'lacks');
  row.name = 'Rope';
  assert.strictEqual(C.stateOf(c, has, {}), 'lacks');
  const m = DM.createContentModule(c, { type: 'scene', name: 'Heist', text: 'x' });
  const done = C.createCondition(c, { name: 'Heist done', kind: 'resolved', settings: { moduleId: m.id } });
  assert.strictEqual(C.stateOf(c, done, {}), 'open');
  m.complete = true;
  assert.strictEqual(C.stateOf(c, done, {}), 'done');
  // they work in sections and combinations like any other condition
  const combo = C.createCondition(c, { name: 'Both', kind: 'combo', settings: { mode: 'all', rules: [{ conditionId: done.id, states: ['done'] }, { conditionId: has.id, states: ['lacks'] }] } });
  assert.strictEqual(C.stateOf(c, combo, {}), 'met');
  assert.ok(C.sectionShows(c, done, 'done', {}));
  assert.ok(!C.sectionShows(c, done, '!done', {}));
});

test('loading keeps the new kinds', () => {
  const Storage = require('../src/storage');
  const c = DM.emptyCampaign();
  ['presence', 'item', 'resolved'].forEach((k) => C.createCondition(c, { name: k, kind: k }));
  Storage.normalizeCampaign(c);
  assert.strictEqual(c.conditions.length, 3);
});

test('specific roll values: at least, at most, exactly, between', () => {
  const c = DM.emptyCampaign();
  const d = C.createCondition(c, { name: 'Roll', kind: 'dice', settings: { checkType: 'investigation', dc: 12, critMargin: 0, natCrit: false } });
  assert.strictEqual(C.makeRollKey('atleast', 15), 'ge15');
  assert.strictEqual(C.makeRollKey('range', 14, 10), 'r14x10');
  assert.strictEqual(C.rollKeyLabel('r14x10'), 'Roll 10 to 14');
  assert.ok(!C.sectionShows(c, d, 'ge15', {}), 'not rolled yet shows nothing');
  C.rollDice(d, 16);
  assert.ok(C.sectionShows(c, d, 'ge15', {}) && C.sectionShows(c, d, 'success,le3', {}));
  assert.ok(!C.sectionShows(c, d, 'eq15', {}) && C.sectionShows(c, d, 'eq16', {}));
  assert.ok(C.sectionShows(c, d, 'r10x16', {}) && !C.sectionShows(c, d, 'r17x20', {}));
  assert.ok(C.sectionShows(c, d, '!le5', {}), 'negation works');
  assert.ok(/Roll 15 or more/.test(C.describeSection(c, d, 'ge15')));
  C.clearResult(d);
  assert.ok(!C.sectionShows(c, d, 'ge15', {}), 'a cleared roll no longer matches');
});

test('tiers stack unless switched off', () => {
  const Q = require('../src/query');
  const c = DM.emptyCampaign();
  const ck = DM.createDCCheck(c, { name: 'I', checkType: 'investigation', mode: 'scale' });
  [10, 15, 20].forEach((dc) => DM.addDCTableRow(c, ck.id, { dc, text: 't' + dc }));
  assert.deepStrictEqual(Q.resolveDCCheckTableRows(ck, 16).map((r) => r.dc), [10, 15]);
  assert.deepStrictEqual(Q.resolveDCCheckTableRows(ck, 5), []);
  ck.stackTiers = false;
  assert.deepStrictEqual(Q.resolveDCCheckTableRows(ck, 16).map((r) => r.dc), [15]);
});

test('quests get a yellow-ish colour of their own and do not use up the palette', () => {
  const Q = require('../src/quests');
  const c = DM.emptyCampaign();
  const q = DM.createEntity(c, { type: 'quest', name: 'Lost Purse' });
  assert.ok(Q.QUEST_COLORS.includes(q.color), q.color);
  assert.strictEqual(c.meta.nextColorIndex || 0, 0);
  const q2 = DM.createEntity(c, { type: 'quest', name: 'Another' });
  assert.ok(Q.QUEST_COLORS.includes(q2.color));
  // an old quest with a cycled colour is repaired once; a colour picked afterwards is kept
  const old = DM.createEntity(c, { type: 'quest', name: 'Old' });
  old.color = 'blue'; delete old.questColorSet;
  Q.sanitize(c);
  assert.ok(Q.QUEST_COLORS.includes(old.color));
  old.color = 'purple'; Q.sanitize(c);
  assert.strictEqual(old.color, 'purple');
});

if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('All condition tests passed.');
