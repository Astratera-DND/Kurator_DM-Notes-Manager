// Entity image file handling — one small image per entity, stored as a
// plain file on disk next to that campaign's own campaign.json, never
// embedded in campaign.json itself. That's the whole point: campaign.json
// gets autosaved on nearly every edit, plus periodic backup snapshots: if
// images lived in there as base64 text, every unrelated text edit would
// mean re-serializing and rewriting every image blob in the campaign.
// Kept as a plain, fully-testable module (no Electron APIs) so the actual
// file logic has real test coverage — main.js's ipcMain handlers are thin
// wrappers around these functions, matching how storage.js/
// campaignManager.js are already used from main.js.
//
// Layout: campaign-data/campaigns/camp_xxx/images/<entityId>.<ext>

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

function imagesDir(campaignDir) {
  return path.join(campaignDir, 'images');
}

function ensureImagesDir(campaignDir) {
  const dir = imagesDir(campaignDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// A proper file:// URL for the campaign's images folder, correctly
// escaped for whatever the OS's own path conventions are (spaces,
// non-ASCII characters, a Windows drive letter, all handled by Node's
// own pathToFileURL rather than hand-rolled string concatenation, which
// is exactly the kind of thing that looks fine on one OS and breaks on
// another). The renderer appends "/<filename>" to this directly.
function imagesBaseFileUrl(campaignDir) {
  return pathToFileURL(imagesDir(campaignDir)).href;
}

// Removes every existing image file for this entity, regardless of
// extension — otherwise replacing a .png with a .jpg would leave the
// old .png behind forever as an orphan nothing ever references again.
function removeExistingImagesForEntity(campaignDir, entityId) {
  const dir = imagesDir(campaignDir);
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach((name) => {
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    if (base === entityId) fs.unlinkSync(path.join(dir, name));
  });
}

// Copies sourceFilePath into the campaign's images folder as
// "<entityId><ext>", replacing any previous image for this entity.
// Returns the new filename (just the name, not a full path — that's
// what gets stored on the entity; the full path/URL is only ever
// resolved from campaignDir + filename when actually needed).
function saveEntityImage(campaignDir, entityId, sourceFilePath) {
  const ext = path.extname(sourceFilePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(`Unsupported image type "${ext}" — expected one of: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }
  ensureImagesDir(campaignDir);
  removeExistingImagesForEntity(campaignDir, entityId);
  const filename = `${entityId}${ext}`;
  fs.copyFileSync(sourceFilePath, path.join(imagesDir(campaignDir), filename));
  return filename;
}

// Writes the crop tool's output straight to disk as <entityId>.jpg,
// always JPEG regardless of what format the user originally picked —
// the crop tool re-encodes on its own canvas, so the source format
// never survives past that point anyway. dataUrl is a base64 data URL
// (image/jpeg) produced by canvas.toDataURL on the renderer side.
function saveCroppedEntityImage(campaignDir, entityId, dataUrl) {
  const match = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Expected a base64-encoded JPEG data URL from the crop canvas');
  ensureImagesDir(campaignDir);
  removeExistingImagesForEntity(campaignDir, entityId);
  const filename = `${entityId}.jpg`;
  fs.writeFileSync(path.join(imagesDir(campaignDir), filename), Buffer.from(match[1], 'base64'));
  return filename;
}

// Safe no-op if the file doesn't exist (e.g. it was already removed, or
// the campaign moved since) -- removing an entity's image reference
// should never fail just because the file itself is already gone.
function removeEntityImageFile(campaignDir, filename) {
  if (!filename) return;
  const filePath = path.join(imagesDir(campaignDir), filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

module.exports = {
  ALLOWED_EXTENSIONS,
  imagesDir,
  ensureImagesDir,
  imagesBaseFileUrl,
  removeExistingImagesForEntity,
  saveEntityImage,
  saveCroppedEntityImage,
  removeEntityImageFile
};
