// Regenerates examples/campaign-data/ — the example campaign that ships with every
// release. It is exactly what a fresh install seeds on first launch (src/seed.js),
// written out as plain files so it can be browsed on GitHub and dropped in by hand.
const fs = require('fs');
const path = require('path');
const campaignManager = require('../src/campaignManager');

const examplesDir = path.join(__dirname, '..', 'examples');
fs.rmSync(path.join(examplesDir, 'campaign-data'), { recursive: true, force: true });
fs.mkdirSync(examplesDir, { recursive: true });
campaignManager.ensureActiveCampaign(examplesDir);
// Backups are created by the app while running; the example doesn't need any.
const campaignsDir = path.join(examplesDir, 'campaign-data', 'campaigns');
for (const id of fs.readdirSync(campaignsDir)) fs.rmSync(path.join(campaignsDir, id, 'backups'), { recursive: true, force: true });
console.log('[make-example] wrote', path.join(examplesDir, 'campaign-data'));
