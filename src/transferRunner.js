// Disk side of "transfer to other campaign": loads each target campaign,
// backs it up, applies the transfer (src/transfer.js), copies image files and
// writes it back. One target failing never affects the others.
const fs = require('fs');
const path = require('path');
const storage = require('./storage');
const campaignManager = require('./campaignManager');
const entityImages = require('./entityImages');
const Transfer = require('./transfer');

function listTargets(baseDir, activeId) {
  return campaignManager.listCampaigns(baseDir)
    .filter((c) => c.id !== activeId)
    .map((c) => {
      let counts = { npcs: 0, locations: 0 };
      try {
        const loaded = storage.loadCampaign(campaignManager.campaignDir(baseDir, c.id));
        Object.values(loaded.entities || {}).forEach((e) => { if (e.type === 'location') counts.locations++; else counts.npcs++; });
      } catch { counts = null; }
      return { id: c.id, name: c.name, counts };
    });
}

// Names that already exist in each target, so the preview can warn about duplicates.
function previewTargets(baseDir, source, targetIds, entries) {
  const names = entries.map((e) => source.entities[e.id]).filter(Boolean).map((e) => ({ name: e.name, type: e.type }));
  return targetIds.map((id) => {
    try {
      const t = storage.loadCampaign(campaignManager.campaignDir(baseDir, id));
      const have = new Set(Object.values(t.entities || {}).map((e) => `${e.type}:${String(e.name).trim().toLowerCase()}`));
      return { id, duplicates: names.filter((n) => have.has(`${n.type}:${n.name.trim().toLowerCase()}`)).map((n) => n.name) };
    } catch (err) {
      return { id, error: err.message, duplicates: [] };
    }
  });
}

function runTransfer(baseDir, source, sourceDir, targetIds, entries) {
  const results = [];
  targetIds.forEach((id) => {
    const entry = campaignManager.listCampaigns(baseDir).find((c) => c.id === id);
    const res = { id, name: entry ? entry.name : id, ok: false };
    try {
      if (!entry) throw new Error('Campaign not found');
      const dir = campaignManager.campaignDir(baseDir, id);
      const target = storage.loadCampaign(dir);
      storage.createBackup(dir); // safety net before anything is written
      const report = Transfer.applyTransfer(source, target, entries);
      const missingImages = [];
      report.imageCopies.forEach((c) => {
        const from = path.join(entityImages.imagesDir(sourceDir), c.from);
        try {
          entityImages.ensureImagesDir(dir);
          fs.copyFileSync(from, path.join(entityImages.imagesDir(dir), c.to));
        } catch {
          missingImages.push(c.entityId);
          if (target.entities[c.entityId]) target.entities[c.entityId].image = null;
        }
      });
      if (missingImages.length) report.warnings.push(`${missingImages.length} image file${missingImages.length === 1 ? ' was' : 's were'} missing and left out.`);
      storage.writeCampaignSync(dir, target);
      res.ok = true;
      res.report = report;
    } catch (err) {
      res.error = err.message;
    }
    results.push(res);
  });
  return results;
}

module.exports = { listTargets, previewTargets, runTransfer };
