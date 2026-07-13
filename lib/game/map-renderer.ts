/**
 * Shared map renderer contract implemented by the isometric renderer.
 */

import type { HubId } from './types';
import type { HitTarget, Scene } from './map-scene';

export interface MapRendererApi {
  scene: Scene;
  hover: HitTarget | null;
  resize(): void;
  fitAll(): void;
  pan(dx: number, dy: number): void;
  zoomAt(sx: number, sy: number, factor: number): void;
  hitTest(sx: number, sy: number): HitTarget | null;
  frame(t: number, dt: number): void;
  burstConfetti(hubId: HubId | null): void;
  floatText(hubId: HubId | null, text: string, color?: string): void;
  puffSmoke(hubId: HubId | null): void;
  sparkle(hubId: HubId | null): void;
}
