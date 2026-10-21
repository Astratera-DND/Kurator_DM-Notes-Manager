// Manages multiple independent campaigns living side by side inside
// campaign-data/, on top of the existing per-directory storage.js
// functions (which don't need to change at all — they already just take
// a directory and don't care how many of them there are).
//
// Layout:
//   campaign-data/
//     index.json              [{ id, name, createdAt }, ...]
//     active.json             { activeId: "camp_xxx" }
//     .initialized            marker: true after the very first boot,
//                              so an empty list later (e.g. everything got
//                              deleted) is never mistaken for a fresh
//                              install and re-seeded with demo content
//     campaigns/
//       camp_xxx/
//         campaign.json
//         backups/...
//     deleted/
//       camp_xxx-<timestamp>/   soft-deleted campaigns land here, never
//                                truly destroyed by the app itself

const fs = require('fs');
const path = require('path');
const { makeId, emptyCampaign } = require('./dataModel');
const { buildSeedCampaign } = require('./seed');
const { writeCampaignSync } = require('./storage');

function paths(baseDir) {
  const root = path.join(baseDir, 'campaign-data');
  return {
    root,
    indexFile: path.join(root, 'index.json'),
    activeFile: path.join(root, 'active.json'),
    initMarker: path.join(root, '.initialized'),
    campaignsDir: path.join(root, 'campaigns'),
    deletedDir: path.join(root, 'deleted'),
    legacyFile: path.join(root, 'campaign.json'),
    legacyBackups: path.join(root, 'backups')
  };
}

function readJsonSafe(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function listCampaigns(baseDir) {
  const p = paths(baseDir);
  return readJsonSafe(p.indexFile, []);
}

function saveIndex(baseDir, index) {
  writeJson(paths(baseDir).indexFile, index);
}

function getActiveId(baseDir) {
  const p = paths(baseDir);
  return readJsonSafe(p.activeFile, { activeId: null }).activeId;
}

function setActive(baseDir, id) {
  writeJson(paths(baseDir).activeFile, { activeId: id });
}

function campaignDir(baseDir, id) {
  return path.join(paths(baseDir).campaignsDir, id);
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

function createCampaign(baseDir, name, { seed = false } = {}) {
  const p = paths(baseDir);
  const id = makeId('camp');
  const dir = campaignDir(baseDir, id);
  fs.mkdirSync(dir, { recursive: true });
  writeCampaignSync(dir, seed ? buildSeedCampaign() : emptyCampaign());

  const index = listCampaigns(baseDir);
  const entry = { id, name: name || 'New campaign', createdAt: new Date().toISOString() };
  index.push(entry);
  saveIndex(baseDir, index);
  setActive(baseDir, id);
  return entry;
}

function renameCampaign(baseDir, id, name) {
  const index = listCampaigns(baseDir);
  const entry = index.find((c) => c.id === id);
  if (entry && name && name.trim()) entry.name = name.trim();
  saveIndex(baseDir, index);
  return entry || null;
}

// Soft delete: move the campaign's folder out of campaigns/ into deleted/
// rather than removing it. The app itself never permanently destroys a
// campaign — if one needs to be truly removed, that's a manual step
// outside the app, on purpose.
function deleteCampaign(baseDir, id) {
  const p = paths(baseDir);
  const index = listCampaigns(baseDir).filter((c) => c.id !== id);
  saveIndex(baseDir, index);

  const src = campaignDir(baseDir, id);
  if (fs.existsSync(src)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(p.deletedDir, `${id}-${stamp}`);
    fs.mkdirSync(p.deletedDir, { recursive: true });
    fs.renameSync(src, dest);
  }

  if (getActiveId(baseDir) === id) {
    setActive(baseDir, index[0] ? index[0].id : null);
  }
  return index;
}

// One-time migration from the old single-campaign.json layout (no index,
// no campaigns/ folder) into the multi-campaign layout, preserving
// whatever the person already had — including its backup history.
function migrateLegacyIfNeeded(baseDir) {
  const p = paths(baseDir);
  if (!fs.existsSync(p.legacyFile)) return null;

  const id = makeId('camp');
  const dir = campaignDir(baseDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(p.legacyFile, path.join(dir, 'campaign.json'));
  if (fs.existsSync(p.legacyBackups)) {
    copyDirRecursive(p.legacyBackups, path.join(dir, 'backups'));
  }

  const entry = { id, name: 'My campaign', createdAt: new Date().toISOString() };
  saveIndex(baseDir, [entry]);
  setActive(baseDir, id);

  // Move the old file aside rather than delete it outright — same
  // never-destroy-on-our-own-initiative principle as soft delete above.
  fs.renameSync(p.legacyFile, path.join(p.root, 'campaign.pre-multi-campaign-backup.json'));
  if (fs.existsSync(p.legacyBackups)) {
    fs.renameSync(p.legacyBackups, path.join(p.root, 'backups.pre-multi-campaign-backup'));
  }
  return entry;
}

// The single entry point main.js calls at startup. Guarantees a valid
// active campaign exists and returns where to load it from, handling
// migration, first-run seeding, and the "every campaign got deleted"
// edge case (recreated empty, not re-seeded with demo content).
function ensureActiveCampaign(baseDir) {
  const p = paths(baseDir);
  fs.mkdirSync(p.campaignsDir, { recursive: true });

  const isFreshInstall = !fs.existsSync(p.initMarker) && !fs.existsSync(p.indexFile);

  if (isFreshInstall) {
    const migrated = migrateLegacyIfNeeded(baseDir);
    if (!migrated) {
      createCampaign(baseDir, 'My campaign', { seed: true });
    }
  }
  writeJson(p.initMarker, { initialized: true });

  let list = listCampaigns(baseDir);
  let activeId = getActiveId(baseDir);

  if (list.length === 0) {
    // Not a fresh install (that's handled above) — this means every
    // campaign was deleted. Recreate an empty one rather than reseed.
    const entry = createCampaign(baseDir, 'New campaign', { seed: false });
    activeId = entry.id;
    list = listCampaigns(baseDir);
  } else if (!activeId || !list.find((c) => c.id === activeId)) {
    activeId = list[0].id;
    setActive(baseDir, activeId);
  }

  return { id: activeId, dir: campaignDir(baseDir, activeId), list };
}

module.exports = {
  listCampaigns,
  getActiveId,
  setActive,
  campaignDir,
  createCampaign,
  renameCampaign,
  deleteCampaign,
  ensureActiveCampaign
};
