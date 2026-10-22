// Builds a small example campaign on first launch, using the same
// Rusted spire market / Grey man / Scrap gate scenario from the design
// mockup, so opening the app for the first time shows a working example
// rather than a blank page.

const {
  emptyCampaign, createEntity, createCheckpoint, createArrivalBlock,
  createNoteBlock, createTopicBlock, createSceneBlock, addSceneLine, addBeat, createDCCheck, addDCCondition
} = require('./dataModel');
const Conditions = require('./conditions');
const Quests = require('./quests');

function buildSeedCampaign() {
  const c = emptyCampaign();

  const market = createEntity(c, {
    type: 'location',
    name: 'Rusted spire market',
    summary: 'A market built into the ribs of a downed orbital tether.'
  });
  const scrapGate = createEntity(c, {
    type: 'location',
    name: 'Scrap gate',
    summary: 'A rusted blast door repurposed as the market\'s north entrance.'
  });
  const greyMan = createEntity(c, {
    type: 'npc',
    name: 'Grey man',
    summary: 'Former signal corps engineer. Left hand replaced with a salvaged manipulator arm. Deeply distrustful of Concord officials.'
  });
  const sailor = createEntity(c, {
    type: 'npc',
    name: 'Old sailor',
    summary: 'Runs the fuel barge at the eastern dock. Owes the grey man a debt he refuses to discuss.'
  });

  const d1dawn = createCheckpoint(c, { label: 'Day 1 · dawn' });
  createCheckpoint(c, { label: 'Day 1 · midday' });
  const d2morning = createCheckpoint(c, { label: 'Day 2 · morning' });
  createCheckpoint(c, { label: 'Day 3 · night' });

  const a1 = createArrivalBlock(c, {
    locationId: market.id,
    timeId: d1dawn.id,
    html: `You arrive at the Rusted spire market as the twin suns crest the horizon. Stalls are still shuttered, but a [[${greyMan.id}]] leans against a support strut near the old [[${scrapGate.id}]], watching the crowd trickle in. [[SAY:${greyMan.id}]]You are early.[[/SAY]] he mutters, not looking up.`
  });
  a1.presence = [greyMan.id, scrapGate.id];
  addBeat(a1, {
    label: 'Robbery near the fountain',
    text: `A pickpocket strikes if the party lingers near the central fountain for more than a minute. [[SAY:${greyMan.id}]]Watch your pockets around here.[[/SAY]] the grey man mutters, if he's still nearby.`
  });

  const a2 = createArrivalBlock(c, {
    locationId: market.id,
    timeId: d2morning.id,
    html: `Rain streaks down the market's plastic awnings. The stalls near the [[${scrapGate.id}]] are busier than usual — the [[${greyMan.id}]] is nowhere in sight.`
  });
  a2.presence = [scrapGate.id];

  createNoteBlock(c, {
    entityId: market.id,
    timeId: null,
    text: 'Built into the ribs of a downed orbital tether. The structure groans audibly in high wind — a good excuse for a Perception check to notice anything else moving.'
  });
  createTopicBlock(c, {
    entityId: market.id,
    label: 'If asked about the tether wreck',
    text: 'Locals treat it as sacred ground. Climbing on the exposed rib sections is technically forbidden, though nobody enforces it seriously.'
  });

  createNoteBlock(c, {
    entityId: greyMan.id,
    timeId: null,
    text: 'Former signal corps engineer. Left hand replaced with a salvaged manipulator arm. Deeply distrustful of Concord officials.'
  });
  createNoteBlock(c, {
    entityId: greyMan.id,
    timeId: d1dawn.id,
    text: 'Waiting for a courier who never shows. Approaches the party if they linger near the scrap gate for more than a minute.'
  });
  createNoteBlock(c, {
    entityId: greyMan.id,
    timeId: d1dawn.id,
    text: 'Keeps glancing toward the fuel barge — he already knows the sailor is avoiding him.'
  });
  createNoteBlock(c, {
    entityId: greyMan.id,
    timeId: d2morning.id,
    text: 'Not present today. Last seen heading toward the relay outpost before sunrise.'
  });

  createTopicBlock(c, {
    entityId: greyMan.id,
    label: 'Ask about the signal',
    text: 'He goes quiet, then mutters about a repeating pattern coming from the outpost. Wants medical supplies in trade for the details.'
  });
  createTopicBlock(c, {
    entityId: greyMan.id,
    label: 'Rumors in town',
    text: 'A Concord patrol passed through three days ago, asking after outsiders. The stall keeper at the scrap gate is hiding something in the back room.'
  });
  createTopicBlock(c, {
    entityId: greyMan.id,
    label: 'What happened with the sailor',
    text: 'If pressed, he admits the debt was never really about money — the sailor lost cargo that belonged to someone the grey man still answers to.',
    timeId: d2morning.id // only makes sense to ask about once the party has seen the Day 1 debt scene play out
  });

  // Example: a DC check, and text that only appears once the check succeeds.
  // (Select text in a field, right-click > Make conditional; Alt+D inserts a DC check.)
  const humCheck = createDCCheck(c, { name: 'Notice the hum', checkType: 'perception', mode: 'passfail' });
  addDCCondition(c, humCheck.id, { trigger: 'failure', dc: 14, occurrence: 1, text: 'Just the wind in the rusted frame.' });
  addDCCondition(c, humCheck.id, { trigger: 'success', dc: 14, occurrence: 1, text: 'A faint, repeating pulse — somewhere behind the door.' });
  Conditions.syncDCChecks(c);
  Conditions.setPassDC(c, humCheck, 14);
  const humCond = Conditions.ensureDCLink(c, humCheck);
  createNoteBlock(c, {
    entityId: scrapGate.id,
    timeId: null,
    text: `A faint hum is audible up close. [[DCCHECK:${humCheck.id}]] [[IF:${humCond.id}:success,critSuccess]]It is the same repeating pattern the grey man talks about, coming from the relay outpost.[[/IF]]`
  });
  createNoteBlock(c, {
    entityId: scrapGate.id,
    timeId: d1dawn.id,
    text: 'Still chained shut. Opens automatically at midday.'
  });
  createNoteBlock(c, {
    entityId: scrapGate.id,
    timeId: d2morning.id,
    text: 'Propped open with a supply crate; foot traffic is heavier than usual.'
  });

  createNoteBlock(c, {
    entityId: sailor.id,
    timeId: null,
    text: 'Runs the fuel barge at the eastern dock. Owes the grey man a debt he refuses to discuss.'
  });

  const debtScene = createSceneBlock(c, {
    locationId: market.id,
    timeId: d1dawn.id,
    label: 'The grey man collects on an old debt'
  });
  addSceneLine(debtScene, {
    speakerId: null,
    text: 'The old sailor freezes mid-stride as the grey man steps out from behind a stall.'
  });
  addSceneLine(debtScene, { speakerId: greyMan.id, text: 'You have been avoiding the dock road for a week.' });
  addSceneLine(debtScene, { speakerId: sailor.id, text: 'I do not have it yet. Another few days.' });
  addSceneLine(debtScene, {
    speakerId: greyMan.id,
    text: 'Three more days. Then I stop asking politely.'
  });

  // Example: a quest. Any content can be marked as a step of it (right-click a block > Quest…).
  const debtQuest = createEntity(c, { type: 'quest', name: "The grey man's debt", summary: 'Find out what the sailor owes, and whether it can be settled.' });
  const settle = createSceneBlock(c, { locationId: market.id, timeId: d2morning.id, label: 'Settling the debt' });
  addSceneLine(settle, { speakerId: sailor.id, text: 'The cargo is gone. All I can offer is a seat on the next barge out.' });
  addSceneLine(settle, { speakerId: greyMan.id, text: 'Then we are square. For now.' });

  // The content above is stored as the older block layout; convert it now so the quest can tag modules.
  require('./storage').migrateToModularContent(c);
  ['The grey man collects on an old debt', 'What happened with the sailor', 'Settling the debt'].forEach((name) => {
    const m = c.contentModules.find((x) => x.name === name);
    if (m) Quests.assign(c, m.id, debtQuest.id);
  });

  return c;
}

module.exports = { buildSeedCampaign };
