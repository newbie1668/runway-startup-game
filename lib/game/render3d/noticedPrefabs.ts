/**
 * RUNWAY — baked "noticed tower" meshes (SFSIM layer 2).
 *
 * Loads committed glTF from /map/noticed/ (written by `pnpm bake:noticed`).
 * Missing manifest or files are skipped — the OSM extrusion stays. Only
 * imported from CityRenderer3D, behind the factory's dynamic import.
 * Albedo maps stay — these are the Kansas unique-mesh layer, not OSM paint.
 */

import * as THREE from 'three';
import { NOTICED_BAKE_HEIGHT_SCALE, TOWER_HEIGHT_SCALE } from './buildingStyle';
import { METERS_TO_WORLD } from '../geo';
import { buildUniqueNoticed, isUniqueNoticedId, uniquePlanRing } from './uniqueNoticed';
import { meshBudget } from './lookClip';
import { loadPrefabScene, type PrefabLoadOptions } from './prefabLoad';
import { batchStaticMeshes } from './staticMeshBatch';

export const NOTICED_DIR = '/map/noticed';

/** Street still on the noticed tray. Playtime does not instantiate it. */
export const STREET_NOTICED_ID = 'no-1-poultry';

export function isStreetNoticedId(id: string): boolean {
  return id === STREET_NOTICED_ID;
}

export function shouldLoadNoticedGlb(id: string, skipGlb: boolean): boolean {
  if (isUniqueNoticedId(id)) return false;
  // Uniqueness is parked. The 0873e8a still (~1.2MB, DoubleSide, unculled)
  // Aw Snapped citystreet and poisoned view=mid. Do not fetch it.
  if (isStreetNoticedId(id)) return false;
  return !skipGlb;
}

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

export async function loadNoticedPrefabs(options: PrefabLoadOptions): Promise<{
  entries: NoticedEntry[];
  prefabs: Map<string, THREE.Object3D>;
}> {
  let manifest: NoticedManifest;
  try {
    if (options.signal.aborted || !options.isCurrent()) return { entries: [], prefabs: new Map() };
    const res = await fetch(`${NOTICED_DIR}/manifest.json`, { signal: options.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (options.signal.aborted || !options.isCurrent()) return { entries: [], prefabs: new Map() };
    manifest = (await res.json()) as NoticedManifest;
    if (options.signal.aborted || !options.isCurrent()) return { entries: [], prefabs: new Map() };
  } catch (error) {
    if (!options.signal.aborted && options.isCurrent()) options.onError('asset:noticed:manifest', error);
    return { entries: [], prefabs: new Map() };
  }

  const skipGlb = typeof window !== 'undefined' && meshBudget().skipGlb;
  const entries: NoticedEntry[] = [];
  const prefabs = new Map<string, THREE.Object3D>();
  await Promise.all(
    (manifest.files ?? []).map(async (file) => {
      if (options.signal.aborted || !options.isCurrent()) return;
      if (!shouldLoadNoticedGlb(file.id, skipGlb)) {
        if (isStreetNoticedId(file.id)) return;
        if (options.signal.aborted || !options.isCurrent()) return;
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
      const scene = await loadPrefabScene(`asset:noticed:${file.id}`, `${NOTICED_DIR}/${file.file}`, options, { keepMaps: true });
      if (!scene || options.signal.aborted || !options.isCurrent()) return;
      prefabs.set(file.id, scene);
      entries.push({
        id: file.id,
        name: file.name,
        x: file.x,
        z: file.z,
        exclusionM: file.exclusionM,
        heightM: file.heightM ?? 120,
      });
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
      batchStaticMeshes(built, { keepUniquelyNamed: true });
      built.scale.y = TOWER_HEIGHT_SCALE / NOTICED_BAKE_HEIGHT_SCALE;
      return built;
    }
  }
  if (!prefab) return new THREE.Group();
  const clone = prefab.clone(true);
  const group = clone instanceof THREE.Group ? clone : new THREE.Group();
  if (!(clone instanceof THREE.Group)) group.add(clone);
  if (!isStreetNoticedId(entry.id)) {
    group.scale.y = TOWER_HEIGHT_SCALE / NOTICED_BAKE_HEIGHT_SCALE;
  }
  return group;
}
