/**
 * RUNWAY — baked "noticed tower" meshes (SFSIM layer 2).
 *
 * Loads committed glTF from /map/noticed/ (written by `pnpm bake:noticed`).
 * Missing manifest or files are skipped — the OSM extrusion stays. Only
 * imported from CityRenderer3D, behind the factory's dynamic import.
 * Albedo maps stay — these are the Kansas unique-mesh layer, not OSM paint.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NOTICED_BAKE_HEIGHT_SCALE, TOWER_HEIGHT_SCALE } from './buildingStyle';
import { METERS_TO_WORLD } from '../geo';
import { makeMatteLambert } from './matteGltf';
import { buildUniqueNoticed, isUniqueNoticedId, uniquePlanRing } from './uniqueNoticed';
import { meshBudget } from './lookClip';

export const NOTICED_DIR = '/map/noticed';

export interface NoticedEntry {
  id: string;
  name: string;
  x: number;
  z: number;
  exclusionM: number;
  heightM: number;
}

interface NoticedManifest {
  files?: Array<{
    id: string;
    name: string;
    file: string;
    x: number;
    z: number;
    exclusionM: number;
    heightM?: number;
  }>;
}

export async function loadNoticedPrefabs(): Promise<{
  entries: NoticedEntry[];
  prefabs: Map<string, THREE.Object3D>;
}> {
  const loader = new GLTFLoader();
  let manifest: NoticedManifest;
  try {
    const res = await fetch(`${NOTICED_DIR}/manifest.json`);
    if (!res.ok) return { entries: [], prefabs: new Map() };
    manifest = (await res.json()) as NoticedManifest;
  } catch {
    return { entries: [], prefabs: new Map() };
  }

  const skipGlb = typeof window !== 'undefined' && meshBudget().skipGlb;
  const entries: NoticedEntry[] = [];
  const prefabs = new Map<string, THREE.Object3D>();
  await Promise.all(
    (manifest.files ?? []).map(async (file) => {
      try {
        if (isUniqueNoticedId(file.id) || skipGlb) {
          prefabs.set(file.id, new THREE.Group());
          entries.push({
            id: file.id,
            name: file.name,
            x: file.x,
            z: file.z,
            exclusionM: file.exclusionM,
            heightM: file.heightM ?? 120,
          });
          return;
        }
        const gltf = await loader.loadAsync(`${NOTICED_DIR}/${file.file}`);
        makeMatteLambert(gltf.scene, { keepMaps: true });
        prefabs.set(file.id, gltf.scene);
        entries.push({
          id: file.id,
          name: file.name,
          x: file.x,
          z: file.z,
          exclusionM: file.exclusionM,
          heightM: file.heightM ?? 120,
        });
      } catch {
        // OSM extrusion remains for this footprint.
      }
    }),
  );
  return { entries, prefabs };
}

export function instantiateNoticed(
  entry: NoticedEntry,
  prefab: THREE.Object3D | null = null,
): THREE.Group {
  if (isUniqueNoticedId(entry.id)) {
    const built = buildUniqueNoticed({
      id: entry.id,
      heightWorld: entry.heightM * METERS_TO_WORLD * NOTICED_BAKE_HEIGHT_SCALE,
      ring: uniquePlanRing(entry.id),
    });
    if (built) {
      built.scale.y = TOWER_HEIGHT_SCALE / NOTICED_BAKE_HEIGHT_SCALE;
      return built;
    }
  }
  if (!prefab) return new THREE.Group();
  const clone = prefab.clone(true);
  const group = clone instanceof THREE.Group ? clone : new THREE.Group();
  if (!(clone instanceof THREE.Group)) group.add(clone);
  group.scale.y = TOWER_HEIGHT_SCALE / NOTICED_BAKE_HEIGHT_SCALE;
  return group;
}
