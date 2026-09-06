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

const closedPool = createResourcePool();
closedPool.dispose();
const late = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
const lateRelease = retainSceneResources(closedPool, late);
lateRelease();

console.log('scene resource tree checks passed');
}

void main();
