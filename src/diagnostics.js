// Tiny append-only diagnostics log (one JSON object per line).
//
// Purpose: when the app "freezes" or a save fails, there has to be something
// to look at afterwards. This writes to campaign-data/diagnostics.log.
//
// Hard rules: logging must NEVER throw, and must NEVER block the app. All
// writes are queued and done asynchronously; any error while logging is
// swallowed. The file is rotated to <file>.1 once it grows past maxBytes, so
// it can never grow without bound.
const fs = require('fs');
const path = require('path');

const MAX_STRING = 2000;
const MAX_ARRAY = 20;
const MAX_KEYS = 30;
const MAX_DEPTH = 3;

function describe(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: describe(String(value.message), depth + 1),
      code: value.code,
      stack: describe(String(value.stack || ''), depth + 1)
    };
  }
  const t = typeof value;
  if (t === 'string') return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + `…(+${value.length - MAX_STRING})` : value;
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return String(value);
  if (t === 'function') return '[function]';
  if (t === 'symbol') return String(value);
  if (depth >= MAX_DEPTH) return '[…]';
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => describe(v, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`…(+${value.length - MAX_ARRAY} more)`);
    return out;
  }
  const out = {};
  let n = 0;
  try {
    for (const k of Object.keys(value)) {
      if (n++ >= MAX_KEYS) { out['…'] = 'more keys omitted'; break; }
      try { out[k] = describe(value[k], depth + 1); } catch { out[k] = '[unreadable]'; }
    }
  } catch {
    return '[unreadable]';
  }
  return out;
}

function createDiagnostics(file, { maxBytes = 256 * 1024, now = () => new Date() } = {}) {
  let queue = [];
  let flushing = false;

  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      while (queue.length) {
        const lines = queue.join('');
        queue = [];
        try {
          await fs.promises.mkdir(path.dirname(file), { recursive: true });
          try {
            const st = await fs.promises.stat(file);
            if (st.size > maxBytes) {
              try { await fs.promises.rename(file, file + '.1'); }
              catch { try { await fs.promises.unlink(file); } catch { /* ignore */ } }
            }
          } catch { /* no file yet */ }
          await fs.promises.appendFile(file, lines, 'utf8');
        } catch { /* logging must never throw */ }
      }
    } finally {
      flushing = false;
    }
  }

  function log(kind, details) {
    try {
      const entry = { t: now().toISOString(), kind: String(kind), details: describe(details) };
      queue.push(JSON.stringify(entry) + '\n');
      flush().catch(() => {});
    } catch { /* never throw */ }
  }

  // Resolves once everything queued so far has been written (used by tests
  // and on shutdown).
  async function drain() {
    for (let i = 0; i < 200 && (flushing || queue.length); i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  return { log, drain, file };
}

module.exports = { createDiagnostics, describe };
