import assert from 'node:assert/strict';
async function main(): Promise<void> {
const THREE = await import('three');
const { createResourcePool } = await import('../lib/game/render3d/sceneResources');
const { retainMatteScene, retainSceneResources } = await import('../lib/game/render3d/sceneResourceTree');

const geometry = new THREE.BoxGeometry();
const albedo = new THREE.Texture();
const normal = new THREE.Texture();
const material = new THREE.MeshStandardMaterial({ map: albedo, normalMap: normal });
const disposeCounts = new Map<object, number>();
for (const resource of [geometry, albedo, normal, material]) {
  const original = resource.dispose.bind(resource);
  resource.dispose = () => {
    disposeCounts.set(resource, (disposeCounts.get(resource) ?? 0) + 1);
    original();
  };
}
const root = new THREE.Group();
root.add(new THREE.Mesh(geometry, [material, material]));
const pool = createResourcePool();
const release = retainSceneResources(pool, root);
const clone = root.clone();
const releaseClone = retainSceneResources(pool, clone);
release();
assert.ok(geometry.attributes.position, 'shared geometry remains usable after first root release');
assert.equal((material as THREE.MeshStandardMaterial).map, albedo, 'shared texture remains usable after first root release');
assert.equal(disposeCounts.get(geometry) ?? 0, 0);
release();
releaseClone();
releaseClone();
pool.dispose();
assert.equal(disposeCounts.get(geometry), 1);
assert.equal(disposeCounts.get(material), 1);
assert.equal(disposeCounts.get(albedo), 1);
assert.equal(disposeCounts.get(normal), 1);

const shaderTexture = new THREE.Texture();
const shader = new THREE.ShaderMaterial({ uniforms: { nested: { value: shaderTexture } } });
const cycle: Record<string, unknown> = {};
cycle.self = cycle;
shader.uniforms.cycle = { value: cycle };
const shaderRoot = new THREE.Mesh(new THREE.BoxGeometry(), shader);
const shaderPool = createResourcePool();
const shaderRelease = retainSceneResources(shaderPool, shaderRoot);
shaderRelease();
shaderPool.dispose();

const lineTexture = new THREE.Texture();
const lineMaterial = new THREE.LineBasicMaterial();
(lineMaterial as unknown as Record<string, unknown>).customTexture = lineTexture;
const line = new THREE.LineSegments(new THREE.BufferGeometry(), lineMaterial);
const spriteMaterial = new THREE.SpriteMaterial({ map: lineTexture });
const sprite = new THREE.Sprite(spriteMaterial);
const lineRoot = new THREE.Group();
lineRoot.add(line, sprite);
const linePool = createResourcePool();
const lineRelease = retainSceneResources(linePool, lineRoot);
lineRelease();
linePool.dispose();

const instance = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
let instanceDisposals = 0;
instance.addEventListener('dispose', () => { instanceDisposals += 1; });
const instancePool = createResourcePool();
const instanceRelease = retainSceneResources(instancePool, instance);
instanceRelease();
assert.equal(instanceDisposals, 1);
instancePool.dispose();

const matteMap = new THREE.Texture();
const matteRoot = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: matteMap, roughness: 0.2 }));
const mattePool = createResourcePool();
const matteRelease = retainMatteScene(mattePool, matteRoot, { keepMaps: true });
assert.equal((matteRoot.material as THREE.MeshLambertMaterial).map, matteMap);
matteRelease();
mattePool.dispose();

const matteDropMap = new THREE.Texture();
let matteDropMapDisposals = 0;
const originalDropDispose = matteDropMap.dispose.bind(matteDropMap);
matteDropMap.dispose = () => { matteDropMapDisposals += 1; originalDropDispose(); };
const matteDropRoot = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: matteDropMap }));
const matteDropPool = createResourcePool();
const matteDropRelease = retainMatteScene(matteDropPool, matteDropRoot, { keepMaps: false });
matteDropRelease();
matteDropPool.dispose();
assert.equal(matteDropMapDisposals, 1);

const bitmapClass = class FakeImageBitmap { closes = 0; close(): void { this.closes += 1; } };
Object.defineProperty(globalThis, 'ImageBitmap', { configurable: true, value: bitmapClass });
const sharedBitmap = new bitmapClass();
const bitmapTextureA = new THREE.Texture(sharedBitmap as unknown as ImageBitmap);
const bitmapTextureB = new THREE.Texture(sharedBitmap as unknown as ImageBitmap);
const bitmapRootA = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: bitmapTextureA }));
const bitmapRootB = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map: bitmapTextureB }));
const bitmapPool = createResourcePool();
const bitmapReleaseA = retainSceneResources(bitmapPool, bitmapRootA);
const bitmapReleaseB = retainSceneResources(bitmapPool, bitmapRootB);
bitmapReleaseA();
assert.equal(sharedBitmap.closes, 0);
bitmapReleaseB();
assert.equal(sharedBitmap.closes, 1);
delete (globalThis as { ImageBitmap?: unknown }).ImageBitmap;

const closedPool = createResourcePool();
closedPool.dispose();
const lateGeometry = new THREE.BoxGeometry();
const lateMaterial = new THREE.MeshBasicMaterial();
lateGeometry.dispose = () => { throw new Error('first late disposer failed'); };
const late = new THREE.Mesh(lateGeometry, lateMaterial);
assert.throws(() => retainSceneResources(closedPool, late), AggregateError);

console.log('scene resource tree checks passed');
}

void main();
