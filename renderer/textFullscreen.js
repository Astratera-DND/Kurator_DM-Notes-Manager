// Fullscreen editing for text areas.
//
// A small expand button appears in the corner of whichever textarea is hovered
// or focused. Clicking it enlarges THAT SAME <textarea> in place (position:
// fixed) -- not a copy -- so undo history, cursor, @-mention autocomplete and
// the app's normal saving keep working untouched. Esc (or the Close button, or
// clicking the dimmed background) shrinks it back.
(function () {
  const btn = document.createElement('button');
  btn.id = 'tf-expand-btn';
  btn.type = 'button';
  btn.title = 'Fullscreen editing';
  btn.setAttribute('aria-label', 'Edit in fullscreen');
  btn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  btn.style.display = 'none';

  let target = null;          // textarea the button currently belongs to
  let hideTimer = null;
  let suppressUntil = 0;      // do not show the button before this time
  let popupCheck = () => false;
  let active = null;          // { ta, placeholder, backdrop, bar }

  function eligible(ta) {
    return ta && ta.tagName === 'TEXTAREA' && ta.isConnected && !ta.readOnly && !ta.disabled &&
      !ta.hasAttribute('data-no-expand') && !ta.classList.contains('tf-fullscreen') &&
      ta.getClientRects().length > 0;
  }

  function place(ta) {
    const r = ta.getBoundingClientRect();
    if (r.width < 60 || r.height < 24) { hide(); return; }
    const x = Math.min(window.innerWidth - 30, r.right - 28);
    const y = Math.max(2, r.top + 4);
    btn.style.left = x + 'px';
    btn.style.top = y + 'px';
  }

  function show(ta) {
    if (active || Date.now() < suppressUntil || !eligible(ta)) return;
    clearTimeout(hideTimer);
    target = ta;
    place(ta);
    btn.style.display = 'flex';
  }

  function hide() {
    clearTimeout(hideTimer);
    target = null;
    btn.style.display = 'none';
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const a = document.activeElement;
      if (a && a === target && a.tagName === 'TEXTAREA') return; // still focused
      hide();
    }, 250);
  }

  function fieldTitle(ta) {
    let t = ta.getAttribute('aria-label') || '';
    if (!t) {
      const row = ta.closest('.form-row');
      const lab = row && row.querySelector('label');
      if (lab) t = lab.textContent;
    }
    if (!t && ta.id) {
      const lab = document.querySelector(`label[for="${ta.id}"]`);
      if (lab) t = lab.textContent;
    }
    if (!t) t = ta.getAttribute('placeholder') || '';
    t = (t || 'Text').split(/\s[—–-]\s/)[0].replace(/\s+/g, ' ').trim();
    return t.length > 60 ? t.slice(0, 57) + '…' : t;
  }

  function enter(ta) {
    if (active || !eligible(ta)) return;
    hide();
    const parent = ta.parentNode;
    const placeholder = document.createElement('div');
    placeholder.className = 'tf-placeholder';
    const r = ta.getBoundingClientRect();
    placeholder.style.height = r.height + 'px';
    placeholder.style.width = '100%';
    placeholder.style.flex = getComputedStyle(ta).flex;
    parent.insertBefore(placeholder, ta);

    const backdrop = document.createElement('div');
    backdrop.className = 'tf-backdrop';
    backdrop.addEventListener('mousedown', (e) => { e.preventDefault(); leave(); });

    const bar = document.createElement('div');
    bar.className = 'tf-bar';
    const title = document.createElement('span');
    title.className = 'tf-bar-title';
    title.textContent = fieldTitle(ta);
    const hint = document.createElement('span');
    hint.className = 'tf-bar-hint';
    hint.textContent = 'Esc to close';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'mini-btn';
    close.textContent = 'Close';
    close.addEventListener('mousedown', (e) => e.preventDefault());
    close.addEventListener('click', () => leave());
    bar.append(title, hint, close);

    parent.insertBefore(backdrop, ta);
    parent.insertBefore(bar, ta);
    ta.classList.add('tf-fullscreen');
    active = { ta, placeholder, backdrop, bar };
    ta.focus({ preventScroll: true });
  }

  function cleanup() {
    if (!active) return null;
    const a = active;
    active = null;
    a.ta.classList.remove('tf-fullscreen');
    for (const el of [a.placeholder, a.backdrop, a.bar]) { try { el.remove(); } catch { /* already gone */ } }
    return a.ta;
  }

  function leave() {
    const ta = cleanup();
    hide();
    // The programmatic re-focus below fires focusin; keep the button away
    // until the mouse actually moves again.
    suppressUntil = Date.now() + 400;
    if (ta && ta.isConnected) { try { ta.focus({ preventScroll: true }); } catch { /* ignore */ } }
  }

  function isActive() { return !!active; }

  // --- events ---------------------------------------------------------
  document.addEventListener('mouseover', (e) => {
    if (active) return;
    const ta = e.target && e.target.closest ? e.target.closest('textarea') : null;
    if (ta && eligible(ta)) { suppressUntil = 0; show(ta); }
    else if (!btn.contains(e.target)) scheduleHide();
  }, true);

  document.addEventListener('focusin', (e) => {
    if (active) return;
    const ta = e.target;
    if (ta && ta.tagName === 'TEXTAREA' && eligible(ta)) show(ta);
  }, true);

  document.addEventListener('mousemove', () => { suppressUntil = 0; }, true);

  btn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
  btn.addEventListener('mouseleave', scheduleHide);
  btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus/selection in the field
  btn.addEventListener('click', () => { if (target) enter(target); });

  const reposition = () => { if (target && !active) { if (eligible(target)) place(target); else hide(); } };
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);

  document.addEventListener('keydown', (e) => {
    if (!active || e.key !== 'Escape') return;
    if (popupCheck()) return; // let the app close its @-mention / picker popup first
    e.preventDefault();
    e.stopPropagation();
    leave();
  }, true);

  // If a redraw throws the field away while fullscreen, forget everything.
  // Also covers the field being hidden (e.g. switching Play/Create mode only
  // hides a view rather than removing it).
  new MutationObserver(() => {
    if (active && (!active.ta.isConnected || active.ta.getClientRects().length === 0)) { cleanup(); hide(); }
    else if (target && (!target.isConnected || target.getClientRects().length === 0)) hide();
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] });

  function init() { document.body.appendChild(btn); }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);

  window.TextFullscreen = {
    enter, leave, isActive,
    setPopupCheck(fn) { if (typeof fn === 'function') popupCheck = fn; }
  };
})();
