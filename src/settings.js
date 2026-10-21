// Machine-level app settings — separate from campaign-data/, since these
// apply across every campaign rather than belonging to one of them.
// The path to the local Notion.exe (used to open an entity's Notion link
// in the desktop app instead of a browser tab), and the two paths the
// Director-tool integration needs: the session-prep root (where
// sessions/scenes/layouts live on disk, for browsing them from the
// entity editor) and the Director app's own folder (where its
// command-watcher patch — see check_remote_command() in that project —
// looks for director_remote_command.json). Plain JSON, sits at the
// project root, safe to hand-edit any of these directly if a path ever
// changes (a reinstall, a different machine, etc).

const fs = require('fs');
const path = require('path');

// Notion's default Windows install location, built from the current user's own
// profile. Elsewhere (or if Notion lives somewhere else) it can be edited in
// settings.json.
const DEFAULT_NOTION_EXE_PATH = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'),
  'Programs', 'Notion', 'Notion.exe'
);

function settingsFile(baseDir) {
  return path.join(baseDir, 'settings.json');
}

function defaultSettings() {
  return {
    notionExePath: DEFAULT_NOTION_EXE_PATH,
    directorPrepRootPath: '',
    directorAppFolderPath: '',
    // The folder the last entity image was picked from, so the next image
    // dialog opens right there. Machine-level on purpose: where a person
    // keeps their images has nothing to do with which campaign is open.
    lastImageDirectory: '',
    // Folder of default artwork. A new NPC/location whose name matches a file
    // in here (loosely: MiraSelven.png, mira-selven.jpg…) is offered that image.
    artworkFolderPath: ''
  };
}

function loadSettings(baseDir) {
  const file = settingsFile(baseDir);
  if (!fs.existsSync(file)) {
    const defaults = defaultSettings();
    fs.writeFileSync(file, JSON.stringify(defaults, null, 2), 'utf8');
    return defaults;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Backfill any settings added after this file was first created, same
    // reasoning as normalizeCampaign in storage.js — an existing
    // settings.json should never end up missing a field newer code
    // expects, without every read site needing to defensively check.
    // Object.assign here (defaults first, parsed second) means an
    // existing value always wins over a default, and only a genuinely
    // absent key gets backfilled.
    return Object.assign(defaultSettings(), parsed);
  } catch {
    return defaultSettings();
  }
}

function saveSettings(baseDir, settings) {
  fs.writeFileSync(settingsFile(baseDir), JSON.stringify(settings, null, 2), 'utf8');
}

// A remembered folder is only worth handing to a file dialog if it is
// still there — a deleted folder or an unplugged drive would otherwise
// leave the dialog with a bad starting point. Anything unusable comes back
// undefined, which makes the dialog fall back to the operating system's
// own default, exactly as if nothing had been remembered.
function usableDirectory(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') return undefined;
  try {
    return fs.statSync(dir).isDirectory() ? dir : undefined;
  } catch {
    return undefined;
  }
}

// Remembers the folder a file was just picked from. Returns the settings
// to keep using — the same object when the folder is unchanged (no needless
// write), otherwise an updated copy that has also been saved. Saving is a
// convenience: if writing settings.json fails (read-only folder, say), the
// folder is still remembered for this session and picking the image carries
// on undisturbed rather than failing over a bookkeeping detail.
function rememberLastImageDirectory(baseDir, settings, pickedFilePath) {
  const dir = path.dirname(pickedFilePath);
  if (!dir || settings.lastImageDirectory === dir) return settings;
  const updated = Object.assign({}, settings, { lastImageDirectory: dir });
  try {
    saveSettings(baseDir, updated);
  } catch {
    // intentionally ignored — see above
  }
  return updated;
}

module.exports = { loadSettings, saveSettings, settingsFile, usableDirectory, rememberLastImageDirectory, DEFAULT_NOTION_EXE_PATH };
