// Regression test for the "shared top-level scope" bug: when these files
// run as sibling <script> tags (or concatenated into one bundle) in a
// browser, they share ONE top-level scope — unlike Node's require(), which
// gives each file its own module scope. A duplicate top-level `const`
// (e.g. `const api` in more than one file) is invisible to node test/*.js
// runs but throws a SyntaxError in that shared-scope situation. This test
// actually exercises that shared-scope scenario to catch it.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function ok(msg) { console.log('ok  -', msg); }

const files = ['constants.js', 'dataModel.js', 'query.js', 'characterCard.js', 'transfer.js', 'graph.js'];
const bundle = files
  .map((f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8'))
  .join('\n');

// A minimal fake `window` — no `module`/`require`, matching what a real
// renderer's main-world context looks like, so each file takes the browser
// branch of its UMD check rather than the Node branch.
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);

assert.doesNotThrow(() => {
  vm.runInContext(bundle, sandbox, { filename: 'bundle.js' });
}, 'concatenated bundle must not throw when run in one shared scope, exactly as the renderer does');
ok('bundle parses and executes without a redeclaration error in a shared scope');

assert.ok(sandbox.window.Constants, 'window.Constants should be set');
assert.ok(sandbox.window.DataModel, 'window.DataModel should be set');
assert.ok(sandbox.window.Query, 'window.Query should be set');
assert.ok(sandbox.window.CharacterCard, 'window.CharacterCard should be set');
assert.ok(sandbox.window.Transfer, 'window.Transfer should be set');
assert.ok(sandbox.window.Graph, 'window.Graph should be set');
ok('window.Constants, window.DataModel, and window.Query are all defined');

assert.ok(Array.isArray(sandbox.window.Constants.COLOR_PALETTE) && sandbox.window.Constants.COLOR_PALETTE.length > 0);
assert.strictEqual(typeof sandbox.window.DataModel.createEntity, 'function');
assert.strictEqual(typeof sandbox.window.Query.getLocationView, 'function');
ok('each exposed API has real, callable content, not just an empty object');

console.log('\nAll bundle-scope tests passed.');
