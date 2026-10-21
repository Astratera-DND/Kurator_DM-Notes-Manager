const assert = require('assert');
const dataModel = require('../src/dataModel');
const query = require('../src/query');

function ok(msg) { console.log('ok  -', msg); }

// --- Test 1: createDCCheck and basic field shape ---------------------------
{
  const c = dataModel.emptyCampaign();
  const check = dataModel.createDCCheck(c, { name: 'Guard awareness', checkType: 'perception' });
  assert.strictEqual(check.name, 'Guard awareness');
  assert.strictEqual(check.checkType, 'perception');
  assert.deepStrictEqual(check.table, []);
  assert.deepStrictEqual(check.conditions, []);
  assert.deepStrictEqual(check.rollLog, []);
  assert.strictEqual(c.dcChecks.length, 1);
  assert.strictEqual(c.dcChecks[0].id, check.id);
  ok('createDCCheck produces the correct shape and is stored on the campaign');
}

// --- Test 2: table row CRUD -------------------------------------------------
{
  const c = dataModel.emptyCampaign();
  const check = dataModel.createDCCheck(c, { name: '', checkType: 'stealth' });
  const rowA = dataModel.addDCTableRow(c, check.id, { dc: 10, text: 'Low tier' });
  const rowB = dataModel.addDCTableRow(c, check.id, { dc: 15, text: 'Mid tier' });
  const rowC = dataModel.addDCTableRow(c, check.id, { dc: 20, text: 'High tier' });
  assert.strictEqual(check.table.length, 3);

  dataModel.updateDCTableRow(c, check.id, rowB.id, 'text', 'Mid tier, edited');
  assert.strictEqual(check.table.find((r) => r.id === rowB.id).text, 'Mid tier, edited');

  const moved = dataModel.moveDCTableRow(c, check.id, rowC.id, -1);
  assert.strictEqual(moved, true);
  assert.deepStrictEqual(check.table.map((r) => r.id), [rowA.id, rowC.id, rowB.id]);

  dataModel.deleteDCTableRow(c, check.id, rowA.id);
  assert.strictEqual(check.table.length, 2);
  assert.ok(!check.table.find((r) => r.id === rowA.id));

  ok('table row add/update/move/delete all work correctly');
}

// --- Test 3: condition CRUD -------------------------------------------------
{
  const c = dataModel.emptyCampaign();
  const check = dataModel.createDCCheck(c, { name: '', checkType: 'stealth' });
  const cond1 = dataModel.addDCCondition(c, check.id, { trigger: 'failure', dc: 10, occurrence: 1, text: 'First fail' });
  const cond2 = dataModel.addDCCondition(c, check.id, { trigger: 'failure', dc: 10, occurrence: 2, text: 'Second fail' });
  assert.strictEqual(check.conditions.length, 2);

  dataModel.updateDCCondition(c, check.id, cond1.id, 'text', 'First fail, edited');
  assert.strictEqual(check.conditions.find((cc) => cc.id === cond1.id).text, 'First fail, edited');

  dataModel.deleteDCCondition(c, check.id, cond2.id);
  assert.strictEqual(check.conditions.length, 1);

  ok('condition add/update/delete all work correctly');
}

// --- Test 4: roll log append and clear --------------------------------------
{
  const c = dataModel.emptyCampaign();
  const check = dataModel.createDCCheck(c, { name: '', checkType: 'perception' });
  dataModel.appendDCRollLogEntry(c, check.id, 12);
  dataModel.appendDCRollLogEntry(c, check.id, 18);
  assert.strictEqual(check.rollLog.length, 2);
  assert.strictEqual(check.rollLog[0].value, 12);
  assert.strictEqual(check.rollLog[1].value, 18);
  assert.ok(check.rollLog[0].id);

  dataModel.clearDCRollLog(c, check.id);
  assert.strictEqual(check.rollLog.length, 0);

  ok('roll log entries append in order and clear correctly');
}

// --- Test 5: deleteDCCheck removes it entirely ------------------------------
{
  const c = dataModel.emptyCampaign();
  const check = dataModel.createDCCheck(c, { name: '', checkType: 'insight' });
  dataModel.deleteDCCheck(c, check.id);
  assert.strictEqual(c.dcChecks.length, 0);
  ok('deleteDCCheck removes the check from the campaign');
}

// --- Test 6: resolveDCCheckTableRow — tier resolution -----------------------
{
  const c = dataModel.emptyCampaign();
  const check = dataModel.createDCCheck(c, { name: '', checkType: 'investigation' });
  dataModel.addDCTableRow(c, check.id, { dc: 10, text: 'Low' });
  dataModel.addDCTableRow(c, check.id, { dc: 15, text: 'Mid' });
  dataModel.addDCTableRow(c, check.id, { dc: 20, text: 'High' });

  assert.strictEqual(query.resolveDCCheckTableRow(check, null), null, 'no roll yet -> null');
  assert.strictEqual(query.resolveDCCheckTableRow(check, 5), null, 'below the lowest DC -> null');
  assert.strictEqual(query.resolveDCCheckTableRow(check, 10).text, 'Low', 'exact match on the lowest DC');
  assert.strictEqual(query.resolveDCCheckTableRow(check, 16).text, 'Mid', 'between two DCs resolves to the highest one actually met (16 meets 15, not 20)');
  assert.strictEqual(query.resolveDCCheckTableRow(check, 20).text, 'High', 'exact match on the highest DC');
  assert.strictEqual(query.resolveDCCheckTableRow(check, 99).text, 'High', 'above every DC still resolves to the highest tier, not null');

  const empty = dataModel.createDCCheck(c, { name: '', checkType: 'insight' });
  assert.strictEqual(query.resolveDCCheckTableRow(empty, 15), null, 'an empty table always resolves to null');

  ok('resolveDCCheckTableRow picks the highest DC tier the roll meets or exceeds');
}

// --- Test 7: evaluateDCCheckConditions — the "1st fail / 2nd fail" scenario -
{
  const c = dataModel.emptyCampaign();
  const check = dataModel.createDCCheck(c, { name: '', checkType: 'stealth' });
  dataModel.addDCCondition(c, check.id, { trigger: 'failure', dc: 10, occurrence: 1, text: 'First fail' });
  dataModel.addDCCondition(c, check.id, { trigger: 'failure', dc: 10, occurrence: 2, text: 'Second fail' });
  dataModel.addDCCondition(c, check.id, { trigger: 'nat20', dc: null, occurrence: 1, text: 'Critical success' });

  // Traced by hand: 8 (fail#1), 12 (pass), 9 (fail#2), 20 (nat20 + pass), 3 (fail#3, no condition at occurrence 3)
  const r1 = dataModel.appendDCRollLogEntry(c, check.id, 8);
  dataModel.appendDCRollLogEntry(c, check.id, 12);
  const r3 = dataModel.appendDCRollLogEntry(c, check.id, 9);
  const r4 = dataModel.appendDCRollLogEntry(c, check.id, 20);
  dataModel.appendDCRollLogEntry(c, check.id, 3);

  const evaluated = query.evaluateDCCheckConditions(check);
  const firstFail = evaluated.find((e) => e.condition.text === 'First fail');
  const secondFail = evaluated.find((e) => e.condition.text === 'Second fail');
  const nat20 = evaluated.find((e) => e.condition.text === 'Critical success');

  assert.strictEqual(firstFail.reached, true);
  assert.strictEqual(firstFail.currentCount, 3, 'three total failures logged (8, 9, 3)');
  assert.strictEqual(firstFail.reachedByRollId, r1.id, 'first-fail threshold was reached by the very first failing roll');

  assert.strictEqual(secondFail.reached, true);
  assert.strictEqual(secondFail.reachedByRollId, r3.id, 'second-fail threshold was reached specifically by the second failing roll');

  assert.strictEqual(nat20.reached, true);
  assert.strictEqual(nat20.reachedByRollId, r4.id);

  ok('evaluateDCCheckConditions correctly tallies escalating failure occurrences and nat20, matching a hand-traced roll sequence');
}

// --- Test 8: independent DCs don't cross-contaminate tallies ---------------
{
  const c = dataModel.emptyCampaign();
  const check = dataModel.createDCCheck(c, { name: '', checkType: 'perception' });
  dataModel.addDCCondition(c, check.id, { trigger: 'failure', dc: 10, occurrence: 1, text: 'Fail DC10' });
  dataModel.addDCCondition(c, check.id, { trigger: 'failure', dc: 15, occurrence: 1, text: 'Fail DC15' });

  dataModel.appendDCRollLogEntry(c, check.id, 12); // fails DC15, passes DC10
  const evaluated = query.evaluateDCCheckConditions(check);
  const failDC10 = evaluated.find((e) => e.condition.text === 'Fail DC10');
  const failDC15 = evaluated.find((e) => e.condition.text === 'Fail DC15');
  assert.strictEqual(failDC10.reached, false, 'a roll of 12 passes DC10, so the DC10 failure condition must not be reached');
  assert.strictEqual(failDC15.reached, true, 'the same roll of 12 fails DC15, so that condition should be reached independently');

  ok('failure/success tallies at different DCs are tracked independently, not conflated');
}

// --- Test 9: currentDCCheckConditionOutcomes — only the highest reached ----
{
  const c = dataModel.emptyCampaign();
  const check = dataModel.createDCCheck(c, { name: '', checkType: 'stealth' });
  dataModel.addDCCondition(c, check.id, { trigger: 'failure', dc: 10, occurrence: 1, text: 'First fail' });
  dataModel.addDCCondition(c, check.id, { trigger: 'failure', dc: 10, occurrence: 2, text: 'Second fail' });
  dataModel.addDCCondition(c, check.id, { trigger: 'nat1', dc: null, occurrence: 1, text: 'Fumble' });

  dataModel.appendDCRollLogEntry(c, check.id, 8);
  let current = query.currentDCCheckConditionOutcomes(check);
  assert.strictEqual(current.length, 1);
  assert.strictEqual(current[0].condition.text, 'First fail', 'only the first-fail threshold has been reached so far');

  dataModel.appendDCRollLogEntry(c, check.id, 4);
  current = query.currentDCCheckConditionOutcomes(check);
  assert.strictEqual(current.length, 1, 'still one entry for the failure group -- the group is superseded, not accumulated');
  assert.strictEqual(current[0].condition.text, 'Second fail', 'now that the second threshold is reached, it replaces the first in the current view');

  dataModel.appendDCRollLogEntry(c, check.id, 1);
  current = query.currentDCCheckConditionOutcomes(check);
  assert.strictEqual(current.length, 2, 'a nat1 is an independent group, so it appears alongside the failure outcome rather than replacing it');
  assert.ok(current.find((o) => o.condition.text === 'Fumble'));
  assert.ok(current.find((o) => o.condition.text === 'Second fail'));

  ok('currentDCCheckConditionOutcomes shows the most escalated reached outcome per independent group, not a growing stack of every threshold ever crossed');
}

// --- Test 10: renderMentions integration — the button itself ---------------
{
  const c = dataModel.emptyCampaign();
  const check = dataModel.createDCCheck(c, { name: 'Guard awareness', checkType: 'perception' });
  dataModel.addDCTableRow(c, check.id, { dc: 15, text: 'They notice you.' });

  const { html: beforeRoll } = query.renderMentions(`Roll it: [[DCCHECK:${check.id}]]`, c);
  assert.ok(beforeRoll.includes('dc-check-btn'), 'the button should render even with no roll logged yet');
  assert.ok(beforeRoll.includes('Guard awareness'), 'the button label should include the check\'s name');
  assert.ok(!beforeRoll.includes('dc-check-resolved'), 'no resolved block should render before any roll is logged');

  dataModel.appendDCRollLogEntry(c, check.id, 16);
  const { html: afterRoll } = query.renderMentions(`Roll it: [[DCCHECK:${check.id}]]`, c);
  assert.ok(afterRoll.includes('dc-check-resolved'), 'a resolved block should appear once a roll has been logged');
  assert.ok(afterRoll.includes('They notice you.'), 'the resolved block should contain the matching table row\'s text');

  ok('a DC Check token renders as a button, with a resolved outcome block appearing only once a roll has been logged');
}

// --- Test 11: unknown/deleted DC check id leaves the raw token visible -----
{
  const c = dataModel.emptyCampaign();
  const { html } = query.renderMentions('Roll it: [[DCCHECK:dcc_nonexistent]]', c);
  assert.ok(html.includes('[[DCCHECK:dcc_nonexistent]]'), 'an unresolvable DC Check id should leave the raw token visible, matching how an unresolvable [[id]] mention already behaves');
  ok('an unknown or deleted DC Check id leaves the raw token visible rather than breaking rendering');
}

// --- Test 12: full formatting parity in the resolved table text ------------
// The actual point of this whole test: the table's text field is not a
// second-class plain-text field. It needs the exact same support as a
// beat's own text -- mentions, SAY quotes, bold/italic, and mentions
// nested inside a quote, all inside the SAME resolved outcome text.
{
  const c = dataModel.emptyCampaign();
  const npc = dataModel.createEntity(c, { type: 'npc', name: 'Sergeant Vale' });
  const check = dataModel.createDCCheck(c, { name: '', checkType: 'perception' });
  dataModel.addDCTableRow(c, check.id, {
    dc: 10,
    text: `You spot [[${npc.id}]] nearby. [[SAY:${npc.id}]]Halt, who goes there?[[/SAY]] Their armor is **freshly polished**.`
  });
  dataModel.appendDCRollLogEntry(c, check.id, 12);

  const { html } = query.renderMentions(`[[DCCHECK:${check.id}]]`, c);
  assert.ok(html.includes('Sergeant Vale'), 'a mention inside the resolved table text should render as a real pill, not stay as a raw token');
  assert.ok(html.includes('inline-quote'), 'a SAY quote inside the resolved table text should render as a real quote span');
  assert.ok(html.includes('Halt, who goes there?'), 'the quoted dialogue text itself should be present');
  assert.ok(html.includes('<strong>freshly polished</strong>'), 'bold formatting inside the resolved table text should render correctly');

  ok('the resolved table row text supports full formatting -- mentions, SAY quotes, and bold -- exactly like a beat\'s own text field');
}

// --- Test 13: a mention nested inside a SAY quote, inside the resolved text
{
  const c = dataModel.emptyCampaign();
  const guard = dataModel.createEntity(c, { type: 'npc', name: 'Guard' });
  const captain = dataModel.createEntity(c, { type: 'npc', name: 'Captain Reyes' });
  const check = dataModel.createDCCheck(c, { name: '', checkType: 'insight' });
  dataModel.addDCTableRow(c, check.id, {
    dc: 10,
    text: `[[SAY:${guard.id}]]Best fetch [[${captain.id}]], this looks serious.[[/SAY]]`
  });
  dataModel.appendDCRollLogEntry(c, check.id, 15);

  const { html } = query.renderMentions(`[[DCCHECK:${check.id}]]`, c);
  assert.ok(html.includes('inline-quote'), 'the SAY quote itself should render');
  assert.ok(html.includes('Captain Reyes'), 'a mention nested inside a SAY quote, inside the resolved DC check text, should still resolve to a real pill');

  ok('a mention nested inside a quote, nested inside the resolved DC check text, resolves correctly -- the exact nesting combination requested');
}

// --- Test 14: a DC Check token nested inside a SAY quote in the OUTER text --
// Mirrors the existing JUMP/SCENEBTN-inside-SAY tests -- resolving DC
// Check tokens before SAY (not after) is what makes this work.
{
  const c = dataModel.emptyCampaign();
  const npc = dataModel.createEntity(c, { type: 'npc', name: 'Innkeeper' });
  const check = dataModel.createDCCheck(c, { name: 'Notice the ledger', checkType: 'investigation' });
  dataModel.addDCTableRow(c, check.id, { dc: 12, text: 'You spot a discrepancy.' });

  const { html } = query.renderMentions(`[[SAY:${npc.id}]]Go on, take a look. [[DCCHECK:${check.id}]][[/SAY]]`, c);
  assert.ok(html.includes('inline-quote'), 'the outer SAY quote should still render');
  assert.ok(html.includes('dc-check-btn'), 'the DC Check button should render correctly even though it is nested inside the quote');
  assert.ok(html.includes('Notice the ledger'), 'the button\'s label should be present inside the rendered quote');

  ok('a DC Check token nested inside a SAY quote in the outer text resolves correctly, same as JUMP/SCENEBTN already do');
}

// --- Test 15: multiple independent DC Check tokens in the same text --------
{
  const c = dataModel.emptyCampaign();
  const checkA = dataModel.createDCCheck(c, { name: 'Check A', checkType: 'perception' });
  const checkB = dataModel.createDCCheck(c, { name: 'Check B', checkType: 'stealth' });
  dataModel.addDCTableRow(c, checkA.id, { dc: 10, text: 'Outcome A' });
  dataModel.addDCTableRow(c, checkB.id, { dc: 10, text: 'Outcome B' });
  dataModel.appendDCRollLogEntry(c, checkA.id, 12);
  dataModel.appendDCRollLogEntry(c, checkB.id, 14);

  const { html } = query.renderMentions(`First: [[DCCHECK:${checkA.id}]] Then: [[DCCHECK:${checkB.id}]]`, c);
  assert.ok(html.includes('Check A') && html.includes('Outcome A'), 'the first check should resolve independently');
  assert.ok(html.includes('Check B') && html.includes('Outcome B'), 'the second check should resolve independently');

  ok('multiple independent DC Check tokens in the same text field each resolve correctly');
}

// --- Test 16: either/or modes, single pass DC, scale link DC ----------------
{
  const Conditions = require('../src/conditions');
  assert.strictEqual(Conditions.defaultDCCheckMode('dexterity'), 'passfail');
  assert.strictEqual(Conditions.defaultDCCheckMode('investigation'), 'scale');

  const c = dataModel.emptyCampaign();
  const inv = dataModel.createDCCheck(c, { name: 'Inv', checkType: 'investigation', mode: 'scale' });
  let m = Conditions.dcCheckMode(inv);
  assert.ok(m.showScale && !m.showPassFail && !m.both, 'scale mode shows only tiers');
  dataModel.addDCTableRow(c, inv.id, { dc: 15, text: 'a' });
  dataModel.addDCTableRow(c, inv.id, { dc: 10, text: 'b' });
  Conditions.refreshLinkDC(c, inv);
  assert.strictEqual(Conditions.ensureDCLink(c, inv).settings.dc, 10, 'scale check succeeds from its lowest tier');

  const dex = dataModel.createDCCheck(c, { name: 'Dex', checkType: 'dexterity', mode: 'passfail' });
  dataModel.addDCCondition(c, dex.id, { trigger: 'failure', dc: 10, occurrence: 1, text: 'f' });
  dataModel.addDCCondition(c, dex.id, { trigger: 'success', dc: 10, occurrence: 1, text: 's' });
  Conditions.setPassDC(c, dex, 14);
  assert.ok(dex.conditions.every((x) => x.dc === 14), 'all success/failure outcomes share the single DC');
  assert.strictEqual(Conditions.ensureDCLink(c, dex).settings.dc, 14);
  m = Conditions.dcCheckMode(dex);
  assert.ok(!m.showScale && m.showPassFail);

  dataModel.addDCTableRow(c, dex.id, { dc: 5, text: 'x' });
  assert.ok(Conditions.dcCheckMode(dex).both, 'a check that holds both kinds shows both');
  ok('DC check modes: either/or by default, one pass DC, scale link DC');
}

console.log('\nAll DC Check data-model and evaluation tests passed.');
