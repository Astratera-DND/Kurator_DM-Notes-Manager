const assert = require('assert');
const DM = require('../src/dataModel');
const Q = require('../src/query');
function ok(m) { console.log('ok  -', m); }

const c = DM.emptyCampaign();
const a = DM.createDraftEntity ? null : null;
const mk = (name, type) => { const e = DM.createDraftEntity(c, { type, groupId: null }); e.name = name; DM.commitDraftEntity(c, e.id); return e; };
const mira = mk('Mira Selven', 'npc'), bob = mk('Bob', 'npc'), spire = mk('Spire', 'location');
const topic = DM.createContentModule(c, { type: 'topic', name: 'The Death of the Duke', text: 'Nobody saw **it** happen.' });
const note = DM.createContentModule(c, { type: 'note', name: '', text: 'She hides a dark secret about [[' + bob.id + ']]' });
const scene = DM.createContentModule(c, { type: 'scene', name: 'Confrontation', lines: [{ id: 'l1', speakerId: mira.id, text: 'I will not let another one meet death.' }] });
const desc = DM.createContentModule(c, { type: 'description', name: '', html: '<p>A cold wind. Death hangs here.</p>' });
const lonely = DM.createContentModule(c, { type: 'note', name: '', text: 'death but unassigned' });
DM.createAssignment(c, { moduleId: topic.id, entityId: mira.id });
DM.createAssignment(c, { moduleId: topic.id, entityId: bob.id });
DM.createAssignment(c, { moduleId: note.id, entityId: mira.id });
DM.createAssignment(c, { moduleId: scene.id, entityId: spire.id });
DM.createAssignment(c, { moduleId: desc.id, entityId: spire.id });

let r = Q.searchContent(c, 'death');
assert.strictEqual(r.length, 3, 'unassigned content is not offered');
assert.strictEqual(r[0].moduleId, topic.id, 'title matches first');
assert.strictEqual(r[0].assignments.length, 2, 'one result lists all its entities');
ok('title/text search, one collapsed result with several entities, unassigned excluded');
const sc = r.find((x) => x.type === 'scene');
assert.ok(sc.snippet.pre.startsWith('Mira Selven:') || sc.snippet.pre.includes('Mira Selven'), 'scene snippet carries the speaker');
assert.strictEqual(sc.snippet.hit.toLowerCase(), 'death');
ok('snippet carries the matching quote with the hit separated');
assert.strictEqual(Q.searchContent(c, 'dark bob').length, 1, 'mentions resolve to names and all words must match');
assert.strictEqual(Q.searchContent(c, 'secret zzz').length, 0);
assert.strictEqual(Q.searchContent(c, '').length, 0);
ok('all words must match; mentions are searchable by name; empty query is empty');
assert.ok(!/\*\*/.test(Q.searchContent(c, 'nobody')[0].snippet.post + Q.searchContent(c, 'nobody')[0].snippet.pre));
ok('formatting markers are stripped');
