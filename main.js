const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const storage = require('./src/storage');
const campaignManager = require('./src/campaignManager');
const entityImages = require('./src/entityImages');
const transferRunner = require('./src/transferRunner');
const { buildSharedBundle } = require('./src/copyVendor');
const { createDiagnostics } = require('./src/diagnostics');
const directorRemote = require('./src/directorRemote');
const artworkMatch = require('./src/artworkMatch');
const { resolveDataDir } = require('./src/dataDir');
const { loadSettings, saveSettings, usableDirectory, rememberLastImageDirectory } = require('./src/settings');

// Do this unconditionally, every launch, regardless of how the app was
// started — npm's pre/post-install hooks are a convenience for local dev,
// not something the app's correctness should depend on (some npm setups
// disable lifecycle scripts entirely, and there's no error if they do).
// (In a packaged app the bundle is built at packaging time — the app folder is
// read-only there — so this only runs from source.)
if (!app.isPackaged) {
  const bundleInfo = buildSharedBundle(__dirname);
  console.log(`[startup] shared logic bundle written: ${bundleInfo.destPath} (${bundleInfo.bytes} bytes)`);
}

// campaign-data/ and settings.json live here: the project folder when run from
// source, next to the .exe when packaged (see src/dataDir.js).
const DATA_DIR = resolveDataDir(__dirname, { isPackaged: app.isPackaged });

let mainWindow = null;
let campaignDir = null;
let campaign = null;
let scheduleSave = null;
let backupTimer = null;
let appSettings = loadSettings(DATA_DIR);

// --- Diagnostics -------------------------------------------------------
// campaign-data/diagnostics.log records anything that could explain a
// "freeze": failed saves, uncaught errors, a blocked main process, slow IPC
// calls, a renderer that stopped responding. Logging is async and never
// throws, so it cannot itself cause a freeze.
const diagnostics = createDiagnostics(path.join(DATA_DIR, 'campaign-data', 'diagnostics.log'));
let lastIpc = null;

process.on('uncaughtException', (err) => {
  diagnostics.log('uncaught-exception', { err, lastIpc });
  console.error('[uncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  diagnostics.log('unhandled-rejection', { reason, lastIpc });
  console.error('[unhandledRejection]', reason);
});

// Watchdog: a timer that should fire every 250ms. If it fires much later,
// the main process was blocked (e.g. by a slow synchronous disk write).
(function startWatchdog() {
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const lag = now - last - 250;
    last = now;
    if (lag > 700 && lag < 120000) diagnostics.log('main-process-stall', { lagMs: lag, lastIpc });
  }, 250).unref();
})();

function notifySaveStatus(status) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('save-status', status);
  } catch { /* window may be closing */ }
}

// Wraps ipcMain.handle so every call is timed and any throw is logged
// before being passed on unchanged.
const rawHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => rawHandle(channel, async (...args) => {
  const started = Date.now();
  if (channel !== 'diagnostics:log') lastIpc = { channel, at: new Date(started).toISOString() };
  try {
    return await handler(...args);
  } catch (err) {
    diagnostics.log('ipc-error', { channel, err });
    throw err;
  } finally {
    const took = Date.now() - started;
    if (took > 250 && channel !== 'diagnostics:log') diagnostics.log('slow-ipc', { channel, ms: took });
  }
});

// Data lives in DATA_DIR (see above), not the OS userData directory — everything in
// one place, easy to find and to back up by hand.
//
// Multiple campaigns live side by side under campaign-data/campaigns/ — see
// src/campaignManager.js. This function (re)points the currently active
// campaign's storage (load, autosave, backups) at whichever one that is.
function loadActiveCampaignStorage() {
  const active = campaignManager.ensureActiveCampaign(DATA_DIR);
  campaignDir = active.dir;
  campaign = storage.loadCampaign(campaignDir);
  scheduleSave = storage.makeAutosaver(campaignDir, {
    onError: (err, failuresInARow) => {
      // Log the first failure and then only every 12th, so a long outage
      // cannot flood the log.
      if (failuresInARow === 1 || failuresInARow % 12 === 0) {
        diagnostics.log('autosave-failed', { err, failuresInARow, dir: campaignDir });
      }
      notifySaveStatus({ ok: false, message: `${err.code || 'error'}: ${err.message}`, failures: failuresInARow });
    },
    onRecovered: () => {
      diagnostics.log('autosave-recovered', {});
      notifySaveStatus({ ok: true });
    }
  });
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = storage.startBackupSchedule(campaignDir);
  return active;
}

function flushCurrentCampaign() {
  try {
    if (campaignDir && campaign) storage.writeCampaignSync(campaignDir, campaign);
  } catch (err) {
    diagnostics.log('flush-failed', { err, dir: campaignDir });
    console.error('[flush] failed:', err.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 820,
    minWidth: 340,
    backgroundColor: '#141311',
    title: 'Kurator Session Manager',
    icon: path.join(__dirname, 'renderer', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const wc = mainWindow.webContents;
  mainWindow.on('unresponsive', () => diagnostics.log('window-unresponsive', { lastIpc }));
  mainWindow.on('responsive', () => diagnostics.log('window-responsive', {}));
  wc.on('render-process-gone', (_e, details) => diagnostics.log('render-process-gone', details));
  wc.on('did-fail-load', (_e, code, desc, url) => diagnostics.log('did-fail-load', { code, desc, url }));
}

app.whenReady().then(() => {
  loadActiveCampaignStorage();

  ipcMain.handle('diagnostics:log', (_event, { kind, details } = {}) => {
    diagnostics.log(`renderer:${String(kind || 'event')}`, details);
    return true;
  });

  ipcMain.handle('campaign:load', () => campaign);

  ipcMain.handle('campaign:save', (_event, updated) => {
    campaign = updated;
    scheduleSave(campaign);
    return true;
  });

  ipcMain.handle('campaign:backupNow', () => {
    storage.writeCampaignSync(campaignDir, campaign); // flush pending edits first
    return storage.createBackup(campaignDir);
  });

  ipcMain.handle('campaign:location', () => campaignDir);

  // --- Entity images -----------------------------------------------
  // The image file itself always lives on disk under this campaign's
  // own images/ folder (see src/entityImages.js for why) — campaign.json
  // only ever stores the filename and a size choice. campaignDir is
  // already kept current across every campaign switch/create/delete
  // above, so these handlers never need the renderer to tell them which
  // campaign is active.
  //
  // Two steps, not one: image:pickSource only opens the file dialog and
  // reads the picked file back as a data URL — nothing gets copied into
  // the campaign folder yet. The renderer loads that into the crop tool
  // (a plain <canvas>, no new dependency), and only once the person
  // actually saves their crop does image:saveCropped write the result to
  // disk. The original file picked from the hard drive is never itself
  // copied anywhere; only the cropped, re-encoded square is.
  ipcMain.handle('image:baseUrl', () => entityImages.imagesBaseFileUrl(campaignDir));

  ipcMain.handle('image:pickSource', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      // Opens in the folder the last image came from, so getting back to it
      // is no clicks at all. If that folder is gone, this is undefined and
      // the dialog starts wherever the operating system would anyway.
      defaultPath: usableDirectory(appSettings.lastImageDirectory),
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    try {
      const filePath = result.filePaths[0];
      // Remembered as soon as a file is picked, even if the crop is
      // cancelled afterwards — it's the folder being remembered, not the
      // outcome.
      appSettings = rememberLastImageDirectory(DATA_DIR, appSettings, filePath);
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase().replace('.', '');
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext] || 'application/octet-stream';
      return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
    } catch (err) {
      return { error: err.message };
    }
  });

  // Default-artwork folder (Settings): find files matching an entity name, and read one back.
  ipcMain.handle('artwork:find', (_e, name) => {
    const root = appSettings.artworkFolderPath;
    if (!usableDirectory(root)) return { noFolder: true, matches: [] };
    const { pathToFileURL } = require('url');
    const matches = artworkMatch.findArtwork(root, name).map((m) => Object.assign(m, { url: pathToFileURL(m.path).href }));
    return { matches };
  });

  ipcMain.handle('artwork:read', (_e, filePath) => {
    try {
      if (!artworkMatch.isInside(appSettings.artworkFolderPath, filePath)) return { error: 'That file is outside the artwork folder.' };
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase().replace('.', '');
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext] || 'application/octet-stream';
      return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('image:saveCropped', (_event, { entityId, dataUrl }) => {
    try {
      const filename = entityImages.saveCroppedEntityImage(campaignDir, entityId, dataUrl);
      return { filename };
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('image:remove', (_event, { filename }) => {
    entityImages.removeEntityImageFile(campaignDir, filename);
    return true;
  });

  // --- Multi-campaign management ---

  ipcMain.handle('campaign:list', () => campaignManager.listCampaigns(DATA_DIR));

  ipcMain.handle('campaign:activeInfo', () => {
    const id = campaignManager.getActiveId(DATA_DIR);
    const entry = campaignManager.listCampaigns(DATA_DIR).find((c) => c.id === id);
    return entry || null;
  });

  ipcMain.handle('campaign:create', (_event, { name }) => {
    flushCurrentCampaign();
    const entry = campaignManager.createCampaign(DATA_DIR, name, { seed: false });
    loadActiveCampaignStorage();
    return { entry, campaign };
  });

  ipcMain.handle('campaign:switch', (_event, id) => {
    flushCurrentCampaign();
    campaignManager.setActive(DATA_DIR, id);
    loadActiveCampaignStorage();
    return campaign;
  });

  ipcMain.handle('campaign:rename', (_event, { id, name }) => campaignManager.renameCampaign(DATA_DIR, id, name));

  ipcMain.handle('campaign:delete', (_event, id) => {
    const wasActive = campaignManager.getActiveId(DATA_DIR) === id;
    if (wasActive) flushCurrentCampaign();
    const list = campaignManager.deleteCampaign(DATA_DIR, id);
    if (wasActive) loadActiveCampaignStorage();
    return list;
  });

  // --- Transfer entities into other campaigns ---------------------------
  // The renderer always saves (and awaits it) before calling these, so
  // `campaign` here is current. The source is never modified.
  ipcMain.handle('transfer:listTargets', () => transferRunner.listTargets(DATA_DIR, campaignManager.getActiveId(DATA_DIR)));

  ipcMain.handle('transfer:preview', (_event, { targetIds, entries }) =>
    transferRunner.previewTargets(DATA_DIR, campaign, targetIds || [], entries || []));

  ipcMain.handle('transfer:run', (_event, { targetIds, entries }) => {
    const activeId = campaignManager.getActiveId(DATA_DIR);
    const ids = (targetIds || []).filter((id) => id !== activeId);
    const results = transferRunner.runTransfer(DATA_DIR, campaign, campaignDir, ids, entries || []);
    diagnostics.log('transfer', results.map((r) => ({ id: r.id, ok: r.ok, error: r.error })));
    return results;
  });

  // --- Open an entity's Notion link in the local Notion app -------------
  // Launches Notion.exe directly with the URL as an argument, rather than
  // shell.openExternal (which would hand https:// links to the default
  // browser). The exe path lives in settings.json, editable by hand if it
  // ever changes. Not verified against a live Notion install — if the
  // app opens but doesn't navigate to the right page, that's the most
  // likely place something needs adjusting (Notion may expect a
  // notion://-scheme link rather than a plain https:// URL as an
  // argument — worth trying if the plain URL doesn't land correctly).
  ipcMain.handle('notion:open', (_event, url) => {
    if (!url || !url.trim()) return { ok: false, error: 'No Notion link set for this entity.' };
    const exePath = appSettings.notionExePath;
    if (!exePath || !fs.existsSync(exePath)) {
      return { ok: false, error: `Notion executable not found at: ${exePath}. Check settings.json.` };
    }
    return new Promise((resolve) => {
      let settled = false;
      try {
        const child = spawn(exePath, [url.trim()], { detached: true, stdio: 'ignore' });
        child.once('error', (err) => {
          if (settled) return;
          settled = true;
          console.error('[notion] failed to launch:', err.message);
          resolve({ ok: false, error: err.message });
        });
        child.unref();
        // Notion is a long-running GUI app — its process won't exit when
        // we're done with it, so there's nothing to "wait for completion"
        // on. Give the 'error' event (e.g. a bad path) a short window to
        // fire before assuming the launch succeeded.
        setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve({ ok: true });
        }, 300);
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  });

  // --- App settings (Notion path, Director-tool paths) ------------------
  ipcMain.handle('settings:get', () => appSettings);

  ipcMain.handle('settings:save', (_event, updated) => {
    appSettings = Object.assign({}, appSettings, updated);
    saveSettings(DATA_DIR, appSettings);
    return appSettings;
  });

  ipcMain.handle('settings:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // --- Director-tool integration ------------------------------------
  // Browsing reads directly off disk from the configured session-prep
  // root — sessions/scenes are folders, layouts are the .json files
  // inside a scene's own "layouts" folder. Matches exactly how the
  // Director tool itself organizes them (root/session/scene/layouts/*.json).
  function listSubdirectories(dirPath) {
    if (!dirPath || !fs.existsSync(dirPath)) return [];
    try {
      return fs.readdirSync(dirPath, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  ipcMain.handle('director:listSessions', () => listSubdirectories(appSettings.directorPrepRootPath));

  ipcMain.handle('director:listScenes', (_event, session) =>
    listSubdirectories(path.join(appSettings.directorPrepRootPath, session)));

  ipcMain.handle('director:listLayouts', (_event, { session, scene }) => {
    const layoutsDir = path.join(appSettings.directorPrepRootPath, session, scene, 'layouts');
    if (!fs.existsSync(layoutsDir)) return [];
    try {
      return fs.readdirSync(layoutsDir).filter((f) => f.endsWith('.json')).sort();
    } catch {
      return [];
    }
  });

  // Music and quickfire lists are read straight off disk the way the Director tool
  // builds them (see src/directorRemote.js).
  ipcMain.handle('director:listAllScenes', () => directorRemote.listAllScenes(appSettings.directorPrepRootPath));
  ipcMain.handle('director:listMusic', (_event, { session, scene }) =>
    directorRemote.listMusic({ prepRoot: appSettings.directorPrepRootPath, appFolder: appSettings.directorAppFolderPath, session, scene }));
  ipcMain.handle('director:listQuickfire', (_event, { session, scene }) =>
    directorRemote.listQuickfire({ prepRoot: appSettings.directorPrepRootPath, session, scene }));

  const dirOpts = () => ({ prepRoot: appSettings.directorPrepRootPath, appFolder: appSettings.directorAppFolderPath });
  ipcMain.handle('director:listGenres', () => directorRemote.listGenres(dirOpts()));
  ipcMain.handle('director:listGenreTracks', (_e, genre) => directorRemote.listGenreTracks(Object.assign(dirOpts(), { genre })));
  ipcMain.handle('director:listPlaylists', () => directorRemote.listPlaylists(dirOpts()));
  ipcMain.handle('director:listPlaylistTracks', (_e, item) => directorRemote.listPlaylistTracks(Object.assign(dirOpts(), item || {})));
  ipcMain.handle('director:listSfxCategories', () => directorRemote.listSfxCategories(dirOpts()));
  ipcMain.handle('director:listSfxFiles', (_e, category) => directorRemote.listSfxFiles(Object.assign(dirOpts(), { category })));

  // Writes the command the Director tool polls for (director_remote_command.json),
  // atomically, at least ~1 s after the previous one. `cmd` may carry session,
  // scene, layout, music, quickfire, quickfire_fire.
  ipcMain.handle('director:listSceneSfx', (_e, { session, scene }) => directorRemote.listSceneSfx(Object.assign(dirOpts(), { session, scene })));
  ipcMain.handle('director:sendCommand', (_event, cmd) => {
    const c = Object.assign({}, cmd);
    if (typeof c.playlist === 'string') c.playlist = directorRemote.resolvePlaylist(appSettings.directorPrepRootPath, c.playlist);
    return directorRemote.sendCommand(appSettings.directorAppFolderPath, c);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  flushCurrentCampaign();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  flushCurrentCampaign();
});
