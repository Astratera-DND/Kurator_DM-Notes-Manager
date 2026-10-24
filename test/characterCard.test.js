const assert = require('assert');
const CC = require('../src/characterCard');
const storage = require('../src/storage');
const DM = require('../src/dataModel');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`ok  - ${name}`); }
  catch (err) { failures++; console.log(`FAIL - ${name}\n  ${err.stack}`); }
}

test('ability modifiers follow the standard table', () => {
  const t = { 1: -5, 8: -1, 9: -1, 10: 0, 11: 0, 12: 1, 15: 2, 20: 5, 30: 10 };
  Object.entries(t).forEach(([s, m]) => assert.strictEqual(CC.abilityMod(Number(s)), m, `score ${s}`));
  assert.strictEqual(CC.fmt(0), '+0'); assert.strictEqual(CC.fmt(3), '+3'); assert.strictEqual(CC.fmt(-2), '-2');
});

test('proficiency bonus follows the challenge rating, including fractions', () => {
  const t = { '0': 2, '1/8': 2, '1/2': 2, '4': 2, '5': 3, '8': 3, '9': 4, '12': 4, '13': 5, '17': 6, '21': 7, '25': 8, '29': 9, '30': 9, 'junk': 2, '': 2, '1/0': 2 };
  Object.entries(t).forEach(([cr, pb]) => assert.strictEqual(CC.proficiencyBonusForCR(cr), pb, `CR ${cr}`));
});

test('the default is the 2024 Commoner: AC 10, 4 HP (1d8), all 10s, CR 0, club +2 for 2 (1d4)', () => {
  const r = CC.resolve(CC.defaultStatblock());
  assert.strictEqual(r.sb.ac, 10); assert.strictEqual(r.hpText, '4 (1d8)');
  assert.ok(r.abilities.every((a) => a.score === 10 && a.mod === 0 && a.save === 0));
  assert.strictEqual(r.pb, 2); assert.strictEqual(r.initiativeText, '+0 (10)'); assert.strictEqual(r.passivePerception, 10);
  assert.strictEqual(r.typeLine, 'Medium Humanoid, Neutral');
  assert.ok(/Club/.test(r.sb.actions) && /\+2/.test(r.sb.actions) && /2 \(1d4\)/.test(r.sb.actions));
});

test('saving throws add proficiency only where it is set', () => {
  const sb = CC.defaultStatblock(); sb.abilities.wis = 16; sb.abilities.dex = 14; sb.saveProf.wis = true; sb.cr = '5';
  const r = CC.resolve(sb);
  const get = (k) => r.abilities.find((a) => a.key === k);
  assert.strictEqual(get('wis').mod, 3); assert.strictEqual(get('wis').save, 6); assert.strictEqual(get('wis').saveText, '+6');
  assert.strictEqual(get('dex').mod, 2); assert.strictEqual(get('dex').save, 2);
});

test('skills use the right ability; proficiency adds the bonus once, expertise twice', () => {
  const sb = CC.defaultStatblock(); sb.abilities.wis = 14; sb.abilities.str = 8; sb.skills = { Insight: 1, Perception: 2, Athletics: 0 };
  const r = CC.resolve(sb);
  const sk = (n) => r.skills.find((s) => s.name === n);
  assert.strictEqual(sk('Insight').bonus, 2 + 2); assert.strictEqual(sk('Perception').bonus, 2 + 4);
  assert.strictEqual(sk('Athletics').bonus, -1); assert.strictEqual(sk('Animal Handling').bonus, 2);
  assert.strictEqual(sk('Insight').ability, 'wis'); assert.strictEqual(sk('Stealth').ability, 'dex');
  assert.strictEqual(r.passivePerception, 16);
  assert.deepStrictEqual(r.proficientSkills.map((s) => s.name), ['Insight', 'Perception']);
  assert.strictEqual(r.skills.length, 18);
});

test('every skill belongs to exactly one of the six abilities', () => {
  const keys = CC.ABILITIES.map((a) => a.key);
  CC.SKILLS.forEach((s) => assert.ok(keys.includes(s.ability), s.name));
  assert.strictEqual(new Set(CC.SKILLS.map((s) => s.name)).size, 18);
});

test('sanitising repairs junk and clamps numbers without losing good data', () => {
  const sb = CC.sanitizeStatblock({ ac: 'x', hp: -5, abilities: { str: 99, dex: 'abc', con: 12 }, saveProf: { str: 'yes', con: true }, skills: { Insight: 7, Stealth: 2, Bogus: 1 }, cr: 3, hpDice: 5, gear: 'Spear' });
  assert.strictEqual(sb.ac, 10); assert.strictEqual(sb.hp, 0);
  assert.strictEqual(sb.abilities.str, 30); assert.strictEqual(sb.abilities.dex, 10); assert.strictEqual(sb.abilities.con, 12);
  assert.strictEqual(sb.saveProf.str, false); assert.strictEqual(sb.saveProf.con, true);
  assert.deepStrictEqual(sb.skills, { Stealth: 2 });
  assert.strictEqual(sb.cr, '3'); assert.strictEqual(sb.hpDice, '1d8'); assert.strictEqual(sb.gear, 'Spear');
  assert.deepStrictEqual(CC.sanitizeStatblock(null), CC.defaultStatblock());
  assert.deepStrictEqual(CC.sanitizeStatblock('nope'), CC.defaultStatblock());
});

test('ensureStatblock gives an NPC its own copy of the Villager and never overwrites an existing block', () => {
  const e = { type: 'npc' };
  const sb = CC.ensureStatblock(e);
  assert.deepStrictEqual(sb, CC.defaultStatblock()); assert.ok(CC.isDefaultStatblock(e));
  sb.ac = 15;
  assert.ok(!CC.isDefaultStatblock(e)); assert.strictEqual(CC.getStatblock(e).ac, 15);
  assert.strictEqual(CC.ensureStatblock(e).ac, 15, 'a second call keeps the edits');
  assert.strictEqual(CC.defaultStatblock().ac, 10, 'editing a copy never changes the default');
});

test('reset puts the Villager back and keeps voice and personality', () => {
  const e = { type: 'npc' };
  CC.ensureStatblock(e).ac = 18; e.characterCard.voice.accent = 'Soft';
  CC.resetStatblock(e);
  assert.ok(CC.isDefaultStatblock(e)); assert.strictEqual(e.characterCard.statblock.ac, 10);
  assert.strictEqual(e.characterCard.voice.accent, 'Soft');
});

test('roleplay figures: passive Perception and Insight, the social skills, languages', () => {
  const e = { type: 'npc' };
  let rp = CC.roleplay(e);
  assert.strictEqual(rp.passivePerception, 10); assert.strictEqual(rp.passiveInsight, 10);
  assert.deepStrictEqual(rp.skills.map((k) => k.name), ['Insight', 'Perception', 'Deception', 'Persuasion', 'Intimidation']);
  assert.strictEqual(rp.languages, 'Common');
  const sb = CC.ensureStatblock(e); sb.abilities.wis = 14; sb.abilities.cha = 16; sb.skills = { Insight: 1, Persuasion: 2 }; sb.languages = 'Common, Thieves\' Cant';
  rp = CC.roleplay(e);
  const by = (n) => rp.skills.find((k) => k.name === n);
  assert.strictEqual(by('Insight').bonus, 4); assert.strictEqual(rp.passiveInsight, 14);
  assert.strictEqual(by('Persuasion').bonus, 3 + 4); assert.strictEqual(by('Persuasion').level, 2);
  assert.strictEqual(by('Deception').bonus, 3); assert.strictEqual(rp.passivePerception, 12);
  assert.strictEqual(rp.languages, 'Common, Thieves\' Cant');
});

test('voice and persona detection ignores blanks', () => {
  const e = { type: 'npc' };
  assert.ok(!CC.hasVoiceOrPersona(e));
  CC.ensureCard(e); assert.ok(!CC.hasVoiceOrPersona(e));
  e.characterCard.voice.accent = '   '; assert.ok(!CC.hasVoiceOrPersona(e));
  e.characterCard.persona.secret = 'Spy'; assert.ok(CC.hasVoiceOrPersona(e));
});

test('loading a campaign gives every NPC a Villager block, repairs broken cards, and leaves locations alone', () => {
  const c = storage.normalizeCampaign({
    entities: {
      a: { id: 'a', type: 'npc', name: 'A', characterCard: { statblock: { ac: 'bad', abilities: { str: 14 } }, voice: { accent: 'Soft' }, junk: 1 } },
      b: { id: 'b', type: 'npc', name: 'B' },
      c: { id: 'c', type: 'npc', name: 'C', characterCard: 'broken' },
      d: { id: 'd', type: 'npc', name: 'D', characterCard: { voice: { pitch: 'Low' }, statblock: null } },
      l: { id: 'l', type: 'location', name: 'L' }
    },
    meta: {}, blocks: [], contentModules: [], assignments: [], checkpoints: []
  });
  assert.strictEqual(c.entities.a.characterCard.statblock.ac, 10);
  assert.strictEqual(c.entities.a.characterCard.statblock.abilities.str, 14, 'an existing block keeps its real values');
  assert.strictEqual(c.entities.a.characterCard.voice.accent, 'Soft');
  assert.ok(!('junk' in c.entities.a.characterCard));
  ['b', 'c', 'd'].forEach((k) => assert.ok(CC.isDefaultStatblock(c.entities[k]), k));
  assert.strictEqual(c.entities.d.characterCard.voice.pitch, 'Low');
  assert.ok(!('characterCard' in c.entities.l));
});

test('loading twice changes nothing the second time, and never overwrites an edited block', () => {
  const raw = { entities: { a: { id: 'a', type: 'npc', name: 'A' } }, meta: {}, blocks: [], contentModules: [], assignments: [], checkpoints: [] };
  const once = JSON.parse(JSON.stringify(storage.normalizeCampaign(raw)));
  once.entities.a.characterCard.statblock.ac = 16;
  const twice = storage.normalizeCampaign(JSON.parse(JSON.stringify(once)));
  assert.strictEqual(twice.entities.a.characterCard.statblock.ac, 16);
  assert.deepStrictEqual(storage.normalizeCampaign(JSON.parse(JSON.stringify(twice))), twice);
});

test('a new NPC (and a draft NPC) starts with the Villager; a new location does not', () => {
  const campaign = DM.emptyCampaign();
  const npc = DM.createEntity(campaign, { type: 'npc', name: 'Mara' });
  assert.ok(CC.isDefaultStatblock(npc) && npc.characterCard.statblock);
  assert.ok(!('characterCard' in DM.createEntity(campaign, { type: 'location', name: 'Dock' })));
  const draft = DM.createDraftEntity(campaign, { type: 'npc' });
  assert.ok(draft.characterCard && draft.characterCard.statblock);
  assert.ok(!('characterCard' in DM.createDraftEntity(campaign, { type: 'location' })));
});

test('a card survives a JSON round trip unchanged', () => {
  const e = { type: 'npc' };
  CC.ensureStatblock(e).abilities.cha = 18; CC.ensureCard(e).voice.pitch = 'Low';
  assert.deepStrictEqual(CC.sanitizeCard(JSON.parse(JSON.stringify(e.characterCard))), e.characterCard);
});

test('summary gives the figures for the Create editor line', () => {
  const e = { type: 'npc' };
  assert.deepStrictEqual(CC.summary(e), { ac: 10, hp: 4, hpText: '4 (1d8)', cr: '0', isDefault: true });
  const sb = CC.ensureStatblock(e); sb.ac = 17; sb.hp = 45; sb.cr = '3';
  assert.deepStrictEqual(CC.summary(e), { ac: 17, hp: 45, hpText: '45 (1d8)', cr: '3', isDefault: false });
});

test('passive scores are automatic unless overridden by hand, and clearing returns to automatic', () => {
  const e = { type: 'npc' };
  const sb = CC.ensureStatblock(e); sb.abilities.wis = 14; sb.skills = { Insight: 1 };
  let r = CC.resolve(sb);
  assert.strictEqual(r.passiveInsight, 14); assert.strictEqual(r.passiveInsightAuto, 14); assert.ok(!r.passiveInsightManual);
  assert.strictEqual(r.passivePerception, 12);
  sb.passiveInsightOverride = 19; sb.passivePerceptionOverride = 0;
  r = CC.resolve(sb);
  assert.strictEqual(r.passiveInsight, 19); assert.strictEqual(r.passiveInsightAuto, 14); assert.ok(r.passiveInsightManual);
  assert.strictEqual(r.passivePerception, 0, 'zero is a real override, not "unset"'); assert.ok(r.passivePerceptionManual);
  const rp = CC.roleplay(e);
  assert.strictEqual(rp.passiveInsight, 19); assert.ok(rp.passiveInsightManual && rp.passivePerceptionManual);
  sb.passiveInsightOverride = null;
  assert.strictEqual(CC.resolve(sb).passiveInsight, 14);
  sb.abilities.wis = 18; assert.strictEqual(CC.resolve(sb).passiveInsightAuto, 16, 'auto follows later changes to the skills');
});

test('override values are sanitised: junk and blanks mean automatic, numbers are clamped', () => {
  const clean = (o) => CC.sanitizeStatblock({ passiveInsightOverride: o }).passiveInsightOverride;
  assert.strictEqual(clean(undefined), null); assert.strictEqual(clean(''), null); assert.strictEqual(clean(null), null);
  assert.strictEqual(clean('abc'), null); assert.strictEqual(clean(15), 15); assert.strictEqual(clean('15'), 15);
  assert.strictEqual(clean(500), 99); assert.strictEqual(clean(-4), 0);
  assert.ok(CC.isDefaultStatblock({ type: 'npc' }), 'a block with no overrides is still the default');
  const e = { type: 'npc' }; CC.ensureStatblock(e).passivePerceptionOverride = 11;
  assert.ok(!CC.isDefaultStatblock(e), 'an override counts as a customisation');
});

test('pinned voice / personality fields: only those with content show, bad keys are dropped', () => {
  const e = { type: 'npc' };
  CC.ensureCard(e);
  e.characterCard.voice.pitch = 'low, gravelly';
  assert.strictEqual(CC.togglePinned(e, 'voice', 'pitch'), true);
  CC.togglePinned(e, 'persona', 'secret');           // pinned but empty
  assert.deepStrictEqual(CC.pinnedFields(e).map((f) => f.key), ['pitch'], 'empty pinned fields stay hidden');
  e.characterCard.persona.secret = 'Owes the Syndicate';
  assert.deepStrictEqual(CC.pinnedFields(e).map((f) => `${f.group}.${f.key}`), ['voice.pitch', 'persona.secret']);
  assert.strictEqual(CC.togglePinned(e, 'voice', 'pitch'), false);
  assert.ok(!CC.isPinned(e, 'voice', 'pitch'));
  e.characterCard.pinned = ['voice.accent', 'nonsense', 'voice.accent', 7];
  assert.deepStrictEqual(CC.sanitizeCard(e.characterCard).pinned, ['voice.accent']);
});

test('a skill can carry a custom bonus that replaces the calculated one', () => {
  const sb = CC.defaultStatblock();
  sb.skills.Perception = 1;
  sb.skillOverrides = { Perception: 9, Stealth: 'x', Arcana: '' , Bogus: 4 };
  const r = CC.resolve(sb);
  const per = r.skills.find((k) => k.name === 'Perception');
  assert.ok(per.manual && per.bonus === 9 && per.bonusText === '+9' && per.autoBonus === 2);
  assert.strictEqual(r.passivePerceptionAuto, 19, 'the passive score follows the custom bonus');
  assert.ok(!r.skills.find((k) => k.name === 'Stealth').manual && !r.skills.find((k) => k.name === 'Arcana').manual);
  assert.ok(!('Bogus' in CC.sanitizeStatblock(sb).skillOverrides));
  assert.ok(r.proficientSkills.some((k) => k.name === 'Perception'));
  const sb2 = CC.defaultStatblock(); sb2.skillOverrides = { History: -2 };
  assert.ok(CC.resolve(sb2).proficientSkills.some((k) => k.name === 'History' && k.bonusText === '-2'), 'an override shows even without proficiency');
  assert.ok(!CC.isDefaultStatblock({ characterCard: { statblock: sb2 } }), 'an override counts as customised');
});

if (failures) { console.log(`${failures} failed`); process.exit(1); }
console.log('All character card tests passed.');
