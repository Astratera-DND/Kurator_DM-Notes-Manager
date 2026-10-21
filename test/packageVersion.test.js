const assert = require('assert');
const pkg = require('../package.json');
// electron-builder (and npm) only accept three-part versions such as 1.0.0 or 1.2.3-beta.1.
// A four-part "0.1.0.0" makes the exe build fail with "Invalid version".
assert.ok(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version),
  `package.json "version" must look like 1.0.0 (three numbers), got "${pkg.version}"`);
console.log('ok  - package.json version is a valid three-part version:', pkg.version);
