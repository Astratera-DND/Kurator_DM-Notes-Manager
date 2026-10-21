const assert = require('assert');
const {
  createEntity, createCheckpoint, createArrivalBlock, addBeat, createNoteBlock, createTopicBlock, emptyCampaign,
  createContentModule, createAssignment
} = require('../src/dataModel');
const { getLocationView, getEntityCard, markModuleComplete, setBookmark, undoSinceStart, renderMentions, autoTagEntityNames } = require('../src/query');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log('ok  -', msg);
}

// Test helpers matching the ergonomics of the old create*Block functions
// (addBeat/createNoteBlock/createTopicBlock/createSceneBlock+addSceneLine),
// but building directly through the new content-module + assignment
// system instead — what the real app does now too, post-flip, so there's
// no migration step needed between constructing test data and querying
// it. Each returns {module, assignment, id} — id is module.id, since
// that's what markModuleComplete/carried-list entries key off; a test
// that specifically needs the assignment (for moveAssignment) reads
// .assignment.id instead.
function addBeatV2(campaign, { locationId, timeId, label, text = '' }) {
  const module = createContentModule(campaign, { type: 'beat', name: label, text });
  const assignment = createAssignment(campaign, { moduleId: module.id, entityId: locationId, timeId });
  return { module, assignment, id: module.id };
}
function addNoteV2(campaign, { entityId, timeId = null, text = '' }) {
  const module = createContentModule(campaign, { type: 'note', name: '', text });
  const assignment = createAssignment(campaign, { moduleId: module.id, entityId, timeId });
  return { module, assignment, id: module.id };
}
function addTopicV2(campaign, { entityId, label, text = '', timeId = null }) {
  const module = createContentModule(campaign, { type: 'topic', name: label, text });
  const assignment = createAssignment(campaign, { moduleId: module.id, entityId, timeId });
  return { module, assignment, id: module.id };
}
function addSceneV2(campaign, { locationId, timeId, label, lines = [] }) {
  const module = createContentModule(campaign, { type: 'scene', name: label, lines });
  const assignment = createAssignment(campaign, { moduleId: module.id, entityId: locationId, timeId });
  return { module, assignment, id: module.id };
}
function addDescriptionV2(campaign, { locationId, timeId, html }) {
  const module = createContentModule(campaign, { type: 'description', name: '', html });
  const assignment = createAssignment(campaign, { moduleId: module.id, entityId: locationId, timeId });
  return { module, assignment, id: module.id };
}

const campaign = emptyCampaign();

const market = createEntity(campaign, { type: 'location', name: 'Rusted spire market' });
const greyMan = createEntity(campaign, { type: 'npc', name: 'Grey man' });
const scrapGate = createEntity(campaign, { type: 'location', name: 'Scrap gate' });

const d1 = createCheckpoint(campaign, { label: 'Day 1 · dawn' });
const d1mid = createCheckpoint(campaign, { label: 'Day 1 · midday' });
const d2 = createCheckpoint(campaign, { label: 'Day 2 · morning' });
const d3 = createCheckpoint(campaign, { label: 'Day 3 · night' });

const a1 = createArrivalBlock(campaign, { locationId: market.id, timeId: d1.id });
a1.presence = [greyMan.id, scrapGate.id];
addDescriptionV2(campaign, {
  locationId: market.id,
  timeId: d1.id,
  html: `You arrive as the twin suns crest the horizon. A [[${greyMan.id}]] leans near the [[${scrapGate.id}]].`
});
const robberyBeat = addBeatV2(campaign, { locationId: market.id, timeId: d1.id, label: 'Robbery near the fountain', text: 'A pickpocket strikes if the party lingers.' });

const a2 = createArrivalBlock(campaign, { locationId: market.id, timeId: d2.id });
a2.presence = [scrapGate.id];
addDescriptionV2(campaign, {
  locationId: market.id,
  timeId: d2.id,
  html: `Rain streaks down the awnings. The [[${scrapGate.id}]] is busy, the [[${greyMan.id}]] is nowhere in sight.`
});

// --- Test 1: exact match, presence, mentions -----------------------------
let view = getLocationView(campaign, market.id, d1.id);
assert.strictEqual(view.fallback, false);
assert.strictEqual(view.present.length, 2, 'day 1 dawn should show 2 present entities');
assert.ok(view.html.includes('Grey man'), 'mention token should render entity name');
ok('exact-match view resolves presence and mentions');

// --- Test 2: fallback to nearest earlier content --------------------------
view = getLocationView(campaign, market.id, d1mid.id);
assert.strictEqual(view.fallback, true, 'day 1 midday has no arrival, should fall back');
assert.strictEqual(view.fallbackFrom.id, d1.id);
ok('falls back to nearest earlier checkpoint when nothing authored');

// --- Test 3: distinct content on day 2 -------------------------------------
view = getLocationView(campaign, market.id, d2.id);
assert.strictEqual(view.fallback, false);
assert.strictEqual(view.present.length, 1, 'grey man should not be in the present list on day 2');
assert.strictEqual(view.present[0].id, scrapGate.id);
ok('day 2 shows different presence than day 1, even though grey man is still mentioned in text');

// --- Test 4: available-here never includes mention-only entities ----------
assert.ok(!view.present.find((e) => e.id === greyMan.id), 'grey man is mentioned but not present on day 2 -> must not appear in available-here');
ok('available-here list respects presence, not mentions');

// --- Test 5: unmarked beat carries forward to a later checkpoint ----------
view = getLocationView(campaign, market.id, d3.id);
const carriedRobbery = view.carried.find((c) => c.id === robberyBeat.id);
assert.ok(carriedRobbery, 'unmarked beat from day 1 should carry forward to day 3');
assert.strictEqual(carriedRobbery.sourceLabel, 'Day 1 · dawn');
ok('incomplete beat carries forward via live query, without moving the original text');

// --- Test 6: marking complete removes it from future views ----------------
markModuleComplete(campaign, robberyBeat.id, true);
view = getLocationView(campaign, market.id, d3.id);
assert.ok(!view.carried.find((c) => c.id === robberyBeat.id), 'completed beat must not carry forward anymore');
ok('marking a beat complete removes it from future carry-forward');

// --- Test 7: unmarking brings it back instantly, nothing to "move back" ---
markModuleComplete(campaign, robberyBeat.id, false);
view = getLocationView(campaign, market.id, d3.id);
assert.ok(view.carried.find((c) => c.id === robberyBeat.id), 'unmarking should instantly resurface the beat');
ok('unmarking is instant and reversible, confirming nothing was ever physically moved');

// --- Test 8: undo-since-bookmark -------------------------------------------
setBookmark(campaign, market.id, d1.id);
markModuleComplete(campaign, robberyBeat.id, true);
assert.strictEqual(campaign.meta.completedSinceStart.length, 1);
undoSinceStart(campaign);
assert.strictEqual(robberyBeat.module.complete, false, 'undo-since-start should revert the completion');
assert.strictEqual(campaign.meta.completedSinceStart.length, 0);
ok('undo-since-bookmark reverts test-run completions in one step');

// --- Test 9: a scene at the exact checkpoint shows up in view.scenes ------
const scene1 = addSceneV2(campaign, {
  locationId: market.id,
  timeId: d1.id,
  label: 'Grey man confronts a courier',
  lines: [
    { id: 'ln1', speakerId: greyMan.id, text: 'You were supposed to be here yesterday.' },
    { id: 'ln2', speakerId: null, text: 'The courier says nothing, just hands over a sealed case.' }
  ]
});
view = getLocationView(campaign, market.id, d1.id);
assert.strictEqual(view.scenes.length, 1, 'the scene should show up for its exact location and checkpoint');
assert.strictEqual(view.scenes[0].lines.length, 2);
ok('a scene at the exact checkpoint appears in the location view, lines intact');

// --- Test 10: an incomplete scene carries forward like a beat --------------
view = getLocationView(campaign, market.id, d3.id);
const carriedScene = view.carried.find((c) => c.id === scene1.id);
assert.ok(carriedScene, 'an unresolved scene from an earlier checkpoint should carry forward');
assert.strictEqual(carriedScene.kind, 'scene');
ok('incomplete scene carries forward to a later checkpoint, same as a beat');

// --- Test 11: marking a scene complete is all-or-nothing (whole scene) -----
markModuleComplete(campaign, scene1.id, true);
view = getLocationView(campaign, market.id, d3.id);
assert.ok(!view.carried.find((c) => c.id === scene1.id), 'a completed scene must not carry forward anymore, as a whole unit');
assert.strictEqual(scene1.module.complete, true);
markModuleComplete(campaign, scene1.id, false); // leave state clean for anyone extending this file later
ok('marking a scene complete removes the whole scene from carry-forward (all-or-nothing, not per-line)');

// --- Test 12: lightweight markdown renders as real formatting --------------
let md = renderMentions('You feel **watched**. Someone whispers, _run_.', campaign);
assert.ok(md.html.includes('<strong>watched</strong>'), 'double-asterisk text should render as <strong>');
assert.ok(md.html.includes('<em>run</em>'), 'underscore text should render as <em>');
ok('bold and italic markdown render as real HTML formatting');

md = renderMentions('The vendor mutters, "get away from my stall."', campaign);
assert.ok(md.html.includes('class="inline-quote"'), 'quoted text should get inline-quote styling');
ok('quoted dialog gets styled inline without becoming a structured Scene');

// --- Test 13: italic marker must not span across two mention tokens --------
const spanning = `You see [[${greyMan.id}]] and [[${scrapGate.id}]] nearby.`;
md = renderMentions(spanning, campaign);
assert.ok(!md.html.includes('<em>'), 'underscores inside two different [[id]] tokens must never be mistaken for an italic pair');
assert.strictEqual(md.mentioned.length, 2, 'both mentions should still resolve correctly despite sharing underscores');
ok('italic detection cannot false-positive across [[id]] token boundaries');

// --- Test 14: auto-tagging entity names from plain pasted text -------------
const pasted = 'Grey man leans near the Scrap gate, watching the crowd.';
const tagResult = autoTagEntityNames(pasted, campaign);
assert.ok(tagResult.text.includes(`[[${greyMan.id}]]`), 'Grey man should be auto-tagged by name');
assert.ok(tagResult.text.includes(`[[${scrapGate.id}]]`), 'Scrap gate should be auto-tagged by name');
assert.deepStrictEqual(tagResult.taggedIds.sort(), [greyMan.id, scrapGate.id].sort());
ok('auto-tagging replaces plain entity names with [[id]] tokens and reports which entities were tagged');

// --- Test 15: auto-tagging respects word boundaries, no partial matches ---
const noPartial = autoTagEntityNames('The greyhound barks at nothing.', campaign);
assert.ok(!noPartial.text.includes(greyMan.id), '"greyhound" must not partially match the entity named "Grey man"');
ok('auto-tagging never partial-matches inside an unrelated word');

// --- Test 16: newlines render as real line breaks, not collapsed --------
// A single newline (soft break, Shift+Enter) renders as one <br>. A double
// newline (hard break, plain Enter) renders as two — visibly more space,
// matching Notion's own distinction between the two keys.
const softBreak = renderMentions('Line one\nLine two', campaign);
assert.ok(softBreak.html.includes('<br>'), 'a single newline should become a real <br> so multi-line text does not visually run together');
assert.ok(!softBreak.html.includes('<br><br>'), 'a single newline (soft break) must not get the wider hard-break spacing');

const hardBreak = renderMentions('Paragraph one\n\nParagraph two', campaign);
assert.ok(hardBreak.html.includes('<br><br>'), 'a double newline (hard break) should render with visibly more space than a soft break');
ok('newlines render as <br>, and hard breaks (double newline) get visibly more space than soft breaks (single newline)');

// --- Test 17: visibleBeats always includes every beat, complete or not —
// completion state is preserved for the renderer to display consistently
// (collapsed to a line when complete), not filtered out at the query layer
{
  const c2 = emptyCampaign();
  const loc2 = createEntity(c2, { type: 'location', name: 'Outpost' });
  const d1 = createCheckpoint(c2, { label: 'Day 1' });
  const d2 = createCheckpoint(c2, { label: 'Day 2' }); // no arrival authored -> pure fallback to Day 1
  createArrivalBlock(c2, { locationId: loc2.id, timeId: d1.id });
  addDescriptionV2(c2, { locationId: loc2.id, timeId: d1.id, html: 'Arrival text' });
  const action = addBeatV2(c2, { locationId: loc2.id, timeId: d1.id, label: 'Signal flare goes up', text: '' });

  let v = getLocationView(c2, loc2.id, d2.id);
  assert.strictEqual(v.fallback, true);
  assert.strictEqual(v.visibleBeats.length, 1, 'an incomplete beat should show through fallback');
  assert.strictEqual(v.visibleBeats[0].complete, false);

  markModuleComplete(c2, action.id, true);
  v = getLocationView(c2, loc2.id, d2.id);
  assert.strictEqual(v.visibleBeats.length, 1, 'a completed beat still appears via fallback — completion is a display state (collapsed line), not a reason to hide it entirely');
  assert.strictEqual(v.visibleBeats[0].complete, true);

  const v1 = getLocationView(c2, loc2.id, d1.id);
  assert.strictEqual(v1.fallback, false);
  assert.strictEqual(v1.visibleBeats.length, 1, 'the completed beat also still shows on the exact day it happened');
  ok('completion state is consistently preserved for the renderer, regardless of exact-match vs fallback context');
}

// --- Test 18: the exact multi-day scenario reported — an interleaving day
// with no new beat must not disrupt an earlier incomplete beat carrying
// all the way forward to a later day that DOES have new content ---------
{
  const c3 = emptyCampaign();
  const loc3 = createEntity(c3, { type: 'location', name: 'Market' });
  const d1 = createCheckpoint(c3, { label: 'Day 1' });
  const d2 = createCheckpoint(c3, { label: 'Day 2' });
  const d3 = createCheckpoint(c3, { label: 'Day 3' });
  createArrivalBlock(c3, { locationId: loc3.id, timeId: d1.id });
  addDescriptionV2(c3, { locationId: loc3.id, timeId: d1.id, html: 'Day 1 text' });
  const action1 = addBeatV2(c3, { locationId: loc3.id, timeId: d1.id, label: 'Action01', text: '' }); // left unchecked throughout
  createArrivalBlock(c3, { locationId: loc3.id, timeId: d2.id });
  addDescriptionV2(c3, { locationId: loc3.id, timeId: d2.id, html: 'Day 2 text, nothing new' }); // own arrival, no new beat
  createArrivalBlock(c3, { locationId: loc3.id, timeId: d3.id });
  addDescriptionV2(c3, { locationId: loc3.id, timeId: d3.id, html: 'Day 3 text' });
  addBeatV2(c3, { locationId: loc3.id, timeId: d3.id, label: 'Action02', text: '' });

  const v2 = getLocationView(c3, loc3.id, d2.id);
  assert.ok(v2.carried.find((x) => x.id === action1.id), 'Action01 should carry to Day 2 (an interleaving day with its own arrival but no new beat)');

  const v3 = getLocationView(c3, loc3.id, d3.id);
  assert.ok(v3.carried.find((x) => x.id === action1.id), 'Action01 must still carry all the way to Day 3, unaffected by Day 3 having its own new Action02 — an unresolved item never gets silently overridden by newer content');
  assert.ok(v3.visibleBeats.find((b) => b.name === 'Action02'), 'Day 3 should also show its own new beat');
  ok('an unresolved beat survives across multiple days regardless of newer content being added later — carry-forward is a live query, not something newer content can silently override');
}

// --- Test 19: time-specific entity notes — multiple per checkpoint, and
// full carry-forward to every later checkpoint (not just the nearest one),
// exactly matching how beats already work ---------------------------------
{
  const c4 = emptyCampaign();
  const npc = createEntity(c4, { type: 'npc', name: 'Courier' });
  const d1 = createCheckpoint(c4, { label: 'Day 1' });
  const d2 = createCheckpoint(c4, { label: 'Day 2' });
  const d3 = createCheckpoint(c4, { label: 'Day 3' });

  // Bug repro: two notes on the same checkpoint must BOTH show, not just
  // the first one created.
  const noteA = addNoteV2(c4, { entityId: npc.id, timeId: d1.id, text: 'Waiting for a shipment.' });
  addNoteV2(c4, { entityId: npc.id, timeId: d1.id, text: 'Nervous about the patrol.' });

  let card = getEntityCard(c4, npc.id, d1.id);
  assert.strictEqual(card.currentNotes.length, 2, 'both notes on the same checkpoint must show, not just the first one created');

  // Day 2 has its own, unrelated note — Day 1's notes must still carry
  // forward alongside it, not get replaced by it.
  addNoteV2(c4, { entityId: npc.id, timeId: d2.id, text: 'The shipment arrived, late.' });
  card = getEntityCard(c4, npc.id, d2.id);
  assert.strictEqual(card.currentNotes.length, 1, 'day 2 should show only its own new note as "current"');
  assert.strictEqual(card.carriedNotes.length, 2, 'both of day 1\'s unresolved notes should carry forward alongside day 2\'s own note');

  // Day 3 has nothing of its own — everything unresolved should still
  // carry all the way forward, including day 2's note, not just the
  // nearest one.
  card = getEntityCard(c4, npc.id, d3.id);
  assert.strictEqual(card.currentNotes.length, 0);
  assert.strictEqual(card.carriedNotes.length, 3, 'all three unresolved notes (from day 1 and day 2) should carry forward to day 3 — every later checkpoint, not just the nearest');

  // Resolving one specific note removes only that one from future views —
  // the others keep carrying forward.
  markModuleComplete(c4, noteA.id, true);
  card = getEntityCard(c4, npc.id, d3.id);
  assert.strictEqual(card.carriedNotes.length, 2, 'resolving one note should not affect the others still carrying forward');
  assert.ok(!card.carriedNotes.find((n) => n.moduleId === noteA.id));

  // But it still shows on its own exact day, as a record.
  card = getEntityCard(c4, npc.id, d1.id);
  assert.ok(card.currentNotes.find((n) => n.moduleId === noteA.id), 'a resolved note should still show on the exact day it was written for, as a record');
  ok('time-specific notes support multiple per checkpoint and carry forward to every later checkpoint until individually resolved');
}

// --- Test 20: paste formatting detection — semantic tags AND styled spans
const { wrapPastedInline } = require('../src/query');
assert.strictEqual(wrapPastedInline('strong', '', 'x'), '**x**', 'semantic <strong> should be detected');
assert.strictEqual(wrapPastedInline('b', '', 'x'), '**x**', 'semantic <b> should be detected');
assert.strictEqual(wrapPastedInline('em', '', 'x'), '_x_', 'semantic <em> should be detected');
assert.strictEqual(wrapPastedInline('span', 'font-weight: bold', 'x'), '**x**', 'style-based bold (font-weight: bold) must be detected — plain semantic tags alone missed real-world clipboard HTML');
assert.strictEqual(wrapPastedInline('span', 'font-weight: 700', 'x'), '**x**', 'numeric bold weights (700) must also be detected');
assert.strictEqual(wrapPastedInline('span', 'font-style: italic', 'x'), '_x_', 'style-based italic must be detected');
assert.strictEqual(wrapPastedInline('span', 'font-weight:bold;font-style:italic', 'x'), '**_x_**', 'combined bold+italic on one element must nest correctly for renderMentions to pick both up');
assert.strictEqual(wrapPastedInline('span', 'color: red', 'x'), 'x', 'unrelated styling must not be mistaken for bold/italic');
ok('paste formatting detection handles semantic tags, styled spans, and combined bold+italic');

// --- Test 21: strikethrough and asterisk-italic render alongside the -----
// existing underscore-italic and bold conventions
{
  const r1 = renderMentions('~~crossed~~ *italic* **bold**', campaign);
  assert.ok(r1.html.includes('<s>crossed</s>'), 'strikethrough (~~..~~) should render as <s>');
  assert.ok(r1.html.includes('<em>italic</em>'), 'single-asterisk italic should render, not just underscore-italic');
  assert.ok(r1.html.includes('<strong>bold</strong>'), 'bold should still work alongside the new markers');
  ok('strikethrough and asterisk-italic both render correctly alongside bold');
}

// --- Test 22: inline speaker-tagged dialogue (SAY tokens) — dialogue -----
// living inside an otherwise normal text field, not a structured Scene
{
  const sayText = `You arrive at the market. [[SAY:${greyMan.id}]]You are late.[[/SAY]] He steps back into the shadows.`;
  const r2 = renderMentions(sayText, campaign);
  assert.ok(r2.html.includes('class="inline-quote"'), 'a SAY span should render with the inline-quote treatment');
  assert.ok(r2.html.includes('You are late'), 'the dialogue text itself should be present');
  assert.ok(r2.html.includes(`title="${greyMan.name}"`), 'the speaker name should be available (e.g. as a tooltip)');
  assert.ok(r2.mentioned.some((e) => e.id === greyMan.id), 'the speaker should be tracked in mentioned entities, same as a regular [[id]] mention');
  assert.ok(!r2.html.includes('[[SAY'), 'the raw SAY token syntax must not leak into the rendered output');

  // A SAY token for an entity that no longer exists should degrade gracefully
  const orphan = renderMentions('[[SAY:nonexistent_id]]still shown[[/SAY]]', campaign);
  assert.ok(orphan.html.includes('still shown'), 'text inside a SAY span for a deleted entity should still render, just without speaker-specific color');
  ok('inline speaker-tagged dialogue renders with the speaker\'s color and degrades gracefully for a missing entity');
}

// --- Test 22e: formatting AND mentions must resolve inside SAY dialogue --
// Regression test for a real bug: SAY's inner text was captured raw and
// embedded as-is, so bold/italic/mentions typed inside spoken dialogue
// silently stopped resolving and showed as literal markdown/token syntax
// instead. Also covers the nested-placeholder issue found while fixing
// it — a mention generated inside SAY's dialogue is itself protected,
// then the whole SAY span (containing that placeholder) gets protected
// again, so restoring needs more than a single pass.
{
  const sailor = createEntity(campaign, { type: 'npc', name: 'Old sailor' });
  const rich = `[[SAY:${greyMan.id}]]Go ask ${'[['}${sailor.id}]] — he's **far** more _honest_ than me.[[/SAY]]`;
  const rr = renderMentions(rich, campaign);
  assert.ok(rr.html.includes(`window.app.openEntity('${sailor.id}')`), 'a [[id]] mention typed inside SAY dialogue should resolve to a real, clickable mention pill');
  assert.ok(rr.html.includes('<strong>far</strong>'), 'bold markup inside SAY dialogue should resolve');
  assert.ok(rr.html.includes('<em>honest</em>'), 'italic markup inside SAY dialogue should resolve');
  assert.ok(!rr.html.includes('[[' + sailor.id), 'the raw mention token must not leak into the rendered dialogue');
  assert.ok(!rr.html.includes('**') && !rr.html.includes('_honest_'), 'raw markdown syntax must not leak into the rendered dialogue either');
  assert.ok(rr.mentioned.some((e) => e.id === sailor.id), 'a mention inside SAY dialogue should still be tracked in mentioned entities');
  ok('formatting and mentions typed inside SAY dialogue resolve correctly, not just in the surrounding text');
}

// --- Test 22b: JUMP tokens (cross-reference links to a beat or topic) ----
{
  const jumpText = `If they push back, [[JUMP:beat_abc123]]jump to the ambush[[/JUMP]] instead of talking it out.`;
  const rj = renderMentions(jumpText, campaign);
  assert.ok(rj.html.includes('class="jump-link"'), 'a JUMP token should render with the jump-link treatment');
  assert.ok(rj.html.includes('jump to the ambush'), 'the display text baked into the token should be present');
  assert.ok(rj.html.includes("window.app.jumpToReference('beat_abc123')"), 'clicking it should call jumpToReference with the target id');
  assert.ok(!rj.html.includes('[[JUMP'), 'the raw JUMP token syntax must not leak into the rendered output');
  ok('JUMP cross-reference tokens render as a clickable link carrying their target id');
}

// --- Test 22b-2: JUMP tokens with an optional target checkpoint ----------
{
  const jumpTimeText = `[[JUMP:loc_market:cp_day2]]the market, day 2[[/JUMP]] is where this pays off.`;
  const rjt = renderMentions(jumpTimeText, campaign);
  assert.ok(rjt.html.includes("window.app.jumpToReference('loc_market','cp_day2')"), 'a JUMP token with a target checkpoint should pass both ids to jumpToReference');
  assert.ok(rjt.html.includes('the market, day 2'));

  // Without a checkpoint, only the single id should be passed — no
  // dangling comma or empty second argument.
  const jumpNoTimeText = `[[JUMP:loc_market]]the market[[/JUMP]] any time.`;
  const rjn = renderMentions(jumpNoTimeText, campaign);
  assert.ok(rjn.html.includes("window.app.jumpToReference('loc_market')"), 'a JUMP token without a checkpoint should call jumpToReference with just the one id');
  assert.ok(!rjn.html.includes(",'"), 'no trailing comma/empty argument should appear when there is no target checkpoint');
  ok('JUMP tokens correctly carry an optional target checkpoint, and omit it cleanly when absent');
}

// --- Test 22b-4: SCENEBTN (Director-tool remote trigger) tokens -----------
{
  const basic = renderMentions('[[SCENEBTN:Session1|TavernScene|Layout1.json]]Load the tavern[[/SCENEBTN]]', campaign);
  assert.ok(basic.html.includes('data-session="Session1"'));
  assert.ok(basic.html.includes('data-scene="TavernScene"'));
  assert.ok(basic.html.includes('data-layout="Layout1.json"'));
  assert.ok(basic.html.includes('onclick="window.app.triggerDirectorButton(this)"'));
  assert.ok(basic.html.includes('>Load the tavern<'), 'the display label should be preserved as-is');

  // Layout is optional — an empty third field should render as an empty
  // attribute, not break the token or omit the attribute entirely.
  const noLayout = renderMentions('[[SCENEBTN:Session1|TavernScene|]]Switch scene[[/SCENEBTN]]', campaign);
  assert.ok(noLayout.html.includes('data-layout=""'), 'an empty layout field should render as an empty data attribute');

  // The actual reason this token uses data-* attributes instead of an
  // onclick('...') string literal: session/scene/layout are arbitrary
  // user-typed folder names, not a generated id, so they can contain a
  // quote — which would break a naively-embedded JS string literal but
  // is completely harmless as an HTML attribute value once escaped.
  const quoted = renderMentions('[[SCENEBTN:S1|The "Rusty" Anchor|]]Go[[/SCENEBTN]]', campaign);
  assert.ok(quoted.html.includes('data-scene="The &quot;Rusty&quot; Anchor"'), 'a double quote in a scene name must be HTML-escaped rather than breaking the attribute');
  assert.ok(!quoted.html.includes('Anchor"" '), 'the escaped quote should not leave a broken, unescaped attribute boundary');

  ok('SCENEBTN tokens carry session/scene/layout as safely-escaped data attributes, with layout optional and names safe even when they contain quotes');
}

// --- Test 22b-5: JUMP and SCENEBTN resolve when nested inside SAY --------
// Regression test for a real bug: SAY used to run before JUMP/SCENEBTN,
// so a token of either kind typed inside a dialogue span was already
// hidden behind SAY's own placeholder by the time JUMP/SCENEBTN got
// their turn, and the button/link silently never appeared. Fixed by
// reordering so JUMP and SCENEBTN resolve first.
{
  const npcSay = createEntity(campaign, { type: 'npc', name: 'Dialogue NPC' });

  const sceneBtnInSay = renderMentions(
    `[[SAY:${npcSay.id}]]Let me set the mood. [[SCENEBTN:Session1|Tavern|]]Load tavern scene[[/SCENEBTN]] There we go.[[/SAY]]`,
    campaign
  );
  assert.ok(sceneBtnInSay.html.includes('class="scene-btn"'), 'a SCENEBTN nested inside a SAY span must resolve to a real button, not stay as literal [[SCENEBTN:...]] text');
  assert.ok(sceneBtnInSay.html.includes('data-scene="Tavern"'));

  const jumpInSay = renderMentions(
    `[[SAY:${npcSay.id}]]Check [[JUMP:loc_market]]the market[[/JUMP]] later.[[/SAY]]`,
    campaign
  );
  assert.ok(jumpInSay.html.includes('class="jump-link"'), 'a JUMP nested inside a SAY span must also resolve');

  // Bold, a mention, and a SCENEBTN all together within the same SAY
  // span — confirms the fix doesn't disturb anything else that already
  // worked inside dialogue.
  const combined = renderMentions(
    `[[SAY:${npcSay.id}]]Ask [[${market.id}]] about the **debt**, then [[SCENEBTN:S1|Tavern|]]light the room[[/SCENEBTN]].[[/SAY]]`,
    campaign
  );
  assert.ok(combined.html.includes('<strong>debt</strong>'), 'bold should still resolve alongside a nested SCENEBTN');
  assert.ok(combined.html.includes(`window.app.openEntity('${market.id}')`), 'a mention should still resolve alongside a nested SCENEBTN');
  assert.ok(combined.html.includes('class="scene-btn"'), 'the SCENEBTN itself should resolve too, all within the same dialogue');

  ok('JUMP and SCENEBTN tokens nested inside a SAY span resolve correctly, alongside bold and mentions in the same dialogue');
}

// --- Test 22b-3: generated ids must survive every later marker pass ------
// Regression test for a real bug: ids embedded in already-generated HTML
// (via onclick="...('id')") were getting mangled by the italic regex,
// since every marker pass scans the *whole* string, including HTML an
// earlier pass already produced. Two adjacent underscore-containing ids
// (exactly what JUMP's optional "id:timeId" pair produces) triggered it
// reliably; this checks that case plus a plain entity mention pill right
// next to a JUMP link, to make sure protection covers both token types.
{
  const c15 = emptyCampaign();
  const npc15 = createEntity(c15, { type: 'npc', name: 'Old Sailor' });
  const mixedText = `Ask [[${npc15.id}]] about it, or [[JUMP:loc_scrap_yard:cp_day_3]]head to the scrap yard[[/JUMP]] directly.`;
  const rm = renderMentions(mixedText, c15);
  assert.ok(rm.html.includes(`window.app.openEntity('${npc15.id}')`), 'the entity id inside the mention pill must survive intact');
  assert.ok(rm.html.includes("window.app.jumpToReference('loc_scrap_yard','cp_day_3')"), 'both ids inside the JUMP token — each containing multiple underscores — must survive intact');
  assert.ok(!rm.html.includes('<em>'), 'no italic tag should appear anywhere — every underscore here belongs to an id, not markdown emphasis');
  ok('ids embedded in generated HTML (mention pills and JUMP links alike) survive every later marker pass untouched');
}

// --- Test 22c: DM comment marker (^^text^^) --------------------------------
{
  const dmText = `The bridge looks intact. ^^Actually collapses if anyone steps past the midpoint.^^ Roll for it.`;
  const rd = renderMentions(dmText, campaign);
  assert.ok(rd.html.includes('class="dm-comment"'), 'a ^^...^^ span should render with the dm-comment treatment');
  assert.ok(rd.html.includes('Actually collapses'), 'the wrapped text itself should be present');
  assert.ok(!rd.html.includes('^^'), 'the raw ^^ marker syntax must not leak into the rendered output');
  ok('DM comment markers render as distinctly styled inline asides');
}

// --- Test 22g: bullet lists (- and a leading tab per indent level) -------
{
  // A flat list.
  const flat = renderMentions('- Item one\n- Item two\n- Item three', campaign);
  assert.strictEqual(flat.html, '<ul><li>Item one</li><li>Item two</li><li>Item three</li></ul>');

  // A nested list — one tab per indent level, matching what the
  // renderer's own Tab/Shift+Tab handling produces.
  const nested = renderMentions('- Top A\n\t- Sub B\n\t- Sub C\n- Top D', campaign);
  assert.strictEqual(nested.html, '<ul><li>Top A<ul><li>Sub B</li><li>Sub C</li></ul></li><li>Top D</li></ul>', 'sub-items should nest inside their parent <li>, and a later top-level item should close the nested list first');

  // A list surrounded by prose shouldn't leave stray line breaks
  // clinging to the list boundary (the blank line either side of it
  // already gets absorbed into the list's own spacing).
  const mixed = renderMentions('Intro paragraph.\n\n- First\n- Second\n\nOutro paragraph.', campaign);
  assert.strictEqual(mixed.html, 'Intro paragraph.<ul><li>First</li><li>Second</li></ul>Outro paragraph.');

  // Formatting and mentions inside a bullet item should resolve exactly
  // like anywhere else — a bullet item is not a second-class text field.
  const npc = createEntity(campaign, { type: 'npc', name: 'Bulleted NPC' });
  const rich = renderMentions(`- Ask [[${npc.id}]] about the **debt**`, campaign);
  assert.ok(rich.html.includes(`window.app.openEntity('${npc.id}')`), 'a mention inside a bullet item should resolve to a real pill');
  assert.ok(rich.html.includes('<strong>debt</strong>'), 'bold inside a bullet item should resolve');

  // Text with no bullets at all must render exactly as before — this is
  // a regression check that the bullet-detection pass is a strict
  // superset of the previous behavior, not a parallel code path that
  // could diverge from it.
  const plain = renderMentions('Just a plain paragraph\nwith a soft break.', campaign);
  assert.strictEqual(plain.html, 'Just a plain paragraph<br>with a soft break.');

  // A non-blank line right after a bullet, but not itself a bullet, is a
  // soft-break continuation of that item (what Shift+Enter within a
  // bullet produces on the input side) — not a new block, and not the
  // end of the list.
  const continuation = renderMentions('- First line\nSecond line of same item\n- Next bullet', campaign);
  assert.strictEqual(continuation.html, '<ul><li>First line<br>Second line of same item</li><li>Next bullet</li></ul>', 'a continuation line should join the previous item with a <br>, not start a new plain-text block or break the list');

  // The same, but on a nested (indented) bullet — the continuation line
  // carries leading tabs purely so it lines up visually with the
  // bullet's own text while editing (matching what Shift+Enter actually
  // inserts); those tabs must not leak into the rendered output as
  // stray whitespace.
  const nestedContinuation = renderMentions('- Top item\n\t- Nested item\n\tContinuation of nested item\n\t- Another nested item', campaign);
  assert.strictEqual(nestedContinuation.html, '<ul><li>Top item<ul><li>Nested item<br>Continuation of nested item</li><li>Another nested item</li></ul></li></ul>', 'alignment tabs on a nested continuation line should be stripped, not shown as extra whitespace in the rendered item');

  ok('bullet lists render as properly nested <ul>/<li>, including inside mixed prose, with full formatting and mention support inside each item');
}

// --- Test 22d: loot table row normalization --------------------------------
{
  const { normalizeLootTableRows } = require('../src/query');

  // Typical pasted shape: a header row, then data rows, some with an
  // extra third column that should get folded into the result text
  // rather than dropped.
  const raw = [
    ['DC', 'Fund'],
    ['Fail', 'Nutzloser Metallschrott'],
    ['10', '1d6 Copper Scrap'],
    ['15', 'Salvaged Coil', 'Old Iron Faith Emblem']
  ];
  const rows = normalizeLootTableRows(raw);
  assert.strictEqual(rows.length, 3, 'the header row should be detected and skipped, leaving only data rows');
  assert.deepStrictEqual(rows[0], { dc: 'Fail', result: 'Nutzloser Metallschrott' });
  assert.strictEqual(rows[2].result, 'Salvaged Coil / Old Iron Faith Emblem', 'extra columns beyond the second should be joined into the result, not dropped');

  // No header row at all — every row is data, nothing should be
  // mistakenly eaten as a header.
  const noHeader = normalizeLootTableRows([['10', 'Some loot'], ['15', 'Better loot']]);
  assert.strictEqual(noHeader.length, 2, 'without a recognizable header row, every row should be kept as data');

  // Blank/malformed rows (a stray empty line from pasted text) should be
  // dropped rather than producing a garbage entry.
  const withBlank = normalizeLootTableRows([['DC', 'Fund'], ['10', 'Loot'], ['', ''], ['']]);
  assert.strictEqual(withBlank.length, 1, 'empty or single-cell rows should be filtered out');
  ok('loot table rows are normalized correctly: header detection, extra-column joining, and blank-row filtering');
}

// --- Test 22e: inventory table parsing — header-row detection, blank rows -
{
  const { parseInventoryTable } = require('../src/query');

  // The exact example reported, German header included — header
  // detection has no fixed word to match on here (unlike loot's "DC"),
  // so this exercises the digit-in-price heuristic specifically. A
  // detected header row isn't just discarded: its text becomes the
  // table's own column headers.
  const raw = [
    ['Leistung', 'Effekt', 'Preis'],
    ['Waffen Justieren', '1× Advantage auf nächsten Attack Wurf   ', '5 Units']
  ];
  const table = parseInventoryTable(raw);
  assert.strictEqual(table.rows.length, 1, 'the header row should be detected and skipped via the digit-in-price heuristic');
  assert.deepStrictEqual(table.rows[0], { name: 'Waffen Justieren', price: '5 Units', cells: ['1× Advantage auf nächsten Attack Wurf'] });
  assert.strictEqual(table.nameLabel, 'Leistung');
  assert.strictEqual(table.priceLabel, 'Preis');
  assert.deepStrictEqual(table.columnLabels, ['Effekt'], 'a detected header row should supply the column headers rather than just being thrown away');

  // No header row at all — first row's price already has a digit, so
  // the heuristic correctly leaves it as data.
  const noHeader = parseInventoryTable([['Potion', 'Heals 2d4', '3gp'], ['Rope', '50ft', '1gp']]);
  assert.strictEqual(noHeader.rows.length, 2, 'without a recognizable header row (first price already has a digit), every row should be kept as data');
  assert.strictEqual(noHeader.hasHeaders, false);

  // A single data row with nothing to compare against must never be
  // mistaken for a header just because its own price looks header-like.
  const singleRow = parseInventoryTable([['Odd Trinket', 'Unknown', 'Priceless']]);
  assert.strictEqual(singleRow.rows.length, 1, 'a single row should never be stripped as a header — there is nothing to compare it against');

  // Blank/malformed rows are dropped rather than producing a garbage entry.
  const withBlank = parseInventoryTable([['Item', 'Effect', 'Price'], ['Rope', '50ft', '1gp'], ['', '', ''], ['']]);
  assert.strictEqual(withBlank.rows.length, 1, 'empty rows should be filtered out');

  ok('inventory table parsing: digit-in-price header detection (whose text becomes the headers), no false header on a lone row, and blank-row filtering');
}

// --- Test 22f: explicit headers — every column between name and price ----
// stays its OWN independent column, never merged into one field
{
  const { parseInventoryTable } = require('../src/query');

  const headers = ['Name', 'Beschreibung', 'Funktion', 'Kosten (Scrap, Mark, unit)'];
  const raw = [
    ['7-Drift-Days Ration', 'Versiegelte Packung mit organischen Pflanzen, wurzeln und Pilzen', '7 Tage Nahrung', '5 Units'],
    ['Sleeping Moss', 'extrem grünes Moos', 'DC 13 CON sonst Sleep 10min', '10 Units'],
    ['Glowing Slime', 'Eine Kleine Röhre mit einem algenartigen Schleim der Leuchtet', '30 ft Licht', '15 Units']
  ];
  const table = parseInventoryTable(raw, headers);
  assert.deepStrictEqual(table.columnLabels, ['Beschreibung', 'Funktion'], 'both descriptive columns must survive as separate columns, labeled by their own headers');
  assert.strictEqual(table.nameLabel, 'Name');
  assert.strictEqual(table.priceLabel, 'Kosten (Scrap, Mark, unit)');
  assert.strictEqual(table.rows.length, 3);
  assert.deepStrictEqual(table.rows[0], {
    name: '7-Drift-Days Ration',
    price: '5 Units',
    cells: ['Versiegelte Packung mit organischen Pflanzen, wurzeln und Pilzen', '7 Tage Nahrung']
  });
  table.rows.forEach((r) => {
    r.cells.forEach((c) => assert.ok(!/^(Beschreibung|Funktion):/.test(c), 'no header label should ever be written into a cell\'s own text'));
  });

  ok('a 4-column table keeps its two descriptive columns fully independent, each under its own header, with no label text folded into any cell');
}

// --- Test 22g: cost column detection works regardless of position, and ---
// regardless of what the header itself is called
{
  const { findInventoryCostColumn, detectInventoryCostColumn } = require('../src/query');

  // Cost column in the middle, not at the end.
  assert.strictEqual(findInventoryCostColumn(['Name', 'Preis', 'Beschreibung'], [['Item', '5 Units', 'some description']]), 1);

  // Identified purely by its values, though the header gives no hint at
  // all ("Wert" means "value", not cost/price).
  assert.strictEqual(findInventoryCostColumn(['Name', 'Wert', 'Beschreibung'], [['Item', '20 Silvermark', 'some description']]), 1);

  // Falls back to the header text itself when no value names a currency.
  assert.strictEqual(findInventoryCostColumn(['Name', 'Cost', 'Description'], [['Item', 'unknown', 'some description']]), 1);

  assert.strictEqual(detectInventoryCostColumn(['Name', 'Cost'], []).confident, true, 'a cost-like header is a real signal');
  assert.strictEqual(detectInventoryCostColumn(['A', 'B', 'C'], [['x', 'y', 'z']]).confident, false, 'the rightmost-column fallback must report that it was only a guess');

  ok('the cost column is found by its currency words first, then its header text, and a mere last-column guess is reported as such');
}

// --- Test 22h: a headerless paste with exactly one column between name ---
// and price keeps the familiar "Effect" column, so simple 3-column tables
// behave the way they always have
{
  const { parseInventoryTable } = require('../src/query');
  const table = parseInventoryTable([['Rope', '50ft', '1gp']]);
  assert.deepStrictEqual(table.columnLabels, ['Effect']);
  assert.deepStrictEqual(table.rows[0], { name: 'Rope', price: '1gp', cells: ['50ft'] });

  const wide = parseInventoryTable([['Rope', 'a', 'b', '1gp']]);
  assert.deepStrictEqual(wide.columnLabels, ['Column 2', 'Column 3'], 'several unlabeled columns get distinct generic names instead of all being called Effect');

  ok('a headerless 3-column table still gets a single "Effect" column; wider headerless ones get distinct generic column names');
}

// --- Test 22i: parseTabSeparatedTable handles a clean, unwrapped table ----
// with more than 3 columns
{
  const { parseTabSeparatedTable } = require('../src/query');
  const text = 'Name\tBeschreib.\tFunktion\tkosten\nWidget\tA small widget\tDoes a thing\t5 Units\nGadget\tShiny\tMakes noise\t10 Units';
  const { headers, rows } = parseTabSeparatedTable(text);
  assert.deepStrictEqual(headers, ['Name', 'Beschreib.', 'Funktion', 'kosten']);
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0], ['Widget', 'A small widget', 'Does a thing', '5 Units']);
  ok('parseTabSeparatedTable correctly splits a clean 4-column pasted table, not just a fixed 3');
}

// --- Test 22j: a 5-column table works too — genuinely variable -----------
{
  const { parseTabSeparatedTable, parseInventoryTable } = require('../src/query');
  const text = 'Name\tLook\tUse\tRarity\tCost\nOrb\tGlowing\tLights a room\tRare\t50 Units';
  const { headers, rows } = parseTabSeparatedTable(text);
  assert.strictEqual(headers.length, 5);
  const table = parseInventoryTable(rows, headers);
  assert.deepStrictEqual(table.columnLabels, ['Look', 'Use', 'Rarity']);
  assert.deepStrictEqual(table.rows[0], { name: 'Orb', price: '50 Units', cells: ['Glowing', 'Lights a room', 'Rare'] });
  ok('a 5-column pasted table becomes three independent text columns plus name and price — the count is read from the source, not capped');
}

// --- Test 22k: THE EXACT REPORTED CASE — a table cell containing its own -
// internal line break, which a plain-text paste can only represent as an
// extra line with fewer tab-separated cells than the header
{
  const { parseTabSeparatedTable, parseInventoryTable } = require('../src/query');
  const text = 'Name\tBeschreib.\tFunktion\tkosten\n'
    + 'Wartungsdrohne\tkleine schwebende Kugel, mit 3 Greifarmen\tAdvantage auf Repair Checks, \n'
    + 'Gilt ebenfalls für Mechaniker innehralb von Schiff \t80 Units';
  const { headers, rows } = parseTabSeparatedTable(text);
  assert.deepStrictEqual(headers, ['Name', 'Beschreib.', 'Funktion', 'kosten']);
  assert.strictEqual(rows.length, 1, 'the wrapped cell must be reassembled into the SAME row, not split into two malformed rows');
  assert.strictEqual(rows[0][2], 'Advantage auf Repair Checks, \nGilt ebenfalls für Mechaniker innehralb von Schiff ');
  assert.strictEqual(rows[0][3], '80 Units');

  const table = parseInventoryTable(rows, headers);
  assert.deepStrictEqual(table.columnLabels, ['Beschreib.', 'Funktion'], 'two fully independent columns, not one combined field');
  assert.strictEqual(table.priceLabel, 'kosten');
  assert.deepStrictEqual(table.rows[0], {
    name: 'Wartungsdrohne',
    price: '80 Units',
    cells: [
      'kleine schwebende Kugel, mit 3 Greifarmen',
      'Advantage auf Repair Checks,\nGilt ebenfalls für Mechaniker innehralb von Schiff'
    ]
  });

  ok('the exact reported table parses into two independent columns, with the multi-line Funktion cell keeping its own line break and the cost landing under its header');
}

// --- Test 22l: looksLikeInventoryHeaderRow ---------------------------------
{
  const { looksLikeInventoryHeaderRow } = require('../src/query');
  assert.strictEqual(looksLikeInventoryHeaderRow(['Name', 'Beschreib.', 'Funktion', 'kosten']), true);
  assert.strictEqual(looksLikeInventoryHeaderRow(['Rope', 'Sturdy', '50']), false, 'a bare number in a cell means this is a data row, not a header');
  assert.strictEqual(looksLikeInventoryHeaderRow(['Widget', 'A thing', '5 Units']), false, 'a currency keyword in a cell means this is a data row, not a header');
  ok('looksLikeInventoryHeaderRow tells a real header apart from a data row by whether any cell holds a number or currency amount');
}

// --- Test 22m: a paste with no header line keeps every row as data -------
{
  const { parseTabSeparatedTable, parseInventoryTable } = require('../src/query');
  const { headers, rows } = parseTabSeparatedTable('Rope\t50ft\t5 Units\nTorch\tBurns an hour\t2 Units');
  assert.deepStrictEqual(headers, []);
  const table = parseInventoryTable(rows, headers.length > 0 ? headers : undefined);
  assert.strictEqual(table.rows.length, 2);
  assert.strictEqual(table.rows[0].name, 'Rope', 'the first row must not be swallowed as a false header');
  ok('a headerless paste keeps every row as data instead of mistaking the first item for a header');
}

// --- Test 22n: a two-column table is name + text, not name + price -------
{
  const { parseInventoryTable } = require('../src/query');
  const table = parseInventoryTable([['Rope', 'Sturdy rope'], ['Torch', 'Burns']]);
  assert.deepStrictEqual(table.columnLabels, ['Effect']);
  assert.strictEqual(table.rows[0].price, '', 'with no currency anywhere, a second column of a two-column table is a description, not a price');
  assert.strictEqual(table.rows[0].cells[0], 'Sturdy rope');
  ok('a two-column table keeps its second column as text rather than guessing it is a price');
}

// --- Test 22o: name and price are plain single-line; free columns keep ---
// their formatting and line breaks exactly
{
  const { parseInventoryTable } = require('../src/query');
  const table = parseInventoryTable([['**Sword**', 'line one\nline two\n- bullet\n**bold** and _italic_', '**12 Units**\n(negotiable)']], ['Name', 'Text', 'Cost']);
  const row = table.rows[0];
  assert.strictEqual(row.name, 'Sword', 'the plain single-line name column drops formatting markers');
  assert.strictEqual(row.price, '12 Units (negotiable)', 'the price column is single-line plain text too');
  assert.strictEqual(row.cells[0], 'line one\nline two\n- bullet\n**bold** and _italic_', 'a free column keeps its line breaks, bullets and formatting markers untouched');
  ok('name and price are flattened to plain single-line text, while the free-form columns keep every line break and formatting marker');
}

// --- Test 22p: a cost column in the middle still lands last, other -------
// columns keep their source order
{
  const { parseInventoryTable } = require('../src/query');
  const table = parseInventoryTable([['Orb', '50 Units', 'Glowing', 'Rare']], ['Name', 'Preis', 'Look', 'Rarity']);
  assert.deepStrictEqual(table.columnLabels, ['Look', 'Rarity']);
  assert.strictEqual(table.priceLabel, 'Preis');
  assert.deepStrictEqual(table.rows[0], { name: 'Orb', price: '50 Units', cells: ['Glowing', 'Rare'] });
  ok('a cost column sitting in the middle of the source table is moved to the end, with the other columns kept in source order');
}

// --- Test 22q: blank header cells get distinct generic names --------------
{
  const { parseInventoryTable } = require('../src/query');
  const table = parseInventoryTable([['Orb', 'a', 'b', '5 Units']], ['Name', '', '', 'Cost']);
  assert.deepStrictEqual(table.columnLabels, ['Column 2', 'Column 3']);
  ok('blank header cells become distinct generic column names rather than colliding or disappearing');
}

// --- Test 22r: a stored category reads back as the same table shape ------
{
  const { inventoryCategoryToTable } = require('../src/query');
  const cat = {
    nameLabel: 'Item', priceLabel: 'Kosten',
    columns: [{ id: 'c1', label: 'Look' }, { id: 'c2', label: 'Use' }],
    rows: [{ name: 'Orb', price: '5 Units', cells: { c1: 'Glowing' } }]
  };
  const table = inventoryCategoryToTable(cat);
  assert.deepStrictEqual(table.columnLabels, ['Look', 'Use']);
  assert.deepStrictEqual(table.rows[0], { name: 'Orb', price: '5 Units', cells: ['Glowing', ''] }, 'a missing cell reads as empty');
  assert.strictEqual(inventoryCategoryToTable({ rows: [] }).nameLabel, 'Name', 'a category with no custom headers falls back to the defaults');
  ok('a stored inventory category reads back as the same table shape the parser produces, with missing cells empty and default headers filled in');
}

// --- Test 22f: preview truncation never cuts a mention/marker in half ----
// Regression test for a real bug: a carried note's collapsed title is a
// truncated slice of its raw text, and slicing at a fixed character count
// could land in the middle of a [[id]] mention, leaving a broken,
// unresolvable token exposed (raw brackets and a partial entity id)
// instead of extending just far enough to keep it whole.
{
  const { truncatePreservingMarkers } = require('../src/query');

  // The exact example reported: a second mention straddles the cutoff.
  const reported = '- [[npc_mr7g4j1gdt07foe]] stehen am Rand vom [[loc_mr7g1ygjl7omlii]]';
  const truncatedReported = truncatePreservingMarkers(reported, 60);
  assert.ok(truncatedReported.includes('[[loc_mr7g1ygjl7omlii]]'), 'a mention token straddling the cutoff should be extended to include it whole, not left partial');

  // A token straddling the cutoff, with more real content after it —
  // should extend just past the token, not swallow the rest of the text.
  const longer = '[[npc_a]] short intro text and then ' + '[[loc_far_away_place]]' + ' plus a lot more padding text after that keeps going for a while.';
  const truncatedLonger = truncatePreservingMarkers(longer, 45);
  assert.ok(truncatedLonger.includes('[[loc_far_away_place]]'), 'the straddling token should be included whole');
  assert.ok(!truncatedLonger.includes('padding text'), 'extension should stop right after the straddling token, not run to the end of the string');

  // A bold marker straddling the cutoff should also be extended.
  const boldStraddle = 'This sentence has **bold text right here** and then keeps going further.';
  const truncatedBold = truncatePreservingMarkers(boldStraddle, 40);
  assert.ok(truncatedBold.endsWith('**'), 'a bold marker straddling the cutoff should be extended to its closing **, not left open');

  // Text already within the limit should be returned unchanged.
  assert.strictEqual(truncatePreservingMarkers('short text', 60), 'short text');

  // A token fully contained well before the cutoff should not trigger
  // any unnecessary extension.
  const contained = '[[npc_abc]] short and then padding padding padding padding padding.';
  assert.strictEqual(truncatePreservingMarkers(contained, 30), contained.slice(0, 30), 'a token already fully closed before the cutoff should not cause extension');

  ok('preview truncation extends past a straddling mention or marker instead of cutting through it, without over-extending when nothing is actually being cut');
}

// --- Test 23: a scene shown via fallback must not ALSO appear in carried --
// (regression: the old skip-check only excluded the arrival block itself
// from carry-forward, not other blocks — like a scene — tied to the same
// source checkpoint, so a scene from a fallback day showed up twice: once
// at the top via `scenes`, once again in `carried`.)
{
  const c5 = emptyCampaign();
  const loc5 = createEntity(c5, { type: 'location', name: 'Market' });
  const d1dawn = createCheckpoint(c5, { label: 'Day 1 dawn' });
  const d1midday = createCheckpoint(c5, { label: 'Day 1 midday' }); // no arrival of its own -> falls back to dawn
  const d2morning = createCheckpoint(c5, { label: 'Day 2 morning' });
  createArrivalBlock(c5, { locationId: loc5.id, timeId: d1dawn.id });
  addDescriptionV2(c5, { locationId: loc5.id, timeId: d1dawn.id, html: 'Dawn text' });
  createArrivalBlock(c5, { locationId: loc5.id, timeId: d2morning.id });
  addDescriptionV2(c5, { locationId: loc5.id, timeId: d2morning.id, html: 'Day 2 text' });
  addSceneV2(c5, { locationId: loc5.id, timeId: d1dawn.id, label: 'The exchange', lines: [{ id: 'ln1', speakerId: null, text: 'Something happens.' }] });

  const vMid = getLocationView(c5, loc5.id, d1midday.id);
  assert.strictEqual(vMid.fallback, true);
  assert.strictEqual(vMid.scenes.length, 1, 'the scene should show once via fallback (shown as part of the borrowed day)');
  assert.strictEqual(vMid.carried.filter((x) => x.kind === 'scene').length, 0, 'that same scene must NOT also appear in carried — it would be a duplicate of what fallback already shows');

  const v2 = getLocationView(c5, loc5.id, d2morning.id);
  assert.strictEqual(v2.fallback, false);
  assert.strictEqual(v2.scenes.length, 0, 'Day 2 has its own arrival, so the Day 1 scene is not shown "at the top"');
  assert.strictEqual(v2.carried.filter((x) => x.kind === 'scene').length, 1, 'the scene should appear exactly once, via carried, once there is real new content for the day');
  ok('a scene shown via fallback does not also duplicate into the carried-over list');
}

// --- Test 24: dialogue topics can be scoped to become available starting
// a specific checkpoint, staying available at every later one too --------
{
  const c6 = emptyCampaign();
  const npc6 = createEntity(c6, { type: 'npc', name: 'Informant' });
  const d1 = createCheckpoint(c6, { label: 'Day 1' });
  const d2 = createCheckpoint(c6, { label: 'Day 2' });
  const d3 = createCheckpoint(c6, { label: 'Day 3' });

  const always = addTopicV2(c6, { entityId: npc6.id, label: 'Small talk' }); // no timeId -> always available
  const fromDay2 = addTopicV2(c6, { entityId: npc6.id, label: 'The break-in', timeId: d2.id });

  let card = getEntityCard(c6, npc6.id, d1.id);
  assert.ok(card.topics.find((t) => t.moduleId === always.id), 'a topic with no timeId should be available from day 1');
  assert.ok(!card.topics.find((t) => t.moduleId === fromDay2.id), 'a topic scoped to day 2 should not appear yet on day 1');

  card = getEntityCard(c6, npc6.id, d2.id);
  assert.ok(card.topics.find((t) => t.moduleId === fromDay2.id), 'the day-2-scoped topic should become available exactly on day 2');

  card = getEntityCard(c6, npc6.id, d3.id);
  assert.ok(card.topics.find((t) => t.moduleId === fromDay2.id), 'once available, a topic should stay available on later days too, not expire');
  ok('dialogue topics can be scoped to appear starting a specific checkpoint, and stay available afterward');
}

// --- Test 25: the description text itself now carries forward exactly
// like a beat — an earlier, unread description shows collapsed under
// "Carried over" once a later checkpoint has its own new one, and stops
// once marked read -----------------------------------------------------
{
  const c7 = emptyCampaign();
  const loc7 = createEntity(c7, { type: 'location', name: 'Overlook' });
  const d1 = createCheckpoint(c7, { label: 'Day 1' });
  const d2 = createCheckpoint(c7, { label: 'Day 2' });
  const d3 = createCheckpoint(c7, { label: 'Day 3' });
  createArrivalBlock(c7, { locationId: loc7.id, timeId: d1.id });
  const desc1 = addDescriptionV2(c7, { locationId: loc7.id, timeId: d1.id, html: 'The overlook is quiet at dawn.' });
  createArrivalBlock(c7, { locationId: loc7.id, timeId: d2.id });
  const desc2 = addDescriptionV2(c7, { locationId: loc7.id, timeId: d2.id, html: 'Smoke rises from the valley below.' });
  createArrivalBlock(c7, { locationId: loc7.id, timeId: d3.id });
  addDescriptionV2(c7, { locationId: loc7.id, timeId: d3.id, html: 'Ash is falling now.' });

  // Day 2 has its own new description — Day 1's should now appear as a
  // carried, unread description, not just vanish.
  let v = getLocationView(c7, loc7.id, d2.id);
  assert.strictEqual(v.fallback, false);
  const carriedDesc = v.carried.find((c) => c.kind === 'description');
  assert.ok(carriedDesc, 'an earlier unread description should carry forward once a later checkpoint has its own new one');
  assert.strictEqual(carriedDesc.text, 'The overlook is quiet at dawn.', 'the full description text should be available, not just a label');

  // Day 3 also has its own arrival (an exact match, not a fallback), so
  // BOTH day 1's and day 2's descriptions should still carry forward to
  // it — carry-forward survives past an intermediate checkpoint that has
  // its own new content, exactly like beats already do.
  v = getLocationView(c7, loc7.id, d3.id);
  assert.strictEqual(v.fallback, false);
  assert.ok(v.carried.find((c) => c.kind === 'description' && c.blockId === desc1.id), 'day 1\'s description should still carry all the way to day 3');
  assert.ok(v.carried.find((c) => c.kind === 'description' && c.blockId === desc2.id), 'day 2\'s description should also carry forward to day 3');

  // Marking day 1's description read removes it from future carry-forward
  // everywhere, without affecting day 2's.
  markModuleComplete(c7, desc1.id, true);
  v = getLocationView(c7, loc7.id, d3.id);
  assert.ok(!v.carried.find((c) => c.kind === 'description' && c.blockId === desc1.id), 'a read description should not resurface on any later checkpoint');
  assert.ok(v.carried.find((c) => c.kind === 'description' && c.blockId === desc2.id), 'day 2\'s description should still carry forward, unaffected by day 1\'s being resolved');

  // An empty/unused arrival (e.g. a shell created by toggling presence
  // but never actually written) should never clutter the carried list.
  const c8 = emptyCampaign();
  const loc8 = createEntity(c8, { type: 'location', name: 'Empty Room' });
  const e1 = createCheckpoint(c8, { label: 'Day 1' });
  const e2 = createCheckpoint(c8, { label: 'Day 2' });
  createArrivalBlock(c8, { locationId: loc8.id, timeId: e1.id });
  createArrivalBlock(c8, { locationId: loc8.id, timeId: e2.id });
  addDescriptionV2(c8, { locationId: loc8.id, timeId: e2.id, html: 'Something happens now.' });
  const v8 = getLocationView(c8, loc8.id, e2.id);
  assert.ok(!v8.carried.find((c) => c.kind === 'description'), 'an empty, never-written description should not show up as carried content');

  ok('description text carries forward like a beat, and never clutters the list when empty');
}

// --- Test 26: checkpoint reordering ---------------------------------------
{
  const c9 = emptyCampaign();
  const { moveCheckpoint } = require('../src/dataModel');
  const x1 = createCheckpoint(c9, { label: 'First' });
  const x2 = createCheckpoint(c9, { label: 'Second' });
  const x3 = createCheckpoint(c9, { label: 'Third' });

  const orderedLabels = () => c9.checkpoints.slice().sort((a, b) => a.order - b.order).map((c) => c.label);
  assert.deepStrictEqual(orderedLabels(), ['First', 'Second', 'Third'], 'default order should match creation order');

  const moved = moveCheckpoint(c9, x3.id, -1); // move "Third" one step earlier
  assert.strictEqual(moved, true);
  assert.deepStrictEqual(orderedLabels(), ['First', 'Third', 'Second'], 'moving a checkpoint earlier should swap it with its immediate neighbor');

  const cantMoveFurther = moveCheckpoint(c9, x1.id, -1); // "First" is already first
  assert.strictEqual(cantMoveFurther, false, 'moving the first checkpoint earlier should no-op, not error or wrap around');
  assert.deepStrictEqual(orderedLabels(), ['First', 'Third', 'Second'], 'a no-op move should leave order unchanged');

  ok('checkpoints can be reordered by swapping with a neighbor, and safely no-op at the ends');
}

// --- Test 27: entity groups — create, reorder, and safe (non-destructive)
// delete ---------------------------------------------------------------
{
  const c10 = emptyCampaign();
  const { createEntityGroup, moveEntityGroup, deleteEntityGroup } = require('../src/dataModel');
  assert.deepStrictEqual(c10.entityGroups, [], 'a freshly created campaign should start with an empty groups list');

  const npcA = createEntity(c10, { type: 'npc', name: 'A' });
  const g1 = createEntityGroup(c10, { name: 'Market NPCs' });
  const g2 = createEntityGroup(c10, { name: 'Faction Leaders' });
  npcA.groupId = g1.id;

  const orderedNames = () => c10.entityGroups.slice().sort((a, b) => a.order - b.order).map((g) => g.name);
  assert.deepStrictEqual(orderedNames(), ['Market NPCs', 'Faction Leaders']);

  moveEntityGroup(c10, g2.id, -1);
  assert.deepStrictEqual(orderedNames(), ['Faction Leaders', 'Market NPCs'], 'groups should reorder the same way checkpoints do');

  deleteEntityGroup(c10, g1.id);
  assert.strictEqual(c10.entityGroups.find((g) => g.id === g1.id), undefined, 'the group itself should be gone');
  assert.ok(c10.entities[npcA.id], 'the entity that was in the deleted group must still exist — deleting a group never deletes entities');
  assert.strictEqual(c10.entities[npcA.id].groupId, null, 'the entity should fall back to ungrouped, not keep a dangling reference to a group that no longer exists');
  ok('entity groups can be created, reordered, and deleted without ever touching entity data itself');
}

// --- Test 28: bulk entity creation from a comma-separated list -----------
{
  const c11 = emptyCampaign();
  const { createEntitiesBulk, createEntityGroup: mkGroup } = require('../src/dataModel');
  const group = mkGroup(c11, { name: 'Dock workers' });

  const created = createEntitiesBulk(c11, { type: 'npc', namesText: ' Foreman Ilsa ,  Deckhand Tomas ,, , Quiet Bo ', groupId: group.id });
  assert.strictEqual(created.length, 3, 'blank entries from stray/double commas should be silently skipped');
  assert.deepStrictEqual(created.map((e) => e.name), ['Foreman Ilsa', 'Deckhand Tomas', 'Quiet Bo'], 'each name should be trimmed');
  assert.ok(created.every((e) => e.type === 'npc'));
  assert.ok(created.every((e) => e.groupId === group.id), 'bulk-created entities should land in the requested group');
  assert.ok(created.every((e) => e.icon && e.color), 'bulk-created entities should get the same icon/color treatment as one created normally');
  assert.strictEqual(Object.keys(c11.entities).length, 3);
  ok('bulk creation splits a comma-separated list into individual entities, trimmed, type-tagged, and optionally grouped');
}

// --- Test 29: groups can nest to any depth — subgroups reorder among
// their own siblings regardless of depth, and deleting a group in the
// middle of a chain reattaches its children to its own parent rather than
// always flattening to top-level -----------------------------------------
{
  const c12 = emptyCampaign();
  const { createEntityGroup: mkGroup2, moveEntityGroup: mv2, deleteEntityGroup: del2 } = require('../src/dataModel');

  const station = mkGroup2(c12, { name: 'Space Station' });
  const dock = mkGroup2(c12, { name: 'Docking Bay', parentId: station.id });
  const market = mkGroup2(c12, { name: 'Market District', parentId: station.id });
  const stall = mkGroup2(c12, { name: 'Grey Man\'s Stall', parentId: market.id }); // three levels deep
  const otherTop = mkGroup2(c12, { name: 'Unrelated Faction' });

  assert.strictEqual(dock.parentId, station.id);
  assert.strictEqual(stall.parentId, market.id, 'nesting under an existing subgroup should now be allowed, at any depth');
  assert.strictEqual(otherTop.parentId, null);

  // Reordering only affects siblings under the same parent, at whatever
  // depth — top-level order, market's children, and station's children
  // are all independent of each other.
  const subOrder = () => c12.entityGroups.filter((g) => g.parentId === station.id).sort((a, b) => a.order - b.order).map((g) => g.name);
  assert.deepStrictEqual(subOrder(), ['Docking Bay', 'Market District']);
  mv2(c12, market.id, -1);
  assert.deepStrictEqual(subOrder(), ['Market District', 'Docking Bay'], 'a subgroup should reorder among its own siblings regardless of depth');
  const topOrder = () => c12.entityGroups.filter((g) => !g.parentId).sort((a, b) => a.order - b.order).map((g) => g.name);
  assert.deepStrictEqual(topOrder(), ['Space Station', 'Unrelated Faction'], 'reordering a subgroup must not disturb top-level order');

  // Deleting a group in the MIDDLE of a chain (market, which has both a
  // parent [station] and a child [stall]) should reattach its child to
  // its own parent, not flatten it all the way to top-level.
  del2(c12, market.id);
  assert.strictEqual(c12.entityGroups.find((g) => g.id === market.id), undefined);
  const survivingStall = c12.entityGroups.find((g) => g.id === stall.id);
  assert.ok(survivingStall, 'a subgroup must survive its parent being deleted');
  assert.strictEqual(survivingStall.parentId, station.id, 'deleting a mid-chain group should reattach its child to the deleted group\'s own parent, preserving the rest of the tree, not flattening everything to top-level');

  // Deleting a TOP-LEVEL group with children still correctly promotes
  // them to top-level — the same reattach logic, just with "its own
  // parent" being null in this case.
  del2(c12, station.id);
  assert.strictEqual(c12.entityGroups.find((g) => g.id === dock.id).parentId, null, 'deleting a top-level group should promote its children to top-level (its own parent, which is null)');
  ok('groups can nest to any depth, reorder within their own sibling group regardless of depth, and deleting a group reattaches its children to its own parent rather than always flattening to top-level');
}

// --- Test 29b: a group created before nesting existed (no parentId field
// at all, not even null) must still behave as top-level ------------------
{
  const c12b = emptyCampaign();
  const { moveEntityGroup: mv2b } = require('../src/dataModel');
  // Simulating exactly what an existing save file has: groups from before
  // this feature shipped, with no parentId property whatsoever.
  c12b.entityGroups = [
    { id: 'grp_old1', name: 'Old Group One', order: 0 },
    { id: 'grp_old2', name: 'Old Group Two', order: 1 }
  ];
  const moved = mv2b(c12b, 'grp_old2', -1);
  assert.strictEqual(moved, true, 'a pre-nesting group should still be movable among its (top-level) siblings');
  const names = c12b.entityGroups.slice().sort((a, b) => a.order - b.order).map((g) => g.name);
  assert.deepStrictEqual(names, ['Old Group Two', 'Old Group One']);
  ok('a group saved before nesting existed (no parentId field at all) is correctly treated as top-level');
}

// --- Test 30: bulk-assigning several existing entities to a group at once
{
  const c13 = emptyCampaign();
  const { createEntityGroup: mkGroup3, assignEntitiesToGroup } = require('../src/dataModel');
  const npcA = createEntity(c13, { type: 'npc', name: 'A' });
  const npcB = createEntity(c13, { type: 'npc', name: 'B' });
  const npcC = createEntity(c13, { type: 'npc', name: 'C' });
  const group = mkGroup3(c13, { name: 'Dock workers' });

  assignEntitiesToGroup(c13, [npcA.id, npcB.id], group.id);
  assert.strictEqual(c13.entities[npcA.id].groupId, group.id);
  assert.strictEqual(c13.entities[npcB.id].groupId, group.id);
  assert.strictEqual(c13.entities[npcC.id].groupId, undefined, 'an entity not included in the bulk assignment should be untouched');

  assignEntitiesToGroup(c13, [npcA.id], null);
  assert.strictEqual(c13.entities[npcA.id].groupId, null, 'reassigning to null should ungroup, and only affect the entities passed in');
  assert.strictEqual(c13.entities[npcB.id].groupId, group.id, 'an entity not included in a later bulk call should keep its existing group');
  ok('multiple existing entities can be bulk-assigned to a group (or ungrouped) in one call');
}

// --- Test 31: reparenting an existing group, with cycle prevention -------
{
  const c14 = emptyCampaign();
  const { createEntityGroup: mkGroup4, reparentEntityGroup } = require('../src/dataModel');
  const station = mkGroup4(c14, { name: 'Space Station' });
  const dock = mkGroup4(c14, { name: 'Docking Bay', parentId: station.id });
  const stall = mkGroup4(c14, { name: 'Stall', parentId: dock.id });
  const faction = mkGroup4(c14, { name: 'Unrelated Faction' });

  // Basic reparent: move a top-level group under another one.
  let ok1 = reparentEntityGroup(c14, faction.id, station.id);
  assert.strictEqual(ok1, true);
  assert.strictEqual(c14.entityGroups.find((g) => g.id === faction.id).parentId, station.id);

  // Move it back to top-level.
  reparentEntityGroup(c14, faction.id, null);
  assert.strictEqual(c14.entityGroups.find((g) => g.id === faction.id).parentId, null);

  // A group can't become its own parent.
  const selfParent = reparentEntityGroup(c14, station.id, station.id);
  assert.strictEqual(selfParent, false, 'a group should not be able to become its own parent');

  // A group can't be moved under its own child (direct cycle).
  const directCycle = reparentEntityGroup(c14, station.id, dock.id);
  assert.strictEqual(directCycle, false, 'a group should not be able to move under its own direct child');

  // A group can't be moved under a deeper descendant either (indirect cycle).
  const indirectCycle = reparentEntityGroup(c14, station.id, stall.id);
  assert.strictEqual(indirectCycle, false, 'a group should not be able to move under a deeper descendant');

  // Confirm nothing was actually changed by the refused attempts.
  assert.strictEqual(c14.entityGroups.find((g) => g.id === station.id).parentId, null, 'a refused reparent must leave the tree completely unchanged');
  ok('reparenting an existing group works, and is refused whenever it would create a cycle (self, direct child, or deeper descendant)');
}

// --- Test 32: sections (beats) can be reordered -----------------------
{
  const c16 = emptyCampaign();
  const loc16 = createEntity(c16, { type: 'location', name: 'Bazaar' });
  const d1 = createCheckpoint(c16, { label: 'Day 1' });
  const arrival = createArrivalBlock(c16, { locationId: loc16.id, timeId: d1.id, html: '...' });
  const { moveBeat } = require('../src/dataModel');
  const b1 = addBeat(arrival, { label: 'First' });
  const b2 = addBeat(arrival, { label: 'Second' });
  const b3 = addBeat(arrival, { label: 'Third' });

  assert.deepStrictEqual(arrival.beats.map((b) => b.label), ['First', 'Second', 'Third'], 'default order should match creation order');

  const moved = moveBeat(arrival, b3.id, -1);
  assert.strictEqual(moved, true);
  assert.deepStrictEqual(arrival.beats.map((b) => b.label), ['First', 'Third', 'Second'], 'moving a section up should swap it with its immediate neighbor');

  const cantMoveFurther = moveBeat(arrival, b1.id, -1);
  assert.strictEqual(cantMoveFurther, false, 'moving the first section up should no-op, not error or wrap around');
  assert.deepStrictEqual(arrival.beats.map((b) => b.label), ['First', 'Third', 'Second'], 'a no-op move should leave order unchanged');

  ok('sections can be reordered by swapping with a neighbor, and safely no-op at the ends');
}

// --- Test 33: time-specific notes can be reordered, scoped per checkpoint -
{
  const c17 = emptyCampaign();
  const npc17 = createEntity(c17, { type: 'npc', name: 'Quartermaster' });
  const day1 = createCheckpoint(c17, { label: 'Day 1' });
  const day2 = createCheckpoint(c17, { label: 'Day 2' });
  const { moveNote } = require('../src/dataModel');

  const n1 = createNoteBlock(c17, { entityId: npc17.id, timeId: day1.id, text: 'First' });
  const n2 = createNoteBlock(c17, { entityId: npc17.id, timeId: day1.id, text: 'Second' });
  const n3 = createNoteBlock(c17, { entityId: npc17.id, timeId: day1.id, text: 'Third' });
  // A note on a DIFFERENT checkpoint — must be a completely separate
  // order-scope, unaffected by anything happening among the Day 1 notes.
  const other = createNoteBlock(c17, { entityId: npc17.id, timeId: day2.id, text: 'Day 2 note' });

  const day1Notes = () => c17.blocks.filter((b) => b.kind === 'note' && b.timeId === day1.id).sort((a, b) => a.order - b.order).map((n) => n.text);
  assert.deepStrictEqual(day1Notes(), ['First', 'Second', 'Third'], 'default order should match creation order within the same checkpoint');

  const moved = moveNote(c17, n3.id, -1);
  assert.strictEqual(moved, true);
  assert.deepStrictEqual(day1Notes(), ['First', 'Third', 'Second'], 'moving a note up should swap it with its immediate neighbor in the same checkpoint');

  const cantMoveFurther = moveNote(c17, n1.id, -1);
  assert.strictEqual(cantMoveFurther, false, 'moving the first note up should no-op, not error or wrap around');

  const otherUnaffected = moveNote(c17, other.id, 1);
  assert.strictEqual(otherUnaffected, false, 'the lone Day 2 note has no sibling to swap with — a different checkpoint entirely, not affected by the Day 1 reordering above');
  assert.strictEqual(other.text, 'Day 2 note');

  ok('time-specific notes can be reordered, scoped per checkpoint — moving notes in one checkpoint never affects another');
}

// --- Test 33b: reordering actually changes what getEntityCard displays ----
// The data-model test above only confirms order values swap correctly —
// this confirms that swap is actually reflected in the live query Play
// mode reads from, since a reorder button that changes stored order but
// not what's displayed would be a completely invisible bug.
{
  const c17b = emptyCampaign();
  const npc17b = createEntity(c17b, { type: 'npc', name: 'Scribe' });
  const day = createCheckpoint(c17b, { label: 'Day 1' });
  const { moveAssignment } = require('../src/dataModel');
  const a = addNoteV2(c17b, { entityId: npc17b.id, timeId: day.id, text: 'Alpha' });
  const b = addNoteV2(c17b, { entityId: npc17b.id, timeId: day.id, text: 'Beta' });

  const before = getEntityCard(c17b, npc17b.id, day.id);
  assert.deepStrictEqual(before.currentNotes.map((n) => n.text), ['Alpha', 'Beta']);

  moveAssignment(c17b, b.assignment.id, -1);
  const after = getEntityCard(c17b, npc17b.id, day.id);
  assert.deepStrictEqual(after.currentNotes.map((n) => n.text), ['Beta', 'Alpha'], 'a reorder must be reflected in what getEntityCard actually returns, not just in the stored order values');

  ok('reordering notes is reflected in getEntityCard, not just in the underlying data model');
}

// --- Test 34: dialogue topics can be reordered, scoped per entity ---------
{
  const c18 = emptyCampaign();
  const npc18 = createEntity(c18, { type: 'npc', name: 'Innkeeper' });
  const cpA = createCheckpoint(c18, { label: 'Day 1' });
  const { moveTopic } = require('../src/dataModel');

  // Topics deliberately span different timeIds (including "always
  // available") — order is entity-wide precisely because topics from
  // different timeIds end up shown together once their checkpoint is
  // reached, unlike notes.
  const t1 = createTopicBlock(c18, { entityId: npc18.id, label: 'Rumors', timeId: null });
  const t2 = createTopicBlock(c18, { entityId: npc18.id, label: 'The debt', timeId: cpA.id });
  const t3 = createTopicBlock(c18, { entityId: npc18.id, label: 'Local gossip', timeId: null });

  const order = () => c18.blocks.filter((b) => b.kind === 'topic').sort((a, b) => a.order - b.order).map((t) => t.label);
  assert.deepStrictEqual(order(), ['Rumors', 'The debt', 'Local gossip'], 'default order should match creation order across the whole entity, regardless of timeId');

  const moved = moveTopic(c18, t3.id, -1);
  assert.strictEqual(moved, true);
  assert.deepStrictEqual(order(), ['Rumors', 'Local gossip', 'The debt'], 'reordering should work across topics with different timeIds, not just within one');

  const cantMoveFurther = moveTopic(c18, t1.id, -1);
  assert.strictEqual(cantMoveFurther, false, 'moving the first topic up should no-op');

  ok('dialogue topics can be reordered across the whole entity, regardless of which checkpoint (or none) each is scoped to');
}

// --- Test 51: ^^ DM comment resolves across multiple plain-text lines -----
// The exact case reported: selecting several plain lines and pressing
// Ctrl+E used to leave the raw ^^...^^ completely unresolved, since "."
// in a regex never matches a newline by default.
{
  const md51 = renderMentions('^^Test\nnext\nline^^', campaign);
  assert.ok(md51.html.includes('<span class="dm-comment">'), 'a ^^ pair spanning multiple lines should resolve at all, not stay as raw ^^ text');
  assert.ok(!md51.html.includes('^^'), 'no raw ^^ markers should remain once resolved');
  assert.ok(md51.html.includes('Test<br>next<br>line') || md51.html.includes('Test\nnext\nline'), 'the multi-line content itself should survive inside the comment, with its line breaks intact');
  ok('a DM comment spanning multiple plain-text lines resolves correctly, matching the reported bug exactly');
}

// --- Test 52: a ^^ comment spanning a bullet point renders it as a real --
// nested list inside the comment, not broken raw text
{
  const md52 = renderMentions('^^Notes for later:\n- check the vault\n- ask the guard^^', campaign);
  assert.ok(md52.html.includes('<span class="dm-comment">'), 'the comment should resolve even though it contains bullet lines');
  assert.ok(md52.html.includes('<ul>') && md52.html.includes('<li>'), 'a bullet point inside a ^^ comment should render as a real list, not stay as raw "- text"');
  assert.ok(!md52.html.includes('^^'), 'no raw ^^ markers should leak through');
  ok('a ^^ comment that spans one or more bullet points renders them as a real nested list inside the comment');
}

// --- Test 53: a mention inside a multi-line ^^ comment still resolves ----
// to a real pill, not raw [[id]] syntax
{
  const md53 = renderMentions(`^^Remember: [[${greyMan.id}]] is watching\nfrom the shadows^^`, campaign);
  assert.ok(md53.html.includes('<span class="dm-comment">'));
  assert.ok(md53.html.includes('class="pill"'), 'a mention nested inside a multi-line comment should still resolve to a real pill');
  assert.strictEqual(md53.mentioned.length, 1, 'the mentioned entity should be reported just like anywhere else');
  ok('a mention nested inside a multi-line ^^ comment resolves to a real pill and is reported as mentioned');
}

// --- Test 54: bold/italic formatting inside a multi-line ^^ comment still-
// resolves
{
  const md54 = renderMentions('^^This is **important**\nand also _urgent_^^', campaign);
  assert.ok(md54.html.includes('<strong>important</strong>'), 'bold inside a multi-line comment should still resolve');
  assert.ok(md54.html.includes('<em>urgent</em>'), 'italic inside a multi-line comment should still resolve');
  ok('bold and italic formatting inside a multi-line ^^ comment still resolve correctly');
}

// --- Test 55: a comment wrapping an already-protected token (a JUMP -------
// link) still resolves the token correctly, not as raw [[JUMP]] syntax
{
  const beatForJump = campaign.blocks.find((b) => b.kind === 'beat') || { id: 'beat_x' };
  const md55 = renderMentions(`^^Only if they ask: [[JUMP:${beatForJump.id}]]this beat[[/JUMP]]^^`, campaign);
  assert.ok(md55.html.includes('jump-link'), 'a JUMP link nested inside a ^^ comment should still resolve to a real jump-link span');
  assert.ok(!md55.html.includes('[[JUMP'), 'no raw JUMP token syntax should leak through when nested inside a comment');
  ok('a JUMP link nested inside a ^^ comment still resolves correctly, not left as raw token syntax');
}

// --- Test 56: an unpaired ^^ (no closing marker) is left as literal text -
{
  const md56 = renderMentions('This has a stray ^^ marker with no pair.', campaign);
  assert.ok(!md56.html.includes('dm-comment'), 'a single, unpaired ^^ must not be treated as an opened-but-unclosed comment');
  ok('an unpaired ^^ with no matching close is left as literal text rather than swallowing the rest of the content');
}

// --- Test 57: bold and strikethrough also resolve across multiple lines --
// (the same underlying Ctrl+B/Ctrl+E mechanism, fixed for consistency)
{
  const md57a = renderMentions('**bold line one\nbold line two**', campaign);
  assert.ok(md57a.html.includes('<strong>'), 'bold should resolve across multiple plain-text lines too, matching the ^^ fix');
  const md57b = renderMentions('~~struck line one\nstruck line two~~', campaign);
  assert.ok(md57b.html.includes('<s>'), 'strikethrough should resolve across multiple plain-text lines too');
  ok('bold and strikethrough also resolve correctly across multiple plain-text lines, consistent with the ^^ fix');
}

// --- ^^DM aside^^ inside quoted dialogue ---------------------------------------
{
  const someone = Object.values(campaign.entities).find((e) => e.type === 'npc');
  const t = `[[SAY:${someone.id}]]Stay back ^^he is lying, DC 14 insight^^ or else.[[/SAY]] He steps forward.`;
  const r = renderMentions(t, campaign);
  assert.ok(!r.html.includes('^^'), 'no raw ^^ inside dialogue: ' + r.html);
  assert.ok(/<span class="inline-quote"[^>]*>[^]*<span class="dm-comment">he is lying, DC 14 insight<\/span>[^]*<\/span>/.test(r.html), 'the aside renders as a DM comment inside the spoken line');
  const wrapped = renderMentions(`^^[[SAY:${someone.id}]]Hello[[/SAY]] and more^^`, campaign);
  assert.ok(wrapped.html.includes('dm-comment') && !wrapped.html.includes('^^'), 'a comment around a whole quote still works');
  console.log('ok  - ^^ asides inside dialogue resolve');
}

if (process.exitCode === 1) {
  console.error('\nSome tests failed.');
} else {
  console.log('\nAll query engine tests passed.');
}








