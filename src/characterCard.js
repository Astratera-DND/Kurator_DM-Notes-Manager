// Character card for NPCs: a 2024 (5.5e) style stat block plus the DM's own
// notes on voice and personality.
//
// Everything is optional and stored on entity.characterCard:
//   statblock : null  -> the entity uses the default Villager (Commoner) block
//               object -> a customised block (see defaultStatblock())
//   voice     : { pitch, accent, pace, catchphrase, example }
//   persona   : { role, appearance, demeanor, wants, fears, ideal, mannerism, secret, attitude }
//
// The default is deliberately NOT written into every NPC; an entity only gets
// a statblock of its own once the DM customises it, so every NPC without one
// follows the default and nothing bloats the save file.
//
// Wrapped in an IIFE so nothing leaks into the shared renderer scope.
(function () {

const ABILITIES = [
  { key: 'str', label: 'STR', name: 'Strength' },
  { key: 'dex', label: 'DEX', name: 'Dexterity' },
  { key: 'con', label: 'CON', name: 'Constitution' },
  { key: 'int', label: 'INT', name: 'Intelligence' },
  { key: 'wis', label: 'WIS', name: 'Wisdom' },
  { key: 'cha', label: 'CHA', name: 'Charisma' }
];

const SKILLS = [
  { name: 'Acrobatics', ability: 'dex' },
  { name: 'Animal Handling', ability: 'wis' },
  { name: 'Arcana', ability: 'int' },
  { name: 'Athletics', ability: 'str' },
  { name: 'Deception', ability: 'cha' },
  { name: 'History', ability: 'int' },
  { name: 'Insight', ability: 'wis' },
  { name: 'Intimidation', ability: 'cha' },
  { name: 'Investigation', ability: 'int' },
  { name: 'Medicine', ability: 'wis' },
  { name: 'Nature', ability: 'int' },
  { name: 'Perception', ability: 'wis' },
  { name: 'Performance', ability: 'cha' },
  { name: 'Persuasion', ability: 'cha' },
  { name: 'Religion', ability: 'int' },
  { name: 'Sleight of Hand', ability: 'dex' },
  { name: 'Stealth', ability: 'dex' },
  { name: 'Survival', ability: 'wis' }
];

const VOICE_FIELDS = [
  { key: 'pitch', label: 'Pitch & tone', placeholder: 'e.g. low, gravelly, tired' },
  { key: 'accent', label: 'Accent', placeholder: 'e.g. dockside drawl, clipped and formal' },
  { key: 'pace', label: 'Pace & volume', placeholder: 'e.g. slow, mutters, never raises voice' },
  { key: 'catchphrase', label: 'Verbal tic / catchphrase', placeholder: 'e.g. "Mark me." / clears throat before lying' },
  { key: 'example', label: 'Say it like this', placeholder: 'A sample line to get the voice in your head', long: true }
];

const PERSONA_FIELDS = [
  { key: 'role', label: 'Role / occupation', placeholder: 'e.g. bartender, informant for the Syndicate' },
  { key: 'appearance', label: 'Appearance & age', placeholder: 'Quick visual hook' },
  { key: 'demeanor', label: 'Demeanor', placeholder: 'How they come across at first meeting' },
  { key: 'attitude', label: 'Attitude toward the party', placeholder: 'Friendly / wary / hostile — and why' },
  { key: 'wants', label: 'Wants', placeholder: 'What they are after right now' },
  { key: 'fears', label: 'Fears / flaw', placeholder: 'What makes them break or slip' },
  { key: 'ideal', label: 'Ideal / bond', placeholder: 'What they believe in, or who they protect' },
  { key: 'mannerism', label: 'Mannerism / quirk', placeholder: 'A physical habit that is easy to play' },
  { key: 'secret', label: 'Secret', placeholder: 'What they hide', long: true }
];

const SIZES = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'];

function abilityMod(score) { return Math.floor((Number(score) - 10) / 2); }

function fmt(n) { return (n >= 0 ? '+' : '-') + Math.abs(n); }

// "1/8" -> 0.125, "2" -> 2, anything unreadable -> 0
function crToNumber(cr) {
  const s = String(cr == null ? '' : cr).trim();
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

// 2024 Monster Manual: proficiency bonus follows challenge rating.
function proficiencyBonusForCR(cr) {
  const n = crToNumber(cr);
  if (n < 5) return 2;
  if (n < 9) return 3;
  if (n < 13) return 4;
  if (n < 17) return 5;
  if (n < 21) return 6;
  if (n < 25) return 7;
  if (n < 29) return 8;
  return 9;
}

function defaultStatblock() {
  return {
    size: 'Medium',
    creatureType: 'Humanoid',
    alignment: 'Neutral',
    ac: 10,
    hp: 4,
    hpDice: '1d8',
    speed: '30 ft.',
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saveProf: { str: false, dex: false, con: false, int: false, wis: false, cha: false },
    skills: {},
    // A skill bonus set by hand (story reasons): { Perception: 7 }. Replaces the calculated bonus.
    skillOverrides: {},
    // Passive scores are worked out from the skills unless one is set by hand
    // here (story, magic items, other bonuses). null = automatic.
    passivePerceptionOverride: null,
    passiveInsightOverride: null,
    senses: '',
    languages: 'Common',
    cr: '0',
    gear: 'Club',
    traits: 'Training. The villager has proficiency in one skill of the DM\'s choice and has Advantage on checks using that skill.',
    actions: 'Club. Melee Attack Roll: +2, reach 5 ft. Hit: 2 (1d4) Bludgeoning damage.'
  };
}

function str(v, max = 4000) { return typeof v === 'string' ? v.slice(0, max) : ''; }
function int(v, lo, hi, fallback) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function sanitizeStatblock(raw) {
  const base = defaultStatblock();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const sb = base;
  sb.size = SIZES.includes(raw.size) ? raw.size : (typeof raw.size === 'string' && raw.size ? str(raw.size, 40) : base.size);
  for (const k of ['creatureType', 'alignment', 'hpDice', 'speed', 'senses', 'languages', 'gear']) {
    if (typeof raw[k] === 'string') sb[k] = str(raw[k], 300);
  }
  for (const k of ['traits', 'actions']) if (typeof raw[k] === 'string') sb[k] = str(raw[k]);
  sb.ac = int(raw.ac, 0, 40, base.ac);
  sb.hp = int(raw.hp, 0, 9999, base.hp);
  for (const k of ['passivePerceptionOverride', 'passiveInsightOverride']) {
    const v = raw[k];
    sb[k] = v === null || v === undefined || v === '' ? null : int(v, 0, 99, null);
  }
  sb.cr = typeof raw.cr === 'string' || typeof raw.cr === 'number' ? str(String(raw.cr), 8) : base.cr;
  const ab = raw.abilities && typeof raw.abilities === 'object' ? raw.abilities : {};
  const sp = raw.saveProf && typeof raw.saveProf === 'object' ? raw.saveProf : {};
  ABILITIES.forEach(({ key }) => {
    sb.abilities[key] = int(ab[key], 1, 30, 10);
    sb.saveProf[key] = sp[key] === true;
  });
  const sk = raw.skills && typeof raw.skills === 'object' ? raw.skills : {};
  sb.skills = {};
  SKILLS.forEach(({ name }) => {
    const v = Number(sk[name]);
    if (v === 1 || v === 2) sb.skills[name] = v;
  });
  const so = raw.skillOverrides && typeof raw.skillOverrides === 'object' ? raw.skillOverrides : {};
  sb.skillOverrides = {};
  SKILLS.forEach(({ name }) => {
    if (so[name] === null || so[name] === undefined || so[name] === '') return;
    const v = int(so[name], -20, 40, null);
    if (v !== null) sb.skillOverrides[name] = v;
  });
  return sb;
}

function sanitizeTextGroup(raw, fields) {
  const out = {};
  fields.forEach(({ key }) => { out[key] = raw && typeof raw === 'object' ? str(raw[key], 1000) : ''; });
  return out;
}

// Voice / personality fields the DM pinned to the NPC's quick card in Play: "voice.pitch", "persona.secret"…
function validPinKeys() { return VOICE_FIELDS.map((f) => `voice.${f.key}`).concat(PERSONA_FIELDS.map((f) => `persona.${f.key}`)); }
function sanitizePinned(raw) {
  const ok = validPinKeys();
  return Array.isArray(raw) ? raw.filter((k, i) => typeof k === 'string' && ok.includes(k) && raw.indexOf(k) === i) : [];
}

function sanitizeCard(raw) {
  const card = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    statblock: card.statblock ? sanitizeStatblock(card.statblock) : null,
    voice: sanitizeTextGroup(card.voice, VOICE_FIELDS),
    persona: sanitizeTextGroup(card.persona, PERSONA_FIELDS),
    pinned: sanitizePinned(card.pinned)
  };
}

// Returns the entity's card, creating an empty one if it has none yet.
function ensureCard(entity) {
  if (!entity.characterCard || typeof entity.characterCard !== 'object') entity.characterCard = sanitizeCard(null);
  const c = entity.characterCard;
  if (!c.voice) c.voice = sanitizeTextGroup(null, VOICE_FIELDS);
  if (!c.persona) c.persona = sanitizeTextGroup(null, PERSONA_FIELDS);
  if (!('statblock' in c)) c.statblock = null;
  if (!Array.isArray(c.pinned)) c.pinned = [];
  return c;
}

// The block to show: the entity's own, or the default Villager if it has none
// (every NPC is given one on load and on creation, so this is only a safety net).
function getStatblock(entity) {
  return entity && entity.characterCard && entity.characterCard.statblock
    ? entity.characterCard.statblock : defaultStatblock();
}

// Gives an NPC its own copy of the default Villager stat block unless it
// already has one. Never touches an existing block. Idempotent.
function ensureStatblock(entity) {
  const card = ensureCard(entity);
  if (!card.statblock) card.statblock = defaultStatblock();
  return card.statblock;
}

// True while the block is still exactly the stock Villager.
function isDefaultStatblock(entity) {
  return JSON.stringify(sanitizeStatblock(getStatblock(entity))) === JSON.stringify(defaultStatblock());
}

// Puts the stock Villager back (voice and personality notes are untouched).
function resetStatblock(entity) {
  ensureCard(entity).statblock = defaultStatblock();
}

function hasTextIn(group) { return !!group && Object.values(group).some((v) => typeof v === 'string' && v.trim()); }
function hasVoiceOrPersona(entity) {
  const c = entity && entity.characterCard;
  return !!c && (hasTextIn(c.voice) || hasTextIn(c.persona));
}

// Everything a renderer needs, already computed.
function resolve(statblock) {
  const sb = sanitizeStatblock(statblock);
  const pb = proficiencyBonusForCR(sb.cr);
  const abilities = ABILITIES.map(({ key, label, name }) => {
    const score = sb.abilities[key];
    const mod = abilityMod(score);
    const saveProf = sb.saveProf[key];
    const save = mod + (saveProf ? pb : 0);
    return { key, label, name, score, mod, modText: fmt(mod), saveProf, save, saveText: fmt(save) };
  });
  const modOf = (k) => abilities.find((a) => a.key === k).mod;
  const skills = SKILLS.map(({ name, ability }) => {
    const level = sb.skills[name] || 0;
    const autoBonus = modOf(ability) + pb * level;
    const manual = Object.prototype.hasOwnProperty.call(sb.skillOverrides, name);
    const bonus = manual ? sb.skillOverrides[name] : autoBonus;
    return { name, ability, level, bonus, bonusText: fmt(bonus), manual, autoBonus, autoText: fmt(autoBonus) };
  });
  const autoPerception = 10 + skills.find((s) => s.name === 'Perception').bonus;
  const autoInsight = 10 + skills.find((s) => s.name === 'Insight').bonus;
  const initiative = modOf('dex');
  return {
    sb, pb, pbText: fmt(pb), abilities, skills,
    initiative, initiativeText: `${fmt(initiative)} (${10 + initiative})`,
    passivePerceptionAuto: autoPerception,
    passiveInsightAuto: autoInsight,
    passivePerception: sb.passivePerceptionOverride != null ? sb.passivePerceptionOverride : autoPerception,
    passiveInsight: sb.passiveInsightOverride != null ? sb.passiveInsightOverride : autoInsight,
    passivePerceptionManual: sb.passivePerceptionOverride != null,
    passiveInsightManual: sb.passiveInsightOverride != null,
    proficientSkills: skills.filter((s) => s.level > 0 || s.manual),
    typeLine: `${sb.size} ${sb.creatureType}${sb.alignment ? `, ${sb.alignment}` : ''}`,
    hpText: sb.hpDice ? `${sb.hp} (${sb.hpDice})` : String(sb.hp)
  };
}

// The few figures that matter when you are talking to an NPC rather than
// fighting it: how hard they are to read, fool or sway, and what they speak.
const ROLEPLAY_SKILLS = ['Insight', 'Perception', 'Deception', 'Persuasion', 'Intimidation'];
function roleplay(entity) {
  const r = resolve(getStatblock(entity));
  return {
    passivePerception: r.passivePerception,
    passiveInsight: r.passiveInsight,
    passivePerceptionManual: r.passivePerceptionManual,
    passiveInsightManual: r.passiveInsightManual,
    skills: ROLEPLAY_SKILLS.map((n) => r.skills.find((k) => k.name === n)),
    languages: r.sb.languages && r.sb.languages.trim() ? r.sb.languages.trim() : ''
  };
}

function isPinned(entity, group, key) {
  return !!(entity && entity.characterCard && Array.isArray(entity.characterCard.pinned) && entity.characterCard.pinned.includes(`${group}.${key}`));
}
function togglePinned(entity, group, key) {
  const c = ensureCard(entity);
  const k = `${group}.${key}`;
  if (!validPinKeys().includes(k)) return false;
  const i = c.pinned.indexOf(k);
  if (i === -1) c.pinned.push(k); else c.pinned.splice(i, 1);
  return i === -1;
}
// Pinned fields that have content, in the order of the card (voice first), for the quick card in Play.
function pinnedFields(entity) {
  const card = entity && entity.characterCard;
  if (!card || !Array.isArray(card.pinned)) return [];
  const out = [];
  [['voice', VOICE_FIELDS], ['persona', PERSONA_FIELDS]].forEach(([group, fields]) => fields.forEach((f) => {
    const text = card[group] && typeof card[group][f.key] === 'string' ? card[group][f.key].trim() : '';
    if (text && card.pinned.includes(`${group}.${f.key}`)) out.push({ group, key: f.key, label: f.label, text });
  }));
  return out;
}

// Short figures about the block (used in the Create editor's summary line).
function summary(entity) {
  const r = resolve(getStatblock(entity));
  return { ac: r.sb.ac, hp: r.sb.hp, hpText: r.hpText, cr: r.sb.cr, isDefault: isDefaultStatblock(entity) };
}

const api = {
  ABILITIES, SKILLS, VOICE_FIELDS, PERSONA_FIELDS, SIZES,
  abilityMod, fmt, crToNumber, proficiencyBonusForCR,
  defaultStatblock, sanitizeStatblock, sanitizeCard, ensureCard,
  hasVoiceOrPersona, getStatblock, ensureStatblock, isDefaultStatblock, resetStatblock,
  isPinned, togglePinned, pinnedFields, sanitizePinned,
  ROLEPLAY_SKILLS, roleplay, resolve, summary
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.CharacterCard = api;
}

})();
