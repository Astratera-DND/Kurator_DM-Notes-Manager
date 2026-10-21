// Quests: a tag any content block can carry. A quest is an entity of type 'quest'
// (so it lives in the Entities list); a content block that belongs to it stores
//   module.questId     the quest entity's id
//   module.questIndex  its place inside the quest: 1, 2, 3 …
// Tagging a block puts it on top (highest index). Moving a block, or removing
// it, always renumbers the rest to 1..n with no gaps. Nothing else is stored:
// the quest lane in the graph and the quest page are derived from these two fields.
(function () {

function isQuest(e) { return !!e && e.type === 'quest'; }
function questList(campaign) { return Object.values(campaign.entities || {}).filter(isQuest).sort((a, b) => a.name.localeCompare(b.name)); }
function moduleById(campaign, id) { return (campaign.contentModules || []).find((m) => m.id === id) || null; }

// Blocks of a quest, lowest index first (ties keep list order; unnumbered go last).
function itemsOf(campaign, questId) {
  return (campaign.contentModules || [])
    .map((m, i) => ({ m, i }))
    .filter((x) => x.m.questId === questId)
    .sort((a, b) => ((a.m.questIndex || 1e9) - (b.m.questIndex || 1e9)) || (a.i - b.i))
    .map((x) => x.m);
}

function renumber(campaign, questId) {
  itemsOf(campaign, questId).forEach((m, i) => { m.questIndex = i + 1; });
}

// Tag a block as part of a quest. It goes on top (highest index). Re-tagging with the same quest changes nothing.
function assign(campaign, moduleId, questId) {
  const m = moduleById(campaign, moduleId);
  const q = campaign.entities && campaign.entities[questId];
  if (!m || !isQuest(q)) return null;
  if (m.questId === questId && m.questIndex) return m.questIndex;
  const old = m.questId;
  delete m.questId; delete m.questIndex;
  if (old) renumber(campaign, old);
  m.questId = questId;
  m.questIndex = itemsOf(campaign, questId).filter((x) => x.id !== m.id).length + 1;
  renumber(campaign, questId);
  return m.questIndex;
}

function unassign(campaign, moduleId) {
  const m = moduleById(campaign, moduleId);
  if (!m || !m.questId) return;
  const old = m.questId;
  delete m.questId; delete m.questIndex;
  renumber(campaign, old);
}

// Put a block at position `index` (1-based, clamped) inside its quest.
function moveTo(campaign, moduleId, index) {
  const m = moduleById(campaign, moduleId);
  if (!m || !m.questId) return;
  const items = itemsOf(campaign, m.questId).filter((x) => x.id !== m.id);
  const at = Math.max(0, Math.min(items.length, Math.round(Number(index) || 1) - 1));
  items.splice(at, 0, m);
  items.forEach((x, i) => { x.questIndex = i + 1; });
}

function step(campaign, moduleId, delta) {
  const m = moduleById(campaign, moduleId);
  if (m && m.questId) moveTo(campaign, moduleId, (m.questIndex || 1) + delta);
}

// Drag and drop: place `moduleId` before `beforeId` (null = last).
function moveBefore(campaign, moduleId, beforeId) {
  const m = moduleById(campaign, moduleId);
  if (!m || !m.questId) return;
  const items = itemsOf(campaign, m.questId).filter((x) => x.id !== m.id);
  const at = beforeId ? items.findIndex((x) => x.id === beforeId) : -1;
  items.splice(at < 0 ? items.length : at, 0, m);
  items.forEach((x, i) => { x.questIndex = i + 1; });
}

// Repairs: tags pointing at a missing quest are dropped; every quest is numbered 1..n.
function sanitize(campaign) {
  (campaign.contentModules || []).forEach((m) => {
    if (m.questId && !isQuest((campaign.entities || {})[m.questId])) { delete m.questId; delete m.questIndex; }
    else if (!m.questId && 'questIndex' in m) delete m.questIndex;
    else if (m.questId && !Number.isFinite(Number(m.questIndex))) m.questIndex = 0;
  });
  const ids = new Set((campaign.contentModules || []).filter((m) => m.questId).map((m) => m.questId));
  ids.forEach((id) => renumber(campaign, id));
}

// When a quest entity is deleted its blocks lose the tag (they stay otherwise untouched).
function releaseQuest(campaign, questId) {
  (campaign.contentModules || []).forEach((m) => { if (m.questId === questId) { delete m.questId; delete m.questIndex; } });
}

const api = { isQuest, questList, itemsOf, assign, unassign, moveTo, step, moveBefore, sanitize, releaseQuest, renumber };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else window.Quests = api;
})();
