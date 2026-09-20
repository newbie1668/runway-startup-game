/**
 * RUNWAY — 3D-with-fallback renderer factory.
 *
 * three.js is only ever reached via the dynamic import below, so it stays
 * out of the initial JS chunk (and away from `pnpm test:ui`'s SSR render,
 * which never touches this module). Decision order: explicit `?map=` debug
 * override, a session flag from a previous fallback, a low-memory heuristic,
 * a WebGL2 support check on the actual city canvas, then construct-and-catch.
 */

import { MapRenderer } from '../render';
import type { IMapRenderer } from '../scene';
import type { MapDiagnosticsReporter } from '../mapDiagnostics';
import { meshBudget } from './lookClip';

export type RendererMode = '2d' | '3d';

function make2d(
  overlayCanvas: HTMLCanvasElement,
  diagnostics: MapDiagnosticsReporter,
  reason: string,
): { renderer: IMapRenderer; mode: RendererMode } {
  const renderer = new MapRenderer(overlayCanvas);
  diagnostics.selectMode('2d', reason);
  return { renderer, mode: '2d' };
}

export async function createMapRenderer(
  cityCanvas: HTMLCanvasElement,
  overlayCanvas: HTMLCanvasElement,
  opts: { onFatal: (reason?: string) => void; onReady?: () => void; diagnostics: MapDiagnosticsReporter },
): Promise<{ renderer: IMapRenderer; mode: RendererMode }> {
  const mapParam = new URLSearchParams(window.location.search).get('map');

  if (mapParam === '2d') return make2d(overlayCanvas, opts.diagnostics, 'explicit map=2d');

  let forced2d = false;
  try {
    forced2d = sessionStorage.getItem('runway-force-2d') === '1';
  } catch {
    forced2d = false;
  }
  if (forced2d && mapParam !== '3d') return make2d(overlayCanvas, opts.diagnostics, 'previous context loss');

  const nav = navigator as Navigator & { deviceMemory?: number };
  if (mapParam !== '3d' && typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 2) {
    return make2d(overlayCanvas, opts.diagnostics, 'low device memory');
  }

  const coarsePointer =
    typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const budget = meshBudget();
  let context: WebGL2RenderingContext | null = null;
  try {
    context = cityCanvas.getContext('webgl2', {
      alpha: false,
      antialias: !coarsePointer && !budget.skipAntialias,
      powerPreference: 'high-performance',
    });
    if (!context) return make2d(overlayCanvas, opts.diagnostics, 'WebGL2 unavailable');
    const { CityRenderer3D } = await import('./CityRenderer3D');
    const renderer = new CityRenderer3D(cityCanvas, overlayCanvas, { ...opts, context });
    opts.diagnostics.selectMode('3d');
    return { renderer, mode: '3d' };
  } catch (error) {
    opts.diagnostics.recordError('init:3d', true, error);
    try {
      context?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch (cleanupError) {
      opts.diagnostics.recordError('init:webgl-cleanup', false, cleanupError);
    }
    const message = error instanceof Error ? error.message : String(error);
    return make2d(overlayCanvas, opts.diagnostics, `3D initialization failed: ${message}`);
  }
}
