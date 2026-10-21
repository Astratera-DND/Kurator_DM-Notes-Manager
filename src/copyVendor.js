const fs = require('fs');
const path = require('path');

// Concatenates the shared logic modules into ONE file, renderer/vendor-bundle.js,
// loaded by a single <script> tag — structurally identical to how app.js is
// already loaded (same directory, same mechanism), which is proven to work.
// Avoids any possibility of a multi-file-loading difference mattering.
// Called directly from main.js on every launch, not just via an npm
// lifecycle hook, so this can never silently fail to happen regardless of
// how the app is started.
const SOURCE_FILES = ['constants.js', 'dataModel.js', 'conditions.js', 'quests.js', 'query.js', 'imageCrop.js', 'notionImport.js', 'characterCard.js', 'transfer.js', 'graph.js'];
const BUNDLE_NAME = 'vendor-bundle.js';

function buildSharedBundle(baseDir) {
  const srcDir = path.join(baseDir, 'src');
  const destDir = path.join(baseDir, 'renderer');
  fs.mkdirSync(destDir, { recursive: true });

  const parts = SOURCE_FILES.map((f) => {
    const full = path.join(srcDir, f);
    const content = fs.readFileSync(full, 'utf8');
    return `// ---- ${f} ----\n${content}\n`;
  });
  const bundle = parts.join('\n');
  const destPath = path.join(destDir, BUNDLE_NAME);
  fs.writeFileSync(destPath, bundle, 'utf8');

  return { destPath, bytes: bundle.length };
}

module.exports = { buildSharedBundle, BUNDLE_NAME };
