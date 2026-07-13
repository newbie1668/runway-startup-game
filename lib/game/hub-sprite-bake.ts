/**
 * Bake static hub cluster PNGs from procedural draw helpers.
 * Used by scripts/bake-hub-sprites.ts — not imported in the browser bundle.
 */

import { TILE_H, TILE_W } from './iso';
import { drawHubPlaza, drawIllustratedBuilding, HUB_THEMES } from './iso-draw';
import { HUB_CLUSTERS } from './sprites';
import { HUB_SPRITE_META } from './sprite-loader';
import type { HubId } from './types';

const BAKE_ZOOM = 1.15;
const RETINA = 2;

function bakeIsoToScreen(
  ix: number,
  iy: number,
  originX: number,
  originY: number,
  zoom: number,
): { x: number; y: number } {
  return {
    x: originX + (ix - iy) * (TILE_W / 2) * zoom,
    y: originY + (ix + iy) * (TILE_H / 2) * zoom,
  };
}

export function bakeHubCluster(
  ctx: CanvasRenderingContext2D,
  hubId: HubId,
  width: number,
  height: number,
): void {
  const cluster = HUB_CLUSTERS[hubId];
  const theme = HUB_THEMES[hubId];
  const meta = HUB_SPRITE_META[hubId];
  const originX = width * meta.anchorX;
  const originY = height * meta.anchorY;
  const z = BAKE_ZOOM;

  const rx = cluster.groundRx * TILE_W * 0.5 * z;
  const ry = cluster.groundRy * TILE_H * 0.5 * z;
  const origin = bakeIsoToScreen(0, 0, originX, originY, z);

  drawHubPlaza(ctx, origin.x, origin.y, rx, ry, theme, z);

  if (theme.sign) {
    ctx.font = `600 ${Math.max(10, 11 * z)}px system-ui`;
    ctx.fillStyle = 'rgba(15,23,42,0.4)';
    ctx.textAlign = 'center';
    ctx.fillText(theme.sign, origin.x, origin.y + ry * 0.55);
  }

  const sorted = [...cluster.buildings]
    .filter((b) => b.role === 'neutral')
    .sort((a, b) => a.wx + a.wy - (b.wx + b.wy));

  for (const b of sorted) {
    const base = bakeIsoToScreen(b.wx, b.wy, originX, originY, z);
    const hw = b.w * TILE_W * 0.5 * z;
    const hd = b.d * TILE_H * 0.5 * z;
    const rise = b.h * TILE_H * z;
    drawIllustratedBuilding(ctx, base, hw, hd, rise, {
      roof: b.roof,
      left: b.left,
      right: b.right,
      accent: cluster.accent,
    }, theme.buildingStyle, {
      kind: 'neutral',
      gag: theme.gag,
      hover: false,
    });
  }

  if (theme.gag) {
    ctx.font = `${Math.max(14, 18 * z)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(theme.gag, origin.x, origin.y - ry - 10 * z);
  }
}

export function hubSpriteCanvasSize(hubId: HubId): { width: number; height: number } {
  const meta = HUB_SPRITE_META[hubId];
  const width = Math.ceil(meta.drawW * TILE_W * BAKE_ZOOM * RETINA);
  const height = Math.ceil(meta.drawH * TILE_H * BAKE_ZOOM * RETINA);
  return { width, height };
}

export const HUB_IDS = Object.keys(HUB_CLUSTERS) as HubId[];
