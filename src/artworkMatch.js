// Finds artwork files for an entity name in a folder of images.
// Pure matching logic (names in, ranked names out) plus a small folder scan.
// "Mira Selven" should find MiraSelven.png, Mira-selven.jpg, mira_selven_01.webp,
// "Selven, Mira.png", "Mira Selven (portrait).jpg" — case, spacing, separators,
// accents and trailing numbers/qualifiers don't matter.

const fs = require('fs');
const path = require('path');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function stripAccents(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
}

// "MiraSelven" -> "mira selven"; "Mira-selven_02" -> "mira selven 02"
function tokens(s) {
  return stripAccents(s)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function squash(s) { return tokens(s).join(''); }

// Score one file's base name (no extension) against an entity name. 0 = no match.
function scoreMatch(entityName, fileBase) {
  const nameTokens = tokens(entityName);
  const fileTokens = tokens(fileBase);
  if (!nameTokens.length || !fileTokens.length) return 0;
  const name = nameTokens.join('');
  const file = fileTokens.join('');
  if (name === file) return 100;                                   // MiraSelven, Mira-selven, mira_selven
  const stripNum = fileTokens.filter((t) => !/^\d+$/.test(t));
  if (stripNum.join('') === name) return 95;                        // mira_selven_02
  const sortedName = [...nameTokens].sort().join('');
  if ([...stripNum].sort().join('') === sortedName) return 90;      // Selven, Mira
  // A run of whole file tokens that spells the name (so "Mira" never matches "Miranda").
  for (let i = 0; i < fileTokens.length; i++) {
    let acc = '';
    for (let j = i; j < fileTokens.length && acc.length < name.length; j++) {
      acc += fileTokens[j];
      if (acc === name) return i === 0 ? 80 : 65;                   // MiraSelven_portrait / portrait of Mira Selven
    }
  }
  const set = new Set(fileTokens);
  if (nameTokens.length > 1 && nameTokens.every((t) => set.has(t))) return 55;   // Selven - portrait - Mira
  return 0;
}

function findMatchesIn(entityName, fileNames) {
  const out = [];
  for (const f of fileNames) {
    const ext = path.extname(f).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;
    const score = scoreMatch(entityName, path.basename(f, path.extname(f)));
    if (score > 0) out.push({ file: f, score });
  }
  out.sort((a, b) => b.score - a.score || a.file.length - b.file.length || a.file.localeCompare(b.file));
  return out;
}

// Walks the folder (a few levels deep, capped) and returns [{path,name,score}].
function findArtwork(rootDir, entityName, { maxDepth = 3, maxFiles = 20000, limit = 24 } = {}) {
  if (!rootDir || !String(entityName || '').trim()) return [];
  const files = [];
  const walk = (dir, depth) => {
    if (files.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < maxDepth && !e.name.startsWith('.')) walk(full, depth + 1); }
      else if (e.isFile()) files.push(full);
    }
  };
  walk(rootDir, 0);
  return findMatchesIn(entityName, files).slice(0, limit)
    .map((m) => ({ path: m.file, name: path.basename(m.file), score: m.score }));
}

// A path is only readable if it lies inside the artwork folder.
function isInside(rootDir, filePath) {
  if (!rootDir || !filePath) return false;
  const rel = path.relative(path.resolve(rootDir), path.resolve(filePath));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

module.exports = { scoreMatch, findMatchesIn, findArtwork, isInside, tokens, IMAGE_EXTS };
