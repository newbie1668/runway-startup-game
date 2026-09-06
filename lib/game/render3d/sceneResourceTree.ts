import * as THREE from 'three';
import type { ResourcePool } from './sceneResources';
import { makeMatteLambert, type MatteGltfOptions } from './matteGltf';

type Disposable = { dispose(): void };
type TextureLike = THREE.Texture & { isTexture?: boolean };

const bitmapWrappers = new WeakMap<object, Disposable>();

function isTexture(value: unknown): value is TextureLike {
  return value instanceof THREE.Texture || (typeof value === 'object' && value !== null && (value as TextureLike).isTexture === true);
}

function bitmapResource(value: unknown): Disposable | null {
  if (typeof ImageBitmap === 'undefined' || typeof ImageBitmap !== 'undefined' && !(value instanceof ImageBitmap)) return null;
  if (typeof value !== 'object' || value === null || typeof (value as { close?: unknown }).close !== 'function') return null;
  let wrapper = bitmapWrappers.get(value);
  if (!wrapper) {
    wrapper = { dispose: () => (value as ImageBitmap).close() };
    bitmapWrappers.set(value, wrapper);
  }
  return wrapper;
}

function addTextureResources(texture: TextureLike, resources: Set<Disposable>): void {
  resources.add(texture);
  const image = texture.image as unknown;
  if (Array.isArray(image)) {
    for (const item of image) {
      const bitmap = bitmapResource(item);
      if (bitmap) resources.add(bitmap);
    }
  } else {
    const bitmap = bitmapResource(image);
    if (bitmap) resources.add(bitmap);
  }
}

function addMaterialTextures(material: THREE.Material, resources: Set<Disposable>): void {
  for (const key of Object.keys(material)) {
    const value = (material as unknown as Record<string, unknown>)[key];
    if (isTexture(value)) addTextureResources(value, resources);
    else if (Array.isArray(value)) {
      for (const item of value) if (isTexture(item)) addTextureResources(item, resources);
    }
  }
  if (!(material instanceof THREE.ShaderMaterial)) return;
  const visited = new Set<object>();
  const visit = (value: unknown): void => {
    if (isTexture(value)) {
      addTextureResources(value, resources);
      return;
    }
    if (typeof value !== 'object' || value === null || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
    } else {
      for (const item of Object.values(value)) visit(item);
    }
  };
  visit(material.uniforms);
}

function collectSceneResources(root: THREE.Object3D): Set<Disposable> {
  const resources = new Set<Disposable>();
  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      isMesh?: boolean; isLine?: boolean; isSprite?: boolean;
      geometry?: Disposable; material?: THREE.Material | THREE.Material[];
    };
    if (object instanceof THREE.Mesh || renderable.isMesh === true || renderable.isLine === true || renderable.isSprite === true) {
      if (renderable.geometry) resources.add(renderable.geometry);
      const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
      for (const material of materials) if (material) {
        resources.add(material);
        addMaterialTextures(material, resources);
      }
    }
    if (object instanceof THREE.InstancedMesh || (object as THREE.Object3D & { isInstancedMesh?: boolean }).isInstancedMesh === true) {
      resources.add(object as unknown as Disposable);
    }
  });
  return resources;
}

function releaseAll(releases: Array<() => void>): void {
  const errors: unknown[] = [];
  for (const release of releases) {
    try { release(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Scene resource release failed');
}

export function retainSceneResources(pool: ResourcePool, root: THREE.Object3D): () => void {
  const releases: Array<() => void> = [];
  const errors: unknown[] = [];
  for (const resource of collectSceneResources(root)) {
    try { releases.push(pool.retain(resource)); } catch (error) { errors.push(error); }
  }
  if (errors.length) {
    try { releaseAll(releases); } catch (cleanup) { errors.push(cleanup); }
    throw new AggregateError(errors, 'Scene resource retention failed');
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseAll(releases);
  };
}

export function retainMatteScene(pool: ResourcePool, root: THREE.Object3D, opts?: MatteGltfOptions): () => void {
  const rawRelease = retainSceneResources(pool, root);
  let convertedRelease: (() => void) | undefined;
  try {
    makeMatteLambert(root, { ...opts, disposeResource: () => undefined });
    convertedRelease = retainSceneResources(pool, root);
  } catch (error) {
    const errors: unknown[] = [error];
    try {
      const partialRelease = retainSceneResources(pool, root);
      partialRelease();
    } catch (cleanup) { errors.push(cleanup); }
    try { rawRelease(); } catch (cleanup) { errors.push(cleanup); }
    if (errors.length > 1) throw new AggregateError(errors, 'Matte scene conversion failed');
    throw error;
  }
  try {
    rawRelease();
  } catch (error) {
    try { convertedRelease(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Matte scene ownership release failed'); }
    throw error;
  }
  return convertedRelease;
}
