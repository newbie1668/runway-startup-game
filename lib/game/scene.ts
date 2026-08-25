/**
 * RUNWAY — renderer-agnostic map contract.
 *
 * Scene/HitTarget describe what the map shows and what can be clicked; both
 * the 2D canvas renderer and the 3D city renderer implement IMapRenderer
 * against these same shapes so GameApp never needs to know which one is
 * mounted.
 */

import type { HubId, SectorId } from './types';

export const SECTOR_COLORS: Record<SectorId, string> = {
  ai: '#a78bfa',
  fintech: '#34d399',
  climate: '#a3e635',
  healthtech: '#fb7185',
  devtools: '#fbbf24',
  consumer: '#f472b6',
};

export const PLAYER_COLOR = '#f8c33a';
export const EVENT_COLOR = '#7dd3fc';

export interface SceneRival {
  id: string;
  name: string;
  hubId: HubId;
  sectorId: SectorId;
  stageName: string;
  alive: boolean;
}

export interface SceneEvent {
  id: string;
  name: string;
  hubId: HubId;
  attended: boolean;
}

export interface Scene {
  mode: 'setup' | 'play';
  playerHubId: HubId | null;
  playerSectorId: SectorId | null;
  companyName: string;
  stageName: string;
  rivals: SceneRival[];
  events: SceneEvent[];
}

export type HitTarget =
  | { type: 'hub'; hubId: HubId }
  | { type: 'event'; eventId: string }
  | { type: 'rival'; rivalId: string };

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export interface IMapRenderer {
  scene: Scene;
  hover: HitTarget | null;
  resize(): void;
  fitAll(): void;
  focusHub(hubId: HubId, zoom?: number): void;
  frame(t: number, dt: number): void;
  pan(dxPx: number, dyPx: number): void;
  zoomAt(sx: number, sy: number, factor: number): void;
  hitTest(sx: number, sy: number): HitTarget | null;
  burstConfetti(hubId: HubId | null): void;
  floatText(hubId: HubId | null, text: string, color?: string): void;
  puffSmoke(hubId: HubId | null): void;
  sparkle(hubId: HubId | null): void;
  getCamera(): CameraState;
  setCamera(c: CameraState): void;
  dispose(): void;
}
