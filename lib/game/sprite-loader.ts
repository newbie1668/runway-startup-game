/**
 * Hub cluster sprite metadata. PNG/SVG assets live under /map/hubs/.
 * Renderer uses procedural illustration when assets are not loaded.
 */

import type { HubId } from './types';

export interface HubSpriteMeta {
  hubId: HubId;
  /** Asset path relative to public/ */
  assetPath: string;
  /** World-units: sprite anchor at cluster centre */
  anchorX: number;
  anchorY: number;
  /** Draw width in iso tile units at zoom=1 */
  drawW: number;
  drawH: number;
}

/** Hubs with hand-illustrated cluster PNGs — skip procedural building draws. */
export const ILLUSTRATED_HUBS: ReadonlySet<HubId> = new Set(['shoreditch']);

export function isIllustratedHub(hubId: HubId): boolean {
  return ILLUSTRATED_HUBS.has(hubId);
}

export const HUB_SPRITE_META: Record<HubId, HubSpriteMeta> = {
  shoreditch: { hubId: 'shoreditch', assetPath: '/map/hubs/shoreditch.png', anchorX: 0.5, anchorY: 0.55, drawW: 9.2, drawH: 7.4 },
  kingscross: { hubId: 'kingscross', assetPath: '/map/hubs/kingscross.png', anchorX: 0.5, anchorY: 0.55, drawW: 8.8, drawH: 7.0 },
  soho: { hubId: 'soho', assetPath: '/map/hubs/soho.png', anchorX: 0.5, anchorY: 0.55, drawW: 8.0, drawH: 6.4 },
  farringdon: { hubId: 'farringdon', assetPath: '/map/hubs/farringdon.png', anchorX: 0.5, anchorY: 0.55, drawW: 8.2, drawH: 6.6 },
  canarywharf: { hubId: 'canarywharf', assetPath: '/map/hubs/canarywharf.png', anchorX: 0.5, anchorY: 0.52, drawW: 10.0, drawH: 8.2 },
  londonbridge: { hubId: 'londonbridge', assetPath: '/map/hubs/londonbridge.png', anchorX: 0.5, anchorY: 0.55, drawW: 8.4, drawH: 6.8 },
  camden: { hubId: 'camden', assetPath: '/map/hubs/camden.png', anchorX: 0.5, anchorY: 0.55, drawW: 7.6, drawH: 6.2 },
  battersea: { hubId: 'battersea', assetPath: '/map/hubs/battersea.png', anchorX: 0.5, anchorY: 0.55, drawW: 8.6, drawH: 6.8 },
};

export type SpriteLoadState = 'idle' | 'loading' | 'ready' | 'failed';

const cache = new Map<string, HTMLImageElement | 'failed'>();

export function loadHubSprite(path: string): Promise<HTMLImageElement | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const hit = cache.get(path);
  if (hit === 'failed') return Promise.resolve(null);
  if (hit instanceof HTMLImageElement && hit.complete) return Promise.resolve(hit);

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      cache.set(path, img);
      resolve(img);
    };
    img.onerror = () => {
      cache.set(path, 'failed');
      resolve(null);
    };
    img.src = path;
  });
}

export function getCachedSprite(path: string): HTMLImageElement | null {
  const hit = cache.get(path);
  return hit instanceof HTMLImageElement ? hit : null;
}

export function preloadHubSprites(): void {
  if (typeof window === 'undefined') return;
  for (const meta of Object.values(HUB_SPRITE_META)) {
    void loadHubSprite(meta.assetPath);
  }
}
