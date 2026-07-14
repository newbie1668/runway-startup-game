/**
 * Sprite metadata and layout constants for the isometric map.
 * Procedural illustrated clusters per hub (PNG swap-ready metadata).
 */

import { SECTOR_COLORS } from './map-scene';
import type { HubId, SectorId } from './types';

export { SECTOR_COLORS };

export interface ClusterBuildingDef {
  id: string;
  wx: number;
  wy: number;
  w: number;
  d: number;
  h: number;
  roof: string;
  left: string;
  right: string;
  role: 'player' | 'rival' | 'neutral';
}

export interface HubClusterDef {
  hubId: HubId;
  groundRx: number;
  groundRy: number;
  buildings: readonly ClusterBuildingDef[];
  accent: string;
}

const base = (role: ClusterBuildingDef['role'], wx: number, wy: number, h: number, roof: string, left: string, right: string, w = 0.85, d = 0.75): ClusterBuildingDef => ({
  id: `${role}-${wx}-${wy}`,
  wx,
  wy,
  w,
  d,
  h,
  roof,
  left,
  right,
  role,
});

/** Eight unique hub cluster silhouettes — procedural v1 art. */
export const HUB_CLUSTERS: Record<HubId, HubClusterDef> = {
  shoreditch: {
    hubId: 'shoreditch',
    groundRx: 4.4,
    groundRy: 3.4,
    accent: '#e879f9',
    buildings: [
      base('player', 0, 0, 1.35, '#f59e0b', '#fdba74', '#fb923c', 1.05, 0.9),
      base('rival', 1.5, -0.35, 1.05, '#94a3b8', '#cbd5e1', '#64748b'),
      base('rival', -1.35, 0.45, 1.0, '#94a3b8', '#cbd5e1', '#64748b', 0.8, 0.7),
      base('neutral', 0.75, 1.15, 0.85, '#a78bfa', '#c4b5fd', '#8b5cf6', 0.7, 0.65),
      base('neutral', -0.85, -1.05, 0.95, '#34d399', '#6ee7b7', '#10b981', 0.75, 0.7),
    ],
  },
  kingscross: {
    hubId: 'kingscross',
    groundRx: 4.2,
    groundRy: 3.2,
    accent: '#60a5fa',
    buildings: [
      base('player', 0, 0, 1.5, '#3b82f6', '#93c5fd', '#2563eb', 1.0, 0.85),
      base('rival', 1.35, 0.2, 1.25, '#94a3b8', '#cbd5e1', '#64748b'),
      base('rival', -1.2, -0.5, 1.15, '#94a3b8', '#cbd5e1', '#64748b'),
      base('neutral', 0.5, 1.0, 1.0, '#f472b6', '#fbcfe8', '#db2777'),
    ],
  },
  soho: {
    hubId: 'soho',
    groundRx: 3.8,
    groundRy: 3.0,
    accent: '#f472b6',
    buildings: [
      base('player', 0, 0, 1.2, '#ec4899', '#fbcfe8', '#db2777', 0.95, 0.8),
      base('rival', 1.1, -0.2, 0.95, '#94a3b8', '#cbd5e1', '#64748b', 0.75, 0.65),
      base('rival', -1.0, 0.35, 0.9, '#94a3b8', '#cbd5e1', '#64748b', 0.7, 0.6),
      base('neutral', -0.6, -0.95, 0.85, '#fbbf24', '#fde68a', '#d97706'),
    ],
  },
  farringdon: {
    hubId: 'farringdon',
    groundRx: 3.9,
    groundRy: 3.1,
    accent: '#fbbf24',
    buildings: [
      base('player', 0, 0, 1.25, '#f59e0b', '#fcd34d', '#d97706'),
      base('rival', 1.25, 0.15, 1.05, '#94a3b8', '#cbd5e1', '#64748b'),
      base('neutral', -1.15, -0.25, 1.0, '#a3e635', '#d9f99d', '#65a30d'),
      base('neutral', 0.65, 1.05, 0.9, '#94a3b8', '#e2e8f0', '#64748b', 0.7, 0.65),
    ],
  },
  canarywharf: {
    hubId: 'canarywharf',
    groundRx: 4.6,
    groundRy: 3.5,
    accent: '#38bdf8',
    buildings: [
      base('player', 0, 0, 2.0, '#0ea5e9', '#7dd3fc', '#0284c7', 1.1, 0.95),
      base('rival', 1.6, -0.15, 1.75, '#94a3b8', '#cbd5e1', '#64748b', 0.9, 0.8),
      base('rival', -1.45, 0.3, 1.65, '#94a3b8', '#cbd5e1', '#64748b', 0.85, 0.75),
      base('neutral', 0.85, 1.2, 1.55, '#34d399', '#6ee7b7', '#059669', 0.8, 0.7),
      base('neutral', -0.75, -1.1, 1.7, '#60a5fa', '#93c5fd', '#2563eb', 0.75, 0.7),
    ],
  },
  londonbridge: {
    hubId: 'londonbridge',
    groundRx: 4.0,
    groundRy: 3.2,
    accent: '#fb7185',
    buildings: [
      base('player', 0, 0, 1.3, '#f43f5e', '#fda4af', '#e11d48'),
      base('rival', 1.3, -0.3, 1.05, '#94a3b8', '#cbd5e1', '#64748b'),
      base('rival', -1.2, 0.5, 1.0, '#94a3b8', '#cbd5e1', '#64748b', 0.8, 0.7),
      base('neutral', 0.7, 1.1, 0.95, '#a78bfa', '#c4b5fd', '#7c3aed', 0.75, 0.65),
    ],
  },
  camden: {
    hubId: 'camden',
    groundRx: 3.7,
    groundRy: 2.9,
    accent: '#a3e635',
    buildings: [
      base('player', 0, 0, 0.95, '#84cc16', '#bef264', '#4d7c0f', 0.9, 0.75),
      base('rival', 1.05, 0.1, 0.8, '#94a3b8', '#cbd5e1', '#64748b', 0.7, 0.6),
      base('rival', -0.95, -0.35, 0.75, '#94a3b8', '#cbd5e1', '#64748b', 0.65, 0.55),
      base('neutral', 0.55, 0.95, 0.7, '#f97316', '#fdba74', '#ea580c', 0.65, 0.55),
    ],
  },
  battersea: {
    hubId: 'battersea',
    groundRx: 4.1,
    groundRy: 3.1,
    accent: '#4ade80',
    buildings: [
      base('player', 0, 0, 1.2, '#22c55e', '#86efac', '#15803d'),
      base('rival', 1.2, -0.25, 1.0, '#94a3b8', '#cbd5e1', '#64748b'),
      base('neutral', -1.1, 0.4, 0.95, '#38bdf8', '#bae6fd', '#0284c7', 0.8, 0.7),
      base('neutral', 0.6, 1.0, 0.85, '#a78bfa', '#ddd6fe', '#7c3aed', 0.7, 0.6),
    ],
  },
};

export function sectorBuildingColors(sectorId: SectorId): { roof: string; left: string; right: string } {
  const c = SECTOR_COLORS[sectorId];
  return { roof: c, left: `${c}bb`, right: c };
}

/** Minimum hit padding in CSS pixels for mobile tap targets. */
export const MIN_HIT_PX = 44;

/** Per-hub iso nudges for stylised, mobile-readable compression. */
export const HUB_NUDGES: Record<HubId, { dx: number; dy: number }> = {
  shoreditch: { dx: 0, dy: 0 },
  kingscross: { dx: 0.15, dy: -0.2 },
  soho: { dx: -0.1, dy: 0.1 },
  farringdon: { dx: 0.05, dy: 0 },
  canarywharf: { dx: -1.1, dy: 0.55 },
  londonbridge: { dx: 0, dy: 0.25 },
  camden: { dx: 0.25, dy: -0.35 },
  battersea: { dx: -0.15, dy: 0.45 },
};

/** Road segments linking hub sites (game-optimised, not geographic). */
export const HUB_ROAD_EDGES: readonly [HubId, HubId][] = [
  ['shoreditch', 'kingscross'],
  ['shoreditch', 'farringdon'],
  ['shoreditch', 'soho'],
  ['shoreditch', 'londonbridge'],
  ['kingscross', 'farringdon'],
  ['kingscross', 'camden'],
  ['farringdon', 'soho'],
  ['soho', 'londonbridge'],
  ['londonbridge', 'canarywharf'],
  ['farringdon', 'canarywharf'],
  ['camden', 'shoreditch'],
  ['battersea', 'londonbridge'],
  ['battersea', 'soho'],
];

/** Daytime palette tokens for procedural sprites. */
export const ISO_PALETTE = {
  skyTop: '#87ceeb',
  skyBottom: '#e8f4fc',
  groundFar: '#d4e8c2',
  groundNear: '#c8ddb8',
  thames: '#5ba3c6',
  thamesBank: '#4a8fb0',
  park: '#8fbc8f',
  parkStroke: '#6b9a6b',
  road: '#9ca3af',
  roadEdge: '#6b7280',
  hubSite: 'rgba(154,181,138,0.45)',
  hubSiteStroke: '#7a9a6a',
  landmark: 'rgba(71,85,105,0.65)',
} as const;
