const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../src/directorRemote');
const Query = require('../src/query');

let failures = 0;
function test(name, fn) {
  Promise.resolve().then(fn).then(() => console.log(`ok  - ${name}`)).catch((e) => { failures++; console.log(`FAIL - ${name}\n  ${e.stack}`); });
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dir-'));
const touch = (...p) => { const f = path.join(...p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'x'); };

function world() {
  const root = tmp(), app = tmp(), improv = tmp(), qf = tmp();
  const scene = path.join(root, 'S1', 'Harbour');
  fs.mkdirSync(scene, { recursive: true });
  fs.writeFileSync(path.join(app, 'director_config.json'), JSON.stringify({ root_path: root, improv_music_path: improv, improv_category: 'Calm' }));
  return { root, app, improv, qf, scene };
}

test('scene music: every file of the scene music folder, ordered first by "orders", then alphabetical', () => {
  const w = world();
  ['b.mp3', 'a.ogg', 'c.txt'].forEach((n) => touch(w.scene, 'music', n));
  fs.writeFileSync(path.join(w.scene, 'scene_settings.json'), JSON.stringify({ use_scene_music: true, orders: { music: ['c.txt', 'gone.mp3'] }, linked_assets: { music: { 'x.mp3': 'y' } } }));
  assert.deepStrictEqual(R.listMusic({ prepRoot: w.root, appFolder: w.app, session: 'S1', scene: 'Harbour' }), ['c.txt', 'a.ogg', 'b.mp3', 'x.mp3']);
});

test('genre mode: files of the genre folder plus linked music; root folder and playlist variants', () => {
  const w = world();
  touch(w.improv, 'Calm', 'wave.mp3'); touch(w.improv, 'Calm', 'rain.mp3'); touch(w.improv, 'root.mp3');
  const f = path.join(w.scene, 'scene_settings.json');
  fs.writeFileSync(f, JSON.stringify({ use_scene_music: false, improv_category: 'Calm', linked_assets: { music: { 'linked.mp3': {} } } }));
  const q = { prepRoot: w.root, appFolder: w.app, session: 'S1', scene: 'Harbour' };
  assert.deepStrictEqual(R.listMusic(q), ['linked.mp3', 'rain.mp3', 'wave.mp3']);
  fs.writeFileSync(f, JSON.stringify({ use_scene_music: false, improv_category: '--- Root Folder ---' }));
  assert.ok(R.listMusic(q).includes('root.mp3'));
  fs.writeFileSync(f, JSON.stringify({ use_scene_music: false, improv_category: '★ Playlist', music_playlist: [{ name: 'one.mp3', path: 'p' }, { name: 'two.mp3', path: 'q' }] }));
  assert.deepStrictEqual(R.listMusic(q), ['one.mp3', 'two.mp3']);
  assert.deepStrictEqual(R.listMusic({ ...q, scene: 'Nope' }), []);
});

test('playlist mode (use_playlist) lists the playlist; per-source orders are honoured', () => {
  const w = world();
  fs.writeFileSync(path.join(w.scene, 'scene_settings.json'), JSON.stringify({ use_playlist: true, use_scene_music: true, music_playlist: [{ name: 'b.mp3', path: 'p' }, { name: 'a.mp3', path: 'q' }, { name: 'c.mp3', path: 'r' }], music_orders: { playlist: ['c.mp3'] }, linked_assets: { music: { 'x.mp3': 1 } } }));
  touch(w.scene, 'music', 'folder.mp3');
  assert.deepStrictEqual(R.listMusic({ prepRoot: w.root, appFolder: w.app, session: 'S1', scene: 'Harbour' }), ['c.mp3', 'a.mp3', 'b.mp3']);
  fs.writeFileSync(path.join(w.scene, 'scene_settings.json'), JSON.stringify({ use_scene_music: true, music_orders: { scene: ['folder.mp3'] } }));
  touch(w.scene, 'music', 'aaa.mp3');
  assert.deepStrictEqual(R.listMusic({ prepRoot: w.root, appFolder: w.app, session: 'S1', scene: 'Harbour' }), ['folder.mp3', 'aaa.mp3']);
});

test('switch_scene:false is sent with session and scene, and only then', () => {
  assert.deepStrictEqual(R.buildCommand({ session: 'S1', scene: 'Sc2', music: 't.mp3', switch_scene: false }).command, { session: 'S1', scene: 'Sc2', layout: '', music: 't.mp3', switch_scene: false });
  assert.deepStrictEqual(R.buildCommand({ session: 'S1', scene: 'Sc2', quickfire: 'z.wav', quickfire_fire: true, switch_scene: false }).command, { session: 'S1', scene: 'Sc2', layout: '', quickfire: 'z.wav', quickfire_fire: true, switch_scene: false });
  assert.ok(R.buildCommand({ music: 't.mp3', switch_scene: false }).error);
  assert.ok(!('switch_scene' in R.buildCommand({ session: 'S1', scene: 'Sc2' }).command));
});

test('all scenes of all sessions, for searching the whole hierarchy', () => {
  const w = world();
  fs.mkdirSync(path.join(w.root, 'S2', 'Forest'), { recursive: true });
  fs.writeFileSync(path.join(w.root, 'notes.txt'), 'x');
  assert.deepStrictEqual(R.listAllScenes(w.root), [{ session: 'S1', scene: 'Harbour', layouts: [] }, { session: 'S2', scene: 'Forest', layouts: [] }]);
  fs.mkdirSync(path.join(w.root, 'S2', 'Forest', 'layouts'), { recursive: true });
  fs.writeFileSync(path.join(w.root, 'S2', 'Forest', 'layouts', 'Ambush.json'), '{}');
  assert.deepStrictEqual(R.listAllScenes(w.root)[1].layouts, ['Ambush.json']);
  assert.deepStrictEqual(R.listAllScenes(''), []);
});

test('quickfire: audio files only, alphabetical; not set up = empty', () => {
  const w = world();
  ['b.wav', 'A.mp3', 'notes.txt', 'c.MP4'].forEach((n) => touch(w.qf, n));
  const f = path.join(w.scene, 'scene_settings.json');
  fs.writeFileSync(f, JSON.stringify({ quickfire_path: w.qf, quickfire_enabled: false }));
  assert.deepStrictEqual(R.listQuickfire({ prepRoot: w.root, session: 'S1', scene: 'Harbour' }), ['A.mp3', 'b.wav', 'c.MP4']);
  fs.writeFileSync(f, JSON.stringify({ quickfire_path: '' }));
  assert.deepStrictEqual(R.listQuickfire({ prepRoot: w.root, session: 'S1', scene: 'Harbour' }), []);
});

test('commands: scene switch keeps the old shape; music/quickfire may omit session and scene', () => {
  assert.deepStrictEqual(R.buildCommand({ session: 'S', scene: 'X', layout: 'l.json' }).command, { session: 'S', scene: 'X', layout: 'l.json' });
  assert.deepStrictEqual(R.buildCommand({ session: 'S', scene: 'X' }).command, { session: 'S', scene: 'X', layout: '' });
  assert.deepStrictEqual(R.buildCommand({ music: 't.mp3' }).command, { music: 't.mp3' });
  assert.deepStrictEqual(R.buildCommand({ quickfire: 'q.wav', quickfire_fire: true }).command, { quickfire: 'q.wav', quickfire_fire: true });
  assert.deepStrictEqual(R.buildCommand({ quickfire_fire: true }).command, { quickfire_fire: true });
  assert.deepStrictEqual(R.buildCommand({ session: 'S', scene: 'X', music: 't.mp3', quickfire: 'q.wav', quickfire_fire: false }).command, { session: 'S', scene: 'X', layout: '', music: 't.mp3', quickfire: 'q.wav' });
  assert.ok(R.buildCommand({ session: 'S' }).error);
  assert.ok(R.buildCommand({}).error);
  assert.ok(R.buildCommand({ layout: 'a.json', music: 'x' }).error);
});

test('sending writes the file atomically and keeps commands at least a second apart', async () => {
  const app = tmp();
  let t = 1000000; const waits = [];
  const now = () => t, wait = async (ms) => { waits.push(ms); t += ms; };
  const a = await R.sendCommand(app, { music: 'a.mp3' }, now, wait);
  assert.ok(a.ok);
  const file = path.join(app, 'director_remote_command.json');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { music: 'a.mp3' });
  assert.ok(!fs.existsSync(`${file}.tmp`));
  t += 100;
  const b = await R.sendCommand(app, { music: 'b.mp3' }, now, wait);
  assert.ok(b.ok && waits.length >= 1 && waits[waits.length - 1] >= R.MIN_GAP_MS - 100);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { music: 'b.mp3' });
  assert.ok(!(await R.sendCommand('', { music: 'x' })).ok);
  assert.ok(!(await R.sendCommand(path.join(app, 'missing'), { music: 'x' })).ok);
  assert.ok(!(await R.sendCommand(app, {})).ok);
});

test('buttons in text: music and quickfire render with their data, even with a "]" in the name', () => {
  const DM = require('../src/dataModel');
  const c = DM.emptyCampaign();
  const html = Query.renderMentions('[[MUSICBTN:S1|Harbour|wave [remix%5D.mp3]]Music: wave[[/MUSICBTN]] [[QFBTN:||boom.wav|1]]Fire: boom[[/QFBTN]]', c).html;
  assert.ok(html.includes('data-music="wave [remix].mp3"'), html);
  assert.ok(html.includes('triggerDirectorMusic') && html.includes('triggerDirectorQuickfire'));
  assert.ok(html.includes('data-session=""') && html.includes('data-fire="1"'));
});


test('genres at any depth, genre tracks, SFX folders and files, saved playlists across all scenes', () => {
  const w = world();
  const sfx = tmp(), music = tmp();
  fs.writeFileSync(path.join(w.app, 'director_config.json'), JSON.stringify({ improv_music_path: music, improv_sfx_path: sfx }));
  touch(music, 'Jazz', 'Bebop', 'x.mp3'); touch(music, 'Jazz', 'y.flac'); touch(music, 'Jazz', 'notes.txt'); touch(music, 'Rock', 'r.wav');
  assert.deepStrictEqual(R.listGenres({ appFolder: w.app }), ['Jazz', 'Jazz/Bebop', 'Rock']);
  assert.deepStrictEqual(R.listGenreTracks({ appFolder: w.app, genre: 'Jazz' }), ['y.flac']);
  assert.deepStrictEqual(R.listGenreTracks({ appFolder: w.app, genre: 'Jazz/Bebop' }), ['x.mp3']);
  assert.deepStrictEqual(R.listGenreTracks({ appFolder: w.app, genre: '../..' }), [], 'no path escapes');
  touch(sfx, 'door.wav'); touch(sfx, 'Rain', 'drops.ogg');
  assert.deepStrictEqual(R.listSfxCategories({ appFolder: w.app }), ['', 'Rain']);
  assert.deepStrictEqual(R.listSfxFiles({ appFolder: w.app, category: '' }), ['door.wav']);
  assert.deepStrictEqual(R.listSfxFiles({ appFolder: w.app, category: 'Rain' }), ['drops.ogg']);
  fs.mkdirSync(path.join(w.root, 'S1', 'Harbour', 'playlists'), { recursive: true });
  fs.writeFileSync(path.join(w.root, 'S1', 'Harbour', 'playlists', 'Calm.json'), JSON.stringify({ name: 'Calm night', tracks: [{ name: 'a.mp3', path: 'p' }, { name: 'b.mp3', path: 'q' }] }));
  const pl = R.listPlaylists({ prepRoot: w.root });
  assert.strictEqual(pl.length, 1);
  assert.strictEqual(pl[0].label, 'S1 / Harbour  —  Calm night');
  assert.deepStrictEqual(R.listPlaylistTracks({ prepRoot: w.root, session: 'S1', scene: 'Harbour', file: 'Calm.json' }), ['a.mp3', 'b.mp3']);
});

test('commands for genre music, playlist, SFX', () => {
  assert.deepStrictEqual(R.buildCommand({ music_genre: 'Jazz/Bebop', music: 'x.mp3' }).command, { music: 'x.mp3', music_genre: 'Jazz/Bebop' });
  assert.deepStrictEqual(R.buildCommand({ music_genre: 'Jazz', play: true }).command, { music_genre: 'Jazz', play: true });
  assert.deepStrictEqual(R.buildCommand({ playlist: 'S1 / Harbour  —  Calm night', play: true }).command, { playlist: 'S1 / Harbour  —  Calm night', play: true });
  assert.deepStrictEqual(R.buildCommand({ playlist_off: true }).command, { playlist_off: true });
  assert.deepStrictEqual(R.buildCommand({ sfx_category: '', sfx: 'door.wav' }).command, { sfx: 'door.wav', sfx_category: '' });
  assert.deepStrictEqual(R.buildCommand({ sfx_stop: true }).command, { sfx_stop: true });
  assert.ok(R.buildCommand({}).error);
});

test('DIRBTN buttons render with their data and strip from graph excerpts', () => {
  const html = Query.renderMentions('[[DIRBTN:sfx|Rain|drops.ogg|]]SFX: drops[[/DIRBTN]]', { entities: {}, blocks: [], checkpoints: [] }).html;
  assert.ok(html.includes('triggerDirectorGeneric') && html.includes('data-dkind="sfx"') && html.includes('data-a="Rain"'));
});


test('scene SFX: own sfx folder or the library category, plus linked; playlist label resolves to its file path', () => {
  const w = world();
  const sfx = tmp();
  fs.writeFileSync(path.join(w.app, 'director_config.json'), JSON.stringify({ improv_sfx_path: sfx }));
  touch(w.scene, 'sfx', 'b.wav'); touch(w.scene, 'sfx', 'a.ogg'); touch(sfx, 'Rain', 'drops.ogg');
  fs.writeFileSync(path.join(w.scene, 'scene_settings.json'), JSON.stringify({ use_scene_sfx: true, linked_assets: { sfx: { 'l.wav': 'x' } } }));
  assert.deepStrictEqual(R.listSceneSfx({ prepRoot: w.root, appFolder: w.app, session: 'S1', scene: 'Harbour' }), ['a.ogg', 'b.wav', 'l.wav']);
  fs.writeFileSync(path.join(w.scene, 'scene_settings.json'), JSON.stringify({ improv_sfx_category: 'Rain' }));
  assert.deepStrictEqual(R.listSceneSfx({ prepRoot: w.root, appFolder: w.app, session: 'S1', scene: 'Harbour' }), ['drops.ogg']);
  fs.mkdirSync(path.join(w.scene, 'playlists'), { recursive: true });
  fs.writeFileSync(path.join(w.scene, 'playlists', 'Calm.json'), JSON.stringify({ name: 'Calm night', tracks: [] }));
  assert.strictEqual(R.resolvePlaylist(w.root, 'S1 / Harbour  —  Calm night'), path.join(w.scene, 'playlists', 'Calm.json'));
  assert.strictEqual(R.resolvePlaylist(w.root, 'Something else'), 'Something else');
});

setTimeout(() => { if (failures) { console.log(`${failures} failed`); process.exit(1); } console.log('All Director remote tests passed.'); }, 600);
