/**
 * RUNWAY — baked landmark meshes.
 *
 * Loads committed glTF from /map/landmarks/<kind>.glb (written by
 * `pnpm bake:landmarks`). Missing or failed files fall back to the
 * procedural builders in landmarks.ts. This module is only imported from
 * CityRenderer3D, behind the factory's dynamic import of three.js.
 */

import * as THREE from 'three';
import { LANDMARKS, isDeckLandmark, type LandmarkKind } from '../geo';
import { build as buildLandmark } from './landmarks';
import { meshBudget } from './lookClip';
import { loadPrefabScene, type PrefabLoadOptions } from './prefabLoad';

export const LANDMARK_GLB_DIR = '/map/landmarks';

/** Unique silhouettes stay procedural so pale steel / stone survive playtime. */
const PLAYTIME_PROCEDURAL: ReadonlySet<LandmarkKind> = new Set([
  'towerlondon',
  'canadasq',
  'gherkin',
  'walkie',
  'grater',
  'shard',
  'bishop',
  'heron',
  'tower42',
  'eye',
  'lcy',
  'buckingham',
]);

export function isPlaytimeProceduralKind(kind: LandmarkKind): boolean {
  return PLAYTIME_PROCEDURAL.has(kind) || (isDeckLandmark(kind) && kind !== 'oldstreet');
}

export async function loadLandmarkPrefabs(options: PrefabLoadOptions): Promise<Map<LandmarkKind, THREE.Object3D>> {
  if (typeof window !== 'undefined' && meshBudget().skipGlb) return new Map();
  const kinds = [...new Set(LANDMARKS.map((l) => l.kind))].filter(
    (kind) => !isPlaytimeProceduralKind(kind),
  );
  const prefabs = new Map<LandmarkKind, THREE.Object3D>();
  await Promise.all(
    kinds.map(async (kind) => {
      const scene = await loadPrefabScene(`asset:landmark:${kind}`, `${LANDMARK_GLB_DIR}/${kind}.glb`, options);
      if (scene && options.isCurrent() && !options.signal.aborted) prefabs.set(kind, scene);
    }),
  );
  return prefabs;
}

export function instantiateLandmark(
  kind: LandmarkKind,
  prefabs: Map<LandmarkKind, THREE.Object3D>,
): THREE.Group {
  // River decks and unique skyline meshes stay procedural so asphalt / pale
  // steel are not stuck in a stale GLB or crushed by makeMatteLambert.
  if (isPlaytimeProceduralKind(kind)) {
    return buildLandmark(kind);
  }
  const prefab = prefabs.get(kind);
  if (!prefab) return buildLandmark(kind);
  const clone = prefab.clone(true);
  if (clone instanceof THREE.Group) return clone;
  const group = new THREE.Group();
  group.add(clone);
  return group;
}
