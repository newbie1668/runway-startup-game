import type { IMapRenderer } from './scene';

export interface MapProjection {
  /** Ground point → CSS px; null when off-camera/behind. */
  worldToScreen(p: { x: number; y: number }): { x: number; y: number } | null;
  /** CSS px → ground-plane world point. */
  screenToWorld(sx: number, sy: number): { x: number; y: number };
}

export type ProjectedMapRenderer = IMapRenderer & MapProjection;

export function hasProjection(r: IMapRenderer): r is ProjectedMapRenderer {
  const c = r as Partial<MapProjection>;
  return typeof c.worldToScreen === 'function' && typeof c.screenToWorld === 'function';
}
