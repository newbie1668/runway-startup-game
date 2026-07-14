/**
 * Map scene types shared by renderers and the game shell.
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
  | { type: 'rival'; rivalId: string }
  | { type: 'player' };

export interface MapHit {
  target: HitTarget;
  x: number;
  y: number;
}
