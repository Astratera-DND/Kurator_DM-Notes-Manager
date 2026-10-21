const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSettings, saveSettings, settingsFile, usableDirectory, rememberLastImageDirectory, DEFAULT_NOTION_EXE_PATH } = require('../src/settings');

function ok(msg) { console.log('ok  -', msg); }
function freshDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'settings-test-')); }

// --- Test 1: first load creates the file with sensible defaults -----------
{
  const base = freshDir();
  const settings = loadSettings(base);
  assert.strictEqual(settings.notionExePath, DEFAULT_NOTION_EXE_PATH);
  assert.strictEqual(settings.directorPrepRootPath, '', 'Director prep root should default to empty, not undefined');
  assert.strictEqual(settings.directorAppFolderPath, '', 'Director app folder should default to empty, not undefined');
  assert.ok(fs.existsSync(settingsFile(base)), 'settings.json should be written on first load');
  ok('first load creates settings.json with defaults for every known setting, Director-tool fields included');
}

// --- Test 2: an existing file's values are honored, not overwritten -------
{
  const base = freshDir();
  fs.writeFileSync(settingsFile(base), JSON.stringify({
    notionExePath: 'D:\\Custom\\Notion.exe',
    directorPrepRootPath: 'D:\\DnD\\SessionPrep',
    directorAppFolderPath: 'D:\\DnD\\Director'
  }), 'utf8');
  const settings = loadSettings(base);
  assert.strictEqual(settings.notionExePath, 'D:\\Custom\\Notion.exe', 'a hand-edited path should be respected, not reset to the default');
  assert.strictEqual(settings.directorPrepRootPath, 'D:\\DnD\\SessionPrep');
  assert.strictEqual(settings.directorAppFolderPath, 'D:\\DnD\\Director');
  ok('an existing settings.json is loaded as-is, hand-edits are respected');
}

// --- Test 3: a corrupt file falls back to defaults instead of crashing ----
{
  const base = freshDir();
  fs.writeFileSync(settingsFile(base), '{ not valid json', 'utf8');
  const settings = loadSettings(base);
  assert.strictEqual(settings.notionExePath, DEFAULT_NOTION_EXE_PATH);
  assert.strictEqual(settings.directorPrepRootPath, '');
  ok('a corrupt settings.json falls back to defaults instead of crashing the app');
}

// --- Test 4: a settings.json saved before the Director fields existed -----
// This is the one that matters most: a real settings.json from before this
// feature, with only notionExePath in it, must load with the new fields
// backfilled to empty strings rather than ending up undefined (which every
// read site would then need to defensively guard against) — and the
// pre-existing value must survive completely unchanged.
{
  const base = freshDir();
  fs.writeFileSync(settingsFile(base), JSON.stringify({ notionExePath: 'C:\\OldPath\\Notion.exe' }), 'utf8');
  const settings = loadSettings(base);
  assert.strictEqual(settings.notionExePath, 'C:\\OldPath\\Notion.exe', 'the pre-existing value must be completely unchanged');
  assert.strictEqual(settings.directorPrepRootPath, '', 'a field added after this file was first written should backfill to empty, not undefined');
  assert.strictEqual(settings.directorAppFolderPath, '', 'same for the second new field');
  ok('a settings.json from before the Director-tool fields existed backfills them without disturbing existing values');
}

// --- Test 5: saveSettings round-trips correctly through a reload ----------
{
  const base = freshDir();
  loadSettings(base); // creates the file with defaults first
  saveSettings(base, {
    notionExePath: DEFAULT_NOTION_EXE_PATH,
    directorPrepRootPath: 'E:\\Prep',
    directorAppFolderPath: 'E:\\Director'
  });
  const reloaded = loadSettings(base);
  assert.strictEqual(reloaded.directorPrepRootPath, 'E:\\Prep');
  assert.strictEqual(reloaded.directorAppFolderPath, 'E:\\Director');
  ok('saveSettings round-trips correctly through a reload');
}

// --- Test 6: the remembered image folder defaults to empty, and a --------
// settings.json from before it existed gets it backfilled
{
  const base = freshDir();
  assert.strictEqual(loadSettings(base).lastImageDirectory, '', 'nothing remembered yet on a fresh install');

  const old = freshDir();
  fs.writeFileSync(settingsFile(old), JSON.stringify({ notionExePath: 'D:\\Notion.exe', directorPrepRootPath: 'D:\\Prep', directorAppFolderPath: 'D:\\Dir' }), 'utf8');
  const loaded = loadSettings(old);
  assert.strictEqual(loaded.lastImageDirectory, '', 'an older settings.json gains the field without losing anything else');
  assert.strictEqual(loaded.notionExePath, 'D:\\Notion.exe');
  ok('lastImageDirectory defaults to empty and is backfilled into an older settings.json');
}

// --- Test 7: usableDirectory only accepts a folder that really exists ----
{
  const dir = freshDir();
  const file = path.join(dir, 'pic.png');
  fs.writeFileSync(file, 'x');
  assert.strictEqual(usableDirectory(dir), dir, 'an existing folder is used as given');
  assert.strictEqual(usableDirectory(path.join(dir, 'gone')), undefined, 'a folder that no longer exists falls back to the OS default');
  assert.strictEqual(usableDirectory(file), undefined, 'a path that is a file, not a folder, is not a usable starting folder');
  assert.strictEqual(usableDirectory(''), undefined);
  assert.strictEqual(usableDirectory('   '), undefined);
  assert.strictEqual(usableDirectory(undefined), undefined);
  assert.strictEqual(usableDirectory(null), undefined);
  assert.strictEqual(usableDirectory(42), undefined, 'a non-string (hand-edited settings) never throws');
  ok('a remembered folder is only used if it still exists and is a folder; anything else quietly falls back to the OS default');
}

// --- Test 8: picking a file remembers its folder, persistently -----------
{
  const base = freshDir();
  const images = freshDir();
  const second = freshDir();
  let settings = loadSettings(base);
  const notionBefore = settings.notionExePath;

  settings = rememberLastImageDirectory(base, settings, path.join(images, 'orc.png'));
  assert.strictEqual(settings.lastImageDirectory, images, 'the folder of the picked file is remembered, not the file itself');
  assert.strictEqual(loadSettings(base).lastImageDirectory, images, 'and survives an app restart (it was written to settings.json)');
  assert.strictEqual(settings.notionExePath, notionBefore, 'every other setting is left exactly as it was');

  const again = rememberLastImageDirectory(base, settings, path.join(images, 'elf.png'));
  assert.strictEqual(again, settings, 'picking another file from the same folder changes nothing and does not rewrite the file');

  settings = rememberLastImageDirectory(base, settings, path.join(second, 'dwarf.png'));
  assert.strictEqual(loadSettings(base).lastImageDirectory, second, 'picking from a different folder moves the memory there');

  fs.rmSync(second, { recursive: true });
  assert.strictEqual(usableDirectory(loadSettings(base).lastImageDirectory), undefined, 'if that folder is later deleted, the next dialog just uses the OS default');
  ok('the folder of each picked image is remembered across restarts, other settings are untouched, and a since-deleted folder is ignored');
}

// --- Test 9: failing to WRITE the setting never gets in the way ----------
{
  const missingBase = path.join(freshDir(), 'does', 'not', 'exist');
  const settings = { notionExePath: 'x', lastImageDirectory: '' };
  let result;
  assert.doesNotThrow(() => { result = rememberLastImageDirectory(missingBase, settings, path.join('C:', 'imgs', 'a.png')); }, 'an unwritable settings.json must not break picking an image');
  assert.strictEqual(result.lastImageDirectory, path.join('C:', 'imgs'), 'the folder is still remembered for this session');
  ok('if settings.json cannot be written, picking an image still works and the folder is remembered for the session');
}

console.log('\nAll settings tests passed.');
