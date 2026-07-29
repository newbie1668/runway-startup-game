import type { HubId, SectorId } from './types';

export interface SceneRival {
  id: string;
  name: string;
  hubId: HubId;
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
  rivals: SceneRival[];
  events: SceneEvent[];
}

export type HitTarget =
  | { type: 'hub'; hubId: HubId }
  | { type: 'event'; eventId: string }
  | { type: 'rival'; rivalId: string };

export interface DioramaController {
  fitAll(): void;
  focusHub(hubId: HubId): void;
  burstConfetti(hubId: HubId | null): void;
  floatText(hubId: HubId | null, text: string, color?: string): void;
  puffSmoke(hubId: HubId | null): void;
  sparkle(hubId: HubId | null): void;
}
