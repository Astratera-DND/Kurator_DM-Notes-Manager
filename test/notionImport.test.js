const assert = require('assert');
const { parseOutlineText } = require('../src/notionImport');

function ok(msg) { console.log('ok  -', msg); }

// --- Test 1: basic nesting --------------------------------------------------
{
  const tree = parseOutlineText('- A\n    - B\n        - C');
  assert.strictEqual(tree.length, 1);
  assert.strictEqual(tree[0].text, 'A');
  assert.strictEqual(tree[0].depth, 0);
  assert.strictEqual(tree[0].children.length, 1);
  assert.strictEqual(tree[0].children[0].text, 'B');
  assert.strictEqual(tree[0].children[0].depth, 1);
  assert.strictEqual(tree[0].children[0].children[0].text, 'C');
  assert.strictEqual(tree[0].children[0].children[0].depth, 2);
  ok('basic nesting produces the correct parent/child chain with correct depths');
}

// --- Test 2: siblings at the same level -------------------------------------
{
  const tree = parseOutlineText('- A\n    - B1\n    - B2');
  assert.strictEqual(tree[0].children.length, 2);
  assert.strictEqual(tree[0].children[0].text, 'B1');
  assert.strictEqual(tree[0].children[1].text, 'B2');
  assert.strictEqual(tree[0].children[0].depth, tree[0].children[1].depth, 'siblings must share the same depth');
  ok('siblings at the same indentation become siblings in the tree, not nested under each other');
}

// --- Test 3: multi-level dedent in one step ---------------------------------
// A single line can dedent past several ancestor levels at once -- this is
// the case that actually exercises the while-loop popping more than one
// stack frame, not just the simple one-level-back case.
{
  const tree = parseOutlineText('- A\n    - B\n        - C\n    - D');
  assert.strictEqual(tree[0].children.length, 2, 'A should have exactly two children: B and D');
  assert.strictEqual(tree[0].children[1].text, 'D');
  assert.strictEqual(tree[0].children[1].depth, 1, 'D dedents back to being a sibling of B, not a child of C');
  assert.strictEqual(tree[0].children[0].children.length, 1, 'B should still have exactly its one child, C, unaffected by D dedenting past it');
  ok('a line dedenting past multiple ancestor levels at once lands at the correct shallower level');
}

// --- Test 4: mixed bullet and paragraph siblings ----------------------------
// The actual reason Phase 1 needs to exist at all: real Notion content mixes
// bulleted structure with plain paragraph lines nested under a bullet (a
// summary line under an NPC, with no "-" marker of its own).
{
  const tree = parseOutlineText('- NPC Name\n    Rasse: Human\n    - Topic Name\n        - Topic body line');
  const npc = tree[0];
  assert.strictEqual(npc.children.length, 2, 'the NPC should have two children: the paragraph and the topic bullet');
  assert.strictEqual(npc.children[0].type, 'paragraph');
  assert.strictEqual(npc.children[0].text, 'Rasse: Human');
  assert.strictEqual(npc.children[1].type, 'bullet');
  assert.strictEqual(npc.children[1].text, 'Topic Name');
  assert.strictEqual(npc.children[1].children[0].text, 'Topic body line');
  ok('a plain paragraph line and a bullet at the same depth become siblings, correctly typed as paragraph vs bullet');
}

// --- Test 5: blank lines are pure spacing, never represented as nodes ------
{
  const tree = parseOutlineText('- A\n\n    Text under A\n\n- B\n');
  assert.strictEqual(tree.length, 2, 'blank lines must not themselves become nodes, and must not disrupt sibling detection');
  assert.strictEqual(tree[0].text, 'A');
  assert.strictEqual(tree[0].children.length, 1);
  assert.strictEqual(tree[0].children[0].text, 'Text under A');
  assert.strictEqual(tree[1].text, 'B');
  ok('blank lines are skipped entirely rather than represented as empty nodes');
}

// --- Test 6: a stray empty bullet with no children gets pruned -------------
{
  const tree = parseOutlineText('- A\n    - B\n    - \n');
  assert.strictEqual(tree[0].children.length, 1, 'the empty, childless bullet should be removed, leaving only B');
  assert.strictEqual(tree[0].children[0].text, 'B');
  ok('a stray empty bullet with no children of its own is pruned as an artifact, not kept as a meaningless node');
}

// --- Test 7: an empty bullet that DOES have children is preserved ----------
// Deliberately different from test 6 -- discarding a node that has real
// content nested under it would lose that content's context entirely, so
// only a truly empty (no text, no children) bullet gets removed.
{
  const tree = parseOutlineText('- A\n    - \n        - Child of empty bullet');
  assert.strictEqual(tree[0].children.length, 1, 'the empty bullet is kept here, since it has a child');
  assert.strictEqual(tree[0].children[0].text, '');
  assert.strictEqual(tree[0].children[0].children[0].text, 'Child of empty bullet');
  ok('an empty bullet is only pruned when it truly has nothing under it -- one with children is preserved so their context isn\'t lost');
}

// --- Test 8: tab-based indentation works identically to spaces -------------
// The algorithm compares relative indentation, not a fixed number of
// spaces, so it shouldn't matter whether an export uses tabs or spaces, as
// long as it's internally consistent.
{
  const tree = parseOutlineText('- A\n\t- B\n\t\t- C');
  assert.strictEqual(tree[0].children[0].text, 'B');
  assert.strictEqual(tree[0].children[0].children[0].text, 'C');
  assert.strictEqual(tree[0].children[0].children[0].depth, 2);
  ok('tab-based indentation produces the same correct nesting as space-based indentation');
}

// --- Test 9: CRLF line endings (the actual encoding real Notion exports use)
{
  const tree = parseOutlineText('- A\r\n    - B\r\n');
  assert.strictEqual(tree[0].children[0].text, 'B', 'no stray \\r should be left stuck to the extracted text');
  assert.ok(!tree[0].text.includes('\r') && !tree[0].children[0].text.includes('\r'));
  ok('CRLF line endings are handled cleanly, matching real Notion export files');
}

// --- Test 10: a realistic, medium-sized synthetic scenario -----------------
// Modeled on the actual shape of a real Notion campaign export (location >
// labeled sub-sections > NPCs > a summary paragraph + a dialogue topic with
// body bullets) using invented names, not real campaign content -- this is
// the shape the later classification stage will need to work with.
{
  const outline = [
    '- Dockside Tavern',
    '    - Description',
    '        - Smells of engine oil and cheap ale',
    '        - A single flickering neon sign',
    '    - NPC',
    '        - Old Kade',
    '            Race: Human',
    '            - Rumors',
    '                - Heard the mines are hiring again',
    '                - Something about a missing shipment',
    '        - Two dockhands playing cards',
    '            - Rill Tanner',
    '                Race: Half-elf',
    '            - Doss',
    '                - quiet, watches the door'
  ].join('\n');

  const tree = parseOutlineText(outline);
  assert.strictEqual(tree.length, 1);
  const tavern = tree[0];
  assert.strictEqual(tavern.text, 'Dockside Tavern');
  assert.strictEqual(tavern.children.length, 2);
  assert.strictEqual(tavern.children[0].text, 'Description');
  assert.strictEqual(tavern.children[0].children.length, 2);

  const npcSection = tavern.children[1];
  assert.strictEqual(npcSection.text, 'NPC');
  assert.strictEqual(npcSection.children.length, 2, 'Old Kade and the two-dockhands group header');

  const kade = npcSection.children[0];
  assert.strictEqual(kade.text, 'Old Kade');
  assert.strictEqual(kade.children[0].type, 'paragraph');
  assert.strictEqual(kade.children[0].text, 'Race: Human');
  assert.strictEqual(kade.children[1].text, 'Rumors');
  assert.strictEqual(kade.children[1].children.length, 2);

  const dockhandsGroup = npcSection.children[1];
  assert.strictEqual(dockhandsGroup.text, 'Two dockhands playing cards');
  assert.strictEqual(dockhandsGroup.children.length, 2, 'the group header has two NPCs nested under it');
  assert.strictEqual(dockhandsGroup.children[0].text, 'Rill Tanner');
  assert.strictEqual(dockhandsGroup.children[1].text, 'Doss');

  ok('a realistic multi-level scenario (location > labeled sections > NPCs > mixed paragraph/bullet content > a nested group header) parses into the correct tree shape end to end');
}

// =============================================================================
// Stage 2: classification
// =============================================================================
const { classifyImportTree, looksLikeLabelLine, isGroupHeaderNode } = require('../src/notionImport');

// --- Test 11: looksLikeLabelLine --------------------------------------------
{
  assert.ok(looksLikeLabelLine('Rasse: Ur-Stämmiger'));
  assert.ok(looksLikeLabelLine('Race: Half-elf'));
  assert.ok(looksLikeLabelLine('Persönlichkeit:'), 'a bare label with nothing after it on the same line still counts');
  assert.ok(!looksLikeLabelLine('Ehemaliger Navigator bei Wayfarer'), 'ordinary prose with no colon should not match');
  assert.ok(!looksLikeLabelLine('quiet, watches the door'));
  ok('looksLikeLabelLine recognizes "Label: value" and bare "Label:" lines without false-matching ordinary prose');
}

// --- Test 12: isGroupHeaderNode ---------------------------------------------
{
  const single = parseOutlineText('- 2 Service Konstrukte\n    - reden nicht')[0];
  assert.strictEqual(isGroupHeaderNode(single), false, 'one plain leaf child is not enough to call this a group header');

  const oneNpcLike = parseOutlineText('- Some NPC\n    - Historie\n        - some story')[0];
  assert.strictEqual(isGroupHeaderNode(oneNpcLike), false, 'a topic bullet child does not itself look like an NPC, so this stays a regular NPC');

  const group = parseOutlineText('- 2 NPCs playing dice\n    - Rell\n        Race: Warborn\n    - Vera\n        Race: Driftfolk\n    - Mechanik\n        - some rule text')[0];
  assert.strictEqual(isGroupHeaderNode(group), true, 'two children each with their own label-line should be enough to call the parent a group header');

  ok('isGroupHeaderNode requires at least two independently NPC-shaped children before treating the parent as a pure container');
}

// --- Test 13: classifyImportTree — location description folding -----------
{
  const outline = [
    '- Dockside Tavern',
    '    - Smells of engine oil',
    '    - Atmosphere',
    '        - A single flickering neon sign',
    '        - Always slightly too loud'
  ].join('\n');
  const { location } = classifyImportTree(parseOutlineText(outline));
  assert.strictEqual(location.name, 'Dockside Tavern');
  assert.deepStrictEqual(location.descriptionLines, [
    '• Smells of engine oil',
    '• Atmosphere',
    '    • A single flickering neon sign',
    '    • Always slightly too loud'
  ]);
  assert.strictEqual(location.npcs.length, 0, 'no NPC section present, so there should be no NPCs at all');
  ok('non-NPC content under the location is flattened into readable, indented description lines, preserving the original nesting visually');
}

// --- Test 14: classifyImportTree — NPC section, summary vs topic split ----
{
  const outline = [
    '- Dockside Tavern',
    '    - NPC',
    '        - Old Kade',
    '            Race: Human',
    '            - Grumpy but fair',
    '            - Rumors',
    '                - Heard the mines are hiring again',
    '                - Something about a missing shipment'
  ].join('\n');
  const { location } = classifyImportTree(parseOutlineText(outline));
  assert.strictEqual(location.npcs.length, 1);
  const kade = location.npcs[0];
  assert.strictEqual(kade.role, 'npc');
  assert.strictEqual(kade.name, 'Old Kade');
  assert.deepStrictEqual(kade.summaryLines, ['Race: Human', 'Grumpy but fair'], 'the paragraph and the leaf bullet should both fold into summary text, in original order');
  assert.strictEqual(kade.topics.length, 1);
  assert.strictEqual(kade.topics[0].name, 'Rumors');
  assert.deepStrictEqual(kade.topics[0].bodyLines, ['• Heard the mines are hiring again', '• Something about a missing shipment']);
  ok('within a recognized NPC, plain paragraphs and leaf bullets become summary text while bullets with children become named topics');
}

// --- Test 15: classifyImportTree — the "npc" keyword is matched -----------
// case-insensitively, and also accepts the plural
{
  const singular = classifyImportTree(parseOutlineText('- Loc\n    - NPC\n        - Bob')).location;
  const plural = classifyImportTree(parseOutlineText('- Loc\n    - npcs\n        - Bob')).location;
  assert.strictEqual(singular.npcs.length, 1);
  assert.strictEqual(plural.npcs.length, 1);
  ok('the NPC section keyword is matched case-insensitively and accepts both singular and plural');
}

// --- Test 16: classifyImportTree — a group header nests correctly --------
{
  const outline = [
    '- Dockside Tavern',
    '    - NPC',
    '        - Two dockhands playing cards',
    '            - Rill Tanner',
    '                Race: Half-elf',
    '            - Doss',
    '                Race: Human'
  ].join('\n');
  const { location } = classifyImportTree(parseOutlineText(outline));
  assert.strictEqual(location.npcs.length, 1);
  const group = location.npcs[0];
  assert.strictEqual(group.role, 'groupHeader');
  assert.strictEqual(group.name, 'Two dockhands playing cards');
  assert.strictEqual(group.npcs.length, 2);
  assert.strictEqual(group.npcs[0].role, 'npc');
  assert.strictEqual(group.npcs[0].name, 'Rill Tanner');
  assert.strictEqual(group.npcs[1].name, 'Doss');
  ok('a group header is recognized and its children are individually classified as their own NPCs, nested one level under it');
}

// --- Test 17: classifyImportTree — extra top-level siblings are separated -
// out, not silently merged into the location or dropped without a trace
{
  const outline = '- Location A\n    - NPC\n        - Bob\n- Location B\n- Location C';
  const { location, extraTopLevelNodes } = classifyImportTree(parseOutlineText(outline));
  assert.strictEqual(location.name, 'Location A');
  assert.strictEqual(extraTopLevelNodes.length, 2);
  assert.strictEqual(extraTopLevelNodes[0].text, 'Location B');
  assert.strictEqual(extraTopLevelNodes[1].text, 'Location C');
  ok('extra top-level siblings beyond the first are surfaced separately rather than merged into the location or silently discarded');
}

// =============================================================================
// Stage 3: merge/diff planning against an existing campaign
// =============================================================================
const dataModel = require('../src/dataModel');
const { planImport } = require('../src/notionImport');

function makeTestCampaign() {
  const campaign = dataModel.emptyCampaign();
  const cpEarly = dataModel.createCheckpoint(campaign, { label: 'Day 1' });
  const cpTarget = dataModel.createCheckpoint(campaign, { label: 'Day 2' });
  return { campaign, cpEarly, cpTarget };
}

// An NPC's imported summary lands as a general note (assigned with no
// timeId, so always visible) rather than the entity's own summary field
// — that field is only ever shown in the entity editor, never during
// play, so this helper mirrors the same place real usage puts it.
function createNpcWithGeneralNote(campaign, name, noteText) {
  const npc = dataModel.createEntity(campaign, { type: 'npc', name });
  if (noteText) {
    const mod = dataModel.createContentModule(campaign, { type: 'note', text: noteText });
    dataModel.createAssignment(campaign, { moduleId: mod.id, entityId: npc.id, timeId: null });
  }
  return npc;
}

// --- Test 18: everything new — nothing exists in the campaign yet ---------
{
  const { campaign, cpTarget } = makeTestCampaign();
  const outline = '- Dockside Tavern\n    - NPC\n        - Old Kade\n            Race: Human\n            - Rumors\n                - Something juicy';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, cpTarget.id);

  assert.strictEqual(plan.location.status, 'new');
  assert.strictEqual(plan.location.matchedEntityId, null);
  assert.strictEqual(plan.npcs[0].status, 'new');
  assert.strictEqual(plan.npcs[0].topics[0].status, 'new');
  ok('a brand new location and NPC with no existing match anywhere plan as fully new, top to bottom');
}

// --- Test 19: existing location, but no description at THIS checkpoint ----
// specifically -- must not be treated as a conflict just because an
// earlier checkpoint has one (that's Play mode's fallback behavior, and
// deliberately does not apply to merge planning).
{
  const { campaign, cpEarly, cpTarget } = makeTestCampaign();
  const loc = dataModel.createEntity(campaign, { type: 'location', name: 'Dockside Tavern' });
  dataModel.createArrivalBlock(campaign, { locationId: loc.id, timeId: cpEarly.id });
  const mod = dataModel.createContentModule(campaign, { type: 'description', html: 'An older description from Day 1.' });
  dataModel.createAssignment(campaign, { moduleId: mod.id, entityId: loc.id, timeId: cpEarly.id });
  // Deliberately no arrival/description at cpTarget at all.

  const classified = classifyImportTree(parseOutlineText('- Dockside Tavern\n    - Smells of engine oil'));
  const plan = planImport(campaign, classified, cpTarget.id);

  assert.strictEqual(plan.location.matchedEntityId, loc.id, 'the existing location entity should still be matched by name');
  assert.strictEqual(plan.location.status, 'new', 'no description at the target checkpoint means new, regardless of an earlier checkpoint having one');
  ok('an existing location with a description only at an earlier checkpoint plans as new for the target checkpoint, not a false conflict against unrelated content');
}

// --- Test 20: existing description at the target checkpoint, identical ----
{
  const { campaign, cpTarget } = makeTestCampaign();
  const loc = dataModel.createEntity(campaign, { type: 'location', name: 'Dockside Tavern' });
  dataModel.createArrivalBlock(campaign, { locationId: loc.id, timeId: cpTarget.id });
  const mod = dataModel.createContentModule(campaign, { type: 'description', html: '• Smells of engine oil' });
  dataModel.createAssignment(campaign, { moduleId: mod.id, entityId: loc.id, timeId: cpTarget.id });

  const classified = classifyImportTree(parseOutlineText('- Dockside Tavern\n    - Smells of engine oil'));
  const plan = planImport(campaign, classified, cpTarget.id);

  assert.strictEqual(plan.location.status, 'unchanged');
  ok('an existing description at the target checkpoint that matches exactly plans as unchanged, not flagged as a needless conflict');
}

// --- Test 21: existing description at the target checkpoint, different ----
{
  const { campaign, cpTarget } = makeTestCampaign();
  const loc = dataModel.createEntity(campaign, { type: 'location', name: 'Dockside Tavern' });
  dataModel.createArrivalBlock(campaign, { locationId: loc.id, timeId: cpTarget.id });
  const mod = dataModel.createContentModule(campaign, { type: 'description', html: 'Something the DM already wrote by hand.' });
  dataModel.createAssignment(campaign, { moduleId: mod.id, entityId: loc.id, timeId: cpTarget.id });

  const classified = classifyImportTree(parseOutlineText('- Dockside Tavern\n    - Smells of engine oil'));
  const plan = planImport(campaign, classified, cpTarget.id);

  assert.strictEqual(plan.location.status, 'conflict');
  assert.strictEqual(plan.location.existingText, 'Something the DM already wrote by hand.');
  assert.strictEqual(plan.location.proposedText, '• Smells of engine oil');
  ok('an existing description at the target checkpoint that differs plans as a conflict, carrying both texts for the side-by-side view');
}

// --- Test 22: existing NPC, matching summary, differing topic -------------
{
  const { campaign } = makeTestCampaign();
  const npc = createNpcWithGeneralNote(campaign, 'Old Kade', 'Race: Human');
  const topicMod = dataModel.createContentModule(campaign, { type: 'topic', name: 'Rumors', text: 'The DM has since rewritten this rumor entirely.' });
  dataModel.createAssignment(campaign, { moduleId: topicMod.id, entityId: npc.id, timeId: null });

  const outline = '- Loc\n    - NPC\n        - Old Kade\n            Race: Human\n            - Rumors\n                - Something juicy from Notion';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, 'irrelevant-for-npcs');
  const kadePlan = plan.npcs[0];

  assert.strictEqual(kadePlan.matchedEntityId, npc.id);
  assert.strictEqual(kadePlan.status, 'unchanged', 'the summary text matches exactly, so the NPC-level plan item should be unchanged');
  assert.strictEqual(kadePlan.topics[0].status, 'conflict', 'the topic with the same name but different body text should be flagged');
  assert.strictEqual(kadePlan.topics[0].matchedEntityId, topicMod.id);
  ok('an existing NPC can be unchanged at the summary level while one of its topics is independently flagged as a conflict');
}

// --- Test 23: existing NPC, a topic name that doesn't exist yet -----------
{
  const { campaign } = makeTestCampaign();
  const npc = createNpcWithGeneralNote(campaign, 'Old Kade', 'Race: Human');

  const outline = '- Loc\n    - NPC\n        - Old Kade\n            Race: Human\n            - Brand New Topic\n                - Never existed before';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, 'irrelevant-for-npcs');
  const kadePlan = plan.npcs[0];

  assert.strictEqual(kadePlan.status, 'unchanged');
  assert.strictEqual(kadePlan.topics[0].status, 'new', 'a topic name the existing NPC does not have yet should plan as new, not matched against anything');
  assert.strictEqual(kadePlan.topics[0].matchedEntityId, null);
  ok('a new topic name under an otherwise-existing, otherwise-unchanged NPC plans as new on its own');
}

// --- Test 24: a brand new NPC's topics are all new, with no existing ------
// entity to even look topics up against
{
  const { campaign } = makeTestCampaign();
  const outline = '- Loc\n    - NPC\n        - Nobody Yet\n            - Some Topic\n                - body text';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, 'irrelevant-for-npcs');

  assert.strictEqual(plan.npcs[0].status, 'new');
  assert.strictEqual(plan.npcs[0].topics[0].status, 'new');
  ok('an entirely new NPC has all of its topics plan as new too, with nothing to look them up against');
}

// --- Test 25: group headers produce no plan item of their own, only ------
// individually-planned children nested under them
{
  const { campaign } = makeTestCampaign();
  const npc = createNpcWithGeneralNote(campaign, 'Rill Tanner', 'Race: Half-elf');

  const outline = '- Loc\n    - NPC\n        - Two dockhands\n            - Rill Tanner\n                Race: Half-elf\n            - Doss\n                Race: Human';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, 'irrelevant-for-npcs');

  const group = plan.npcs[0];
  assert.strictEqual(group.kind, 'groupHeader');
  assert.strictEqual(group.status, undefined, 'a group header itself is never matched against an entity and has no status of its own');
  assert.strictEqual(group.npcs.length, 2);
  assert.strictEqual(group.npcs[0].status, 'unchanged', 'Rill Tanner matches the existing entity and summary exactly');
  assert.strictEqual(group.npcs[1].status, 'new', 'Doss has no existing match at all');
  ok('a group header carries no plan/status of its own, while each child underneath it is independently matched and planned');
}

// --- Test 26: name matching ignores case and surrounding whitespace ------
{
  const { campaign } = makeTestCampaign();
  dataModel.createEntity(campaign, { type: 'npc', name: '  Old Kade  ' });
  const classified = classifyImportTree(parseOutlineText('- Loc\n    - NPC\n        - OLD KADE\n            Race: Human'));
  const plan = planImport(campaign, classified, 'irrelevant-for-npcs');
  assert.notStrictEqual(plan.npcs[0].matchedEntityId, null, 'differing case and stray surrounding whitespace should still match the same NPC');
  ok('name matching for merge purposes ignores case and surrounding whitespace differences');
}

// =============================================================================
// commitImportPlan
// =============================================================================
const { commitImportPlan } = require('../src/notionImport');
const query = require('../src/query');

// --- Test 27: a fully-new import creates everything correctly -------------
{
  const { campaign, cpTarget } = makeTestCampaign();
  const outline = '- Dockside Tavern\n    - Smells of engine oil\n    - NPC\n        - Old Kade\n            Race: Human\n            - Rumors\n                - Something juicy';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, cpTarget.id);

  const result = commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits: new Map() }, dataModel, query);

  const loc = campaign.entities[result.locationId];
  assert.strictEqual(loc.name, 'Dockside Tavern');
  const npc = campaign.entities[result.npcIds[0]];
  assert.strictEqual(npc.name, 'Old Kade');
  const note = query.getAssignedContent(campaign, npc.id, 'note')[0];
  assert.strictEqual(note.text, 'Race: Human');

  const arrival = campaign.blocks.find((b) => b.kind === 'arrival' && b.locationId === loc.id && b.timeId === cpTarget.id);
  assert.ok(arrival, 'an arrival should be created at the target checkpoint');
  assert.ok(arrival.presence.includes(npc.id), 'the imported NPC should be marked present at the location');

  const description = query.getAssignedContent(campaign, loc.id, 'description').find((d) => d.timeId === cpTarget.id);
  assert.strictEqual(description.html, '• Smells of engine oil');

  const topic = query.getAssignedContent(campaign, npc.id, 'topic')[0];
  assert.strictEqual(topic.name, 'Rumors');
  assert.strictEqual(topic.text, '• Something juicy');

  ok('a fully-new import creates the location, its arrival, its description, the NPC, and its topic, all correctly linked');
}

// --- Test 28: importing into existing entities reuses them, never --------
// duplicates
{
  const { campaign, cpTarget } = makeTestCampaign();
  const loc = dataModel.createEntity(campaign, { type: 'location', name: 'Dockside Tavern' });
  const npc = createNpcWithGeneralNote(campaign, 'Old Kade', 'Race: Human');
  const outline = '- Dockside Tavern\n    - NPC\n        - Old Kade\n            Race: Human';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, cpTarget.id);
  const result = commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits: new Map() }, dataModel, query);

  assert.strictEqual(result.locationId, null, 'no new location should be created — the existing one should be reused');
  assert.strictEqual(result.npcIds.length, 0, 'no new NPC should be created either');
  assert.strictEqual(Object.values(campaign.entities).filter((e) => e.type === 'location').length, 1);
  assert.strictEqual(Object.values(campaign.entities).filter((e) => e.type === 'npc').length, 1);

  const arrival = campaign.blocks.find((b) => b.kind === 'arrival' && b.locationId === loc.id && b.timeId === cpTarget.id);
  assert.ok(arrival.presence.includes(npc.id), 'the existing NPC should still be marked present even though nothing about it changed');

  ok('importing content that matches existing entities reuses them rather than creating duplicates, while still marking presence');
}

// --- Test 29: excluding a brand-new NPC skips it and its topics entirely --
{
  const { campaign, cpTarget } = makeTestCampaign();
  const outline = '- Loc\n    - NPC\n        - Keep Me\n            Race: Human\n        - Skip Me\n            Race: Robot\n            - Some Topic\n                - body';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, cpTarget.id);
  const skipMePlan = plan.npcs.find((n) => n.name === 'Skip Me');

  commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set([skipMePlan.key]), edits: new Map() }, dataModel, query);

  assert.ok(Object.values(campaign.entities).some((e) => e.name === 'Keep Me'));
  assert.ok(!Object.values(campaign.entities).some((e) => e.name === 'Skip Me'), 'the excluded, brand-new NPC should not be created at all');
  assert.strictEqual(campaign.contentModules.filter((m) => m.type === 'topic').length, 0, 'its topic should not be created either, since the whole NPC was skipped');

  ok('excluding a brand-new NPC in the plan skips creating it and everything nested under it');
}

// --- Test 30: excluding an EXISTING NPC only skips its summary update, ---
// not presence or its topics (which have their own independent checkboxes)
{
  const { campaign, cpTarget } = makeTestCampaign();
  const npc = createNpcWithGeneralNote(campaign, 'Old Kade', 'Original summary, untouched.');

  const outline = '- Loc\n    - NPC\n        - Old Kade\n            A brand new summary from Notion\n            - New Topic\n                - new body';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, cpTarget.id);
  const kadePlan = plan.npcs[0];
  assert.strictEqual(kadePlan.status, 'conflict', 'sanity check: the summary text genuinely differs');

  commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set([kadePlan.key]), edits: new Map() }, dataModel, query);

  const note = query.getAssignedContent(campaign, npc.id, 'note')[0];
  assert.strictEqual(note.text, 'Original summary, untouched.', 'excluding the NPC-level checkbox should leave the existing general note alone');
  const topic = query.getAssignedContent(campaign, npc.id, 'topic')[0];
  assert.strictEqual(topic.name, 'New Topic', 'the topic should still be created — it has its own checkbox, independent of the NPC-level one');

  ok('excluding an existing NPC only skips its summary update, while its topics are still governed independently');
}

// --- Test 31: inline edits override the proposed text/name before commit -
{
  const { campaign, cpTarget } = makeTestCampaign();
  const outline = '- Loc\n    - NPC\n        - Typo Namee\n            Race: Human';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, cpTarget.id);
  const npcPlan = plan.npcs[0];

  const edits = new Map([[npcPlan.key, { name: 'Typo Name', text: 'Race: Human (corrected)' }]]);
  const result = commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits }, dataModel, query);

  const npc = campaign.entities[result.npcIds[0]];
  assert.strictEqual(npc.name, 'Typo Name');
  const note = query.getAssignedContent(campaign, npc.id, 'note')[0];
  assert.strictEqual(note.text, 'Race: Human (corrected)');

  ok('an inline edit to a plan item\'s name or text overrides the automatically proposed value at commit time');
}

// --- Test 32: a conflict's edited final text updates the existing module -
// in place rather than creating a duplicate
{
  const { campaign, cpTarget } = makeTestCampaign();
  const npc = dataModel.createEntity(campaign, { type: 'npc', name: 'Old Kade' });
  const topicMod = dataModel.createContentModule(campaign, { type: 'topic', name: 'Rumors', text: 'Old version.' });
  dataModel.createAssignment(campaign, { moduleId: topicMod.id, entityId: npc.id, timeId: null });

  const outline = '- Loc\n    - NPC\n        - Old Kade\n            - Rumors\n                - New version from Notion';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, cpTarget.id);
  const topicPlan = plan.npcs[0].topics[0];
  assert.strictEqual(topicPlan.status, 'conflict');

  // The person reviews the side-by-side and decides to merge in a manually-written final version.
  const edits = new Map([[topicPlan.key, { text: 'Manually merged final version.' }]]);
  commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits }, dataModel, query);

  assert.strictEqual(campaign.contentModules.filter((m) => m.type === 'topic').length, 1, 'no duplicate topic module should be created');
  assert.strictEqual(topicMod.text, 'Manually merged final version.');

  ok('resolving a conflict with edited text updates the existing module in place, never creating a duplicate alongside it');
}

// --- Test 33: a "visuell:"-style section folds into the general note, ----
// not a separate topic — the exact real-world case reported
{
  const outline = [
    '- Loc',
    '    - NPC',
    '        - Der Alte Kade',
    '            - visuell:',
    '                ein kleiner extrem schiefer Stand aus einem dunklen fast schwarzen Holz.',
    '            - Historie',
    '                - some real dialogue topic'
  ].join('\n');
  const { location } = classifyImportTree(parseOutlineText(outline));
  const npc = location.npcs[0];

  assert.strictEqual(npc.topics.length, 1, 'only "Historie" should end up as an actual topic');
  assert.strictEqual(npc.topics[0].name, 'Historie');
  assert.deepStrictEqual(npc.summaryLines, ['visuell:', 'ein kleiner extrem schiefer Stand aus einem dunklen fast schwarzen Holz.'], 'the visuell section\'s header and body should both fold into the summary/general-note text, in order');

  ok('a "visuell:" section folds into the NPC\'s general note text instead of becoming its own topic, matching the reported real-world example exactly');
}

// --- Test 34: "visuell" is matched case-insensitively, with or without ---
// a trailing colon
{
  const outline1 = '- Loc\n    - NPC\n        - X\n            - Visuell\n                content';
  const outline2 = '- Loc\n    - NPC\n        - X\n            - VISUELL:\n                content';
  [outline1, outline2].forEach((outline) => {
    const { location } = classifyImportTree(parseOutlineText(outline));
    assert.strictEqual(location.npcs[0].topics.length, 0, 'should not become a topic regardless of case or trailing colon');
    assert.ok(location.npcs[0].summaryLines.some((l) => l.toLowerCase().startsWith('visuell')));
  });
  ok('the visuell keyword is matched case-insensitively, with or without a trailing colon');
}

// --- Test 35: a matching group auto-assigns the location and every -------
// imported NPC
{
  const { campaign, cpTarget } = makeTestCampaign();
  const group = dataModel.createEntityGroup(campaign, { name: 'Dockside Tavern' });

  const outline = '- Dockside Tavern\n    - NPC\n        - Old Kade\n            Race: Human';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, cpTarget.id);
  const result = commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits: new Map() }, dataModel, query);

  assert.strictEqual(campaign.entities[result.locationId].groupId, group.id, 'the new location should be added to the matching group');
  assert.strictEqual(campaign.entities[result.npcIds[0]].groupId, group.id, 'the new NPC should be added to the matching group too');

  ok('a group whose name matches the imported location auto-assigns both the location and its NPCs into it');
}

// --- Test 36: group matching never overrides an already-assigned group ---
{
  const { campaign, cpTarget } = makeTestCampaign();
  const matchingGroup = dataModel.createEntityGroup(campaign, { name: 'Dockside Tavern' });
  const otherGroup = dataModel.createEntityGroup(campaign, { name: 'Some Other Group' });
  const npc = createNpcWithGeneralNote(campaign, 'Old Kade', 'Race: Human');
  npc.groupId = otherGroup.id;

  const outline = '- Dockside Tavern\n    - NPC\n        - Old Kade\n            Race: Human';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, cpTarget.id);
  commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits: new Map() }, dataModel, query);

  assert.strictEqual(campaign.entities[npc.id].groupId, otherGroup.id, 'an NPC already in a different group should not be silently moved');

  ok('group auto-matching never overrides a group an entity is already deliberately assigned to');
}

// --- Test 37: no matching group means no group assignment at all ---------
{
  const { campaign, cpTarget } = makeTestCampaign();
  dataModel.createEntityGroup(campaign, { name: 'Some Unrelated Group' });

  const outline = '- Dockside Tavern\n    - NPC\n        - Old Kade\n            Race: Human';
  const classified = classifyImportTree(parseOutlineText(outline));
  const plan = planImport(campaign, classified, cpTarget.id);
  const result = commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits: new Map() }, dataModel, query);

  assert.ok(!campaign.entities[result.locationId].groupId);
  assert.ok(!campaign.entities[result.npcIds[0]].groupId);

  ok('when no existing group matches the location\'s name, nothing gets grouped at all');
}

// =============================================================================
// Inventory table detection and import
// =============================================================================
const { parseEmbeddedMarkdownTable, serializeInventoryTableToText, parseInventoryTableText } = require('../src/notionImport');

// --- Test 38: parseEmbeddedMarkdownTable recognizes a well-formed table ---
{
  const lines = [
    '| Name | Beschreibung | Kosten |',
    '| --- | --- | --- |',
    '| Rope | 50ft sturdy rope | 5 Units |',
    '| Torch | Burns for an hour | 2 Units |'
  ];
  const table = parseEmbeddedMarkdownTable(lines);
  assert.ok(table);
  assert.deepStrictEqual(table.headers, ['Name', 'Beschreibung', 'Kosten']);
  assert.strictEqual(table.rows.length, 2);
  assert.deepStrictEqual(table.rows[0], ['Rope', '50ft sturdy rope', '5 Units']);

  ok('parseEmbeddedMarkdownTable correctly parses a well-formed header + separator + data rows');
}

// --- Test 39: requires both a header AND the separator row — a stray -----
// line that merely starts and ends with "|" isn't enough
{
  assert.strictEqual(parseEmbeddedMarkdownTable(['| just one line |']), null, 'a single pipe-looking line with nothing else is not a table');
  assert.strictEqual(parseEmbeddedMarkdownTable(['| Name | Cost |', 'not a separator at all']), null, 'a header without a real "|---|---|" separator row is not recognized as a table');
  assert.strictEqual(parseEmbeddedMarkdownTable([]), null);

  ok('parseEmbeddedMarkdownTable requires a genuine header + separator pair, not just pipe-looking text, before recognizing a table');
}

// --- Test 40: blank/empty data rows are filtered out ----------------------
{
  const lines = [
    '| Name | Cost |',
    '| --- | --- |',
    '| Rope | 5 Units |',
    '|  |  |'
  ];
  const table = parseEmbeddedMarkdownTable(lines);
  assert.strictEqual(table.rows.length, 1, 'a fully blank row (matching the real Notion export\'s trailing empty row) should be filtered out');

  ok('a trailing blank table row is filtered out rather than becoming an empty inventory item');
}

// --- Test 41: serializeInventoryTableToText / parseInventoryTableText ----
// round-trip exactly, including multi-line cells and awkward characters
{
  const table = {
    hasHeaders: true, nameLabel: 'Name', priceLabel: 'Kosten',
    columnLabels: ['Beschreib.', 'Funktion'],
    rows: [
      { name: 'Drohne', price: '80 Units', cells: ['kleine Kugel | mit Pipe', 'Zeile eins\nZeile zwei\n- Punkt\n**fett**'] },
      { name: 'Pfad', price: '5 Units', cells: ['C:\\new\\table', 'endet mit Backslash\\'] },
      { name: 'Leer', price: '', cells: ['', 'nur rechts'] }
    ]
  };
  const text = serializeInventoryTableToText(table);
  assert.strictEqual(text.split('\n').length, 5, 'every row, however many lines its cells hold, stays on ONE line of text — a cell\'s line break can never be mistaken for a row boundary');
  assert.deepStrictEqual(parseInventoryTableText(text), table, 'two independent multi-line columns must survive the trip through text and back without corruption');
  assert.strictEqual(parseInventoryTableText('just some words'), null, 'text that is not a table is refused rather than guessed at');

  ok('an inventory table serializes to a one-row-per-line pipe table and parses back identically, with both independent columns and all their line breaks intact');
}

// --- Test 41b: a raw Notion export row with <br> and an escaped pipe -----
{
  const parsed = parseEmbeddedMarkdownTable(['| Name | Text | Kosten |', '| --- | --- | --- |', '| A | line1<br>line2 \\| pipe | 5 Units |']);
  assert.deepStrictEqual(parsed.rows[0], ['A', 'line1\nline2 | pipe', '5 Units'], 'Notion writes a cell\'s line break as <br> and a literal pipe as \\| — both must come back as the real characters');
  ok('Notion\'s <br> line breaks and escaped pipes inside a table cell are read as real line breaks and pipes');
}

// --- Test 42: an "Inventar" section directly under a location is --------
// detected and planned/committed as the location's own inventory
{
  const { campaign, cpTarget } = makeTestCampaign();
  const outline = [
    '- Some Shop',
    '    - Inventar',
    '        ',
    '        | Name | Beschreibung | Kosten |',
    '        | --- | --- | --- |',
    '        | Rope | Sturdy | 5 Units |'
  ].join('\n');
  const classified = classifyImportTree(parseOutlineText(outline));
  assert.ok(classified.location.inventoryTable, 'the location-level inventory table should be detected');

  const plan = planImport(campaign, classified, cpTarget.id);
  assert.ok(plan.location.inventory, 'the location plan should carry an inventory sub-plan');
  assert.strictEqual(plan.location.inventory.status, 'new');

  const result = commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits: new Map() }, dataModel, query);
  const loc = campaign.entities[result.locationId];
  assert.strictEqual(loc.inventoryCategories.length, 1);
  assert.strictEqual(loc.inventoryCategories[0].name, 'Inventar');
  assert.strictEqual(loc.inventoryCategories[0].rows[0].name, 'Rope');
  assert.strictEqual(loc.inventoryCategories[0].rows[0].price, '5 Units');

  ok('an "Inventar" section directly under the location is detected, planned, and committed as the location\'s own inventory category');
}

// --- Test 43: an "Inventar" section under a specific NPC (a vendor) is ---
// attached to that NPC, not the location — matching the real-world shape
// (Torvek Harn, Ila sorr each have their own separate stock)
{
  const { campaign, cpTarget } = makeTestCampaign();
  const outline = [
    '- Some Shop',
    '    - NPC',
    '        - Vendor Bob',
    '            Race: Human',
    '            - Inventar',
    '                ',
    '                | Name | Beschreibung | Kosten |',
    '                | --- | --- | --- |',
    '                | Rope | Sturdy | 5 Units |'
  ].join('\n');
  const classified = classifyImportTree(parseOutlineText(outline));
  const vendorNode = classified.location.npcs[0];
  assert.ok(vendorNode.inventoryTable, 'the NPC-level inventory table should be detected');
  assert.strictEqual(vendorNode.topics.length, 0, 'the inventory section should not also show up as a regular topic');

  const plan = planImport(campaign, classified, cpTarget.id);
  const result = commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits: new Map() }, dataModel, query);

  const loc = campaign.entities[result.locationId];
  const vendor = campaign.entities[result.npcIds.find((id) => campaign.entities[id].name === 'Vendor Bob')];
  assert.strictEqual((loc.inventoryCategories || []).length, 0, 'the location itself should have no inventory — it belongs to the vendor');
  assert.strictEqual(vendor.inventoryCategories.length, 1);
  assert.strictEqual(vendor.inventoryCategories[0].rows[0].name, 'Rope');

  ok('an "Inventar" section nested under a specific NPC attaches to that NPC\'s own inventory, not the location\'s');
}

// --- Test 44: re-importing identical inventory plans as unchanged, and ---
// a genuine difference plans as a conflict without duplicating the category
{
  const { campaign, cpTarget } = makeTestCampaign();
  const vendor = dataModel.createEntity(campaign, { type: 'npc', name: 'Vendor Bob' });
  vendor.inventoryCategories = [{
    id: 'invcat_x', name: 'Inventar', collapsed: false, nameLabel: 'Name', priceLabel: 'Kosten',
    columns: [{ id: 'col_desc', label: 'Beschreibung' }],
    rows: [{ name: 'Rope', price: '5 Units', cells: { col_desc: 'Sturdy' } }]
  }];

  const sameOutline = '- Some Shop\n    - NPC\n        - Vendor Bob\n            - Inventar\n                \n                | Name | Beschreibung | Kosten |\n                | --- | --- | --- |\n                | Rope | Sturdy | 5 Units |';
  const samePlan = planImport(campaign, classifyImportTree(parseOutlineText(sameOutline)), cpTarget.id);
  assert.strictEqual(samePlan.npcs[0].inventory.status, 'unchanged', 'identical rows should plan as unchanged, not a conflict');

  const diffOutline = '- Some Shop\n    - NPC\n        - Vendor Bob\n            - Inventar\n                \n                | Name | Beschreibung | Kosten |\n                | --- | --- | --- |\n                | Rope | Sturdy | 8 Units |';
  const diffPlan = planImport(campaign, classifyImportTree(parseOutlineText(diffOutline)), cpTarget.id);
  assert.strictEqual(diffPlan.npcs[0].inventory.status, 'conflict', 'a changed price should plan as a conflict');

  commitImportPlan(campaign, diffPlan, { timeId: cpTarget.id, excluded: new Set(), edits: new Map() }, dataModel, query);
  assert.strictEqual(vendor.inventoryCategories.length, 1, 'resolving the conflict should update the existing category in place, never duplicate it');
  assert.strictEqual(vendor.inventoryCategories[0].id, 'invcat_x');
  assert.strictEqual(vendor.inventoryCategories[0].columns[0].id, 'col_desc', 'the existing column keeps its id because its header matched');
  assert.strictEqual(vendor.inventoryCategories[0].rows[0].price, '8 Units');

  ok('re-importing identical inventory plans as unchanged, a genuine change plans as a conflict, and accepting it updates the existing category in place rather than duplicating it');
}

// --- Test 44b: leaving a conflict untouched (the preview's default) ------
// changes NOTHING about the existing category
{
  const { campaign, cpTarget } = makeTestCampaign();
  const vendor = dataModel.createEntity(campaign, { type: 'npc', name: 'Vendor Bob' });
  vendor.inventoryCategories = [{
    id: 'invcat_x', name: 'Inventar', collapsed: false,
    columns: [{ id: 'col_a', label: 'Look' }],
    rows: [{ name: 'Rope', price: '5 Units', cells: { col_a: 'hand-edited text with   odd spacing ' } }]
  }];
  const outline = '- Some Shop\n    - NPC\n        - Vendor Bob\n            - Inventar\n                \n                | Name | Beschreibung | Kosten |\n                | --- | --- | --- |\n                | Rope | Sturdy | 8 Units |';
  const plan = planImport(campaign, classifyImportTree(parseOutlineText(outline)), cpTarget.id);
  const inv = plan.npcs[0].inventory;
  assert.strictEqual(inv.status, 'conflict');

  const before = JSON.stringify(vendor.inventoryCategories);
  // The preview pre-seeds every conflict's final text with the existing content.
  const edits = new Map([[inv.key, { text: inv.existingText }]]);
  commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits }, dataModel, query);
  assert.strictEqual(JSON.stringify(vendor.inventoryCategories), before, 'an untouched conflict must leave the existing category byte-for-byte as it was — not re-parsed, not re-saved, not even re-trimmed');
  ok('leaving an inventory conflict untouched changes nothing at all about the existing category');
}

// --- Test 44c: editing the preview text — including adding a column —----
// is read back and applied
{
  const { campaign, cpTarget } = makeTestCampaign();
  const outline = '- Some Shop\n    - NPC\n        - Vendor Bob\n            - Inventar\n                \n                | Name | Beschreibung | Kosten |\n                | --- | --- | --- |\n                | Rope | Sturdy | 5 Units |';
  const plan = planImport(campaign, classifyImportTree(parseOutlineText(outline)), cpTarget.id);
  const inv = plan.npcs[0].inventory;
  assert.strictEqual(inv.status, 'new');

  const edited = '| Name | Beschreibung | Seltenheit | Kosten |\n| --- | --- | --- | --- |\n| Rope | Sturdy\\nand long | common | 5 Units |';
  const result = commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits: new Map([[inv.key, { text: edited }]]) }, dataModel, query);

  const vendor = campaign.entities[result.npcIds[0]];
  const cat = vendor.inventoryCategories[0];
  assert.deepStrictEqual(cat.columns.map((c) => c.label), ['Beschreibung', 'Seltenheit'], 'a column added while editing the preview text becomes a real column');
  assert.strictEqual(cat.rows[0].cells[cat.columns[0].id], 'Sturdy\nand long', 'an edited cell keeps the line break written into it');
  assert.strictEqual(cat.rows[0].cells[cat.columns[1].id], 'common');
  ok('edits made to the inventory text in the preview — a changed cell, a new column — are read back and applied');
}

// --- Test 44d: an unreadable edit is skipped, never guessed at -----------
{
  const { campaign, cpTarget } = makeTestCampaign();
  const outline = '- Some Shop\n    - NPC\n        - Vendor Bob\n            - Inventar\n                \n                | Name | Beschreibung | Kosten |\n                | --- | --- | --- |\n                | Rope | Sturdy | 5 Units |';
  const plan = planImport(campaign, classifyImportTree(parseOutlineText(outline)), cpTarget.id);
  const inv = plan.npcs[0].inventory;
  const result = commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits: new Map([[inv.key, { text: 'I deleted the table by accident' }]]) }, dataModel, query);
  const vendor = campaign.entities[result.npcIds[0]];
  assert.strictEqual((vendor.inventoryCategories || []).length, 0, 'text that is no longer a table creates nothing rather than a garbage category');
  ok('an inventory edit that no longer reads as a table is skipped instead of being guessed at');
}

// --- Test 45: end-to-end against the real Ersatzteilstände data, ---------
// verifying against the actual reported real-world case
// This one needs the author's own Notion export, which is private campaign
// content and therefore not part of the repository. Set NOTION_EXAMPLE_TEXT to
// its path to run it; without the file it is skipped.
const REAL_EXPORT = process.env.NOTION_EXAMPLE_TEXT || '/mnt/user-data/uploads/NotionExampleText.txt';
if (!require('fs').existsSync(REAL_EXPORT)) {
  console.log('skip -  end-to-end import of the real export (file not available)');
} else {
  const fs = require('fs');
  const { campaign, cpTarget } = makeTestCampaign();
  const rawText = fs.readFileSync(REAL_EXPORT, 'utf8');
  const tree = parseOutlineText(rawText);
  const ersatzteilstaendeNode = tree.find((t) => t.text === 'Ersatzteilstände');
  const classified = classifyImportTree([ersatzteilstaendeNode]);
  const plan = planImport(campaign, classified, cpTarget.id);
  const result = commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits: new Map() }, dataModel, query);

  const torvek = campaign.entities[result.npcIds.find((id) => campaign.entities[id].name === 'Torvek Harn')];
  const ilaSorr = campaign.entities[result.npcIds.find((id) => campaign.entities[id].name === 'Ila sorr')];
  assert.ok(torvek, 'Torvek Harn should have been created');
  assert.ok(ilaSorr, 'Ila sorr should have been created');
  assert.strictEqual(torvek.inventoryCategories[0].rows.length, 6, 'Torvek\'s real inventory has 6 items');
  assert.strictEqual(ilaSorr.inventoryCategories[0].rows.length, 2, 'Ila sorr\'s real inventory has 2 items');
  assert.ok(torvek.inventoryCategories[0].rows.some((r) => r.name === 'StillFrame Magnetic Anchor' && r.price === '75 Units'));

  // The reported problem: Beschreibung and Funktion must be two separate
  // columns, not one column with "Funktion:" written into its text.
  const cat = torvek.inventoryCategories[0];
  assert.deepStrictEqual(cat.columns.map((c) => c.label), ['Beschreibung', 'Funktion'], 'the real table\'s two descriptive columns must each stay their own column');
  const [descCol, funcCol] = cat.columns;
  const anchor = cat.rows.find((r) => r.name === 'StillFrame Magnetic Anchor');
  assert.ok(anchor.cells[descCol.id] && anchor.cells[funcCol.id], 'both columns must hold their own text');
  cat.rows.forEach((r) => {
    Object.values(r.cells).forEach((c) => assert.ok(!/^(Beschreibung|Funktion):/m.test(c), 'no header label may be written into a cell\'s own text'));
  });

  ok('end-to-end import of the real Ersatzteilstände data correctly creates both vendor NPCs with their own separate, correctly-priced inventories');
}

// =============================================================================
// Pre-seeding conflicts: "never overwrite by default"
// =============================================================================
const { listPlanItems, seedConflictEdits } = require('../src/notionImport');

const RICH_OUTLINE = [
  '- Dockside Tavern',
  '    - Smells of engine oil',
  '    - Inventar',
  '        | Name | Look | Kosten |',
  '        | --- | --- | --- |',
  '        | Crate | wooden | 5 Units |',
  '    - NPC',
  '        - Old Kade',
  '            Race: Human',
  '            - Rumors',
  '                - Something juicy',
  '            - Inventar',
  '                | Name | Look | Use | Kosten |',
  '                | --- | --- | --- | --- |',
  '                | Rope | Sturdy | climbs | 5 Units |',
  '        - Two dockhands',
  '            - Rill Tanner',
  '                Race: Half-elf',
  '                - Inventar',
  '                    | Name | Look | Kosten |',
  '                    | --- | --- | --- |',
  '                    | Dice | bone | 1 Units |',
  '            - Doss',
  '                Race: Human'
].join('\n');

// --- Test 46: listPlanItems reaches every kind of plan item ---------------
{
  const { campaign, cpTarget } = makeTestCampaign();
  const plan = planImport(campaign, classifyImportTree(parseOutlineText(RICH_OUTLINE)), cpTarget.id);
  const items = listPlanItems(plan);
  const kinds = (k) => items.filter((i) => i.kind === k).length;
  assert.strictEqual(kinds('location'), 1);
  assert.strictEqual(kinds('npc'), 3, 'Old Kade plus both members of the group header');
  assert.strictEqual(kinds('topic'), 1);
  assert.strictEqual(kinds('inventory'), 3, 'the location\'s own inventory, a vendor\'s, and one belonging to an NPC inside a group header');
  assert.ok(items.every((i) => i.kind !== 'groupHeader'), 'a group header has no status of its own and is never listed');
  assert.ok(items.every((i) => i.key), 'every listed item carries the key the preview tracks it by');
  ok('one walker reaches the location, every NPC (group members included), every topic, and every inventory at any level');
}

// --- Test 47: every kind of conflict gets seeded with its existing text ---
{
  const { campaign, cpTarget } = makeTestCampaign();
  const first = planImport(campaign, classifyImportTree(parseOutlineText(RICH_OUTLINE)), cpTarget.id);
  commitImportPlan(campaign, first, { timeId: cpTarget.id, excluded: new Set(), edits: new Map() }, dataModel, query);

  // Hand-edit one of each kind of content.
  const loc = Object.values(campaign.entities).find((e) => e.name === 'Dockside Tavern');
  const kade = Object.values(campaign.entities).find((e) => e.name === 'Old Kade');
  const rill = Object.values(campaign.entities).find((e) => e.name === 'Rill Tanner');
  const descModule = campaign.contentModules.find((m) => m.type === 'description');
  descModule.html = 'my own description';
  campaign.contentModules.find((m) => m.type === 'note').text = 'my own note';
  campaign.contentModules.find((m) => m.type === 'topic').text = 'my own topic text';
  const edit = (entity) => { const cat = entity.inventoryCategories[0]; cat.rows[0].cells[cat.columns[0].id] = 'my own cell'; };
  edit(loc); edit(kade); edit(rill);

  const second = planImport(campaign, classifyImportTree(parseOutlineText(RICH_OUTLINE)), cpTarget.id);
  const conflicts = listPlanItems(second).filter((i) => i.status === 'conflict');
  assert.ok(conflicts.some((i) => i.kind === 'inventory'), 'sanity: the hand-edited inventories really are flagged as conflicts');

  const seeded = seedConflictEdits(second);
  assert.strictEqual(seeded.size, conflicts.length, 'every conflict — of every kind — must be pre-seeded');
  conflicts.forEach((c) => assert.strictEqual(seeded.get(c.key).text, c.existingText, `${c.kind} "${c.name}" must start as what is already in the campaign`));
  assert.ok(listPlanItems(second).filter((i) => i.status !== 'conflict').every((i) => !seeded.has(i.key)), 'items that are new or unchanged are not given a seeded edit');
  ok('every conflict of every kind — descriptions, notes, topics, and inventories at any level — starts as the existing content');
}

// --- Test 48: THE INVARIANT — importing again and leaving every conflict --
// alone changes nothing in the campaign, byte for byte
{
  const { campaign, cpTarget } = makeTestCampaign();
  commitImportPlan(campaign, planImport(campaign, classifyImportTree(parseOutlineText(RICH_OUTLINE)), cpTarget.id), { timeId: cpTarget.id, excluded: new Set(), edits: new Map() }, dataModel, query);

  const loc = Object.values(campaign.entities).find((e) => e.name === 'Dockside Tavern');
  const kade = Object.values(campaign.entities).find((e) => e.name === 'Old Kade');
  const rill = Object.values(campaign.entities).find((e) => e.name === 'Rill Tanner');
  campaign.contentModules.find((m) => m.type === 'description').html = 'my own description';
  campaign.contentModules.find((m) => m.type === 'note').text = 'my own note   ';
  campaign.contentModules.find((m) => m.type === 'topic').text = 'my own topic text';
  [loc, kade, rill].forEach((e) => { const cat = e.inventoryCategories[0]; cat.rows[0].cells[cat.columns[0].id] = 'my own cell  '; });

  const replan = () => planImport(campaign, classifyImportTree(parseOutlineText(RICH_OUTLINE)), cpTarget.id);
  const before = JSON.stringify(campaign);

  // Negative control: WITHOUT seeding, the same re-import overwrites the lot.
  // This proves the invariant below can actually fail.
  const control = JSON.parse(before);
  commitImportPlan(control, replan(), { timeId: cpTarget.id, excluded: new Set(), edits: new Map() }, dataModel, query);
  assert.notStrictEqual(JSON.stringify(control), before, 'control: with no seeded edits, this re-import really does overwrite the hand edits');

  const plan = replan();
  commitImportPlan(campaign, plan, { timeId: cpTarget.id, excluded: new Set(), edits: seedConflictEdits(plan) }, dataModel, query);
  assert.strictEqual(JSON.stringify(campaign), before, 'leaving every conflict untouched must leave the whole campaign exactly as it was — descriptions, notes, topics and every inventory');
  ok('re-importing and leaving every conflict alone changes nothing in the campaign (a control run without seeding does overwrite, so this test can genuinely fail)');
}

console.log('\nAll Notion import outline parser tests passed.');
