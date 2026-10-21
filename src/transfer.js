// Copying NPCs and locations (with their content) from one campaign into
// another. Pure data logic, no file access: main.js loads the campaigns,
// calls applyTransfer, copies image files and writes the result.
//
// What "an entity with its content" means here:
//   - the entity itself (name, summary, icon, colour, Notion link, scene/layout)
//   - everything assigned to it: descriptions, notes, dialogue topics, trackable
//     sections (beats) and scenes, at every checkpoint
//   - its loot table, inventory, character card and image
//   - for a location, its "present here" lists (one per checkpoint)
//   - DC checks referenced from any of that text (copied once, roll log cleared)
//
// Rules:
//   - New entities get fresh ids in the target, so a transfer can never
//     overwrite or collide with anything already there.
//   - An entity that already exists in the target (same type and name, case
//     insensitive) is MERGED, not copied: the target's own data wins, empty
//     fields are filled in, content that is already there (identical) is
//     skipped, new content is added and "present here" lists are united.
//     Transferring the same thing twice therefore changes nothing.
//   - The source campaign is never changed.
//   - Completed/read flags and roll logs are reset: the copy starts fresh.
//   - Checkpoints are matched by label; missing ones are created in the same
//     relative position.
//   - Entity groups are matched by name path; missing ones are created.
//   - References (mentions, speakers, jump links, present-here) to entities that
//     are NOT part of the transfer cannot point anywhere in the target, so they
//     become plain text / are dropped. findMissingDependencies tells you
//     beforehand which these would be.
(function () {

const _dm = (typeof module !== 'undefined' && module.exports) ? require('./dataModel') : window.DataModel;
const makeId = _dm.makeId || ((prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`);

// Content kinds that can be left out per entity.
const CONTENT_TYPES = [
  { key: 'description', label: 'Descriptions' },
  { key: 'note', label: 'Notes' },
  { key: 'topic', label: 'Dialogue topics' },
  { key: 'beat', label: 'Sections' },
  { key: 'scene', label: 'Scenes' },
  { key: 'presence', label: 'Present here' },
  { key: 'lootTable', label: 'Loot table' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'characterCard', label: 'Character card' },
  { key: 'image', label: 'Image' }
];
const MODULE_TYPE_KEYS = ['description', 'note', 'topic', 'beat', 'scene'];

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function exclusionsOf(entry) {
  return entry && entry.exclude && typeof entry.exclude === 'object' ? entry.exclude : {};
}

// --- What an entity has ---------------------------------------------------

function assignmentsOf(campaign, entityId) {
  const mods = new Map((campaign.contentModules || []).map((m) => [m.id, m]));
  return (campaign.assignments || [])
    .filter((a) => a.entityId === entityId && mods.has(a.moduleId))
    .map((a) => ({ assignment: a, module: mods.get(a.moduleId) }));
}

function arrivalBlocksOf(campaign, entityId) {
  return (campaign.blocks || []).filter((b) => b.kind === 'arrival' && b.locationId === entityId);
}

// How much of each content kind an entity has, so the UI only offers
// "leave out" boxes for things that exist.
function describeContent(campaign, entityId) {
  const entity = campaign.entities[entityId];
  const counts = {};
  if (!entity) return counts;
  assignmentsOf(campaign, entityId).forEach(({ module }) => {
    if (MODULE_TYPE_KEYS.includes(module.type)) counts[module.type] = (counts[module.type] || 0) + 1;
  });
  if (entity.type === 'location') {
    const lists = arrivalBlocksOf(campaign, entityId).filter((b) => Array.isArray(b.presence) && b.presence.length > 0);
    if (lists.length) counts.presence = lists.length;
  }
  if (Array.isArray(entity.lootTable) && entity.lootTable.length) counts.lootTable = entity.lootTable.length;
  if (Array.isArray(entity.inventoryCategories) && entity.inventoryCategories.length) counts.inventory = entity.inventoryCategories.length;
  if (entity.characterCard) counts.characterCard = 1;
  if (entity.image && entity.image.filename) counts.image = 1;
  return counts;
}

// --- Tokens inside text -----------------------------------------------------
// Ids are embedded in text as [[id]], [[SAY:id]]..[[/SAY]], [[JUMP:id(:timeId)]]..[[/JUMP]]
// and [[DCCHECK:id]].
const RE_MENTION = /\[\[([a-zA-Z0-9_]+)\]\]/g;
const RE_SAY = /\[\[SAY:([a-zA-Z0-9_]+)\]\]([\s\S]*?)\[\[\/SAY\]\]/g;
const RE_JUMP = /\[\[JUMP:([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_]+))?\]\]([\s\S]*?)\[\[\/JUMP\]\]/g;
const RE_DC = /\[\[DCCHECK:([a-zA-Z0-9_]+)\]\]/g;

function walkStrings(value, fn) {
  if (typeof value === 'string') { fn(value); return; }
  if (Array.isArray(value)) { value.forEach((v) => walkStrings(v, fn)); return; }
  if (value && typeof value === 'object') Object.values(value).forEach((v) => walkStrings(v, fn));
}

function referencedIdsInText(text, into) {
  let m;
  RE_SAY.lastIndex = 0; while ((m = RE_SAY.exec(text))) into.entities.add(m[1]);
  RE_JUMP.lastIndex = 0; while ((m = RE_JUMP.exec(text))) into.entities.add(m[1]);
  RE_DC.lastIndex = 0; while ((m = RE_DC.exec(text))) into.dcChecks.add(m[1]);
  RE_MENTION.lastIndex = 0;
  while ((m = RE_MENTION.exec(text))) {
    if (!/^(DCCHECK|SAY|JUMP|SCENEBTN|MUSICBTN|QFBTN|DIRBTN)$/.test(m[1])) into.entities.add(m[1]);
  }
}

// The parts of an entity that are included given the exclusions.
function includedParts(campaign, entityId, exclude) {
  const entity = campaign.entities[entityId];
  const parts = { modules: [], arrivals: [], extra: [] };
  if (!entity) return parts;
  parts.modules = assignmentsOf(campaign, entityId).filter(({ module }) => !exclude[module.type]);
  if (entity.type === 'location') parts.arrivals = arrivalBlocksOf(campaign, entityId);
  if (!exclude.lootTable && entity.lootTable) parts.extra.push(entity.lootTable);
  if (!exclude.inventory && entity.inventoryCategories) parts.extra.push(entity.inventoryCategories);
  if (!exclude.characterCard && entity.characterCard) parts.extra.push(entity.characterCard);
  return parts;
}

// Entities (other than itself) and DC checks the included content refers to.
function referencesOf(campaign, entityId, exclude) {
  const refs = { entities: new Set(), dcChecks: new Set() };
  const parts = includedParts(campaign, entityId, exclude);
  parts.modules.forEach(({ module }) => {
    walkStrings(module, (s) => referencedIdsInText(s, refs));
    if (module.type === 'scene') (module.lines || []).forEach((l) => { if (l.speakerId) refs.entities.add(l.speakerId); });
  });
  parts.arrivals.forEach((b) => {
    walkStrings({ html: b.html, beats: b.beats }, (s) => referencedIdsInText(s, refs));
    if (!exclude.presence) (b.presence || []).forEach((id) => refs.entities.add(id));
  });
  parts.extra.forEach((x) => walkStrings(x, (s) => referencedIdsInText(s, refs)));
  // DC checks can mention entities themselves.
  refs.dcChecks.forEach((id) => {
    const check = (campaign.dcChecks || []).find((c) => c.id === id);
    if (check) walkStrings({ table: check.table, conditions: check.conditions }, (s) => referencedIdsInText(s, refs));
  });
  refs.entities.delete(entityId);
  return refs;
}

// For a chosen set: which entities does it refer to that are not part of it?
// Returns [{ id, name, type, neededBy: [names] }], optionally the full closure
// (dependencies of dependencies) so one click can pull in everything.
function findMissingDependencies(campaign, entries, { closure = false } = {}) {
  const chosen = new Map(entries.map((e) => [e.id, e]));
  const missing = new Map();
  const queue = entries.slice();
  const seen = new Set();
  while (queue.length) {
    const entry = queue.shift();
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const refs = referencesOf(campaign, entry.id, exclusionsOf(entry));
    refs.entities.forEach((id) => {
      const dep = campaign.entities[id];
      if (!dep || chosen.has(id)) return;
      if (!missing.has(id)) missing.set(id, { id, name: dep.name, type: dep.type, neededBy: [] });
      const by = campaign.entities[entry.id];
      const rec = missing.get(id);
      if (by && !rec.neededBy.includes(by.name)) rec.neededBy.push(by.name);
      if (closure) queue.push({ id, exclude: {} });
    });
  }
  return Array.from(missing.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// --- Applying a transfer ----------------------------------------------------

function groupPath(campaign, groupId) {
  const names = [];
  const seen = new Set();
  let cur = (campaign.entityGroups || []).find((g) => g.id === groupId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    names.unshift(cur.name);
    cur = cur.parentId ? (campaign.entityGroups || []).find((g) => g.id === cur.parentId) : null;
  }
  return names;
}

function ensureGroupPath(target, names, created) {
  if (!Array.isArray(target.entityGroups)) target.entityGroups = [];
  let parentId = null;
  names.forEach((name, i) => {
    let g = target.entityGroups.find((x) => (x.parentId || null) === parentId && x.name.trim().toLowerCase() === name.trim().toLowerCase());
    if (!g) {
      const siblings = target.entityGroups.filter((x) => (x.parentId || null) === parentId);
      g = { id: makeId('grp'), name, parentId, order: siblings.reduce((m, x) => Math.max(m, x.order || 0), -1) + 1 };
      target.entityGroups.push(g);
      created.push(names.slice(0, i + 1).join(' / '));
    }
    parentId = g.id;
  });
  return parentId;
}

// Source checkpoint id -> target checkpoint id, creating the ones that are
// missing. A new checkpoint goes right after the target checkpoint that
// matches the closest earlier source checkpoint (or first, if there is none).
function mapCheckpoints(source, target, usedIds, created) {
  if (!Array.isArray(target.checkpoints)) target.checkpoints = [];
  const map = new Map();
  const srcSorted = (source.checkpoints || []).slice().sort((a, b) => a.order - b.order);
  const norm = (s) => String(s).trim().toLowerCase();
  let previousTargetId = null;
  srcSorted.forEach((cp) => {
    let match = target.checkpoints.find((t) => norm(t.label) === norm(cp.label));
    if (!match && usedIds.has(cp.id)) {
      const sorted = target.checkpoints.slice().sort((a, b) => a.order - b.order);
      let insertAt = 0;
      if (previousTargetId) insertAt = sorted.findIndex((t) => t.id === previousTargetId) + 1;
      match = { id: makeId('cp'), label: cp.label, order: 0 };
      sorted.splice(insertAt, 0, match);
      sorted.forEach((t, i) => { t.order = i; });
      target.checkpoints = sorted;
      created.push(cp.label);
    }
    if (match) { map.set(cp.id, match.id); previousTargetId = match.id; }
  });
  return map;
}

function usedCheckpointIds(source, entries) {
  const used = new Set();
  entries.forEach((entry) => {
    const exclude = exclusionsOf(entry);
    const parts = includedParts(source, entry.id, exclude);
    parts.modules.forEach(({ assignment }) => { if (assignment.timeId) used.add(assignment.timeId); });
    parts.arrivals = parts.arrivals.filter((b) => {
      const pres = exclude.presence ? 0 : (b.presence || []).length;
      const hasOther = (b.html && b.html.trim()) || (Array.isArray(b.beats) && b.beats.length);
      return pres > 0 || hasOther;
    });
    parts.arrivals.forEach((b) => { if (b.timeId) used.add(b.timeId); });
    const jump = new RegExp(RE_JUMP.source, 'g');
    const scan = (s) => { let m; jump.lastIndex = 0; while ((m = jump.exec(s))) if (m[2]) used.add(m[2]); };
    parts.modules.forEach(({ module }) => walkStrings(module, scan));
    parts.arrivals.forEach((b) => walkStrings({ html: b.html, beats: b.beats }, scan));
    parts.extra.forEach((x) => walkStrings(x, scan));
  });
  return used;
}

// Copies the entries (each { id, exclude: { <contentKey>: true } }) from source
// into target, in place on target. Returns what happened plus the image files
// main.js still has to copy.
function applyTransfer(source, target, entries) {
  const report = {
    entities: 0, merged: 0, skippedContent: 0, modules: 0, presenceLists: 0, dcChecks: 0,
    checkpointsCreated: [], groupsCreated: [], droppedReferences: 0,
    warnings: [], imageCopies: [], idMap: {}
  };
  const chosen = entries.filter((e) => source.entities[e.id]);
  if (chosen.length === 0) return report;
  if (!target.entities) target.entities = {};
  ['contentModules', 'assignments', 'blocks', 'dcChecks'].forEach((k) => { if (!Array.isArray(target[k])) target[k] = []; });

  const idMap = new Map(); // source entity id -> target entity id
  const merged = new Set(); // source ids that were matched with an existing target entity
  const normName = (n) => String(n || '').trim().toLowerCase();
  const claimed = new Set();
  chosen.forEach((e) => {
    const se = source.entities[e.id];
    const existing = Object.values(target.entities).find((t) => t.type === se.type && normName(t.name) === normName(se.name) && !claimed.has(t.id));
    if (existing) { idMap.set(e.id, existing.id); merged.add(e.id); claimed.add(existing.id); return; }
    idMap.set(e.id, makeId(se.type === 'location' ? 'loc' : se.type === 'quest' ? 'quest' : 'npc'));
  });

  const cpMap = mapCheckpoints(source, target, usedCheckpointIds(source, chosen), report.checkpointsCreated);

  // DC checks referenced from anything that is being copied.
  const dcMap = new Map();
  const wantedDc = new Set();
  chosen.forEach((e) => referencesOf(source, e.id, exclusionsOf(e)).dcChecks.forEach((id) => wantedDc.add(id)));
  // A check can reference another check; follow those too.
  let grew = true;
  while (grew) {
    grew = false;
    Array.from(wantedDc).forEach((id) => {
      const check = (source.dcChecks || []).find((c) => c.id === id);
      if (!check) return;
      const refs = { entities: new Set(), dcChecks: new Set() };
      walkStrings({ table: check.table, conditions: check.conditions }, (s) => referencedIdsInText(s, refs));
      refs.dcChecks.forEach((d) => { if (!wantedDc.has(d)) { wantedDc.add(d); grew = true; } });
    });
  }
  wantedDc.forEach((id) => { if ((source.dcChecks || []).some((c) => c.id === id)) dcMap.set(id, makeId('dcc')); });

  const nameOf = (id) => (source.entities[id] ? source.entities[id].name : '');

  // Rewrites ids inside one piece of text; references that cannot be kept
  // become plain text.
  function remapText(text) {
    let t = text;
    t = t.replace(RE_SAY, (m, id, inner) => {
      if (idMap.has(id)) return `[[SAY:${idMap.get(id)}]]${inner}[[/SAY]]`;
      report.droppedReferences++; return inner;
    });
    t = t.replace(RE_JUMP, (m, id, timeId, inner) => {
      if (!idMap.has(id)) { report.droppedReferences++; return inner; }
      const tid = timeId ? cpMap.get(timeId) : null;
      return `[[JUMP:${idMap.get(id)}${tid ? `:${tid}` : ''}]]${inner}[[/JUMP]]`;
    });
    t = t.replace(RE_DC, (m, id) => (dcMap.has(id) ? `[[DCCHECK:${dcMap.get(id)}]]` : m));
    t = t.replace(RE_MENTION, (m, id) => {
      if (/^(DCCHECK|SAY|JUMP|SCENEBTN|MUSICBTN|QFBTN|DIRBTN)$/.test(id)) return m;
      if (idMap.has(id)) return `[[${idMap.get(id)}]]`;
      if (source.entities[id]) { report.droppedReferences++; return nameOf(id); }
      return m;
    });
    return t;
  }

  function remapDeep(value) {
    if (typeof value === 'string') return remapText(value);
    if (Array.isArray(value)) return value.map(remapDeep);
    if (value && typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach((k) => { out[k] = remapDeep(value[k]); });
      return out;
    }
    return value;
  }

  // A DC check that already exists in the target (identical apart from ids and
  // roll log) is reused instead of copied again.
  const dcReused = new Set();
  function dcSignature(check) {
    const c = Object.assign({}, check, { rollLog: [] });
    delete c.conditionId; // the linked dice-roll condition is per campaign, not part of what makes two checks the same
    return signature(c);
  }
  Array.from(dcMap.keys()).forEach((oldId) => {
    const remapped = remapDeep(clone(source.dcChecks.find((c) => c.id === oldId)));
    const sig = dcSignature(Object.assign({}, remapped, { id: null }));
    const same = target.dcChecks.find((t) => dcSignature(Object.assign({}, t, { id: null })) === sig);
    if (same) { dcMap.set(oldId, same.id); dcReused.add(oldId); }
  });

  function takeImage(image, newId) {
    const ext = image.filename.includes('.') ? image.filename.slice(image.filename.lastIndexOf('.')) : '.jpg';
    const newName = `${newId}${ext}`;
    report.imageCopies.push({ from: image.filename, to: newName, entityId: newId });
    return Object.assign({}, image, { filename: newName });
  }

  const isEmptyList = (v) => !Array.isArray(v) || v.length === 0;
  const _cc = () => (typeof window !== 'undefined' ? window.CharacterCard : require('./characterCard'));

  // Fills only what the existing target entity is missing; never overwrites.
  function mergeEntity(entry, src, dest, exclude) {
    ['summary', 'notionUrl'].forEach((k) => {
      if (!(dest[k] && String(dest[k]).trim()) && typeof src[k] === 'string' && src[k].trim()) dest[k] = remapText(src[k]);
    });
    if (!dest.groupId && src.groupId) {
      const names = groupPath(source, src.groupId);
      if (names.length) dest.groupId = ensureGroupPath(target, names, report.groupsCreated);
    }
    if (!exclude.lootTable && isEmptyList(dest.lootTable) && !isEmptyList(src.lootTable)) dest.lootTable = remapDeep(clone(src.lootTable));
    if (!exclude.inventory && isEmptyList(dest.inventoryCategories) && !isEmptyList(src.inventoryCategories)) dest.inventoryCategories = remapDeep(clone(src.inventoryCategories));
    if (!exclude.characterCard && src.characterCard) {
      const cc = _cc();
      const untouched = !dest.characterCard || (cc.isDefaultStatblock(dest) && !cc.hasVoiceOrPersona(dest));
      if (untouched) dest.characterCard = remapDeep(clone(src.characterCard));
    }
    if (!exclude.image && src.image && src.image.filename && !(dest.image && dest.image.filename)) dest.image = takeImage(src.image, dest.id);
  }

  // Identity of a module for "is this already there?": everything except ids,
  // timestamps and the completed flag.
  function signature(value) {
    const strip = (v) => {
      if (Array.isArray(v)) return v.map(strip);
      if (v && typeof v === 'object') {
        const o = {};
        Object.keys(v).sort().forEach((k) => { if (!['id', 'complete', 'createdAt', 'updatedAt'].includes(k)) o[k] = strip(v[k]); });
        return o;
      }
      return v;
    };
    return JSON.stringify(strip(value));
  }
  function existingSignatures(entityId, timeId) {
    const set = new Set();
    const mods = new Map(target.contentModules.map((m) => [m.id, m]));
    target.assignments.forEach((a) => {
      if (a.entityId === entityId && (a.timeId || null) === (timeId || null) && mods.has(a.moduleId)) set.add(signature(mods.get(a.moduleId)));
    });
    return set;
  }

  // Entities first, so a later step can look anything up.
  const now = new Date().toISOString();
  chosen.forEach((entry) => {
    const exclude = exclusionsOf(entry);
    const src = source.entities[entry.id];
    const newId = idMap.get(entry.id);
    if (merged.has(entry.id)) { mergeEntity(entry, src, target.entities[newId], exclude); report.merged++; return; }
    const copy = clone(src);
    copy.id = newId;
    delete copy.groupId;
    // Text fields on the entity itself.
    ['name', 'summary', 'notionUrl'].forEach((k) => { if (typeof copy[k] === 'string') copy[k] = remapText(copy[k]); });
    if (src.groupId) {
      const names = groupPath(source, src.groupId);
      if (names.length) copy.groupId = ensureGroupPath(target, names, report.groupsCreated);
    }
    if (exclude.lootTable) copy.lootTable = []; else if (copy.lootTable) copy.lootTable = remapDeep(copy.lootTable);
    if (exclude.inventory) delete copy.inventoryCategories; else if (copy.inventoryCategories) copy.inventoryCategories = remapDeep(copy.inventoryCategories);
    if (exclude.characterCard) delete copy.characterCard; else if (copy.characterCard) copy.characterCard = remapDeep(copy.characterCard);
    if (exclude.image) copy.image = null;
    else if (copy.image && copy.image.filename) copy.image = takeImage(copy.image, newId);
    copy.createdAt = copy.createdAt || now;
    target.entities[newId] = copy;
    report.entities++;
  });

  // Content modules (copied once each, shared between the chosen entities
  // that shared them) and their assignments. For a merged entity, content that
  // is already there is skipped.
  const moduleMap = new Map(); // source module id -> new module
  chosen.forEach((entry) => {
    const exclude = exclusionsOf(entry);
    const newEntityId = idMap.get(entry.id);
    const isMerge = merged.has(entry.id);
    const sigCache = new Map();
    includedParts(source, entry.id, exclude).modules.forEach(({ assignment, module }) => {
      let timeId = null;
      if (assignment.timeId) timeId = cpMap.get(assignment.timeId) || null;
      let copied = moduleMap.get(module.id);
      let fresh = null;
      if (!copied) {
        fresh = remapDeep(clone(module));
        fresh.complete = false;
        delete fresh.questId; delete fresh.questIndex;   // quests stay in their own campaign
        if (fresh.type === 'scene' && Array.isArray(fresh.lines)) {
          fresh.lines.forEach((line) => {
            if (line.speakerId) line.speakerId = idMap.has(line.speakerId) ? idMap.get(line.speakerId) : null;
          });
        }
      }
      if (isMerge) {
        const key = timeId || '';
        if (!sigCache.has(key)) sigCache.set(key, existingSignatures(newEntityId, timeId));
        const sigs = sigCache.get(key);
        const sig = signature(copied || fresh);
        if (sigs.has(sig)) { report.skippedContent++; return; }
        sigs.add(sig);
      }
      if (!copied) {
        copied = fresh;
        copied.id = makeId('mod');
        if (copied.type === 'scene' && Array.isArray(copied.lines)) copied.lines.forEach((line) => { line.id = makeId('line'); });
        moduleMap.set(module.id, copied);
        target.contentModules.push(copied);
        report.modules++;
      }
      target.assignments.push({
        id: makeId('asg'), moduleId: copied.id, entityId: newEntityId, timeId,
        order: assignment.order || 0, createdAt: now
      });
    });
  });

  // "Present here" lists (and anything else stored on a location's arrival blocks).
  chosen.forEach((entry) => {
    const exclude = exclusionsOf(entry);
    if (source.entities[entry.id].type !== 'location') return;
    const newLocationId = idMap.get(entry.id);
    arrivalBlocksOf(source, entry.id).forEach((b) => {
      const presence = exclude.presence ? [] : (b.presence || []).filter((id) => idMap.has(id)).map((id) => idMap.get(id));
      const lostPresence = exclude.presence ? 0 : (b.presence || []).length - presence.length;
      if (lostPresence > 0) report.droppedReferences += lostPresence;
      const hasOther = (b.html && b.html.trim()) || (Array.isArray(b.beats) && b.beats.length);
      if (presence.length === 0 && !hasOther) return;
      const timeIdT = b.timeId ? (cpMap.get(b.timeId) || null) : null;
      const existingBlock = merged.has(entry.id)
        ? target.blocks.find((x) => x.kind === 'arrival' && x.locationId === newLocationId && (x.timeId || null) === timeIdT)
        : null;
      if (existingBlock) {
        const before = (existingBlock.presence || []).length;
        existingBlock.presence = Array.from(new Set([...(existingBlock.presence || []), ...presence]));
        if (existingBlock.presence.length > before) report.presenceLists++;
        if (!(existingBlock.html && existingBlock.html.trim()) && b.html && b.html.trim()) existingBlock.html = remapText(b.html);
        if ((!Array.isArray(existingBlock.beats) || !existingBlock.beats.length) && Array.isArray(b.beats) && b.beats.length) existingBlock.beats = remapDeep(clone(b.beats));
        return;
      }
      const copy = remapDeep(clone(b));
      copy.id = makeId('blk');
      copy.locationId = newLocationId;
      copy.timeId = b.timeId ? (cpMap.get(b.timeId) || null) : null;
      copy.presence = presence;
      copy.complete = false;
      target.blocks.push(copy);
      if (presence.length) report.presenceLists++;
    });
  });

  // DC checks (fresh roll log, tokens inside them remapped too).
  dcMap.forEach((newId, oldId) => {
    if (dcReused.has(oldId)) return;
    const check = remapDeep(clone(source.dcChecks.find((c) => c.id === oldId)));
    check.id = newId;
    check.rollLog = [];
    delete check.conditionId; // the copy gets a dice-roll condition of its own in the target
    target.dcChecks.push(check);
    report.dcChecks++;
  });

  if (report.droppedReferences > 0) {
    report.warnings.push(`${report.droppedReferences} reference${report.droppedReferences === 1 ? '' : 's'} to entities that were not part of the transfer became plain text or were left out.`);
  }
  idMap.forEach((v, k) => { report.idMap[k] = v; });
  require('./conditions').syncDCChecks(target);
  return report;
}

const api = { CONTENT_TYPES, describeContent, referencesOf, findMissingDependencies, applyTransfer, groupPath };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.Transfer = api;
}

})();
