// Data model factories. Every entity/block created goes through one of
// these so the shape stays consistent across the app.
//
// Wrapped in an IIFE so internal names (_constants, api, makeId, etc.)
// never leak into the shared top-level scope alongside the other shared
// modules — only the final window.DataModel assignment is visible outside.
(function () {

const _constants = (typeof module !== 'undefined' && module.exports) ? require('./constants') : window.Constants;
const { colorForIndex, DEFAULT_ICON } = _constants;

function makeId(prefix) {
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

// --- Entities (NPCs and locations) -----------------------------------

// Every NPC starts with its own copy of the default Villager stat block (see
// src/characterCard.js). Looked up at call time because, in the renderer, the
// shared files are concatenated into one scope and load in a fixed order.
function giveDefaultNpcCard(entity) {
  if (entity.type !== 'npc') return;
  const CC = (typeof module !== 'undefined' && module.exports) ? require('./characterCard') : window.CharacterCard;
  if (CC) CC.ensureStatblock(entity);
}

function questsModule() { return (typeof module !== 'undefined' && module.exports) ? require('./quests') : window.Quests; }

function createEntity(campaign, { type, name, summary = '', notionUrl = '' }) {
  const id = makeId(type === 'location' ? 'loc' : type === 'quest' ? 'quest' : 'npc');
  let color;
  if (type === 'quest') color = { key: questsModule().questColorKey(id) };   // quests are yellow-ish and do not use up the palette
  else { color = colorForIndex(campaign.meta.nextColorIndex || 0); campaign.meta.nextColorIndex = (campaign.meta.nextColorIndex || 0) + 1; }
  const entity = {
    id,
    type, // 'npc' | 'location' | 'quest'
    name,
    icon: DEFAULT_ICON[type] || 'user',
    color: color.key,
    ...(type === 'quest' ? { questColorSet: true } : {}),
    summary,
    notionUrl,
    lootTable: [], // {dc, result} rows — location-only in the UI, harmless if unused elsewhere
    image: null, // {filename, size: 'small'|'medium'|'large'} once uploaded — the file itself lives on disk, never in campaign.json (see src/entityImages.js)
    createdAt: new Date().toISOString()
  };
  giveDefaultNpcCard(entity);
  campaign.entities[id] = entity;
  return entity;
}

// The entity only ever stores a filename and a size choice — never the
// image data itself (see src/entityImages.js for why). Preserves the
// existing size choice when replacing an image rather than resetting it
// back to the default, since swapping the picture for a character
// someone already sized "large" shouldn't quietly shrink it back down.
function setEntityImage(campaign, entityId, filename) {
  const entity = campaign.entities[entityId];
  if (!entity) return;
  const existingSize = (entity.image && entity.image.size) || 'medium';
  entity.image = { filename, size: existingSize, updatedAt: new Date().toISOString() };
}

function removeEntityImage(campaign, entityId) {
  const entity = campaign.entities[entityId];
  if (entity) entity.image = null;
}

function setEntityImageSize(campaign, entityId, size) {
  const entity = campaign.entities[entityId];
  if (entity && entity.image) entity.image.size = size;
}

// --- Inventory tables ------------------------------------------------------
//
// entity.inventoryCategories is an array of categories. Each category owns
// its own ordered list of free-form text columns (columns: [{id, label}]),
// so one table can have two descriptive columns and another five — every
// column between the name and the price is a real, independent column,
// not a label folded into some shared field. A row keeps its name and
// price directly and its column contents in cells, keyed by column id
// (an id, not a position, so deleting or reordering a column can never
// shift the wrong text under the wrong heading). A missing cell simply
// reads as empty. nameLabel/priceLabel are the category's own headers for
// the two fixed columns, defaulting to "Name"/"Price".

function normalizeInventoryLabel(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

function createInventoryCategory({ name = 'New category' } = {}) {
  return { id: makeId('invcat'), name, collapsed: false, columns: [{ id: makeId('col'), label: 'Effect' }], rows: [] };
}

function createInventoryRow() {
  return { name: '', price: '', cells: {} };
}

function addInventoryColumn(category, label = 'Column') {
  if (!Array.isArray(category.columns)) category.columns = [];
  const column = { id: makeId('col'), label };
  category.columns.push(column);
  return column;
}

// Removes the column and its text from every row — this genuinely
// discards that content, so callers confirm with the person first.
function deleteInventoryColumn(category, columnId) {
  category.columns = (category.columns || []).filter((c) => c.id !== columnId);
  (category.rows || []).forEach((row) => { if (row.cells) delete row.cells[columnId]; });
}

function cellsFromTableRow(columnIds, values) {
  const cells = {};
  columnIds.forEach((id, i) => { cells[id] = values[i] || ''; });
  return cells;
}

// Adds a parsed table's rows to an existing category (see
// Query.parseInventoryTable for the table shape). An empty category has
// nothing to stay consistent with, so it simply adopts the table's own
// columns and headers. One that already has rows keeps its structure:
// pasted columns are matched to existing ones by header name (so pasting
// more rows of the same table lines up cleanly), any column it doesn't
// have yet is added, and rows already there just read empty for it. A
// table pasted with no header line has no names to match, so it's lined
// up by position instead. Each existing column is matched at most once
// per paste, so two pasted columns sharing a name never collapse into one.
function mergeInventoryTableIntoCategory(category, table) {
  if (!table || table.rows.length === 0) return;
  if (!Array.isArray(category.columns)) category.columns = [];
  if (!Array.isArray(category.rows)) category.rows = [];

  let columnIds;
  if (category.rows.length === 0) {
    category.columns = table.columnLabels.map((label) => ({ id: makeId('col'), label }));
    columnIds = category.columns.map((c) => c.id);
    if (table.hasHeaders) {
      category.nameLabel = table.nameLabel;
      category.priceLabel = table.priceLabel;
    }
  } else {
    const used = new Set();
    columnIds = table.columnLabels.map((label, i) => {
      let target = null;
      if (table.hasHeaders) {
        target = category.columns.find((c) => !used.has(c.id) && normalizeInventoryLabel(c.label) === normalizeInventoryLabel(label));
      } else if (category.columns[i] && !used.has(category.columns[i].id)) {
        target = category.columns[i];
      }
      if (!target) {
        target = { id: makeId('col'), label };
        category.columns.push(target);
      }
      used.add(target.id);
      return target.id;
    });
  }

  table.rows.forEach((r) => {
    category.rows.push({ name: r.name, price: r.price, cells: cellsFromTableRow(columnIds, r.cells) });
  });
}

// Overwrites a category's columns, headers and rows with a table's —
// for when the table is meant to BE the category's complete new content
// (a Notion import the person reviewed), not more rows for it. Columns
// whose header already existed keep their ids.
function replaceInventoryCategoryFromTable(category, table) {
  const oldColumns = category.columns || [];
  const used = new Set();
  const columns = table.columnLabels.map((label) => {
    const match = oldColumns.find((c) => !used.has(c.id) && normalizeInventoryLabel(c.label) === normalizeInventoryLabel(label));
    if (match) { used.add(match.id); return { id: match.id, label }; }
    return { id: makeId('col'), label };
  });
  category.columns = columns;
  category.nameLabel = table.nameLabel;
  category.priceLabel = table.priceLabel;
  const ids = columns.map((c) => c.id);
  category.rows = table.rows.map((r) => ({ name: r.name, price: r.price, cells: cellsFromTableRow(ids, r.cells) }));
}

function createInventoryCategoryFromTable(name, table) {
  const category = { id: makeId('invcat'), name, collapsed: false, columns: [], rows: [] };
  replaceInventoryCategoryFromTable(category, table);
  return category;
}

// Splits "Name One, Name Two, Name Three" into individual entities, all of
// the same type, optionally all landing in the same group at once. Reuses
// createEntity for each — no new entity shape, no new risk, just doing the
// same trusted thing several times instead of once. Blank entries (a
// trailing comma, double commas, etc.) are silently skipped rather than
// creating an empty-named entity.
function createEntitiesBulk(campaign, { type, namesText, groupId = null }) {
  const names = (namesText || '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  const created = names.map((name) => {
    const entity = createEntity(campaign, { type, name });
    if (groupId) entity.groupId = groupId;
    return entity;
  });
  return created;
}

// Assigns several already-existing entities to one group (or ungroups them
// if groupId is null) in a single pass — used by the entity manager's
// select-multiple workflow.
function assignEntitiesToGroup(campaign, entityIds, groupId) {
  (entityIds || []).forEach((id) => {
    const entity = campaign.entities[id];
    if (entity) entity.groupId = groupId || null;
  });
}

// --- Checkpoints (time) -----------------------------------------------

function createCheckpoint(campaign, { label }) {
  const maxOrder = campaign.checkpoints.reduce((m, c) => Math.max(m, c.order), -1);
  const cp = { id: makeId('cp'), label, order: maxOrder + 1 };
  campaign.checkpoints.push(cp);
  return cp;
}

// Swaps a checkpoint's position with its immediate neighbor (direction -1
// = earlier, +1 = later). Default order is still creation order — this is
// purely for fixing it up afterward, e.g. a checkpoint added out of
// chronological sequence. No-ops silently at either end of the list.
function moveCheckpoint(campaign, checkpointId, direction) {
  const sorted = campaign.checkpoints.slice().sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((c) => c.id === checkpointId);
  const swapWith = idx + direction;
  if (idx === -1 || swapWith < 0 || swapWith >= sorted.length) return false;
  const a = sorted[idx];
  const b = sorted[swapWith];
  const temp = a.order;
  a.order = b.order;
  b.order = temp;
  return true;
}

// --- Entity groups -------------------------------------------------------
// Create-mode-only visual organization. Deliberately never referenced by
// query.js or anything Play mode touches — an entity with no groupId (the
// default for every entity that existed before this feature) is simply
// "Ungrouped", not an error state.

// One level of nesting only (a group, and optionally subgroups under it —
// subgroups can't have their own subgroups). Order is scoped to siblings:
// top-level groups reorder among each other, a subgroup reorders among
// its own siblings under the same parent, independently.
// Groups can nest to any depth. A cycle can't actually form through this
// function alone (a brand-new group can't reference itself as an
// ancestor since it doesn't exist yet), so the only defensive check
// needed is that the requested parent actually exists.
function createEntityGroup(campaign, { name, parentId = null }) {
  if (!Array.isArray(campaign.entityGroups)) campaign.entityGroups = [];
  let resolvedParentId = parentId || null;
  if (resolvedParentId && !campaign.entityGroups.find((g) => g.id === resolvedParentId)) {
    resolvedParentId = null;
  }
  const siblings = campaign.entityGroups.filter((g) => (g.parentId || null) === resolvedParentId);
  const maxOrder = siblings.reduce((m, g) => Math.max(m, g.order), -1);
  const group = { id: makeId('grp'), name: name || 'New group', order: maxOrder + 1, parentId: resolvedParentId };
  campaign.entityGroups.push(group);
  return group;
}

function moveEntityGroup(campaign, groupId, direction) {
  const groups = campaign.entityGroups || [];
  const target = groups.find((g) => g.id === groupId);
  if (!target) return false;
  const siblings = groups.filter((g) => (g.parentId || null) === (target.parentId || null)).sort((a, b) => a.order - b.order);
  const idx = siblings.findIndex((g) => g.id === groupId);
  const swapWith = idx + direction;
  if (idx === -1 || swapWith < 0 || swapWith >= siblings.length) return false;
  const a = siblings[idx];
  const b = siblings[swapWith];
  const temp = a.order;
  a.order = b.order;
  b.order = temp;
  return true;
}

// Removing a group never touches entity data — it only clears groupId on
// whatever was in it, sending those entities back to "Ungrouped". Any
// subgroups under the deleted group are reattached to *its* parent
// (skipping over the removed group, same as removing a node from a
// linked list) rather than deleted or left pointing at a group that no
// longer exists — same non-destructive philosophy either way. When the
// deleted group was itself top-level, this naturally means its children
// become top-level too, same as before.
function deleteEntityGroup(campaign, groupId) {
  const groups = campaign.entityGroups || [];
  const target = groups.find((g) => g.id === groupId);
  const reattachTo = target ? (target.parentId || null) : null;
  campaign.entityGroups = groups.filter((g) => g.id !== groupId);
  campaign.entityGroups.forEach((g) => {
    if (g.parentId === groupId) g.parentId = reattachTo;
  });
  Object.values(campaign.entities).forEach((e) => {
    if (e.groupId === groupId) e.groupId = null;
  });
}

// Is `candidateId` a descendant of `groupId` (at any depth)? Used to
// refuse a reparent that would create a cycle — you can't move a group
// to live under one of its own children.
function isDescendantOf(groups, groupId, candidateId) {
  const children = groups.filter((g) => g.parentId === groupId);
  for (const child of children) {
    if (child.id === candidateId) return true;
    if (isDescendantOf(groups, child.id, candidateId)) return true;
  }
  return false;
}

// Moves an existing group under a different parent (or to top-level, if
// newParentId is null). Refuses anything that would create a cycle —
// making a group its own parent, or moving it under one of its own
// descendants — rather than silently corrupting the tree. Lands at the
// end of its new sibling list.
function reparentEntityGroup(campaign, groupId, newParentId) {
  const groups = campaign.entityGroups || [];
  const group = groups.find((g) => g.id === groupId);
  if (!group) return false;
  const resolved = newParentId || null;
  if (resolved === groupId) return false;
  if (resolved && isDescendantOf(groups, groupId, resolved)) return false;
  if (resolved && !groups.find((g) => g.id === resolved)) return false;

  const siblings = groups.filter((g) => g.id !== groupId && (g.parentId || null) === resolved);
  const maxOrder = siblings.reduce((m, g) => Math.max(m, g.order), -1);
  group.parentId = resolved;
  group.order = maxOrder + 1;
  return true;
}

// --- Group placement (drag and drop) ----------------------------------------
//
// Everything the drag-and-drop group manager does to the group tree comes
// down to one question: which group should this one now sit under, and
// before which sibling (or last)? placement is { parentId, beforeGroupId }:
// parentId null means top-level, and beforeGroupId null means "after all of
// that parent's other children".

// Where a drop lands, as a placement. zone is where on the target the
// pointer was:
//   'before' — as a sibling just above the target group
//   'inside' — as the target group's last child
//   'top'    — as the very first top-level group (above the first entry)
//   'end'    — as the last top-level group
// Those four are enough to reach any position in the tree: to put a group
// after some group T, drop it before whatever follows T's whole block, or
// inside T's parent if T is the last child. Returns null when the target
// doesn't exist.
function resolveGroupDrop(campaign, zone, targetGroupId) {
  const groups = campaign.entityGroups || [];
  const byOrder = (a, b) => a.order - b.order;
  if (zone === 'top') {
    const first = groups.filter((g) => !g.parentId).sort(byOrder)[0];
    return { parentId: null, beforeGroupId: first ? first.id : null };
  }
  if (zone === 'end') return { parentId: null, beforeGroupId: null };
  const target = groups.find((g) => g.id === targetGroupId);
  if (!target) return null;
  if (zone === 'before') return { parentId: target.parentId || null, beforeGroupId: target.id };
  if (zone === 'inside') return { parentId: target.id, beforeGroupId: null };
  return null;
}

// Would this placement be legal? Refuses anything that would corrupt the
// tree: a group under itself or one of its own descendants (a cycle), a
// parent or a "before" sibling that doesn't exist, a "before" sibling that
// isn't actually a child of the chosen parent, and "before itself".
function canPlaceEntityGroup(campaign, groupId, { parentId = null, beforeGroupId = null } = {}) {
  const groups = campaign.entityGroups || [];
  const group = groups.find((g) => g.id === groupId);
  if (!group) return false;
  const newParent = parentId || null;
  if (newParent === groupId) return false;
  if (newParent && !groups.find((g) => g.id === newParent)) return false;
  if (newParent && isDescendantOf(groups, groupId, newParent)) return false;
  if (beforeGroupId) {
    if (beforeGroupId === groupId) return false;
    const before = groups.find((g) => g.id === beforeGroupId);
    if (!before || (before.parentId || null) !== newParent) return false;
  }
  return true;
}

// Puts a group at an exact spot in the tree. Siblings under the receiving
// parent are renumbered 0..n-1 in their new order, so order values never
// drift into ties or gaps no matter how many times things are rearranged.
// Returns false (and changes nothing) for an illegal placement.
function placeEntityGroup(campaign, groupId, placement = {}) {
  if (!canPlaceEntityGroup(campaign, groupId, placement)) return false;
  const groups = campaign.entityGroups;
  const group = groups.find((g) => g.id === groupId);
  const newParent = placement.parentId || null;
  const siblings = groups
    .filter((g) => g.id !== groupId && (g.parentId || null) === newParent)
    .sort((a, b) => a.order - b.order);
  const at = placement.beforeGroupId ? siblings.findIndex((g) => g.id === placement.beforeGroupId) : siblings.length;
  siblings.splice(at, 0, group);
  group.parentId = newParent;
  siblings.forEach((g, i) => { g.order = i; });
  return true;
}

// --- Remembering where the last entity went ---------------------------------
//
// So creating several NPCs for the same crew doesn't mean picking that
// group every time: the group chosen for the most recently created NPC (and,
// separately, location) is offered as the default for the next one. Stored
// per campaign, since groups belong to one.

function rememberEntityGroup(campaign, type, groupId) {
  if (!campaign.meta.lastGroupByType || typeof campaign.meta.lastGroupByType !== 'object') {
    campaign.meta.lastGroupByType = {};
  }
  campaign.meta.lastGroupByType[type] = groupId || null;
}

// The group to offer for a new entity of this type — or null (ungrouped) if
// nothing was remembered or that group has since been deleted, rather than
// offering a group that no longer exists.
function getRememberedGroup(campaign, type) {
  const id = campaign.meta.lastGroupByType && campaign.meta.lastGroupByType[type];
  return id && (campaign.entityGroups || []).some((g) => g.id === id) ? id : null;
}

// --- Draft entities (the create form) ---------------------------------------
//
// The create form is the real entity editor, working on an entity that
// doesn't officially exist yet. A draft lives in campaign.entities like any
// other entity — so every editor handler that looks an entity up by id just
// works — but as a NON-ENUMERABLE property. Everything that lists, searches,
// counts or saves entities walks the enumerable ones (Object.values, keys,
// for...in, spread, JSON.stringify), so a draft is invisible to all of it
// until it is committed, and a half-finished one can never leak into a list,
// a picker, Play mode, or a saved file. The only things a draft can create
// outside itself are content assignments and the modules made for them
// (notes, topics); see getDraftOwnedModuleIds.

function isDraftEntity(campaign, id) {
  return Object.prototype.hasOwnProperty.call(campaign.entities, id)
    && !Object.prototype.propertyIsEnumerable.call(campaign.entities, id);
}

function createDraftEntity(campaign, { type, groupId = null }) {
  const id = makeId(type === 'location' ? 'loc' : type === 'quest' ? 'quest' : 'npc');
  // Peeks at the next palette color without using it up — the index only
  // advances if the draft is actually created.
  const color = type === 'quest' ? { key: questsModule().questColorKey(id) } : colorForIndex(campaign.meta.nextColorIndex || 0);
  const entity = {
    id, type, ...(type === 'quest' ? { questColorSet: true } : {}), name: '', icon: DEFAULT_ICON[type] || 'user', color: color.key,
    summary: '', notionUrl: '', groupId: groupId || null,
    lootTable: [], image: null, createdAt: new Date().toISOString()
  };
  giveDefaultNpcCard(entity);
  Object.defineProperty(campaign.entities, id, { value: entity, enumerable: false, configurable: true, writable: true });
  return entity;
}

// Makes a draft a real entity: an ordinary, enumerable one, re-inserted so
// it sorts as the newest, and the palette index advances now that its color
// has really been used. Does nothing for an entity that isn't a draft.
function commitDraftEntity(campaign, id) {
  if (!isDraftEntity(campaign, id)) return null;
  const entity = campaign.entities[id];
  delete campaign.entities[id];
  entity.createdAt = new Date().toISOString();
  campaign.entities[id] = entity;
  if (entity.type !== 'quest') campaign.meta.nextColorIndex = (campaign.meta.nextColorIndex || 0) + 1;
  return entity;
}

// A draft's notes and topics are real content modules assigned to it, made
// as the person fills the form in. Those are the modules made DURING the
// draft (not in the snapshot taken when it started) that are assigned to it.
// A pre-existing library module assigned to a draft is deliberately not
// included — it was already there and must survive the draft being dropped.
function getDraftOwnedModuleIds(campaign, draftId, snapshotModuleIds) {
  const snapshot = snapshotModuleIds instanceof Set ? snapshotModuleIds : new Set(snapshotModuleIds || []);
  const owned = new Set();
  (campaign.assignments || []).forEach((a) => {
    if (a.entityId === draftId && !snapshot.has(a.moduleId)) owned.add(a.moduleId);
  });
  return owned;
}

// Throws a draft away completely: the entity, everything assigned to it,
// and the modules that were made for it. Returns the filename of any image
// uploaded to it so the caller can delete the file from disk (the data layer
// doesn't touch the disk), or null. Refuses to touch a real entity.
function discardDraftEntity(campaign, id, snapshotModuleIds) {
  if (!isDraftEntity(campaign, id)) return null;
  const entity = campaign.entities[id];
  const owned = getDraftOwnedModuleIds(campaign, id, snapshotModuleIds);
  campaign.assignments = (campaign.assignments || []).filter((a) => a.entityId !== id);
  campaign.contentModules = (campaign.contentModules || []).filter((m) => !owned.has(m.id));
  delete campaign.entities[id];
  return entity.image && entity.image.filename ? entity.image.filename : null;
}

function createArrivalBlock(campaign, { locationId, timeId, html = '' }) {
  const block = {
    id: makeId('blk'),
    kind: 'arrival',
    locationId,
    timeId,
    html,
    presence: [],
    beats: [],
    complete: false, // "read aloud already" — carries forward like a beat once a later checkpoint has its own new description
    createdAt: new Date().toISOString()
  };
  campaign.blocks.push(block);
  return block;
}

function createNoteBlock(campaign, { entityId, timeId = null, text = '' }) {
  // Order is scoped to entityId+timeId, not global — that matches
  // exactly how notes get grouped for display (current notes at this
  // checkpoint are one list; carried-forward notes from earlier
  // checkpoints are a separate list), so reordering only ever needs to
  // make sense against the notes actually sitting next to this one.
  const siblings = campaign.blocks.filter((b) => b.kind === 'note' && b.entityId === entityId && b.timeId === timeId);
  const maxOrder = siblings.reduce((m, n) => Math.max(m, n.order || 0), -1);
  const block = {
    id: makeId('blk'),
    kind: 'note',
    entityId,
    timeId, // null = always-visible general note
    text,
    complete: false, // meaningful for time-specific notes; carry-forward-eligible like a beat
    order: maxOrder + 1,
    createdAt: new Date().toISOString()
  };
  campaign.blocks.push(block);
  return block;
}

// Swaps a note's order with its immediate neighbor within the same
// entityId+timeId group (direction -1 = earlier, +1 = later). Changing
// which checkpoint a note belongs to (updateNoteTimeId, in app.js) moves
// it into a different order-scope entirely — it always lands at the end
// of its new group's order, same as a freshly created note would.
function moveNote(campaign, noteId, direction) {
  const note = campaign.blocks.find((b) => b.id === noteId && b.kind === 'note');
  if (!note) return false;
  const siblings = campaign.blocks
    .filter((b) => b.kind === 'note' && b.entityId === note.entityId && b.timeId === note.timeId)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = siblings.findIndex((n) => n.id === noteId);
  const swapWith = idx + direction;
  if (idx === -1 || swapWith < 0 || swapWith >= siblings.length) return false;
  const a = siblings[idx];
  const b = siblings[swapWith];
  const temp = a.order || 0;
  a.order = b.order || 0;
  b.order = temp;
  return true;
}

function createTopicBlock(campaign, { entityId, label, text = '', timeId = null }) {
  // Order is scoped to just entityId, unlike notes — topics from
  // different timeIds can end up shown together in the same list (a
  // topic stays visible at every checkpoint after the one it's scoped
  // to, so several with different timeIds are routinely visible at
  // once), and a single entity-wide order keeps that combined list
  // consistently orderable regardless of which specific mix is showing.
  const siblings = campaign.blocks.filter((b) => b.kind === 'topic' && b.entityId === entityId);
  const maxOrder = siblings.reduce((m, t) => Math.max(m, t.order || 0), -1);
  const block = {
    id: makeId('blk'),
    kind: 'topic',
    entityId,
    label,
    text,
    timeId, // null = always available; otherwise available from this checkpoint onward
    complete: false,
    order: maxOrder + 1,
    createdAt: new Date().toISOString()
  };
  campaign.blocks.push(block);
  return block;
}

function moveTopic(campaign, topicId, direction) {
  const topic = campaign.blocks.find((b) => b.id === topicId && b.kind === 'topic');
  if (!topic) return false;
  const siblings = campaign.blocks
    .filter((b) => b.kind === 'topic' && b.entityId === topic.entityId)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = siblings.findIndex((t) => t.id === topicId);
  const swapWith = idx + direction;
  if (idx === -1 || swapWith < 0 || swapWith >= siblings.length) return false;
  const a = siblings[idx];
  const b = siblings[swapWith];
  const temp = a.order || 0;
  a.order = b.order || 0;
  b.order = temp;
  return true;
}

function createSceneBlock(campaign, { locationId, timeId, label, lines = [] }) {
  const block = {
    id: makeId('blk'),
    kind: 'scene',
    locationId,
    timeId,
    label,
    lines, // [{ speakerId, text }]
    complete: false,
    createdAt: new Date().toISOString()
  };
  campaign.blocks.push(block);
  return block;
}

function addBeat(arrivalBlock, { label, text = '' }) {
  const beat = { id: makeId('beat'), label, text, complete: false };
  arrivalBlock.beats.push(beat);
  return beat;
}

// Sections are shown in array order, so reordering is just a swap of
// array position — no separate order field to manage, unlike checkpoints
// or entity groups (which live in one flat campaign-wide array where
// position alone can't express sibling order once filtering is involved).
function moveBeat(arrivalBlock, beatId, direction) {
  const beats = arrivalBlock.beats || [];
  const idx = beats.findIndex((b) => b.id === beatId);
  const newIdx = idx + direction;
  if (idx === -1 || newIdx < 0 || newIdx >= beats.length) return false;
  const [item] = beats.splice(idx, 1);
  beats.splice(newIdx, 0, item);
  return true;
}

function addSceneLine(sceneBlock, { speakerId = null, text = '' }) {
  const line = { id: makeId('line'), speakerId, text };
  sceneBlock.lines.push(line);
  return line;
}

// --- DC Checks ----------------------------------------------------------
//
// A DC Check is referenced by a [[DCCHECK:id]] token embedded in any
// text field (created via Alt+D) — not assigned to an entity through
// the Modular Content system, since the point is one definition
// droppable into any number of places by id, the same way a
// [[entityId]] mention works, rather than something placed on a
// specific entity. Three parts: a graduated reveal table (different DC
// thresholds show different text — "what do you learn/notice at DC 10
// vs 15 vs 20", purely informational, no pass/fail framing), an
// optional conditions list (explicit pass/fail framing, with escalating
// repeat-failure/repeat-success text and special nat1/nat20 outcomes),
// and a roll log (every value actually logged during play, persisted so
// occurrence counts and history survive between sessions until
// explicitly cleared).

function createDCCheck(campaign, { name = '', checkType, mode = null }) {
  const check = {
    id: makeId('dcc'),
    name,
    checkType,
    mode,          // 'scale' | 'passfail' (null = worked out from the content, see Conditions.dcCheckMode)
    stackTiers: true,
    allowBoth: false,
    table: [],
    conditions: [],
    rollLog: [],
    createdAt: new Date().toISOString()
  };
  campaign.dcChecks.push(check);
  return check;
}

function deleteDCCheck(campaign, checkId) {
  campaign.dcChecks = campaign.dcChecks.filter((c) => c.id !== checkId);
}

function updateDCCheckField(campaign, checkId, field, value) {
  const check = campaign.dcChecks.find((c) => c.id === checkId);
  if (check) check[field] = value;
}

function addDCTableRow(campaign, checkId, { dc = 10, text = '' } = {}) {
  const check = campaign.dcChecks.find((c) => c.id === checkId);
  if (!check) return null;
  const row = { id: makeId('dcr'), dc, text };
  check.table.push(row);
  return row;
}

function updateDCTableRow(campaign, checkId, rowId, field, value) {
  const check = campaign.dcChecks.find((c) => c.id === checkId);
  const row = check && check.table.find((r) => r.id === rowId);
  if (row) row[field] = value;
}

function deleteDCTableRow(campaign, checkId, rowId) {
  const check = campaign.dcChecks.find((c) => c.id === checkId);
  if (check) check.table = check.table.filter((r) => r.id !== rowId);
}

function moveDCTableRow(campaign, checkId, rowId, direction) {
  const check = campaign.dcChecks.find((c) => c.id === checkId);
  if (!check) return false;
  const idx = check.table.findIndex((r) => r.id === rowId);
  const newIdx = idx + direction;
  if (idx === -1 || newIdx < 0 || newIdx >= check.table.length) return false;
  const [item] = check.table.splice(idx, 1);
  check.table.splice(newIdx, 0, item);
  return true;
}

function addDCCondition(campaign, checkId, { trigger = 'failure', dc = 10, occurrence = 1, text = '' } = {}) {
  const check = campaign.dcChecks.find((c) => c.id === checkId);
  if (!check) return null;
  const condition = { id: makeId('dcond'), trigger, dc, occurrence, text };
  check.conditions.push(condition);
  return condition;
}

function updateDCCondition(campaign, checkId, condId, field, value) {
  const check = campaign.dcChecks.find((c) => c.id === checkId);
  const condition = check && check.conditions.find((c) => c.id === condId);
  if (condition) condition[field] = value;
}

function deleteDCCondition(campaign, checkId, condId) {
  const check = campaign.dcChecks.find((c) => c.id === checkId);
  if (check) check.conditions = check.conditions.filter((c) => c.id !== condId);
}

function moveDCCondition(campaign, checkId, condId, direction) {
  const check = campaign.dcChecks.find((c) => c.id === checkId);
  if (!check) return false;
  const idx = check.conditions.findIndex((c) => c.id === condId);
  const newIdx = idx + direction;
  if (idx === -1 || newIdx < 0 || newIdx >= check.conditions.length) return false;
  const [item] = check.conditions.splice(idx, 1);
  check.conditions.splice(newIdx, 0, item);
  return true;
}

// Logged values are always a plain number 1-20 (or higher, with
// advantage/disadvantage house rules etc — never enforced here); nat1/
// nat20 conditions are just the special case of value === 1 or === 20,
// not a separate stored flag, so there's exactly one source of truth
// for what was actually rolled.
function appendDCRollLogEntry(campaign, checkId, value) {
  const check = campaign.dcChecks.find((c) => c.id === checkId);
  if (!check) return null;
  const entry = { id: makeId('roll'), value, at: new Date().toISOString() };
  check.rollLog.push(entry);
  return entry;
}

function clearDCRollLog(campaign, checkId) {
  const check = campaign.dcChecks.find((c) => c.id === checkId);
  if (check) check.rollLog = [];
}

// --- Modular Content (new content-module + assignment system) ---------
//
// A content module is the shared body of a piece of content — its text/
// lines/html and its one shared completion flag. An assignment is one
// placement of a module onto an entity, at an optional checkpoint, with
// its own position among that entity's other assignments. The same
// module can have several assignments (prepared for more than one place
// a scene could plausibly happen); completing it anywhere completes it
// everywhere, since it's one shared flag on the module, not the
// assignment — but milestone and order live on the assignment
// specifically, so the same module can surface at a different
// checkpoint, or in a different position, depending on where it's
// placed. This deliberately mirrors moveNote/moveTopic/moveBeat's own,
// already-proven scoping rules rather than inventing new ones — see
// assignmentScopeKey below.
//
// These are additive, new functions. The existing createNoteBlock/
// createTopicBlock/createSceneBlock/addBeat/moveNote/moveTopic/moveBeat
// above are untouched — query.js and app.js still read the old shape
// until the read side is rewritten to use these instead.

function createContentModule(campaign, { type, name, text = '', html = '', lines = [] }) {
  const module = { id: makeId('mod'), type, name, complete: false, createdAt: new Date().toISOString() };
  if (type === 'scene') module.lines = lines;
  else if (type === 'description') module.html = html;
  else module.text = text; // note, topic, beat
  campaign.contentModules.push(module);
  return module;
}

// Order-scoping matches each type's pre-existing behavior exactly, just
// generalized through one shared table instead of four separate ones:
// notes/beats/scenes are scoped per entityId+timeId (shown together at
// one specific checkpoint, same as a location's beats always were);
// topics are scoped per entityId alone (a topic assigned at one
// checkpoint stays visible at every later one too, so several with
// different timeIds routinely end up shown together — order needs to
// make sense across that whole mixed list, not just within one
// checkpoint's slice of it). Descriptions never have more than one
// assignment per entityId+timeId in practice, so scoping doesn't
// functionally matter for them, but they use the same key as
// notes/beats/scenes for consistency rather than a third rule.
function assignmentScopeKey(moduleType, entityId, timeId) {
  if (moduleType === 'topic') return `${entityId}`;
  return `${entityId}::${timeId || ''}`;
}

function siblingAssignments(campaign, scopeKey, excludeId) {
  return campaign.assignments.filter((a) => {
    if (a.id === excludeId) return false;
    const m = campaign.contentModules.find((mm) => mm.id === a.moduleId);
    return m && assignmentScopeKey(m.type, a.entityId, a.timeId) === scopeKey;
  });
}

function createAssignment(campaign, { moduleId, entityId, timeId = null }) {
  const module = campaign.contentModules.find((m) => m.id === moduleId);
  const scopeKey = assignmentScopeKey(module ? module.type : null, entityId, timeId);
  const siblings = siblingAssignments(campaign, scopeKey, null);
  const maxOrder = siblings.reduce((mx, a) => Math.max(mx, a.order || 0), -1);
  const assignment = {
    id: makeId('asg'),
    moduleId,
    entityId,
    timeId,
    order: maxOrder + 1,
    createdAt: new Date().toISOString()
  };
  campaign.assignments.push(assignment);
  return assignment;
}

// Swaps an assignment's order with its immediate neighbor within its
// scope (direction -1 = earlier, +1 = later) — same swap-with-neighbor
// mechanics as moveNote/moveTopic/moveBeat, just working off the shared
// assignment table and scope key instead of a type-specific one.
function moveAssignment(campaign, assignmentId, direction) {
  const assignment = campaign.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return false;
  const module = campaign.contentModules.find((m) => m.id === assignment.moduleId);
  if (!module) return false;
  const scopeKey = assignmentScopeKey(module.type, assignment.entityId, assignment.timeId);
  const siblings = siblingAssignments(campaign, scopeKey, null)
    .slice()
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  const idx = siblings.findIndex((a) => a.id === assignmentId);
  const swapWith = idx + direction;
  if (idx === -1 || swapWith < 0 || swapWith >= siblings.length) return false;
  const a = siblings[idx];
  const b = siblings[swapWith];
  const temp = a.order || 0;
  a.order = b.order || 0;
  b.order = temp;
  return true;
}

// Changing which checkpoint an assignment belongs to moves it into a
// different order-scope entirely (same as updateNoteTimeId/
// updateTopicTimeId did before) — it always lands at the end of its new
// group's order, same as a freshly created assignment would.
function updateAssignmentTimeId(campaign, assignmentId, newTimeId) {
  const assignment = campaign.assignments.find((a) => a.id === assignmentId);
  if (!assignment) return false;
  assignment.timeId = newTimeId || null;
  const module = campaign.contentModules.find((m) => m.id === assignment.moduleId);
  const scopeKey = assignmentScopeKey(module ? module.type : null, assignment.entityId, assignment.timeId);
  const siblings = siblingAssignments(campaign, scopeKey, assignmentId);
  const maxOrder = siblings.reduce((mx, a) => Math.max(mx, a.order || 0), -1);
  assignment.order = maxOrder + 1;
  return true;
}

// Removes one placement only — the module itself, and any other
// assignments of it elsewhere, are untouched. This is "unassign from
// here", not "delete the content".
function deleteAssignment(campaign, assignmentId) {
  campaign.assignments = campaign.assignments.filter((a) => a.id !== assignmentId);
}

// Assigns one module to many entities at once, all at the same
// time-scope (a checkpoint id, or null for "always available"/general).
// createAssignment itself doesn't guard against duplicates, and a bulk
// assign is exactly where one would slip in — someone selecting a whole
// filtered list that happens to include an entity already holding this
// content — so any entity that already has this exact module placed on
// it at this exact time-scope is skipped rather than duplicated. Returns
// which entities actually got a new assignment and which were skipped,
// so the caller can tell the person what happened.
function assignModuleToEntities(campaign, { moduleId, entityIds, timeId = null }) {
  const created = [];
  const skipped = [];
  const seen = new Set();
  entityIds.forEach((entityId) => {
    if (seen.has(entityId)) return; // the same entity listed twice in one call
    seen.add(entityId);
    const alreadyThere = campaign.assignments.some(
      (a) => a.moduleId === moduleId && a.entityId === entityId && (a.timeId || null) === (timeId || null)
    );
    if (alreadyThere) {
      skipped.push(entityId);
    } else {
      createAssignment(campaign, { moduleId, entityId, timeId });
      created.push(entityId);
    }
  });
  return { created, skipped };
}

// Removes the module and cascades to every assignment of it — an
// assignment pointing at a module that no longer exists would be
// dangling, broken data, so this always takes every placement down
// with it rather than leaving orphans behind.
function deleteContentModule(campaign, moduleId) {
  campaign.contentModules = campaign.contentModules.filter((m) => m.id !== moduleId);
  campaign.assignments = campaign.assignments.filter((a) => a.moduleId !== moduleId);
}

// The one shared completion flag — setting it here means every
// assignment of this module reads as complete, everywhere it's placed,
// since completion lives on the module rather than the assignment.
function setModuleComplete(campaign, moduleId, complete) {
  const module = campaign.contentModules.find((m) => m.id === moduleId);
  if (module) module.complete = !!complete;
}

// --- Empty campaign shell ----------------------------------------------

function emptyCampaign() {
  return {
    entities: {},
    checkpoints: [],
    blocks: [],
    entityGroups: [], // Create-mode-only organization; never read by query.js or Play mode
    // Modular Content — new content-module + assignment system (see the
    // functions above). Present from the start on every new campaign for
    // shape consistency, even though nothing reads from these yet; the
    // existing note/topic/beat/scene blocks above remain the live source
    // of truth for query.js/app.js until the read side is rewritten to
    // use these instead.
    contentModules: [],
    assignments: [],
    // DC Checks — referenced by a [[DCCHECK:id]] token from any text
    // field (not assigned to an entity the way Modular Content is; a
    // token can appear anywhere, and the same check can be referenced
    // from more than one place). See createDCCheck and friends below.
    dcChecks: [],
    // Content Graph layout (node positions only; the graph itself is derived).
    graph: { positions: {}, hidden: {}, roles: {} },
    // Conditions: named tests with a few states; text sections reference them
    // with [[IF:id:states]]...[[/IF]]. See src/conditions.js.
    conditions: [],
    meta: {
      nextColorIndex: 0, startBookmark: null, completedSinceStart: [], collapsedGroupIds: [],
      // Library filter state — persisted so it's still set the next time
      // the app opens, same as collapsedGroupIds. sort is one of
      // 'name'/'type'/'newest'.
      contentLibraryFilters: { search: '', type: '', entityId: '', unassignedOnly: false, sort: 'name' },
      // Which Library groups (an entity id, or '__unassigned__') are
      // currently collapsed — default empty, so every group starts
      // expanded. Persisted the same way collapsedGroupIds is.
      collapsedLibraryGroups: [],
      // Which entity groups (a group id, or '__ungrouped__') are collapsed
      // in the Content tab's "Present here" picker. Its own list rather
      // than collapsedGroupIds: that one belongs to the Entities tab, and
      // tidying a group away in one place shouldn't silently hide it in
      // the other. Default empty, so everything starts expanded.
      collapsedPresenceGroups: [],
      // The group last chosen for a newly created NPC / location, offered as
      // the default next time. See rememberEntityGroup.
      lastGroupByType: {},
      // The location last edited in the Content tab, reopened on next start.
      lastContentLocationId: null,
      lastContentTimeId: null,
      // Dialogue topics left open in Play (they start collapsed).
      openTopicIds: [],
      // Text field and caret the Content tab was left at: { locationId, timeId, id, index, selStart, selEnd, scrollTop }
      lastContentField: null
    }
  };
}

const api = {
  makeId,
  createEntity,
  createEntitiesBulk,
  setEntityImage,
  removeEntityImage,
  setEntityImageSize,
  resolveGroupDrop,
  canPlaceEntityGroup,
  placeEntityGroup,
  rememberEntityGroup,
  getRememberedGroup,
  isDraftEntity,
  createDraftEntity,
  commitDraftEntity,
  getDraftOwnedModuleIds,
  discardDraftEntity,
  normalizeInventoryLabel,
  createInventoryCategory,
  createInventoryRow,
  addInventoryColumn,
  deleteInventoryColumn,
  mergeInventoryTableIntoCategory,
  replaceInventoryCategoryFromTable,
  createInventoryCategoryFromTable,
  createEntityGroup,
  moveEntityGroup,
  deleteEntityGroup,
  reparentEntityGroup,
  assignEntitiesToGroup,
  createCheckpoint,
  moveCheckpoint,
  createArrivalBlock,
  createNoteBlock,
  moveNote,
  createTopicBlock,
  moveTopic,
  createSceneBlock,
  addBeat,
  moveBeat,
  addSceneLine,
  createDCCheck,
  deleteDCCheck,
  updateDCCheckField,
  addDCTableRow,
  updateDCTableRow,
  deleteDCTableRow,
  moveDCTableRow,
  addDCCondition,
  updateDCCondition,
  deleteDCCondition,
  moveDCCondition,
  appendDCRollLogEntry,
  clearDCRollLog,
  createContentModule,
  createAssignment,
  moveAssignment,
  updateAssignmentTimeId,
  deleteAssignment,
  assignModuleToEntities,
  deleteContentModule,
  setModuleComplete,
  emptyCampaign
};
if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
} else {
  window.DataModel = api;
}

})();
