import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createResourcePool } from '../lib/game/render3d/sceneResources';
import { loadPrefabScene } from '../lib/game/render3d/prefabLoad';

const originalFetch = globalThis.fetch;
const originalParse = GLTFLoader.prototype.parseAsync;

function sceneWithCounts() {
  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshLambertMaterial();
  const texture = new THREE.Texture();
  material.map = texture;
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(geometry, material));
  const counts = { geometry: 0, material: 0, texture: 0 };
  for (const [resource, key] of [[geometry, 'geometry'], [material, 'material'], [texture, 'texture']] as const) {
    const dispose = resource.dispose.bind(resource);
    resource.dispose = () => { counts[key]++; dispose(); };
  }
  return { scene, counts };
}

async function run(): Promise<void> {
try {
  const errors: string[] = [];
  const controller = new AbortController();
  const pool = createResourcePool();
  let current = true;
  const options = { resources: pool, signal: controller.signal, isCurrent: () => current, onError: (id: string) => errors.push(id) };
  const success = sceneWithCounts();
  globalThis.fetch = async () => new Response(new ArrayBuffer(8), { status: 200 });
  GLTFLoader.prototype.parseAsync = async () => ({ scene: success.scene }) as never;
  assert.equal(await loadPrefabScene('asset:test:ok', '/map/test.glb', options), success.scene);
  pool.dispose();
  assert.deepEqual(success.counts, { geometry: 1, material: 1, texture: 1 });

  const failedPool = createResourcePool();
  globalThis.fetch = async () => new Response('', { status: 404 });
  assert.equal(await loadPrefabScene('asset:test:http', '/map/test.glb', { ...options, resources: failedPool }), null);
  assert.deepEqual(errors, ['asset:test:http']);
  failedPool.dispose();

  const late = sceneWithCounts();
  let resolveParse!: (value: never) => void;
  GLTFLoader.prototype.parseAsync = () => new Promise((resolve) => { resolveParse = resolve; });
  globalThis.fetch = async () => new Response(new ArrayBuffer(8), { status: 200 });
  const latePool = createResourcePool();
  current = true;
  const pending = loadPrefabScene('asset:test:late', '/map/test.glb', { ...options, resources: latePool });
  for (let i = 0; i < 8 && !resolveParse; i++) await Promise.resolve();
  assert.ok(resolveParse, 'parse should start before the generation changes');
  current = false;
  resolveParse({ scene: late.scene } as never);
  assert.equal(await pending, null);
  assert.deepEqual(late.counts, { geometry: 1, material: 1, texture: 1 });
  latePool.dispose();

  let fetched = false;
  const aborted = new AbortController();
  aborted.abort();
  globalThis.fetch = async () => { fetched = true; return new Response(); };
  assert.equal(await loadPrefabScene('asset:test:abort', '/map/test.glb', { ...options, resources: createResourcePool(), signal: aborted.signal }), null);
  assert.equal(fetched, false);
  console.log('prefab lifecycle passed');
} finally {
  globalThis.fetch = originalFetch;
  GLTFLoader.prototype.parseAsync = originalParse;
}
}

void run();
