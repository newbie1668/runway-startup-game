/**
 * RUNWAY — 3D-with-fallback renderer factory.
 *
 * three.js is only ever reached via the dynamic import below, so it stays
 * out of the initial JS chunk (and away from `pnpm test:ui`'s SSR render,
 * which never touches this module). Decision order: explicit `?map=` debug
 * override, a session flag from a previous fallback, a WebGL2 capability
 * probe (three r163+ requires WebGL2 — this doubles as the support check),
 * a low-memory heuristic, then construct-and-catch.
 */

import { MapRenderer } from '../render';
import type { IMapRenderer } from '../scene';

export type RendererMode = '2d' | '3d';

function make2d(overlayCanvas: HTMLCanvasElement): { renderer: IMapRenderer; mode: RendererMode } {
  return { renderer: new MapRenderer(overlayCanvas), mode: '2d' };
}

export async function createMapRenderer(
  cityCanvas: HTMLCanvasElement,
  overlayCanvas: HTMLCanvasElement,
  opts: { onFatal: () => void; onReady?: () => void },
): Promise<{ renderer: IMapRenderer; mode: RendererMode }> {
  const mapParam = new URLSearchParams(window.location.search).get('map');

  if (mapParam === '2d') return make2d(overlayCanvas);

  let forced2d = false;
  try {
    forced2d = sessionStorage.getItem('runway-force-2d') === '1';
  } catch {
    forced2d = false;
  }
  if (forced2d && mapParam !== '3d') return make2d(overlayCanvas);

  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) return make2d(overlayCanvas);

  const nav = navigator as Navigator & { deviceMemory?: number };
  if (mapParam !== '3d' && typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2) {
    return make2d(overlayCanvas);
  }

  try {
    const { CityRenderer3D } = await import('./CityRenderer3D');
    const renderer = new CityRenderer3D(cityCanvas, overlayCanvas, opts);
    return { renderer, mode: '3d' };
  } catch {
    return make2d(overlayCanvas);
  }
}
