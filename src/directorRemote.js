// Director remote control: what the Director tool can be told to do (see its
// "DIRECTOR REMOTE COMMAND - extended spec") and how to read what exists on
// disk so the Kurator can offer real choices. Pure Node (fs/path), no Electron.
//
// Command file: <Director app folder>/director_remote_command.json
//   session, scene      switch scene (required together; may be omitted when only
//                       music and/or quickfire are sent: they apply to the active scene)
//   layout              optional layout file name incl. ".json"
//   music               optional track name exactly as in the scene's music list
//   quickfire           optional file name from the scene's quickfire folder
//   quickfire_fire      optional boolean, true = play it
//   music_genre         genre folder (relative to the music root, "/" for sub-levels); with music = play
//                       that file from it, without music = select the genre (play:true starts it)
//   playlist            saved playlist (name / "Session / Scene  —  Name" / file / path); music = start a
//                       track of it, play:true = start it;  playlist_off:true = leave playlist mode
//   sfx, sfx_category   play an SFX file (from a category folder of the SFX library); sfx_stop:true stops it
//   play                optional boolean (see music_genre / playlist)
//   switch_scene        optional boolean; false (with session + scene) = do NOT change scene:
//                       music / quickfire are looked up in that scene's own settings and played
//                       while the active scene stays as it is
const fs = require('fs');
const path = require('path');

const QUICKFIRE_EXT = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.mp4'];
const MIN_GAP_MS = 1100;   // Director polls every ~750 ms; two writes inside one poll window merge

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

function listFiles(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name); } catch { return []; }
}

function sceneDir(prepRoot, session, scene) { return path.join(prepRoot, session, scene); }

function sceneSettings(prepRoot, session, scene) {
  return readJson(path.join(sceneDir(prepRoot, session, scene), 'scene_settings.json')) || {};
}

function byOrder(names, order) {
  const list = Array.isArray(order) ? order.filter((n) => names.includes(n)) : [];
  const rest = names.filter((n) => !list.includes(n)).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  return Array.from(new Set(list.concat(rest)));
}

function listDirs(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })); } catch { return []; }
}

// Every scene of every session (with the layout files of each), for searching across the whole hierarchy.
function listAllScenes(prepRoot) {
  if (!prepRoot) return [];
  const out = [];
  listDirs(prepRoot).forEach((session) => listDirs(path.join(prepRoot, session)).forEach((scene) => {
    const layouts = listFiles(path.join(prepRoot, session, scene, 'layouts')).filter((f) => f.endsWith('.json')).sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'base' }));
    out.push({ session, scene, layouts });
  }));
  return out;
}

// Order of the entries of one source. The Director tool keeps one order per source in
// "music_orders" (older versions: "orders".music); accept either shape.
function orderFor(s, sourceKey) {
  const mo = s.music_orders;
  if (Array.isArray(mo)) return mo;
  if (mo && typeof mo === 'object') {
    if (Array.isArray(mo[sourceKey])) return mo[sourceKey];
    const all = Object.values(mo).filter(Array.isArray);
    if (all.length === 1) return all[0];
  }
  return s.orders && s.orders.music;
}

// The music list of a scene, the way the Director tool builds it.
//   use_playlist: true      -> the "music_playlist" entries ({name, path})
//   use_scene_music: true   -> every file of <scene>/music
//   otherwise               -> files of the genre folder (improv_music_path/improv_category;
//                              category "--- Root Folder ---" = the root itself)
// plus the scene's linked music tracks (not in playlist mode). Legacy: improv_category
// "★ Playlist" also means the playlist.
function listMusic({ prepRoot, appFolder, session, scene }) {
  if (!prepRoot || !session || !scene || !fs.existsSync(sceneDir(prepRoot, session, scene))) return [];
  const s = sceneSettings(prepRoot, session, scene);
  const cfg = (appFolder && readJson(path.join(appFolder, 'director_config.json'))) || {};
  const category = s.improv_category != null ? s.improv_category : cfg.improv_category;
  let names = [], source = 'scene';
  if (s.use_playlist || (!s.use_scene_music && category === '★ Playlist')) {
    source = 'playlist';
    names = (Array.isArray(s.music_playlist) ? s.music_playlist : []).map((e) => e && e.name).filter((n) => typeof n === 'string' && n);
  } else if (s.use_scene_music) {
    names = listFiles(path.join(sceneDir(prepRoot, session, scene), 'music'));
  } else {
    source = 'genre';
    const root = s.improv_music_path || cfg.improv_music_path;
    if (root) names = listFiles(!category || category === '--- Root Folder ---' ? root : path.join(root, category));
  }
  if (source !== 'playlist') {
    const linked = s.linked_assets && s.linked_assets.music;
    if (linked && typeof linked === 'object') names = names.concat(Object.keys(linked));
  }
  return byOrder(Array.from(new Set(names)), orderFor(s, source));
}

// The quickfire sounds of a scene (empty when the scene has no quickfire folder).
function listQuickfire({ prepRoot, session, scene }) {
  if (!prepRoot || !session || !scene) return [];
  const s = sceneSettings(prepRoot, session, scene);
  if (!s.quickfire_path) return [];
  return listFiles(s.quickfire_path).filter((n) => QUICKFIRE_EXT.includes(path.extname(n).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// Builds the JSON object to send. Returns { command } or { error }.
function buildCommand(opts) {
  const o = opts || {};
  const str = (v) => (typeof v === 'string' ? v : '');
  const cmd = {};
  const session = str(o.session), scene = str(o.scene);
  const hasExtra = !!(str(o.music) || str(o.quickfire) || o.quickfire_fire === true || str(o.music_genre) || str(o.playlist)
    || o.playlist_off === true || str(o.sfx) || o.sfx_stop === true || o.play === true);
  if (session || scene) {
    if (!session || !scene) return { error: 'A scene command needs both a session and a scene.' };
    cmd.session = session; cmd.scene = scene;
    cmd.layout = str(o.layout);   // "" = no specific layout (kept: the Director tool treats it as none)
  } else if (!hasExtra) {
    return { error: 'Nothing to send.' };
  } else if (str(o.layout)) {
    return { error: 'A layout needs a session and scene.' };
  }
  if (o.switch_scene === false) {
    if (!cmd.session) return { error: 'switch_scene:false needs a session and scene.' };
    cmd.switch_scene = false;
  }
  if (str(o.music)) cmd.music = str(o.music);
  if (str(o.quickfire)) cmd.quickfire = str(o.quickfire);
  if (o.quickfire_fire === true) cmd.quickfire_fire = true;
  if (str(o.music_genre)) cmd.music_genre = str(o.music_genre);
  if (str(o.playlist)) cmd.playlist = str(o.playlist);
  if (o.playlist_off === true) cmd.playlist_off = true;
  if (str(o.sfx)) {
    cmd.sfx = str(o.sfx);
    if (o.sfx_category !== undefined && o.sfx_category !== null) cmd.sfx_category = str(o.sfx_category);
  }
  if (o.sfx_stop === true) cmd.sfx_stop = true;
  if (o.play === true) cmd.play = true;
  return { command: cmd };
}

let lastWrite = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Writes the command atomically (temp file + rename) and keeps commands at least
// MIN_GAP_MS apart, so two quick presses never merge into one poll window.
let chain = Promise.resolve();
function sendCommand(appFolder, opts, now = Date.now, wait = sleep) {
  const run = async () => {
    if (!appFolder) return { ok: false, error: 'Director app folder not set. Configure it in Settings first.' };
    if (!fs.existsSync(appFolder)) return { ok: false, error: `Director app folder not found: ${appFolder}` };
    const built = buildCommand(opts);
    if (built.error) return { ok: false, error: built.error };
    const gap = MIN_GAP_MS - (now() - lastWrite);
    if (gap > 0) await wait(gap);
    const target = path.join(appFolder, 'director_remote_command.json');
    const tmp = `${target}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(built.command), 'utf8');
      fs.renameSync(tmp, target);
      lastWrite = now();
      return { ok: true, command: built.command };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

// --- Libraries read from director_config.json ---------------------------------------------
const AUDIO_EXT = ['.mp3', '.flac', '.wav', '.ogg', '.m4a', '.aac', '.wma', '.opus'];
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
function audioIn(dir) { return listFiles(dir).filter((n) => AUDIO_EXT.includes(path.extname(n).toLowerCase())).sort(byName); }
function configOf(appFolder) { return (appFolder && readJson(path.join(appFolder, 'director_config.json'))) || {}; }
function inside(root, rel) {
  const full = path.resolve(root, rel || '.');
  const r = path.resolve(root);
  return full === r || full.startsWith(r + path.sep) ? full : null;
}

// Every genre = every sub-folder of the music library at any depth; the id is the relative path with "/".
function listGenres({ appFolder }) {
  const root = configOf(appFolder).improv_music_path;
  if (!root || !fs.existsSync(root)) return [];
  const out = [];
  const walk = (rel, depth) => {
    if (depth > 8 || out.length > 3000) return;
    listDirs(path.join(root, rel)).forEach((d) => { const id = rel ? `${rel}/${d}` : d; out.push(id); walk(id, depth + 1); });
  };
  walk('', 0);
  return out.sort(byName);
}

function listGenreTracks({ appFolder, genre }) {
  const root = configOf(appFolder).improv_music_path;
  const dir = root && genre ? inside(root, genre) : null;
  return dir ? audioIn(dir) : [];
}

// Every saved playlist: <root>/<session>/<scene>/playlists/<Name>.json = { name, tracks: [{name, path}] }.
function listPlaylists({ prepRoot }) {
  if (!prepRoot) return [];
  const out = [];
  listDirs(prepRoot).forEach((session) => listDirs(path.join(prepRoot, session)).forEach((scene) => {
    const dir = path.join(prepRoot, session, scene, 'playlists');
    listFiles(dir).filter((f) => f.toLowerCase().endsWith('.json')).forEach((file) => {
      const j = readJson(path.join(dir, file)) || {};
      const name = typeof j.name === 'string' && j.name ? j.name : file.replace(/\.json$/i, '');
      out.push({ name, session, scene, file, label: `${session} / ${scene}  —  ${name}`, tracks: Array.isArray(j.tracks) ? j.tracks.length : 0 });
    });
  }));
  return out.sort((a, b) => byName(a.label, b.label));
}

function listPlaylistTracks({ prepRoot, session, scene, file }) {
  if (!prepRoot || !session || !scene || !file) return [];
  const full = inside(prepRoot, path.join(session, scene, 'playlists', path.basename(file)));
  const j = full && readJson(full);
  return j && Array.isArray(j.tracks) ? j.tracks.map((t) => t && t.name).filter((n) => typeof n === 'string' && n) : [];
}

// SFX library: its root and its direct sub-folders ("" = the root itself).
function listSfxCategories({ appFolder }) {
  const root = configOf(appFolder).improv_sfx_path;
  if (!root || !fs.existsSync(root)) return [];
  return [''].concat(listDirs(root));
}

function listSfxFiles({ appFolder, category }) {
  const root = configOf(appFolder).improv_sfx_path;
  const dir = root ? inside(root, category && category !== '--- Root Folder ---' ? category : '') : null;
  return dir ? audioIn(dir) : [];
}

// The SFX list of one scene, built like the music list: the scene's own sfx folder
// (use_scene_sfx) or the library category it points to (improv_sfx_category), plus linked SFX.
function listSceneSfx({ prepRoot, appFolder, session, scene }) {
  if (!prepRoot || !session || !scene || !fs.existsSync(sceneDir(prepRoot, session, scene))) return [];
  const s = sceneSettings(prepRoot, session, scene);
  let names;
  if (s.use_scene_sfx) names = audioIn(path.join(sceneDir(prepRoot, session, scene), 'sfx'));
  else names = listSfxFiles({ appFolder, category: s.improv_sfx_category || '' });
  const linked = s.linked_assets && s.linked_assets.sfx;
  if (linked && typeof linked === 'object') names = names.concat(Object.keys(linked));
  return Array.from(new Set(names)).sort(byName);
}

// A playlist given as its label ("Session / Scene  —  Name") becomes the full file path, which the
// Director tool accepts without any guessing (and without depending on how the dash is encoded).
function resolvePlaylist(prepRoot, value) {
  if (!value || !prepRoot) return value;
  const hit = listPlaylists({ prepRoot }).find((x) => x.label === value);
  return hit ? path.join(prepRoot, hit.session, hit.scene, 'playlists', hit.file) : value;
}

module.exports = { listSceneSfx, resolvePlaylist, listGenres, listGenreTracks, listPlaylists, listPlaylistTracks, listSfxCategories, listSfxFiles, AUDIO_EXT, listAllScenes, QUICKFIRE_EXT, MIN_GAP_MS, listMusic, listQuickfire, buildCommand, sendCommand };
