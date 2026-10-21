// Pure math for the square image cropper — no DOM/canvas APIs at all, so
// this is fully unit-testable in isolation. app.js owns the actual canvas
// drawing and mouse-drag/zoom-slider event wiring; this module just
// answers three questions: what's the minimum zoom (the scale at which
// the image exactly covers the square viewport, no smaller), what's the
// valid range for panning at a given zoom level, and given the current
// pan+zoom, which square region of the source image's own pixels should
// end up in the final crop.
//
// Wrapped in an IIFE so it can join the shared vendor bundle alongside
// constants.js/dataModel.js/query.js, exposing window.ImageCrop in the
// renderer the same way those expose window.Constants etc, while still
// being plain CommonJS-requirable from Node for the test suite.
(function () {
  // The scale at which the image, displayed at naturalSize * scale, exactly
  // covers a square viewport of viewportSize (i.e. CSS object-fit: cover) —
  // the minimum allowed zoom, since anything smaller would reveal empty
  // space around the image inside the viewport. Using the larger of the
  // two per-axis ratios is what makes the *shorter* axis exactly fill the
  // viewport while the longer axis overflows it (rather than the other way
  // around, which would leave gaps).
  function baseCoverScale(naturalWidth, naturalHeight, viewportSize) {
    return Math.max(viewportSize / naturalWidth, viewportSize / naturalHeight);
  }

  // The offset (image's top-left corner, relative to the viewport's own
  // top-left corner) that centers the image within the viewport at the
  // given displayed size. At minimum zoom this only actually shifts one
  // axis — the other's displayed size already exactly equals the viewport
  // size, so its offset lands on exactly 0.
  function centeredOffset(displayedSize, viewportSize) {
    return (viewportSize - displayedSize) / 2;
  }

  // Clamps a pan offset so the image can never be dragged far enough to
  // reveal empty space inside the viewport: the image's top-left corner
  // can't start after the viewport's own top-left (offset > 0), and its
  // bottom-right corner can't end before the viewport's bottom-right
  // (offset < viewportSize - displayedSize).
  function clampOffset(offset, displayedSize, viewportSize) {
    const min = Math.min(0, viewportSize - displayedSize);
    return Math.max(min, Math.min(0, offset));
  }

  // Given the current pan/zoom state, returns the square region of the
  // SOURCE image — in the image's own natural pixel coordinates, not
  // screen/CSS pixels — that's currently showing inside the viewport. This
  // is exactly the region a canvas drawImage call should read from to
  // produce the final crop.
  function computeCropRegion({ viewportSize, displayScale, offsetX, offsetY }) {
    return {
      x: (-offsetX / displayScale) || 0,
      y: (-offsetY / displayScale) || 0,
      size: viewportSize / displayScale
    };
  }

  const api = { baseCoverScale, centeredOffset, clampOffset, computeCropRegion };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    window.ImageCrop = api;
  }
})();
