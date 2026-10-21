// A small drag-and-drop engine for lists and trees, built on plain mouse
// events rather than the browser's native drag-and-drop.
//
// Native drag-and-drop gives no dependable control over scrolling while
// something is being dragged — and dragging from the bottom of a long list
// up to the top is exactly when that matters — and it can't be driven by
// ordinary input in a test. Doing it with mouse events means this code owns
// the whole interaction: a press only becomes a drag after the pointer has
// moved a few pixels (so a plain click still just clicks), the container
// scrolls by itself whenever the pointer sits near its top or bottom edge
// (including while the pointer is perfectly still, and including when it
// has been taken above or below the window), and the mouse wheel keeps
// working mid-drag.
//
// The engine knows nothing about groups or entities. The page tells it:
//   begin(event)        → what, if anything, a press on this spot picks up:
//                         { label, payload?, onClick?(event) } or null. onClick
//                         runs for a press that never turned into a drag.
//   targetAt(x, y, src) → what is under the pointer as a drop target:
//                         { key, valid, ...anything } or null. key identifies
//                         the target so repeated moves over the same one
//                         don't churn the highlight.
//   mark(target, on)    → show / hide the drop highlight for a target.
//   onStart(src)        → a drag has begun (dim the source, etc).
//   onDrop(src, target) → released over a valid target.
//   onCancel(src)       → released over nothing valid, or Escape / focus lost.
//   onEnd()             → always last, after either of the above.
(function () {
  const THRESHOLD = 5;      // px of movement before a press becomes a drag
  const EDGE = 64;          // px from the scroller's top/bottom where scrolling starts
  const MAX_SPEED = 26;     // px per frame, reached at the edge itself
  const OVERSHOOT = 1.6;    // taken past the edge (even out of the window) it speeds up further

  function nearestScroller(el) {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
    }
    return document.scrollingElement || document.documentElement;
  }

  function create(opts) {
    let press = null;
    let drag = null;
    let last = { x: 0, y: 0 };

    function onDown(e) {
      if (e.button !== 0 || press || drag) return;
      const source = opts.begin(e);
      if (!source) return;
      e.preventDefault(); // no text selection, no native drag image
      press = { source, startX: e.clientX, startY: e.clientY };
      last = { x: e.clientX, y: e.clientY };
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('blur', onBlur);
    }

    function onMove(e) {
      last = { x: e.clientX, y: e.clientY };
      // The button was let go somewhere this page never saw (released over
      // another window, say). Never stay stuck in a drag nobody is holding.
      if (e.buttons === 0) { finish(null, false); return; }
      if (press && !drag) {
        if (Math.hypot(e.clientX - press.startX, e.clientY - press.startY) < THRESHOLD) return;
        startDrag();
      }
      if (drag) { moveGhost(); updateTarget(); }
    }

    function onUp(e) {
      last = { x: e.clientX, y: e.clientY };
      if (drag) {
        updateTarget();
        finish(drag.target, true);
      } else if (press) {
        const source = press.source;
        teardown();
        if (source.onClick) source.onClick(e);
        if (opts.onEnd) opts.onEnd();
      }
    }

    function onKey(e) {
      if (e.key !== 'Escape' || !drag) return;
      e.stopPropagation();
      e.preventDefault();
      finish(null, false);
    }

    function onBlur() { if (drag) finish(null, false); else if (press) teardown(); }

    function startDrag() {
      const ghost = document.createElement('div');
      ghost.className = 'tdnd-ghost';
      ghost.textContent = press.source.label || '';
      document.body.appendChild(ghost);
      drag = { source: press.source, ghost, target: null, raf: 0, scroller: (opts.getScroller || nearestScroller)(opts.root) };
      document.body.classList.add('tdnd-active');
      if (opts.onStart) opts.onStart(drag.source);
      moveGhost();
      drag.raf = requestAnimationFrame(tick);
    }

    function moveGhost() {
      drag.ghost.style.transform = `translate(${last.x + 14}px, ${last.y + 12}px)`;
    }

    function updateTarget() {
      const next = opts.targetAt(last.x, last.y, drag.source);
      const same = (next ? next.key : '') === (drag.target ? drag.target.key : '');
      if (same) { if (next) drag.target = next; return; }
      if (drag.target && opts.mark) opts.mark(drag.target, false);
      if (next && opts.mark) opts.mark(next, true);
      drag.target = next;
    }

    // Runs every frame for as long as the drag lasts, not just when the
    // mouse moves — so holding the pointer at an edge keeps scrolling. The
    // content moves under a still pointer when it scrolls, so what is under
    // the pointer is looked up again afterwards.
    function tick() {
      if (!drag) return;
      const sc = drag.scroller;
      const r = sc === document.scrollingElement || sc === document.documentElement
        ? { top: 0, bottom: window.innerHeight }
        : sc.getBoundingClientRect();
      let dy = 0;
      if (last.y < r.top + EDGE) dy = -MAX_SPEED * Math.min((r.top + EDGE - last.y) / EDGE, OVERSHOOT);
      else if (last.y > r.bottom - EDGE) dy = MAX_SPEED * Math.min((last.y - (r.bottom - EDGE)) / EDGE, OVERSHOOT);
      if (dy !== 0) {
        const before = sc.scrollTop;
        sc.scrollTop += dy;
        if (sc.scrollTop !== before) updateTarget();
      }
      drag.raf = requestAnimationFrame(tick);
    }

    // A drag ends with a mouseup, and the browser then sends a click to
    // wherever the press and release have in common — which could be some
    // unrelated container with its own click handler. Swallow that one click.
    function suppressNextClick() {
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', swallow, true);
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
    }

    function teardown() {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      if (drag) {
        cancelAnimationFrame(drag.raf);
        if (drag.target && opts.mark) opts.mark(drag.target, false);
        drag.ghost.remove();
        document.body.classList.remove('tdnd-active');
      }
      press = null;
      drag = null;
    }

    function finish(target, dropAllowed) {
      const source = drag ? drag.source : null;
      suppressNextClick();
      teardown();
      if (source) {
        if (dropAllowed && target && target.valid) opts.onDrop(source, target);
        else if (opts.onCancel) opts.onCancel(source);
      }
      if (opts.onEnd) opts.onEnd();
    }

    opts.root.addEventListener('mousedown', onDown);

    return {
      isDragging: () => !!drag,
      destroy() {
        opts.root.removeEventListener('mousedown', onDown);
        if (press || drag) teardown();
      }
    };
  }

  window.TreeDnd = { create, nearestScroller };
})();
