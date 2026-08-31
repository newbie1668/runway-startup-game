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

/** Street stills on the noticed tray. Loaded even when the wide budget skips GLBs. */
export const STREET_NOTICED_ID = 'no-1-poultry';

export function isStreetNoticedId(id: string): boolean {
  return id === STREET_NOTICED_ID;
}

export function shouldLoadNoticedGlb(id: string, skipGlb: boolean): boolean {
  if (isUniqueNoticedId(id)) return false;
  if (isStreetNoticedId(id)) {
    if (typeof window === 'undefined') return true;
    if (!skipGlb) return true;
    return new URLSearchParams(window.location.search).get('look') === 'citystreet';
  }
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
        if (!shouldLoadNoticedGlb(file.id, skipGlb)) {
          if (isStreetNoticedId(file.id)) return;
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
        let prefab: THREE.Object3D = gltf.scene;
        if (isStreetNoticedId(file.id)) {
          prefab = adoptStreetNoticed(gltf.scene);
        } else {
          makeMatteLambert(gltf.scene, { keepMaps: true });
        }
        prefabs.set(file.id, prefab);
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

function isDrawMesh(obj: THREE.Object3D): obj is THREE.Mesh {
  return (obj as THREE.Mesh).isMesh === true;
}

/**
 * GLTFLoader meshes can come from a second `three` copy in the bundle.
 * Re-wrap so the city renderer will actually draw them, unlit, with the
 * still's vertex colours.
 */
function adoptStreetNoticed(src: THREE.Object3D): THREE.Group {
  const root = new THREE.Group();
  root.name = STREET_NOTICED_ID;
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    fog: true,
    side: THREE.DoubleSide,
  });
  src.updateWorldMatrix(true, true);
  src.traverse((obj) => {
    if (!isDrawMesh(obj)) return;
    const next = new THREE.Mesh(obj.geometry, mat);
    next.name = obj.name;
    next.matrix.copy(obj.matrixWorld);
    next.matrixAutoUpdate = false;
    next.frustumCulled = false;
    root.add(next);
  });
  return root;
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
  if (!isStreetNoticedId(entry.id)) {
    group.scale.y = TOWER_HEIGHT_SCALE / NOTICED_BAKE_HEIGHT_SCALE;
  }
  return group;
}
