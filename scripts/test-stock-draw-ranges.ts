import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createGeometryTracker } from '../lib/game/render3d/diagnostics';
import { StockDrawRanges } from '../lib/game/render3d/stockDrawRanges';

function fixture() {
  const geometry = new THREE.BoxGeometry();
  geometry.clearGroups();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial());
  const root = new THREE.Group();
  root.add(mesh);
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
  camera.position.set(4, 6, 8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  root.updateMatrixWorld(true);
  return { mesh, root, camera };
}

function finish(ranges: StockDrawRanges): void {
  for (let n = 0; !ranges.idle; n++) {
    assert(n < 500, 'filter jobs converge');
    ranges.drain(2);
  }
}

function triples(index: THREE.BufferAttribute): string[] {
  const result: string[] = [];
  for (let i = 0; i < index.count; i += 3)
    result.push(`${index.getX(i)},${index.getX(i + 1)},${index.getX(i + 2)}`);
  return result.sort();
}

{
  const { mesh, root, camera } = fixture();
  const errors: unknown[] = [];
  const ranges = new StockDrawRanges(() => 0, (error) => errors.push(error));
  const tracker = createGeometryTracker();
  tracker.trackTree(root);
  const bytes = tracker.bytes();
  const index = mesh.geometry.index!;
  const source = triples(index);
  const buffer = index.array.buffer;
  const position = mesh.geometry.getAttribute('position').array.slice();
  const normal = mesh.geometry.getAttribute('normal').array.slice();
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(), camera);
  const before = raycaster.intersectObject(mesh).map((hit) => hit.point.toArray());
  ranges.add(mesh);
  ranges.prepare(camera, false);
  assert.equal(mesh.geometry.drawRange.count, Infinity);
  assert.equal(ranges.settled(mesh), false);
  finish(ranges);
  assert.equal(mesh.geometry.drawRange.count, 18);
  assert.equal(index.array.buffer, buffer, 'publication retains the tracked index buffer');
  assert.deepEqual(triples(index), source, 'complete triangle multiset and winding retained');
  assert.deepEqual(mesh.geometry.getAttribute('position').array, position);
  assert.deepEqual(mesh.geometry.getAttribute('normal').array, normal);
  assert.equal(tracker.bytes(), bytes);
  assert.deepEqual(raycaster.intersectObject(mesh).map((hit) => hit.point.toArray()), before);

  const version = index.version;
  camera.position.add(new THREE.Vector3(96, 0, 100));
  camera.lookAt(96, 0, 100);
  camera.updateMatrixWorld(true);
  ranges.prepare(camera, false);
  finish(ranges);
  assert.equal(index.version, version, 'pan rounding does not continuously repartition');

  camera.position.set(-4, 6, -8);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  ranges.prepare(camera, false);
  assert.equal(mesh.geometry.drawRange.count, Infinity, 'rotation restores before filtering');
  finish(ranges);
  assert.deepEqual(triples(index), source);
  raycaster.setFromCamera(new THREE.Vector2(), camera);
  const filteredHits = raycaster.intersectObject(mesh).map((hit) => hit.point.toArray());
  ranges.prepare(camera, true);
  assert.equal(mesh.geometry.drawRange.count, Infinity, 'shadow passes receive all triangles');
  assert.deepEqual(raycaster.intersectObject(mesh).map((hit) => hit.point.toArray()), filteredHits);
  ranges.prepare(camera, false);
  finish(ranges);

  const material = mesh.material;
  const compile = material.onBeforeCompile;
  const texture = new THREE.Texture();
  const guards = [
    { name: 'double side', off: () => { material.side = THREE.DoubleSide; }, on: () => { material.side = THREE.FrontSide; } },
    { name: 'transparency', off: () => { material.transparent = true; }, on: () => { material.transparent = false; } },
    { name: 'opacity', off: () => { material.opacity = 0.5; }, on: () => { material.opacity = 1; } },
    { name: 'wireframe', off: () => { material.wireframe = true; }, on: () => { material.wireframe = false; } },
    { name: 'displacement', off: () => { material.displacementMap = texture; }, on: () => { material.displacementMap = null; } },
    { name: 'custom shader', off: () => { material.onBeforeCompile = () => undefined; }, on: () => { material.onBeforeCompile = compile; } },
    { name: 'parent translation', off: () => { root.position.x = 1; }, on: () => { root.position.x = 0; } },
    { name: 'reflection', off: () => { mesh.scale.x = -1; }, on: () => { mesh.scale.x = 1; } },
    { name: 'manual local matrix', off: () => { mesh.matrixAutoUpdate = false; mesh.matrix.makeTranslation(1, 0, 0); }, on: () => { mesh.matrixAutoUpdate = true; } },
    { name: 'manual world matrix', off: () => { mesh.matrixWorldAutoUpdate = false; }, on: () => { mesh.matrixWorldAutoUpdate = true; } },
    { name: 'morph positions', off: () => { mesh.geometry.morphAttributes.position = [mesh.geometry.getAttribute('position')]; }, on: () => { delete mesh.geometry.morphAttributes.position; } },
    { name: 'material groups', off: () => { mesh.geometry.addGroup(0, 3); }, on: () => mesh.geometry.clearGroups() },
  ];
  for (const guard of guards) {
    guard.off();
    ranges.prepare(camera, false);
    assert.equal(mesh.geometry.drawRange.count, Infinity, guard.name);
    assert(ranges.idle, guard.name);
    guard.on();
    ranges.prepare(camera, false);
    finish(ranges);
    assert.equal(mesh.geometry.drawRange.count, 18, `${guard.name} restored`);
  }
  ranges.prepare(new THREE.PerspectiveCamera(), false);
  assert.equal(mesh.geometry.drawRange.count, Infinity);
  ranges.prepare(camera, false);
  finish(ranges);
  mesh.geometry.getAttribute('position').needsUpdate = true;
  ranges.prepare(camera, false);
  assert.equal(mesh.geometry.drawRange.count, Infinity, 'changed positions invalidate the partition');
  finish(ranges);
  ranges.dispose();
  ranges.dispose();
  assert.equal(mesh.geometry.drawRange.count, Infinity);
  assert(ranges.idle);
  assert.deepEqual(errors, []);
  mesh.geometry.dispose();
  assert.equal(tracker.bytes(), 0);
  material.dispose();
  texture.dispose();
}

{
  let tick = 0;
  const { mesh, camera } = fixture();
  const other = mesh.clone();
  other.geometry = mesh.geometry.clone();
  const original = mesh.geometry.index!;
  const repeated = new Uint16Array(30_000);
  for (let i = 0; i < repeated.length; i++) repeated[i] = original.array[i % original.count]!;
  mesh.geometry.setIndex(new THREE.BufferAttribute(repeated, 1));
  other.geometry.setIndex(new THREE.BufferAttribute(repeated.slice(), 1));
  const errors: unknown[] = [];
  const ranges = new StockDrawRanges(() => tick += 0.6, (error) => errors.push(error));
  ranges.add(mesh);
  ranges.add(other);
  ranges.prepare(camera, false);
  const before = repeated.slice();
  const otherBefore = other.geometry.index!.array.slice();
  ranges.drain(2);
  assert.equal(ranges.idle, false);
  assert.equal(mesh.geometry.index!.version, 0);
  assert.deepEqual(repeated, before, 'partial classification never edits the live index');
  ranges.beginGeneration();
  assert.deepEqual(repeated, before, 'generation cancellation retains full source');
  ranges.drain(2);
  ranges.remove(other);
  finish(ranges);
  assert.deepEqual(other.geometry.index!.array, otherBefore,
    'evicted active meshes cannot receive stale publication');
  assert.equal(other.geometry.drawRange.count, Infinity);
  assert(mesh.geometry.drawRange.count < mesh.geometry.index!.count);
  assert.deepEqual(errors, []);
  ranges.dispose();
  mesh.geometry.dispose();
  other.geometry.dispose();
  mesh.material.dispose();
}

{
  const { mesh, camera } = fixture();
  const errors: unknown[] = [];
  const ranges = new StockDrawRanges(() => 0, (error) => errors.push(error));
  mesh.geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(32_769), 1));
  ranges.add(mesh);
  ranges.prepare(camera, false);
  assert(ranges.idle, 'over-cap stock remains unfiltered without allocating a job');
  assert.equal(mesh.geometry.drawRange.count, Infinity);
  mesh.geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 1, 65_535]), 1));
  ranges.prepare(camera, false);
  finish(ranges);
  ranges.prepare(camera, false);
  finish(ranges);
  assert.equal(errors.length, 1, 'a failed unchanged source is not retried every frame');
  assert.equal(mesh.geometry.drawRange.count, Infinity);
  ranges.dispose();
  mesh.geometry.dispose();
  mesh.material.dispose();
}

console.log('Stock draw-range ownership, guards, cancellation and raycast parity passed');
