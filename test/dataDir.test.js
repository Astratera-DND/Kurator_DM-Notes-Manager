const assert = require('assert');
const path = require('path');
const { resolveDataDir } = require('../src/dataDir');
function ok(m) { console.log('ok  -', m); }

assert.strictEqual(resolveDataDir('/proj', { isPackaged: false, env: {} }), '/proj');
ok('from source the project folder is used, as before');
assert.strictEqual(resolveDataDir('/app.asar', { isPackaged: true, env: { PORTABLE_EXECUTABLE_DIR: '/games/kurator' }, execPath: '/tmp/x/app.exe' }), '/games/kurator');
assert.strictEqual(resolveDataDir('/app.asar', { isPackaged: true, env: {}, execPath: '/opt/k/kurator' }), '/opt/k');
ok('packaged: next to the portable exe');
assert.strictEqual(resolveDataDir('/proj', { isPackaged: true, env: { KURATOR_DATA_DIR: '/data' } }), path.resolve('/data'));
ok('KURATOR_DATA_DIR overrides');
