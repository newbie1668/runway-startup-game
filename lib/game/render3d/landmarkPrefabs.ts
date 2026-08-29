/**
 * RUNWAY — baked landmark meshes.
 *
 * Loads committed glTF from /map/landmarks/<kind>.glb (written by
 * `pnpm bake:landmarks`). Missing or failed files fall back to the
 * procedural builders in landmarks.ts. This module is only imported from
 * CityRenderer3D, behind the factory's dynamic import of three.js.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LANDMARKS, isDeckLandmark, type LandmarkKind } from '../geo';
import { build as buildLandmark } from './landmarks';
import { makeMatteLambert } from './matteGltf';

export const LANDMARK_GLB_DIR = '/map/landmarks';

export async function loadLandmarkPrefabs(): Promise<Map<LandmarkKind, THREE.Object3D>> {
  const loader = new GLTFLoader();
  const kinds = [...new Set(LANDMARKS.map((l) => l.kind))];
  const prefabs = new Map<LandmarkKind, THREE.Object3D>();
  await Promise.all(
    kinds.map(async (kind) => {
      try {
        const gltf = await loader.loadAsync(`${LANDMARK_GLB_DIR}/${kind}.glb`);
        makeMatteLambert(gltf.scene);
        prefabs.set(kind, gltf.scene);
      } catch {
        // Procedural builder is the fallback at instantiate time.
      }
    }),
  );
  return prefabs;
}

export function instantiateLandmark(
  kind: LandmarkKind,
  prefabs: Map<LandmarkKind, THREE.Object3D>,
): THREE.Group {
  // River decks stay procedural so asphalt/join fixes are not stuck in a stale GLB.
  // Tower of London too: pale Caen stone must not go through makeMatteLambert's
  // photogrammetry-white → navy-glass crush.
  if ((isDeckLandmark(kind) && kind !== 'oldstreet') || kind === 'towerlondon') {
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
