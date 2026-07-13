/**
 * Isometric projection layered on RUNWAY world coordinates (from geo.project).
 */

import { HUBS } from './content';
import { project, type WorldPoint } from './geo';
import type { HubId } from './types';
import { HUB_NUDGES } from './sprites';

export const TILE_W = 48;
export const TILE_H = 24;

/** World units → isometric grid units. */
export const WORLD_TO_ISO = 0.042;

export interface IsoPoint {
  ix: number;
  iy: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface IsoCamera {
  /** Screen-space pan offset (pixels). */
  panX: number;
  panY: number;
  /** Scales isometric tile size. */
  zoom: number;
}

export function worldToIso(p: WorldPoint): IsoPoint {
  return { ix: p.x * WORLD_TO_ISO, iy: p.y * WORLD_TO_ISO };
}

export function hubIsoPoint(hubId: HubId): IsoPoint {
  const hub = HUBS.find((h) => h.id === hubId);
  if (!hub) return { ix: 0, iy: 0 };
  const iso = worldToIso(project([hub.lng, hub.lat]));
  const nudge = HUB_NUDGES[hubId];
  return { ix: iso.ix + nudge.dx, iy: iso.iy + nudge.dy };
}

export function isoToScreen(
  iso: IsoPoint,
  cam: IsoCamera,
  viewW: number,
  viewH: number,
): ScreenPoint {
  const cx = viewW / 2 + cam.panX;
  const cy = viewH / 2 + cam.panY;
  const z = cam.zoom;
  return {
    x: (iso.ix - iso.iy) * (TILE_W / 2) * z + cx,
    y: (iso.ix + iso.iy) * (TILE_H / 2) * z + cy,
  };
}

export function screenToIso(
  sx: number,
  sy: number,
  cam: IsoCamera,
  viewW: number,
  viewH: number,
): IsoPoint {
  const cx = viewW / 2 + cam.panX;
  const cy = viewH / 2 + cam.panY;
  const z = cam.zoom;
  const px = (sx - cx) / z;
  const py = (sy - cy) / z;
  return {
    ix: (px / (TILE_W / 2) + py / (TILE_H / 2)) / 2,
    iy: (py / (TILE_H / 2) - px / (TILE_W / 2)) / 2,
  };
}

export function worldToScreen(
  world: WorldPoint,
  cam: IsoCamera,
  viewW: number,
  viewH: number,
): ScreenPoint {
  return isoToScreen(worldToIso(world), cam, viewW, viewH);
}
