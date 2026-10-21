// Where the app keeps its own data (campaign-data/ and settings.json).
//
//  * Running from source (`npm start` / start.bat): the project folder, exactly
//    as it always was — nothing changes for a source install.
//  * Packaged app (the portable .exe): the folder the .exe lives in. The app's
//    own files sit inside a read-only archive there, so they can't hold data.
//    electron-builder's portable build unpacks itself to a temp folder and
//    tells us the real location through PORTABLE_EXECUTABLE_DIR.
//  * KURATOR_DATA_DIR overrides both (handy for tests or a shared drive).

const path = require('path');

function resolveDataDir(appDir, { isPackaged = false, env = process.env, execPath = process.execPath } = {}) {
  if (env.KURATOR_DATA_DIR && String(env.KURATOR_DATA_DIR).trim()) return path.resolve(env.KURATOR_DATA_DIR);
  if (isPackaged) return env.PORTABLE_EXECUTABLE_DIR || path.dirname(execPath);
  return appDir;
}

module.exports = { resolveDataDir };
