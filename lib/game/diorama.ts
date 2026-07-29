import type { HubId, SectorId } from './types';
import generatedManifest from './diorama-manifest.generated.json';

export interface DioramaHub {
  name: string;
  anchor: { x: number; y: number };
  accent: string;
}

function generatedAnchor(hubId: HubId) {
  return generatedManifest.hubs[hubId].anchor;
}

export const DIORAMA_HUBS: Record<HubId, DioramaHub> = {
  camden: { name: 'CAMDEN', anchor: generatedAnchor('camden'), accent: '#7656a8' },
  kingscross: {
    name: "KING'S CROSS",
    anchor: generatedAnchor('kingscross'),
    accent: '#6686a4',
  },
  soho: { name: 'SOHO', anchor: generatedAnchor('soho'), accent: '#d14f88' },
  farringdon: {
    name: 'FARRINGDON',
    anchor: generatedAnchor('farringdon'),
    accent: '#28644d',
  },
  shoreditch: {
    name: 'SHOREDITCH',
    anchor: generatedAnchor('shoreditch'),
    accent: '#e86c3a',
  },
  londonbridge: {
    name: 'LONDON BRIDGE',
    anchor: generatedAnchor('londonbridge'),
    accent: '#d9503f',
  },
  canarywharf: {
    name: 'CANARY WHARF',
    anchor: generatedAnchor('canarywharf'),
    accent: '#6686a4',
  },
  battersea: {
    name: 'BATTERSEA',
    anchor: generatedAnchor('battersea'),
    accent: '#b95038',
  },
};

export const DIORAMA_ASSETS = {
  master: generatedManifest.master,
  tokens: generatedManifest.tokens,
} as const;

export function focusAssets(hubId: HubId) {
  return generatedManifest.hubs[hubId].focus;
}

export const SECTOR_HUE_ROTATION: Record<SectorId, number> = {
  ai: 165,
  fintech: 25,
  climate: 75,
  healthtech: 315,
  devtools: 205,
  consumer: 285,
};
