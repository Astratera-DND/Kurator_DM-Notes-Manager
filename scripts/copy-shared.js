const path = require('path');
const { buildSharedBundle } = require('../src/copyVendor');

const info = buildSharedBundle(path.join(__dirname, '..'));
console.log(`[copy-shared] bundle written: ${info.destPath} (${info.bytes} bytes)`);
