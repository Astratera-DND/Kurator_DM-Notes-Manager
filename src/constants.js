// Shared constants for entity appearance.
// Dark-mode-only palette — each entry is a background tint + a readable
// foreground that's been checked to hold up on a near-black page background.
// Colors are assigned automatically at entity creation (cycling through this
// list in order), never picked truly at random, so two entities never land
// on visually identical or unreadable colors by chance. Always overridable
// by the user afterward.
//
// Everything below is wrapped in an IIFE so none of these internal names
// (COLOR_PALETTE, colorForIndex, etc.) leak into the shared top-level scope
// when this file is loaded as a plain <script> alongside the other shared
// modules — only the final window.Constants assignment is visible outside.
(function () {
  const COLOR_PALETTE = [
    { key: 'coral',   bg: '#3a1f1a', fg: '#f0997b' },
    { key: 'amber',   bg: '#3a2c14', fg: '#f5c26b' },
    { key: 'teal',    bg: '#123330', fg: '#6fd9c9' },
    { key: 'blue',    bg: '#17263a', fg: '#7bb4f0' },
    { key: 'purple',  bg: '#271f3a', fg: '#b79cf0' },
    { key: 'pink',    bg: '#3a1f2e', fg: '#f294c0' },
    { key: 'green',   bg: '#1f331f', fg: '#94c97a' },
    { key: 'gray',    bg: '#2a2a28', fg: '#b9b8b2' },
    { key: 'red',     bg: '#391818', fg: '#ee7777' },
    { key: 'orange',  bg: '#392618', fg: '#eea977' },
    { key: 'yellow',  bg: '#393418', fg: '#eeda77' },
    { key: 'lime',    bg: '#293918', fg: '#b3ee77' },
    { key: 'emerald', bg: '#183929', fg: '#77eeb3' },
    { key: 'cyan',    bg: '#183439', fg: '#77daee' },
    { key: 'indigo',  bg: '#181b39', fg: '#7781ee' },
    { key: 'violet',  bg: '#2c1839', fg: '#bc77ee' },
    { key: 'fuchsia', bg: '#391839', fg: '#ee77ee' },
    { key: 'rose',    bg: '#391821', fg: '#ee7795' },
    { key: 'slate',   bg: '#252932', fg: '#a9b3c6' }
  ];

  // A small curated icon set. Names correspond to entries in the renderer's
  // own inline SVG icon() function (renderer/app.js) — no external font or
  // CDN dependency, so the app works fully offline. Default is picked by
  // entity type; user can swap to any of these from a picker.
  const ICONS_BY_TYPE = {
    npc: ['user', 'crown', 'skull', 'ghost', 'robot', 'eye', 'shield'],
    location: ['mapPin', 'building', 'store', 'tent', 'anchor', 'rocket', 'door', 'mountain'],
    quest: ['flag', 'scroll', 'bookmark', 'crown', 'skull', 'shield']
  };

  const DEFAULT_ICON = { npc: 'user', location: 'mapPin', quest: 'flag' };

  // Which entity types a content module of each type can be assigned to
  // — the same compatibility that already existed before Modular
  // Content (notes/topics worked on either NPCs or locations; beats/
  // scenes/descriptions were always location-only, since they lived
  // inside a location's arrival), now expressed explicitly since the
  // Library needs it for both filtering and the assignment picker.
  const MODULE_TYPE_ENTITY_TYPES = {
    note: ['npc', 'location'],
    topic: ['npc'],
    beat: ['location'],
    scene: ['location'],
    description: ['location']
  };

  const MODULE_TYPE_LABELS = {
    note: 'Note',
    topic: 'Dialogue topic',
    beat: 'Section (beat)',
    scene: 'Scene',
    description: 'Description'
  };

  // The full 2024 (5.5e) skill list, grouped by governing ability (the
  // skill-ability mapping is unchanged from 2014), plus the six raw
  // ability checks for an untrained check not tied to any specific
  // skill (e.g. "raw Strength" to force a door, distinct from
  // Athletics). Used by DC Checks.
  const CHECK_TYPES = [
    { key: 'athletics', label: 'Athletics', ability: 'STR' },
    { key: 'acrobatics', label: 'Acrobatics', ability: 'DEX' },
    { key: 'sleightOfHand', label: 'Sleight of Hand', ability: 'DEX' },
    { key: 'stealth', label: 'Stealth', ability: 'DEX' },
    { key: 'arcana', label: 'Arcana', ability: 'INT' },
    { key: 'history', label: 'History', ability: 'INT' },
    { key: 'investigation', label: 'Investigation', ability: 'INT' },
    { key: 'nature', label: 'Nature', ability: 'INT' },
    { key: 'religion', label: 'Religion', ability: 'INT' },
    { key: 'animalHandling', label: 'Animal Handling', ability: 'WIS' },
    { key: 'insight', label: 'Insight', ability: 'WIS' },
    { key: 'medicine', label: 'Medicine', ability: 'WIS' },
    { key: 'perception', label: 'Perception', ability: 'WIS' },
    { key: 'survival', label: 'Survival', ability: 'WIS' },
    { key: 'deception', label: 'Deception', ability: 'CHA' },
    { key: 'intimidation', label: 'Intimidation', ability: 'CHA' },
    { key: 'performance', label: 'Performance', ability: 'CHA' },
    { key: 'persuasion', label: 'Persuasion', ability: 'CHA' },
    { key: 'strength', label: 'Strength', ability: 'STR' },
    { key: 'dexterity', label: 'Dexterity', ability: 'DEX' },
    { key: 'constitution', label: 'Constitution', ability: 'CON' },
    { key: 'intelligence', label: 'Intelligence', ability: 'INT' },
    { key: 'wisdom', label: 'Wisdom', ability: 'WIS' },
    { key: 'charisma', label: 'Charisma', ability: 'CHA' }
  ];

  function colorForIndex(index) {
    return COLOR_PALETTE[index % COLOR_PALETTE.length];
  }

  const api = { COLOR_PALETTE, ICONS_BY_TYPE, DEFAULT_ICON, MODULE_TYPE_ENTITY_TYPES, MODULE_TYPE_LABELS, CHECK_TYPES, colorForIndex };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.Constants = api;
  }
})();
