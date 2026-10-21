// File storage. Everything lives in one human-readable campaign.json inside
// the app's userData folder, so it's inspectable/recoverable even without
// the app if something goes wrong. Periodic timestamped snapshots go into a
// backups/ subfolder for redundancy.
//
// Splitting campaign.json into one-file-per-act is a natural next step once
// a real campaign grows large, but a single file is the right starting
// point for v0.1 — simpler, and still trivially portable.

const fs = require('fs');
const path = require('path');
const { buildSeedCampaign } = require('./seed');
const { makeId } = require('./dataModel');
const CharacterCard = require('./characterCard');

const MAX_BACKUPS = 40;
const AUTOSAVE_DEBOUNCE_MS = 800;
const BACKUP_INTERVAL_MS = 5 * 60 * 1000;

function campaignFile(dir) {
  return path.join(dir, 'campaign.json');
}

function backupsDir(dir) {
  return path.join(dir, 'backups');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// Ensures fields added after a campaign was first created always exist,
// regardless of how old the file on disk is. This is the one place new
// optional campaign-level fields get backfilled — anything added here
// runs on every single load, so an old save can never end up missing a
// field newer code assumes exists. Entity-level fields (like an entity's
// groupId) don't need backfilling the same way: their absence already
// means the correct default (e.g. "ungrouped"), so code that reads them
// is written to treat missing as that default rather than requiring this
// function to go rewrite every entity.
//
// Note/topic order is a real exception to that principle, not just
// another instance of it — worth spelling out why. "Missing means 0" is
// fine for a single item, but moveNote/moveTopic swap order values
// between neighbors, and if every pre-existing sibling in a group
// defaults to the same 0, they're permanently tied: a stable sort keeps
// tied items in their original position no matter how many times
// they're swapped, since swapping 0 for 0 changes nothing. That's
// exactly the bug reported — reorder buttons "not reacting" on
// pre-existing topics while newly created ones worked fine, because new
// ones get real, distinct order values at creation and old ones never
// did. So this one genuinely does need every group rewritten, not left
// to a per-read default.
function normalizeCampaign(campaign) {
  if (!Array.isArray(campaign.entityGroups)) campaign.entityGroups = [];
  if (!campaign.meta) campaign.meta = {};
  if (!Array.isArray(campaign.meta.collapsedGroupIds)) campaign.meta.collapsedGroupIds = [];
  if (!campaign.meta.contentLibraryFilters || typeof campaign.meta.contentLibraryFilters !== 'object') {
    campaign.meta.contentLibraryFilters = { search: '', type: '', entityId: '', unassignedOnly: false, sort: 'name' };
  }
  if (!Array.isArray(campaign.meta.collapsedLibraryGroups)) campaign.meta.collapsedLibraryGroups = [];
  if (!Array.isArray(campaign.meta.collapsedPresenceGroups)) campaign.meta.collapsedPresenceGroups = [];
  if (!Array.isArray(campaign.meta.openTopicIds)) campaign.meta.openTopicIds = [];
  campaign.meta.openTopicIds = campaign.meta.openTopicIds.filter((x) => typeof x === 'string');
  if (typeof campaign.meta.lastContentLocationId !== 'string') campaign.meta.lastContentLocationId = null;
  if (typeof campaign.meta.lastContentTimeId !== 'string') campaign.meta.lastContentTimeId = null;
  if (!campaign.meta.lastContentField || typeof campaign.meta.lastContentField !== 'object' || Array.isArray(campaign.meta.lastContentField)) campaign.meta.lastContentField = null;
  if (!campaign.meta.lastGroupByType || typeof campaign.meta.lastGroupByType !== 'object' || Array.isArray(campaign.meta.lastGroupByType)) campaign.meta.lastGroupByType = {};
  if (!Array.isArray(campaign.dcChecks)) campaign.dcChecks = [];
  // (DC checks get their linked conditions after the conditions below are repaired.)
  // Conditions: keep only well-formed ones; give every one the fields the app relies on.
  if (!Array.isArray(campaign.conditions)) campaign.conditions = [];
  campaign.conditions = campaign.conditions.filter((c) => c && typeof c === 'object' && typeof c.id === 'string' && ['switch', 'dice', 'milestone', 'combo', 'presence', 'item', 'resolved'].includes(c.kind));
  campaign.conditions.forEach((c) => {
    if (typeof c.name !== 'string') c.name = 'Condition';
    if (!c.settings || typeof c.settings !== 'object' || Array.isArray(c.settings)) c.settings = {};
    if (!Array.isArray(c.rollLog)) c.rollLog = [];
    if (c.kind === 'switch') {
      if (!Array.isArray(c.states)) c.states = [];
      c.states = c.states.filter((s) => s && typeof s.key === 'string' && typeof s.label === 'string');
      if (!c.states.length) c.states = [{ key: 'off', label: 'Off' }, { key: 'on', label: 'On' }];
      if (!c.states.some((s) => s.key === c.current)) c.current = c.states[0].key;
    } else if (c.kind === 'combo') {
      if (!Array.isArray(c.settings.rules)) c.settings.rules = [];
      if (c.settings.mode !== 'any') c.settings.mode = 'all';
    }
  });
  require('./conditions').syncDCChecks(campaign);
  // Layout of the Content Graph (positions only; everything else is derived).
  if (!campaign.graph || typeof campaign.graph !== 'object' || Array.isArray(campaign.graph)) campaign.graph = { positions: {} };
  if (!campaign.graph.positions || typeof campaign.graph.positions !== 'object' || Array.isArray(campaign.graph.positions)) campaign.graph.positions = {};
  if (!campaign.graph.roles || typeof campaign.graph.roles !== 'object' || Array.isArray(campaign.graph.roles)) campaign.graph.roles = {};
  // Things the user took out of the graph (they stay in the campaign and the Library).
  if (!campaign.graph.hidden || typeof campaign.graph.hidden !== 'object' || Array.isArray(campaign.graph.hidden)) campaign.graph.hidden = {};
  Object.values(campaign.entities || {}).forEach((e) => {
    if (!('image' in e)) e.image = null;
    // A malformed character card (hand-edited file, older shape) is repaired
    // rather than left to break the renderer; absent cards stay absent.
    if (e.characterCard) e.characterCard = CharacterCard.sanitizeCard(e.characterCard);
    // Every NPC carries its own stat block. Older NPCs get the default
    // Villager (the 2024 Commoner) here on load; one that already has a block
    // is never touched.
    if (e.type === 'npc') CharacterCard.ensureStatblock(e);
  });
  require('./quests').sanitize(campaign);
  backfillBlockOrder(campaign);
  // Runs on every load, but only ever does real work once — see its own
  // idempotency guard. This is the flip: existing notes/topics/beats/
  // scenes/descriptions convert to the new module+assignment shape here,
  // and query.js's getLocationView/getEntityCard read that shape as the
  // only implementation now, not an alternate one.
  migrateToModularContent(campaign);
  migrateInventoryColumns(campaign);
  return campaign;
}

// Inventory categories used to be a fixed three-field table (name,
// effect, price). Each category now owns an ordered list of free-form
// text columns, with each row's column contents in cells keyed by column
// id — so an existing category becomes one column, "Effect", holding
// exactly what each row's effect field held, and nothing the person has
// already entered changes or moves. Only a category with no columns at
// all is converted, so running it on every load is safe: once converted
// there's nothing left for it to do, and it never touches a category
// that's already been given columns of its own.
function migrateInventoryColumns(campaign) {
  Object.values(campaign.entities || {}).forEach((entity) => {
    (entity.inventoryCategories || []).forEach((category) => {
      if (!Array.isArray(category.rows)) category.rows = [];
      if (!Array.isArray(category.columns)) {
        const column = { id: makeId('col'), label: 'Effect' };
        category.columns = [column];
        category.rows.forEach((row) => {
          row.cells = { [column.id]: typeof row.effect === 'string' ? row.effect : '' };
          delete row.effect;
        });
      } else {
        category.rows.forEach((row) => {
          if (!row.cells || typeof row.cells !== 'object') row.cells = {};
        });
      }
    });
  });
}

// Resolves order ties/gaps within each group (notes scoped by
// entityId+timeId, topics by entityId alone — matching moveNote/
// moveTopic's own scoping exactly) by sorting on whatever's already
// there (stable, so existing ties keep their current — i.e. currently
// displayed — relative position) and reassigning a clean 0,1,2,... in
// that same order. This never changes what's currently displayed; it
// only replaces ties/gaps with distinct values so the reorder buttons
// have something real to swap between. Safe to run on already-correct
// data too — sorting by existing distinct values and reassigning the
// same sequence back is a no-op, so this doesn't need a "does this
// group even need it" check first.
function backfillBlockOrder(campaign) {
  function normalizeGroups(items, keyFn) {
    const groups = {};
    items.forEach((item) => {
      const key = keyFn(item);
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    });
    Object.values(groups).forEach((group) => {
      group
        .slice()
        .sort((a, b) => (a.order || 0) - (b.order || 0))
        .forEach((item, i) => { item.order = i; });
    });
  }
  const blocks = Array.isArray(campaign.blocks) ? campaign.blocks : [];
  normalizeGroups(blocks.filter((b) => b.kind === 'note'), (n) => `${n.entityId}::${n.timeId || ''}`);
  normalizeGroups(blocks.filter((b) => b.kind === 'topic'), (t) => t.entityId);
}

// One-time upgrade path from the old note/topic/beat/scene/description
// shape into the new Modular Content system (a shared content module
// plus one or more assignments — see dataModel.js). Converts:
//   note/topic block  -> one module + one assignment, order preserved
//   scene block       -> one module + one assignment, order derived from
//                        its position among scenes at the same
//                        location+checkpoint (scenes never had an
//                        explicit order field, same situation beats
//                        were in before this rewrite)
//   arrival.beats[]    -> one module + one assignment per beat, order
//                        from array position (same reasoning as scenes)
//   arrival.html       -> one description module + assignment, only if
//                        non-empty — an arrival that's just a presence
//                        marker with no description shouldn't manufacture
//                        an empty one
// Every arrival itself survives, stripped down to {locationId, timeId,
// presence} — beats/html/complete move to modules+assignments, but
// presence isn't content in the same sense (who's physically here, not
// something authored/assigned), and the arrival's existence still marks
// "this location became active at this checkpoint" for the fallback
// logic that finds the most recent prior arrival.
//
// Names for types that never had a label of their own (note,
// description) are a short preview of their own text — manager-only,
// never rendered anywhere in Play mode. Beat/topic/scene modules reuse
// their existing label as-is, exactly as agreed: the label IS the name,
// not a second field alongside it.
//
// Deliberately NOT called from normalizeCampaign yet, and not meant to
// be until the read side (query.js, app.js) is rewritten to resolve
// content through modules+assignments instead of scanning campaign.blocks
// directly. Wiring this into the automatic load path before that rewrite
// exists would not just be premature — it would be actively harmful: the
// data would convert correctly, but every existing note, topic, beat,
// scene, and description would immediately stop appearing anywhere in
// the running app, since nothing would yet know to look for it in its
// new location. Exported here specifically so it can be built and
// verified thoroughly — including against a real campaign file — in
// complete isolation from that risk, and wired in only once the code
// that reads the result is actually ready for it.
function migrateToModularContent(campaign) {
  if (!Array.isArray(campaign.contentModules)) campaign.contentModules = [];
  if (!Array.isArray(campaign.assignments)) campaign.assignments = [];

  // Already migrated (or nothing to migrate) — re-scanning would either
  // duplicate everything or just be wasted work depending on which.
  // Either way, once there's at least one module, this has already run.
  if (campaign.contentModules.length > 0 || campaign.assignments.length > 0) {
    return campaign;
  }

  const blocks = Array.isArray(campaign.blocks) ? campaign.blocks : [];
  const newBlocks = [];
  const sceneOrderCounters = {}; // `${locationId}::${timeId}` -> next order value

  function nextSceneOrder(locationId, timeId) {
    const key = `${locationId}::${timeId || ''}`;
    const n = sceneOrderCounters[key] || 0;
    sceneOrderCounters[key] = n + 1;
    return n;
  }

  // A short, readable preview for module names that don't have an
  // existing label to reuse — strips mention/token syntax and markup
  // characters roughly rather than fully resolving them (this name is
  // never rendered as rich text anywhere, just read as a plain label in
  // the future manager UI, so it doesn't need token-safe truncation the
  // way a rendered preview would).
  function previewName(text, fallback) {
    const plain = (text || '')
      .replace(/\[\[[^\]]*\]\]/g, '')
      .replace(/\[\[\/[A-Z]+\]\]/g, '')
      .replace(/[*_~^]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!plain) return fallback;
    return plain.length > 40 ? `${plain.slice(0, 40)}…` : plain;
  }

  const nowIso = () => new Date().toISOString();

  blocks.forEach((block) => {
    if (block.kind === 'note') {
      // Preserves the block's own id rather than generating a new one --
      // see the comment above migrateToModularContent's declaration for
      // why this matters (an existing JUMP token could reference it).
      const moduleId = block.id;
      campaign.contentModules.push({
        id: moduleId,
        type: 'note',
        name: previewName(block.text, 'Note'),
        text: block.text || '',
        complete: !!block.complete,
        createdAt: block.createdAt || nowIso()
      });
      campaign.assignments.push({
        id: makeId('asg'),
        moduleId,
        entityId: block.entityId,
        timeId: block.timeId || null,
        order: block.order || 0,
        createdAt: block.createdAt || nowIso()
      });
    } else if (block.kind === 'topic') {
      // Preserved id: topics are a real JUMP-link target type -- an
      // existing [[JUMP:topic_xxx]] token in stored text must keep
      // resolving to the exact same id after migration.
      const moduleId = block.id;
      campaign.contentModules.push({
        id: moduleId,
        type: 'topic',
        name: block.label || '', // preserved exactly, including empty — this field IS the rendered Play-mode label
        text: block.text || '',
        complete: !!block.complete,
        createdAt: block.createdAt || nowIso()
      });
      campaign.assignments.push({
        id: makeId('asg'),
        moduleId,
        entityId: block.entityId,
        timeId: block.timeId || null,
        order: block.order || 0,
        createdAt: block.createdAt || nowIso()
      });
    } else if (block.kind === 'scene') {
      // Preserves the block's own id -- scenes aren't a JUMP target
      // today, but nothing about the id needs to change either, so
      // there's no reason to generate a new one and risk it mattering
      // somewhere this migration didn't anticipate.
      const moduleId = block.id;
      campaign.contentModules.push({
        id: moduleId,
        type: 'scene',
        name: block.label || '', // preserved exactly, including empty — this field IS the rendered Play-mode label
        lines: block.lines || [],
        complete: !!block.complete,
        createdAt: block.createdAt || nowIso()
      });
      campaign.assignments.push({
        id: makeId('asg'),
        moduleId,
        entityId: block.locationId,
        timeId: block.timeId || null,
        order: nextSceneOrder(block.locationId, block.timeId),
        createdAt: block.createdAt || nowIso()
      });
    } else if (block.kind === 'arrival') {
      (block.beats || []).forEach((beat, idx) => {
        // Preserved id: beats are a real JUMP-link target type -- an
        // existing [[JUMP:beat_xxx]] token in stored text must keep
        // resolving to the exact same id after migration.
        const moduleId = beat.id;
        campaign.contentModules.push({
          id: moduleId,
          type: 'beat',
          name: beat.label || '', // preserved exactly, including empty — this field IS the rendered Play-mode label
          text: beat.text || '',
          complete: !!beat.complete,
          createdAt: block.createdAt || nowIso()
        });
        campaign.assignments.push({
          id: makeId('asg'),
          moduleId,
          entityId: block.locationId,
          timeId: block.timeId || null,
          order: idx,
          createdAt: block.createdAt || nowIso()
        });
      });
      if (block.html && block.html.trim()) {
        // Generated, not preserved -- a description never had its own
        // independent id to begin with (it lived as arrival.html, under
        // the arrival's own id), and it isn't a JUMP-link target type
        // either, so there's no existing reference anywhere that could
        // need to keep resolving to a specific id here.
        const moduleId = makeId('mod');
        campaign.contentModules.push({
          id: moduleId,
          type: 'description',
          name: previewName(block.html, 'Description'),
          html: block.html,
          complete: !!block.complete,
          createdAt: block.createdAt || nowIso()
        });
        campaign.assignments.push({
          id: makeId('asg'),
          moduleId,
          entityId: block.locationId,
          timeId: block.timeId || null,
          order: 0,
          createdAt: block.createdAt || nowIso()
        });
      }
      newBlocks.push({
        id: block.id,
        kind: 'arrival',
        locationId: block.locationId,
        timeId: block.timeId,
        presence: block.presence || [],
        createdAt: block.createdAt
      });
    } else {
      // Unknown/future block kind — pass through unchanged rather than
      // silently dropping something this function doesn't know about.
      newBlocks.push(block);
    }
  });

  campaign.blocks = newBlocks;

  // completedSinceStart entries are {kind, blockId, beatId} — a shape
  // that doesn't map onto the new {moduleId} one markModuleComplete
  // uses. This is the session-scoped "undo everything I completed since
  // I hit start" list, not precious content, so clearing it here (same
  // as setBookmark already does whenever a new start point is set) is a
  // low-risk, reasonable choice — worst case, whatever was completed
  // right before this migration ran can't be undone via that button
  // anymore, which resolves itself the next time a start point is set.
  if (campaign.meta) campaign.meta.completedSinceStart = [];

  return campaign;
}

function loadCampaign(dir) {
  ensureDir(dir);
  const file = campaignFile(dir);
  if (!fs.existsSync(file)) {
    const seed = buildSeedCampaign();
    fs.writeFileSync(file, JSON.stringify(seed, null, 2), 'utf8');
    return normalizeCampaign(seed);
  }
  const raw = fs.readFileSync(file, 'utf8');
  try {
    return normalizeCampaign(JSON.parse(raw));
  } catch (err) {
    // Corrupt file — do not overwrite it. Fall back to the most recent
    // backup if one exists, otherwise surface the error rather than
    // silently discarding whatever's on disk.
    const restored = restoreLatestBackup(dir);
    if (restored) return normalizeCampaign(restored);
    throw new Error(`campaign.json is corrupt and no backup was found: ${err.message}`);
  }
}

function isTransientFileError(err) {
  return !!err && ['EPERM', 'EBUSY', 'EACCES', 'EAGAIN', 'EMFILE', 'ENFILE'].includes(err.code);
}

function writeCampaignSync(dir, campaign) {
  ensureDir(dir);
  const file = campaignFile(dir);
  const tmp = file + '.tmp';
  // Write to a temp file then rename, so a crash mid-write never leaves a
  // half-written campaign.json on disk.
  fs.writeFileSync(tmp, JSON.stringify(campaign, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    // On Windows the rename can fail with EPERM/EBUSY while an antivirus
    // scanner or a sync client (OneDrive, Dropbox) briefly holds the target
    // open. Fall back to copying over it instead of giving up.
    if (!isTransientFileError(err)) throw err;
    fs.copyFileSync(tmp, file);
    try { fs.unlinkSync(tmp); } catch { /* leftover tmp is harmless */ }
  }
}

const RETRY_DELAYS_MS = [150, 400, 1000, 2500, 5000];

// Debounced autosave that survives failing writes. A failed write used to
// throw out of a timer callback (an uncaught exception in the main process,
// which on Windows shows a blocking error dialog). Now it is caught, reported
// through hooks, and retried with backoff -- always with the NEWEST state.
//
// hooks: onError(err, failuresInARow), onRecovered(), write(dir, campaign),
//        debounceMs, retryDelays
function makeAutosaver(dir, hooks = {}) {
  const write = hooks.write || writeCampaignSync;
  const debounceMs = hooks.debounceMs != null ? hooks.debounceMs : AUTOSAVE_DEBOUNCE_MS;
  const delays = hooks.retryDelays || RETRY_DELAYS_MS;
  let timer = null;
  let pending = null;
  let failures = 0;

  function attempt() {
    timer = null;
    const snapshot = pending;
    if (snapshot == null) return;
    try {
      write(dir, snapshot);
    } catch (err) {
      failures++;
      if (hooks.onError) { try { hooks.onError(err, failures); } catch { /* hook must not break saving */ } }
      const delay = delays[Math.min(failures - 1, delays.length - 1)];
      timer = setTimeout(attempt, delay);
      return;
    }
    if (pending === snapshot) pending = null;
    if (failures > 0) {
      failures = 0;
      if (hooks.onRecovered) { try { hooks.onRecovered(); } catch { /* ignore */ } }
    }
    if (pending != null) timer = setTimeout(attempt, debounceMs);
  }

  return function scheduleSave(campaign) {
    pending = campaign;
    // While failing, a retry is already scheduled and will pick up this
    // newer state; do not reset its backoff.
    if (failures > 0 && timer) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(attempt, debounceMs);
  };
}

function createBackup(dir) {
  const file = campaignFile(dir);
  if (!fs.existsSync(file)) return null;
  const bdir = backupsDir(dir);
  ensureDir(bdir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 6);
  const dest = path.join(bdir, `campaign-${stamp}-${rand}.json`);
  fs.copyFileSync(file, dest);
  pruneBackups(dir);
  return dest;
}

function pruneBackups(dir) {
  const bdir = backupsDir(dir);
  if (!fs.existsSync(bdir)) return;
  const files = fs.readdirSync(bdir)
    .filter((f) => f.startsWith('campaign-') && f.endsWith('.json'))
    .sort(); // ISO stamps sort chronologically as strings
  const excess = files.length - MAX_BACKUPS;
  for (let i = 0; i < excess; i++) {
    fs.unlinkSync(path.join(bdir, files[i]));
  }
}

function restoreLatestBackup(dir) {
  const bdir = backupsDir(dir);
  if (!fs.existsSync(bdir)) return null;
  const files = fs.readdirSync(bdir)
    .filter((f) => f.startsWith('campaign-') && f.endsWith('.json'))
    .sort();
  if (files.length === 0) return null;
  const latest = files[files.length - 1];
  const raw = fs.readFileSync(path.join(bdir, latest), 'utf8');
  return JSON.parse(raw);
}

function startBackupSchedule(dir) {
  createBackup(dir); // one on launch
  return setInterval(() => createBackup(dir), BACKUP_INTERVAL_MS);
}

module.exports = {
  campaignFile,
  backupsDir,
  loadCampaign,
  writeCampaignSync,
  makeAutosaver,
  isTransientFileError,
  createBackup,
  startBackupSchedule,
  normalizeCampaign,
  migrateToModularContent,
  migrateInventoryColumns
};
