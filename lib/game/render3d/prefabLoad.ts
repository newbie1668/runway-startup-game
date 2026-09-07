import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ResourcePool } from './sceneResources';
import { retainMatteScene, retainSceneResources } from './sceneResourceTree';
import type { MatteGltfOptions } from './matteGltf';

export type PrefabLoadOptions = {
  resources: ResourcePool;
  signal: AbortSignal;
  isCurrent: () => boolean;
  onError: (id: string, error: unknown) => void;
};

function obsolete(options: PrefabLoadOptions): boolean {
  return options.signal.aborted || !options.isCurrent();
}

function releaseLateScene(resources: ResourcePool, scene: THREE.Object3D): void {
  const release = retainSceneResources(resources, scene);
  release();
}

/** Fetch and parse a committed GLB while preserving renderer-generation ownership. */
export async function loadPrefabScene(
  id: string,
  url: string,
  options: PrefabLoadOptions,
  matteOptions?: MatteGltfOptions,
): Promise<THREE.Object3D | null> {
  if (obsolete(options)) return null;
  let scene: THREE.Object3D | null = null;
  let release: (() => void) | null = null;
  try {
    const response = await fetch(url, { signal: options.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (obsolete(options)) return null;
    const data = await response.arrayBuffer();
    if (obsolete(options)) return null;
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    scene = (await new GLTFLoader().parseAsync(data, base)).scene;
    if (obsolete(options)) {
      releaseLateScene(options.resources, scene);
      return null;
    }
    release = retainMatteScene(options.resources, scene, matteOptions);
    if (obsolete(options)) {
      release();
      return null;
    }
    return scene;
  } catch (error) {
    const cleanup: unknown[] = [];
    if (release) {
      try { release(); } catch (releaseError) { cleanup.push(releaseError); }
    } else if (scene) {
      try { releaseLateScene(options.resources, scene); } catch (releaseError) { cleanup.push(releaseError); }
    }
    if (obsolete(options)) return null;
    options.onError(id, cleanup.length ? new AggregateError([error, ...cleanup], `Prefab ${id} failed`) : error);
    return null;
  }
}
