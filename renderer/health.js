// Health: keeps the app from hanging silently and records what happened when
// something goes wrong. Everything here is defensive -- nothing in this file
// may ever throw into the app.
(function () {
  const MAX_REPORTS = 60;
  let reports = 0;
  let contextProvider = () => ({});
  let lastAction = null;

  function errorInfo(e) {
    if (!e) return { message: String(e) };
    if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack };
    if (typeof e === 'object') { try { return JSON.parse(JSON.stringify(e)); } catch { return { message: String(e) }; } }
    return { message: String(e) };
  }

  function report(kind, details) {
    try {
      if (reports >= MAX_REPORTS) return;
      reports++;
      let context = {};
      try { context = contextProvider() || {}; } catch { /* ignore */ }
      const payload = Object.assign({}, details, { lastAction, context });
      if (window.core && window.core.logDiagnostic) {
        window.core.logDiagnostic(kind, payload).catch(() => {});
      }
    } catch { /* never throw */ }
  }

  // --- Non-blocking notice (replaces alert(), which blocks the whole window
  // until dismissed and can end up hidden behind it).
  function notice(message, ms = 7000) {
    try {
      let el = document.getElementById('app-notice');
      if (!el) {
        el = document.createElement('div');
        el.id = 'app-notice';
        el.setAttribute('role', 'status');
        el.onclick = () => el.remove();
        document.body.appendChild(el);
      }
      el.textContent = String(message);
      clearTimeout(el._timer);
      el._timer = setTimeout(() => el.remove(), ms);
    } catch { /* ignore */ }
  }

  function setSaveStatus(status) {
    try {
      let el = document.getElementById('save-status-banner');
      if (status && status.ok === false) {
        if (!el) {
          el = document.createElement('div');
          el.id = 'save-status-banner';
          el.setAttribute('role', 'alert');
          document.body.appendChild(el);
        }
        el.textContent = `Can't save to disk right now (${status.message || 'unknown error'}) — your changes are kept and it keeps retrying.`;
      } else if (el) {
        el.remove();
      }
    } catch { /* ignore */ }
  }

  // Records which app action ran last and reports any that take long.
  function wrapActions(app) {
    if (!app) return;
    for (const key of Object.keys(app)) {
      const fn = app[key];
      if (typeof fn !== 'function') continue;
      app[key] = function (...args) {
        lastAction = key;
        const t0 = performance.now();
        let result;
        try {
          result = fn.apply(this, args);
        } catch (err) {
          report('action-error', { action: key, err: errorInfo(err) });
          throw err;
        }
        const finish = () => {
          const took = performance.now() - t0;
          if (took > 250) report('slow-action', { action: key, ms: Math.round(took) });
        };
        if (result && typeof result.then === 'function') {
          result.then(finish, (err) => report('action-error', { action: key, err: errorInfo(err) }));
        } else {
          finish();
        }
        return result;
      };
    }
  }

  window.addEventListener('error', (e) => {
    report('error', { message: e.message, source: e.filename, line: e.lineno, col: e.colno, err: errorInfo(e.error) });
  });
  window.addEventListener('unhandledrejection', (e) => {
    report('unhandled-rejection', { reason: errorInfo(e.reason) });
  });

  // Stall detector: a 500ms timer that fires >1.5s late means the page's main
  // thread was busy (only counted while the window is visible).
  try {
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      const lag = now - last - 500;
      last = now;
      if (lag > 1500 && document.visibilityState === 'visible') report('stall', { lagMs: Math.round(lag) });
    }, 500);
    if (window.PerformanceObserver) {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= 500) report('long-task', { ms: Math.round(entry.duration) });
        }
      });
      po.observe({ entryTypes: ['longtask'] });
    }
  } catch { /* longtask unsupported -- fine */ }

  window.Health = {
    report,
    notice,
    setSaveStatus,
    wrapActions,
    errorInfo,
    setContextProvider(fn) { if (typeof fn === 'function') contextProvider = fn; }
  };
})();
