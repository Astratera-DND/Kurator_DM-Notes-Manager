const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  imagesDir, ensureImagesDir, imagesBaseFileUrl, removeExistingImagesForEntity,
  saveEntityImage, removeEntityImageFile, ALLOWED_EXTENSIONS
} = require('../src/entityImages');

function ok(msg) { console.log('ok  -', msg); }

function tempCampaignDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'entity-images-test-'));
}

// --- Test 1: saveEntityImage copies the file with the right name ----------
{
  const campaignDir = tempCampaignDir();
  const sourceFile = path.join(campaignDir, 'source.png');
  fs.writeFileSync(sourceFile, 'fake-png-bytes');

  const filename = saveEntityImage(campaignDir, 'npc_abc123', sourceFile);
  assert.strictEqual(filename, 'npc_abc123.png');
  const savedPath = path.join(imagesDir(campaignDir), filename);
  assert.ok(fs.existsSync(savedPath), 'the image should actually be copied into the images folder');
  assert.strictEqual(fs.readFileSync(savedPath, 'utf8'), 'fake-png-bytes', 'the copied file\'s content should match the source exactly');

  ok('saveEntityImage copies the source file into <entityId>.<ext> inside the campaign\'s images folder');
}

// --- Test 2: the images folder is created automatically -------------------
{
  const campaignDir = tempCampaignDir();
  assert.ok(!fs.existsSync(imagesDir(campaignDir)), 'the images folder should not exist yet');
  const sourceFile = path.join(campaignDir, 'source.jpg');
  fs.writeFileSync(sourceFile, 'x');
  saveEntityImage(campaignDir, 'loc_1', sourceFile);
  assert.ok(fs.existsSync(imagesDir(campaignDir)), 'saving an image should create the images folder if it does not exist yet');

  ok('the images folder is created automatically on first save, not required to pre-exist');
}

// --- Test 3: replacing an image cleans up the old file, even with a -------
// different extension -- this is the actual point of
// removeExistingImagesForEntity: without it, switching from a .png to a
// .jpg for the same entity would leave the old .png behind forever as an
// orphan nothing references anymore.
{
  const campaignDir = tempCampaignDir();
  const png = path.join(campaignDir, 'a.png');
  const jpg = path.join(campaignDir, 'b.jpg');
  fs.writeFileSync(png, 'png-bytes');
  fs.writeFileSync(jpg, 'jpg-bytes');

  saveEntityImage(campaignDir, 'npc_x', png);
  assert.ok(fs.existsSync(path.join(imagesDir(campaignDir), 'npc_x.png')));

  const newFilename = saveEntityImage(campaignDir, 'npc_x', jpg);
  assert.strictEqual(newFilename, 'npc_x.jpg');
  assert.ok(!fs.existsSync(path.join(imagesDir(campaignDir), 'npc_x.png')), 'the old .png must be removed once replaced with a .jpg');
  assert.ok(fs.existsSync(path.join(imagesDir(campaignDir), 'npc_x.jpg')), 'the new .jpg should exist');

  ok('replacing an entity\'s image removes the previous file even when the extension changes, leaving no orphan behind');
}

// --- Test 4: replacing an image doesn't affect a different entity's image -
{
  const campaignDir = tempCampaignDir();
  const src = path.join(campaignDir, 'src.png');
  fs.writeFileSync(src, 'x');
  saveEntityImage(campaignDir, 'npc_a', src);
  saveEntityImage(campaignDir, 'npc_b', src);
  saveEntityImage(campaignDir, 'npc_a', src); // replace npc_a again

  assert.ok(fs.existsSync(path.join(imagesDir(campaignDir), 'npc_a.png')));
  assert.ok(fs.existsSync(path.join(imagesDir(campaignDir), 'npc_b.png')), 'a different entity\'s image must survive untouched');

  ok('replacing one entity\'s image never touches a different entity\'s image, even sharing the same folder');
}

// --- Test 5: unsupported file types are rejected ---------------------------
{
  const campaignDir = tempCampaignDir();
  const badFile = path.join(campaignDir, 'notes.txt');
  fs.writeFileSync(badFile, 'not an image');

  assert.throws(() => saveEntityImage(campaignDir, 'npc_x', badFile), /Unsupported image type/);
  ok('an unsupported file extension is rejected with a clear error rather than silently copied');
}

// --- Test 6: every allowed extension actually works ------------------------
{
  const campaignDir = tempCampaignDir();
  ALLOWED_EXTENSIONS.forEach((ext, i) => {
    const src = path.join(campaignDir, `img${i}${ext}`);
    fs.writeFileSync(src, 'x');
    const filename = saveEntityImage(campaignDir, `npc_${i}`, src);
    assert.strictEqual(filename, `npc_${i}${ext}`);
  });
  ok('every documented allowed extension (' + ALLOWED_EXTENSIONS.join(', ') + ') is accepted');
}

// --- Test 7: removeEntityImageFile deletes the file, safely no-ops if -----
// it's already gone
{
  const campaignDir = tempCampaignDir();
  const src = path.join(campaignDir, 'a.png');
  fs.writeFileSync(src, 'x');
  saveEntityImage(campaignDir, 'npc_x', src);
  assert.ok(fs.existsSync(path.join(imagesDir(campaignDir), 'npc_x.png')));

  removeEntityImageFile(campaignDir, 'npc_x.png');
  assert.ok(!fs.existsSync(path.join(imagesDir(campaignDir), 'npc_x.png')), 'the file should be removed');

  // Calling it again (or with a filename that never existed) must not throw.
  assert.doesNotThrow(() => removeEntityImageFile(campaignDir, 'npc_x.png'));
  assert.doesNotThrow(() => removeEntityImageFile(campaignDir, 'never_existed.png'));
  assert.doesNotThrow(() => removeEntityImageFile(campaignDir, null));

  ok('removeEntityImageFile deletes the file and is a safe no-op if it\'s already gone or never existed');
}

// --- Test 8: imagesBaseFileUrl produces a correctly-escaped file:// URL ----
{
  const campaignDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entity images with spaces-'));
  const url = imagesBaseFileUrl(campaignDir);
  assert.ok(url.startsWith('file://'), 'should produce a file:// URL');
  assert.ok(!url.includes(' '), 'spaces in the path must be percent-escaped, not left raw (a raw space would break the URL)');

  ok('imagesBaseFileUrl produces a properly escaped file:// URL even when the campaign path contains spaces');
}

// --- Test 9: ensureImagesDir is idempotent ---------------------------------
{
  const campaignDir = tempCampaignDir();
  ensureImagesDir(campaignDir);
  assert.doesNotThrow(() => ensureImagesDir(campaignDir), 'calling it again once the folder already exists must not throw');
  ok('ensureImagesDir is safe to call repeatedly');
}

// --- Test 10: dataModel.setEntityImage / removeEntityImage / -------------
// setEntityImageSize
{
  const dataModel = require('../src/dataModel');
  const c = dataModel.emptyCampaign();
  const npc = dataModel.createEntity(c, { type: 'npc', name: 'Guard' });
  assert.strictEqual(npc.image, null, 'a freshly created entity should have no image by default');

  dataModel.setEntityImage(c, npc.id, 'npc_x.png');
  assert.strictEqual(npc.image.filename, 'npc_x.png');
  assert.strictEqual(npc.image.size, 'medium', 'a first-time image defaults to medium size');
  assert.ok(npc.image.updatedAt, 'a version stamp should be set on first upload too');

  dataModel.setEntityImageSize(c, npc.id, 'large');
  assert.strictEqual(npc.image.size, 'large');

  // Replacing the image (e.g. re-uploading) must preserve the size
  // choice already made, not silently reset it back to medium.
  dataModel.setEntityImage(c, npc.id, 'npc_x.jpg');
  assert.strictEqual(npc.image.filename, 'npc_x.jpg');
  assert.strictEqual(npc.image.size, 'large', 'replacing the image should preserve the previously chosen size');

  dataModel.removeEntityImage(c, npc.id);
  assert.strictEqual(npc.image, null, 'removing the image should clear it back to null');

  ok('setEntityImage/removeEntityImage/setEntityImageSize behave correctly, including preserving size choice across a replacement');
}

// --- Test 10b: replacing an image changes its version stamp --------------
// This is the actual fix for the reported bug: the filename is always
// <entityId>.jpg regardless of how many times it's replaced, so without a
// changing version stamp to build a cache-busting URL from, the browser's
// own image cache would keep showing the old file's bytes forever.
{
  const dataModel = require('../src/dataModel');
  const c = dataModel.emptyCampaign();
  const npc = dataModel.createEntity(c, { type: 'npc', name: 'Guard' });

  dataModel.setEntityImage(c, npc.id, 'npc_x.png');
  const firstStamp = npc.image.updatedAt;
  assert.ok(firstStamp, 'the first upload must produce a version stamp');

  // A short real delay guarantees a different millisecond, rather than
  // relying on two calls never coinciding by chance.
  const until = Date.now() + 2;
  while (Date.now() < until) { /* busy-wait a couple of milliseconds */ }

  dataModel.setEntityImage(c, npc.id, 'npc_x.png'); // a real re-upload keeps the same filename
  const secondStamp = npc.image.updatedAt;

  assert.ok(secondStamp, 'the replacement must produce a version stamp too');
  assert.notStrictEqual(firstStamp, secondStamp, 'the version stamp must change on replace, even when the filename itself does not');

  ok('replacing an entity\'s image changes its version stamp, which is what lets the display URL bust the browser\'s image cache');
}

// --- Test 11: normalizeCampaign backfills entity.image for old data -------
{
  const storage = require('../src/storage');
  const dataModel = require('../src/dataModel');
  const c = dataModel.emptyCampaign();
  const npc = dataModel.createEntity(c, { type: 'npc', name: 'Old NPC' });
  delete npc.image; // simulate data saved before this field existed

  storage.normalizeCampaign(c);
  assert.strictEqual(npc.image, null, 'an entity missing the image field entirely should be backfilled to null, not left undefined');

  ok('normalizeCampaign backfills entity.image to null for entities saved before this feature existed');
}

// --- Test 10: saveCroppedEntityImage writes a base64 JPEG data URL to ----
// disk as <entityId>.jpg
{
  const { saveCroppedEntityImage } = require('../src/entityImages');
  const campaignDir = tempCampaignDir();
  const fakeJpegBytes = Buffer.from('pretend-jpeg-bytes');
  const dataUrl = `data:image/jpeg;base64,${fakeJpegBytes.toString('base64')}`;

  const filename = saveCroppedEntityImage(campaignDir, 'npc_cropped', dataUrl);
  assert.strictEqual(filename, 'npc_cropped.jpg', 'output is always .jpg regardless of what the original source file was');
  const savedPath = path.join(imagesDir(campaignDir), filename);
  assert.ok(fs.existsSync(savedPath));
  assert.ok(fs.readFileSync(savedPath).equals(fakeJpegBytes), 'the decoded bytes should exactly match what was base64-encoded');

  ok('saveCroppedEntityImage decodes a base64 JPEG data URL and writes it to disk as <entityId>.jpg');
}

// --- Test 11: saveCroppedEntityImage replaces an existing image, --------
// including one with a different extension from a direct (non-cropped) upload
{
  const { saveCroppedEntityImage } = require('../src/entityImages');
  const campaignDir = tempCampaignDir();
  const src = path.join(campaignDir, 'a.png');
  fs.writeFileSync(src, 'x');
  saveEntityImage(campaignDir, 'npc_x', src); // old-style direct copy, produces npc_x.png
  assert.ok(fs.existsSync(path.join(imagesDir(campaignDir), 'npc_x.png')));

  const dataUrl = `data:image/jpeg;base64,${Buffer.from('cropped').toString('base64')}`;
  saveCroppedEntityImage(campaignDir, 'npc_x', dataUrl);
  assert.ok(!fs.existsSync(path.join(imagesDir(campaignDir), 'npc_x.png')), 'the old .png from a direct upload should be cleaned up when replaced via the crop tool');
  assert.ok(fs.existsSync(path.join(imagesDir(campaignDir), 'npc_x.jpg')));

  ok('saveCroppedEntityImage cleans up a previous image even when it came from the older direct-copy path with a different extension');
}

// --- Test 12: saveCroppedEntityImage rejects a malformed data URL --------
{
  const { saveCroppedEntityImage } = require('../src/entityImages');
  const campaignDir = tempCampaignDir();
  assert.throws(() => saveCroppedEntityImage(campaignDir, 'npc_x', 'not-a-data-url'), /Expected a base64-encoded JPEG data URL/);
  assert.throws(() => saveCroppedEntityImage(campaignDir, 'npc_x', 'data:image/png;base64,abc'), /Expected a base64-encoded JPEG data URL/, 'a non-JPEG data URL should also be rejected, since the crop tool always outputs JPEG');

  ok('saveCroppedEntityImage rejects anything that isn\'t a well-formed base64 JPEG data URL');
}

console.log('\nAll entity image tests passed.');
