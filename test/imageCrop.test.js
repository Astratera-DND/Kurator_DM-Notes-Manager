const assert = require('assert');
const { baseCoverScale, centeredOffset, clampOffset, computeCropRegion } = require('../src/imageCrop');

function ok(msg) { console.log('ok  -', msg); }

// --- Test 1: baseCoverScale picks the scale that makes the shorter axis
// exactly fill the viewport, letting the longer axis overflow (cover
// behavior, not contain) --------------------------------------------------
{
  // Wide image: height is the constraining (shorter) axis.
  const wideScale = baseCoverScale(800, 400, 300);
  assert.strictEqual(wideScale, 0.75, 'a wide image\'s cover scale should be driven by its height (the shorter axis)');
  assert.ok(800 * wideScale >= 300 && 400 * wideScale >= 300, 'at cover scale, both axes must be at least the viewport size');
  assert.strictEqual(400 * wideScale, 300, 'the shorter axis (height) should land exactly on the viewport size, not overshoot it');

  // Tall image: symmetric case, width is now the constraining axis.
  const tallScale = baseCoverScale(400, 800, 300);
  assert.strictEqual(tallScale, 0.75);
  assert.strictEqual(400 * tallScale, 300, 'for a tall image, width is the shorter axis and should land exactly on the viewport size');

  // Square image: both axes agree.
  const squareScale = baseCoverScale(500, 500, 300);
  assert.strictEqual(squareScale, 0.6);

  ok('baseCoverScale correctly implements cover behavior (shorter axis exactly fills the viewport) for wide, tall, and square images');
}

// --- Test 2: centeredOffset -------------------------------------------------
{
  assert.strictEqual(centeredOffset(300, 300), 0, 'no overflow means no centering offset needed');
  assert.strictEqual(centeredOffset(600, 300), -150, 'overflow should be split evenly, offset negative (image shifted left/up to center the overflow)');
  ok('centeredOffset correctly centers an overflowing dimension');
}

// --- Test 3: clampOffset ----------------------------------------------------
{
  // Exact fit -- no room to pan at all, range is [0, 0].
  assert.strictEqual(clampOffset(0, 300, 300), 0);
  assert.strictEqual(clampOffset(50, 300, 300), 0, 'even a positive offset attempt should clamp to 0 when there is no overflow to pan into');
  assert.strictEqual(clampOffset(-50, 300, 300), 0, 'a negative offset attempt should also clamp to 0 when there is no overflow');

  // Overflowing image (displayedSize 600 in a 300 viewport) -- valid
  // range is [-300, 0].
  assert.strictEqual(clampOffset(50, 600, 300), 0, 'an offset attempting to move past the viewport\'s own edge should clamp to 0');
  assert.strictEqual(clampOffset(-1000, 600, 300), -300, 'an offset attempting to drag the image\'s far edge past the viewport should clamp to the minimum');
  assert.strictEqual(clampOffset(-150, 600, 300), -150, 'a valid, in-range offset should pass through completely unchanged');

  ok('clampOffset keeps panning within exactly the range that never reveals empty space, and never disturbs an already-valid offset');
}

// --- Test 4: computeCropRegion basic behavior -------------------------------
{
  // No pan, displayScale 1 -- crop region should start at the image's own origin.
  let region = computeCropRegion({ viewportSize: 300, displayScale: 1, offsetX: 0, offsetY: 0 });
  assert.deepStrictEqual(region, { x: 0, y: 0, size: 300 });

  // Panned -50/-30 -- crop region's origin should shift by offset/scale.
  region = computeCropRegion({ viewportSize: 300, displayScale: 1, offsetX: -50, offsetY: -30 });
  assert.deepStrictEqual(region, { x: 50, y: 30, size: 300 });

  // Zooming in (higher displayScale) should narrow the visible natural-pixel
  // region -- a tighter crop, showing less of the source image, not more.
  const zoomedOut = computeCropRegion({ viewportSize: 300, displayScale: 1, offsetX: 0, offsetY: 0 });
  const zoomedIn = computeCropRegion({ viewportSize: 300, displayScale: 2, offsetX: 0, offsetY: 0 });
  assert.ok(zoomedIn.size < zoomedOut.size, 'zooming in should narrow the crop region, not widen it');
  assert.strictEqual(zoomedIn.size, 150);

  ok('computeCropRegion correctly maps pan/zoom screen state back to source-image natural pixel coordinates');
}

// --- Test 5: full integration scenario, hand-traced -------------------------
// An 800x400 wide image dropped into a 300x300 viewport, left completely
// untouched (default zoom, centered, no drag) -- the crop should be
// exactly the centered 400x400 square: the image's full height, and the
// middle 400 of its 800-pixel width. This is the single most common case
// (a user picks a wide photo and just hits Save without adjusting anything)
// and needs to look obviously correct, not just pass isolated unit checks.
{
  const naturalWidth = 800;
  const naturalHeight = 400;
  const viewportSize = 300;

  const scale = baseCoverScale(naturalWidth, naturalHeight, viewportSize);
  const displayedWidth = naturalWidth * scale;
  const displayedHeight = naturalHeight * scale;
  const offsetX = centeredOffset(displayedWidth, viewportSize);
  const offsetY = centeredOffset(displayedHeight, viewportSize);

  assert.strictEqual(scale, 0.75);
  assert.strictEqual(displayedWidth, 600);
  assert.strictEqual(displayedHeight, 300);
  assert.strictEqual(offsetX, -150);
  assert.strictEqual(offsetY, 0);

  const region = computeCropRegion({ viewportSize, displayScale: scale, offsetX, offsetY });
  assert.strictEqual(region.x, 200, 'should start 200px in from the left, leaving out 200px on each side of the 800px-wide image');
  assert.strictEqual(region.y, 0, 'should start at the very top, using the image\'s full height');
  assert.strictEqual(region.size, 400, 'should be a 400x400 natural-pixel square -- the image\'s full height, centered horizontally');
  assert.strictEqual(region.x + region.size, 600, 'the crop should end exactly 200px from the right edge too, confirming it is centered, not off to one side');

  ok('a wide image left at default zoom/pan crops to the correct centered square using its full height, verified by hand-traced values');
}

console.log('\nAll image crop math tests passed.');
