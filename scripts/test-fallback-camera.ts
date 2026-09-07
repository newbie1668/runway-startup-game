/** Focused regression checks for the 2D fallback camera handoff. */
import assert from 'node:assert/strict';
import { WORLD } from '../lib/game/geo';
import { MapRenderer } from '../lib/game/render';

const previousWindow = globalThis.window;

function makeRenderer() {
  const context = { setTransform() {} } as unknown as CanvasRenderingContext2D;
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 1280, height: 720 }),
  } as unknown as HTMLCanvasElement;
  const renderer = new MapRenderer(canvas);
  renderer.resize();
  return renderer;
}

function check(label: string, fn: () => void) {
  fn();
  console.log(`  ✓ ${label}`);
}

try {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { devicePixelRatio: 1 },
  });

  const renderer = makeRenderer();
  const centre = { x: WORLD.width / 2, y: WORLD.height / 2 };

  check('legal zoom round-trips unchanged', () => {
    renderer.setCamera({ ...centre, zoom: 10 });
    assert.deepStrictEqual(renderer.getCamera(), { ...centre, zoom: 10 });
  });

  check('oversized fallback zoom caps at the renderer maximum', () => {
    renderer.setCamera({ ...centre, zoom: 468.75 });
    assert.strictEqual(renderer.getCamera().zoom, 26);
    assert.deepStrictEqual(
      { x: renderer.getCamera().x, y: renderer.getCamera().y },
      centre,
    );
  });

  check('zoom below the resized minimum clamps to the fit-derived minimum', () => {
    renderer.setCamera({ ...centre, zoom: 0 });
    const fit = Math.min(1280 / WORLD.width, 720 / WORLD.height);
    assert.strictEqual(renderer.getCamera().zoom, fit * 0.85);
  });

  check('nonfinite zoom retains the current valid zoom', () => {
    renderer.setCamera({ ...centre, zoom: 12 });
    renderer.setCamera({ x: centre.x + 1, y: centre.y + 1, zoom: Number.NaN });
    assert.strictEqual(renderer.getCamera().zoom, 12);
    assert.ok(Number.isFinite(renderer.getCamera().zoom));
  });

  check('world position remains clamped', () => {
    renderer.setCamera({ x: -1000, y: WORLD.height + 1000, zoom: 12 });
    const camera = renderer.getCamera();
    assert.strictEqual(camera.x, -WORLD.width * 0.25);
    assert.strictEqual(camera.y, WORLD.height * 1.25);
  });
} finally {
  if (previousWindow === undefined) delete (globalThis as { window?: Window }).window;
  else Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
}

console.log('Fallback camera checks passed.');
