/**
 * Focused checks for lib/game/render3d/staticMeshBatch.ts plus per-asset
 * parity on every committed procedural landmark and unique noticed tower.
 * Run: pnpm tsx scripts/test-static-mesh-batch.ts
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { LANDMARKS, type LandmarkKind } from '../lib/game/geo';
import { build as buildLandmark, EYE_WHEEL_NAME } from '../lib/game/render3d/landmarks';
import { isPlaytimeProceduralKind } from '../lib/game/render3d/landmarkPrefabs';
import { UNIQUE_NOTICED_IDS, buildUniqueNoticed, uniquePlanRing } from '../lib/game/render3d/uniqueNoticed';
import {
  batchStaticMeshes,
  staticBatchMetadata,
  type StaticBatchReport,
} from '../lib/game/render3d/staticMeshBatch';

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${name}\n    ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    return;
  }
  passed += 1;
  console.log(`  ✓ ${name}`);
}

type MeshStats = { meshes: number; triangles: number; vertices: number; bytes: number; geometries: number };

function meshes(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
}

function stats(root: THREE.Object3D): MeshStats {
  const geometries = new Set<THREE.BufferGeometry>();
  let triangles = 0;
  let vertices = 0;
  for (const mesh of meshes(root)) {
    const g = mesh.geometry;
    geometries.add(g);
    const count = g.index ? g.index.count : g.getAttribute('position').count;
    triangles += count / 3;
    vertices += g.getAttribute('position').count;
  }
  let bytes = 0;
  for (const g of geometries) {
    if (g.index) bytes += g.index.array.byteLength;
    for (const a of Object.values(g.attributes)) bytes += (a as THREE.BufferAttribute).array.byteLength;
  }
  return { meshes: meshes(root).length, triangles, vertices, bytes, geometries: geometries.size };
}

/** Snapshot every mesh's world matrix and geometry before batching. */
function snapshot(root: THREE.Object3D): Map<string, { mesh: THREE.Mesh; world: THREE.Matrix4; geometry: THREE.BufferGeometry }> {
  root.updateMatrixWorld(true);
  const map = new Map<string, { mesh: THREE.Mesh; world: THREE.Matrix4; geometry: THREE.BufferGeometry }>();
  for (const mesh of meshes(root)) map.set(mesh.uuid, { mesh, world: mesh.matrixWorld.clone(), geometry: mesh.geometry });
  return map;
}

/**
 * Every batched mesh must reproduce each source's ordered triangle stream and
 * attributes in world space; every unbatched mesh must be the original object.
 */
function assertParity(root: THREE.Object3D, before: ReturnType<typeof snapshot>, label: string, tolerance = 2e-4): void {
  root.updateMatrixWorld(true);
  const seen = new Set<string>();
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const nm2 = new THREE.Matrix3();
  for (const mesh of meshes(root)) {
    const meta = staticBatchMetadata(mesh);
    if (!meta) {
      assert.ok(before.has(mesh.uuid), `${label}: unbatched mesh ${mesh.name} is not an original`);
      assert.equal(mesh.geometry, before.get(mesh.uuid)!.geometry, `${label}: unbatched mesh geometry changed`);
      seen.add(mesh.uuid);
      continue;
    }
    const merged = mesh.geometry;
    const mergedPos = merged.getAttribute('position');
    const mergedNormal = merged.getAttribute('normal');
    nm2.getNormalMatrix(mesh.matrixWorld);
    for (const source of meta.sources) {
      const original = before.get(source.uuid);
      assert.ok(original, `${label}: source ${source.name} (${source.uuid}) missing from snapshot`);
      assert.ok(!seen.has(source.uuid), `${label}: source ${source.name} appears twice`);
      seen.add(source.uuid);
      assert.equal(original.mesh.parent, null, `${label}: source ${source.name} still attached`);
      assert.equal(original.mesh.material, mesh.material, `${label}: batch material differs from source`);
      const g = original.geometry;
      const pos = g.getAttribute('position');
      assert.equal(pos.count, source.vertexCount);
      const originalIndexCount = g.index ? g.index.count : pos.count;
      assert.equal(originalIndexCount, source.indexCount, `${label}: index count mismatch for ${source.name}`);
      nm.getNormalMatrix(original.world);
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(original.world);
        q.fromBufferAttribute(mergedPos, source.vertexStart + i).applyMatrix4(mesh.matrixWorld);
        assert.ok(p.distanceTo(q) <= tolerance, `${label}: ${source.name} vertex ${i} moved ${p.distanceTo(q)}`);
      }
      const normal = g.getAttribute('normal');
      if (normal) {
        assert.ok(mergedNormal, `${label}: normals dropped`);
        for (let i = 0; i < pos.count; i++) {
          p.fromBufferAttribute(normal, i).applyMatrix3(nm).normalize();
          q.fromBufferAttribute(mergedNormal, source.vertexStart + i).applyMatrix3(nm2).normalize();
          assert.ok(p.distanceTo(q) <= 1e-4, `${label}: ${source.name} normal ${i} differs ${p.distanceTo(q)}`);
        }
      }
      for (const [name, attribute] of Object.entries(g.attributes)) {
        if (name === 'position' || name === 'normal' || name === 'tangent') continue;
        const a = attribute as THREE.BufferAttribute;
        const b = merged.getAttribute(name);
        assert.ok(b, `${label}: attribute ${name} dropped`);
        assert.equal(b.itemSize, a.itemSize);
        assert.equal(b.normalized, a.normalized);
        assert.equal(b.gpuType, a.gpuType, `${label}: ${name} gpuType changed`);
        assert.equal(b.array.constructor, a.array.constructor, `${label}: ${name} array type changed`);
        for (let i = 0; i < a.array.length; i++) {
          assert.equal(b.array[source.vertexStart * a.itemSize + i], a.array[i], `${label}: ${name}[${i}] differs`);
        }
      }
      const mergedIndex = merged.index;
      if (mergedIndex) {
        for (let i = 0; i < source.indexCount; i++) {
          const expected = (g.index ? g.index.array[i]! : i) + source.vertexStart;
          assert.equal(mergedIndex.array[source.indexStart + i], expected, `${label}: index ${i} of ${source.name} differs`);
        }
      } else {
        assert.equal(g.index, null, `${label}: indexed source ${source.name} landed in a non-indexed batch`);
        assert.equal(source.indexStart, source.vertexStart, `${label}: non-indexed batch stream offset mismatch`);
      }
    }
  }
  for (const [uuid, entry] of before) {
    assert.ok(seen.has(uuid), `${label}: original mesh ${entry.mesh.name || uuid} vanished without a batch mapping`);
  }
}

function lambert(color: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function box(material: THREE.Material, x: number, y: number, z: number, name = ''): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), material);
  mesh.position.set(x, y, z);
  mesh.rotation.set(x * 0.3, y * 0.2, z * 0.1);
  mesh.scale.set(1, 1.5, 0.5);
  mesh.name = name;
  return mesh;
}

function countDisposes(geometries: THREE.BufferGeometry[]): Map<THREE.BufferGeometry, number> {
  const counts = new Map<THREE.BufferGeometry, number>();
  for (const g of geometries) {
    counts.set(g, 0);
    g.addEventListener('dispose', () => counts.set(g, counts.get(g)! + 1));
  }
  return counts;
}

console.log('static mesh batch');

check('bakes sibling transforms into one mesh, preserving ordered stream, uvs and material', () => {
  const stone = lambert(0xddccbb);
  const root = new THREE.Group();
  const a = box(stone, 0, 0, 0, 'a');
  const b = box(stone, 4, 1, -2, 'b');
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 3, 7), stone);
  cyl.position.set(-3, 2, 1);
  cyl.rotation.z = Math.PI / 3;
  cyl.name = 'cyl';
  const extruded = new THREE.Mesh(
    new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(2, 0), new THREE.Vector2(1, 1)]), { depth: 1, bevelEnabled: false }),
    stone,
  );
  extruded.name = 'extruded';
  root.add(a, b, cyl, extruded);
  root.position.set(10, 0, -5);
  root.rotation.y = 0.7;
  const before = snapshot(root);
  const statsBefore = stats(root);
  assert.equal(extruded.geometry.index, null, 'extrude geometry is non-indexed in this test');
  const report = batchStaticMeshes(root);
  assert.deepEqual(report, { candidates: 4, skipped: 0, merged: 4, batches: 1, disposedGeometries: 4 });
  assert.equal(root.children.length, 1);
  const batch = root.children[0] as THREE.Mesh;
  assert.equal(batch.material, stone);
  assert.equal(batch.name, 'a+3');
  assert.ok(batch.geometry.index!.array instanceof Uint16Array);
  const meta = staticBatchMetadata(batch)!;
  assert.deepEqual(meta.sources.map((s) => s.name), ['a', 'b', 'cyl', 'extruded']);
  assert.equal(meta.sources[1]!.vertexStart, a.geometry.getAttribute('position').count);
  assertParity(root, before, 'basic');
  const statsAfter = stats(root);
  assert.equal(statsAfter.triangles, statsBefore.triangles);
  assert.equal(statsAfter.vertices, statsBefore.vertices);
  // A mixed indexed/non-indexed page gains a sequential Uint16 index only for the non-indexed member.
  const extrudedVertices = before.get(extruded.uuid)!.geometry.getAttribute('position').count;
  assert.ok(statsAfter.bytes <= statsBefore.bytes + extrudedVertices * 2, 'index widening must not inflate bytes');
  assert.ok(batch.geometry.boundingSphere && batch.geometry.boundingBox, 'bounds computed');
});

check('different material objects or render flags stay separate; equal-valued materials do not merge', () => {
  const m1 = lambert(0x111111);
  const m2 = lambert(0x111111);
  const root = new THREE.Group();
  const shadowed = box(m1, 0, 0, 0, 's1');
  shadowed.castShadow = true;
  const shadowed2 = box(m1, 1, 0, 0, 's2');
  shadowed2.castShadow = true;
  root.add(box(m1, 0, 0, 0, 'p1'), box(m2, 2, 0, 0, 'q1'), box(m1, 3, 0, 0, 'p2'), box(m2, 4, 0, 0, 'q2'), shadowed, shadowed2);
  const before = snapshot(root);
  const report = batchStaticMeshes(root);
  assert.equal(report.batches, 3);
  assert.equal(report.merged, 6);
  const names = root.children.map((c) => c.name);
  assert.deepEqual(names, ['p1+1', 'q1+1', 's1+1'], 'batches keep first-member ordering');
  assert.equal((root.children[2] as THREE.Mesh).castShadow, true);
  assertParity(root, before, 'flags');
});

check('distinct material objects sharing a uuid never merge', () => {
  const m1 = lambert(0x222222);
  const m2 = lambert(0x222222);
  m2.uuid = m1.uuid;
  const root = new THREE.Group();
  root.add(box(m1, 0, 0, 0, 'a1'), box(m2, 1, 0, 0, 'b1'), box(m1, 2, 0, 0, 'a2'), box(m2, 3, 0, 0, 'b2'));
  const before = snapshot(root);
  const report = batchStaticMeshes(root);
  assert.equal(report.batches, 2, 'one batch per material object');
  const materials = root.children.map((c) => (c as THREE.Mesh).material);
  assert.ok(materials.includes(m1) && materials.includes(m2));
  assertParity(root, before, 'same-uuid');
});

check('integer GPU attributes keep their gpuType, array type and raw values', () => {
  const m = lambert(0x444444);
  const root = new THREE.Group();
  const withIds = (name: string, x: number): THREE.Mesh => {
    const mesh = box(m, x, 0, 0, name);
    const count = mesh.geometry.getAttribute('position').count;
    const ids = new THREE.BufferAttribute(new Uint16Array(count).map((_, i) => (i * 7 + x) & 0xffff), 1);
    ids.gpuType = THREE.IntType;
    mesh.geometry.setAttribute('id', ids);
    const color = new THREE.BufferAttribute(new Uint8Array(count * 3).map((_, i) => (i * 13 + x) & 0xff), 3, true);
    mesh.geometry.setAttribute('color', color);
    return mesh;
  };
  root.add(withIds('i1', 0), withIds('i2', 1), withIds('i3', 2));
  const before = snapshot(root);
  const report = batchStaticMeshes(root);
  assert.equal(report.batches, 1);
  const batch = root.children[0] as THREE.Mesh;
  const id = batch.geometry.getAttribute('id');
  assert.equal(id.gpuType, THREE.IntType);
  assert.ok(id.array instanceof Uint16Array);
  const color = batch.geometry.getAttribute('color');
  assert.equal(color.gpuType, THREE.FloatType);
  assert.equal(color.normalized, true);
  assert.ok(color.array instanceof Uint8Array);
  assertParity(root, before, 'int-attrs');
});

check('custom Mesh subclasses and instance raycast overrides stay untouched', () => {
  class Marker extends THREE.Mesh {}
  const m = lambert(0x888888);
  const root = new THREE.Group();
  const sub1 = new Marker(new THREE.BoxGeometry(1, 1, 1), m);
  const sub2 = new Marker(new THREE.BoxGeometry(1, 1, 1), m);
  sub2.position.x = 2;
  const picked = box(m, 4, 0, 0, 'picked');
  picked.raycast = () => undefined;
  const picked2 = box(m, 5, 0, 0, 'picked2');
  picked2.raycast = () => undefined;
  const plain1 = box(m, 6, 0, 0, 'plain');
  const plain2 = box(m, 7, 0, 0, 'plain');
  root.add(sub1, sub2, picked, picked2, plain1, plain2);
  const before = snapshot(root);
  const report = batchStaticMeshes(root);
  assert.deepEqual(report, { candidates: 6, skipped: 4, merged: 2, batches: 1, disposedGeometries: 2 });
  for (const kept of [sub1, sub2, picked, picked2]) assert.equal(kept.parent, root);
  assertParity(root, before, 'subclass');
});

check('nested animated group keeps its transform and batches only inside itself', () => {
  const steel = lambert(0xc5d0dc);
  const root = new THREE.Group();
  root.add(box(steel, 0, 0, 0, 'axle'), box(steel, 0, 1, 0, 'hub'));
  const wheel = new THREE.Group();
  wheel.name = EYE_WHEEL_NAME;
  wheel.position.set(0, 5, 0);
  wheel.rotation.y = Math.PI / 2;
  for (let i = 0; i < 6; i++) wheel.add(box(steel, Math.cos(i), Math.sin(i), 0, `spoke${i}`));
  root.add(wheel);
  const before = snapshot(root);
  const report = batchStaticMeshes(root);
  assert.equal(report.batches, 2);
  assert.equal(root.getObjectByName(EYE_WHEEL_NAME), wheel);
  assert.equal(wheel.children.length, 1);
  assert.equal(wheel.position.y, 5);
  assert.equal(wheel.rotation.y, Math.PI / 2);
  assert.equal(root.children.length, 2);
  assert.equal(root.children[1], wheel, 'group order preserved');
  assertParity(root, before, 'nested pre-spin');
  // spinning the wheel now moves only wheel geometry
  wheel.rotation.z = 1.2;
  root.updateMatrixWorld(true);
  const spoke = [...before.values()].find((entry) => entry.mesh.name === 'spoke0')!;
  const wheelBatch = wheel.children[0] as THREE.Mesh;
  const meta = staticBatchMetadata(wheelBatch)!;
  const src = meta.sources.find((s) => s.name === 'spoke0')!;
  const p = new THREE.Vector3().fromBufferAttribute(wheelBatch.geometry.getAttribute('position'), src.vertexStart).applyMatrix4(wheelBatch.matrixWorld);
  const pre = new THREE.Vector3().fromBufferAttribute(spoke.geometry.getAttribute('position'), 0).applyMatrix4(spoke.world);
  assert.ok(p.distanceTo(pre) > 0.1, 'wheel geometry moved with the spun group');

  const shell = root.children[0] as THREE.Mesh;
  assert.ok(staticBatchMetadata(shell));
  assert.equal(shell.matrixWorld.elements.join(), root.matrixWorld.elements.join());
});

check('unsupported meshes are left untouched and never merged', () => {
  const m = lambert(0x333333);
  const root = new THREE.Group();
  const keep = box(m, 0, 0, 0, 'keep');
  const keep2 = box(m, 1, 0, 0, 'keep2');
  const transparentMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.5 });
  const transparent = box(transparentMat, 0, 0, 0, 'transparent');
  const transparent2 = box(transparentMat, 1, 0, 0, 'transparent2');
  const ranged = box(m, 3, 0, 0, 'ranged');
  ranged.geometry.setDrawRange(0, 6);
  const morphed = box(m, 4, 0, 0, 'morphed');
  morphed.geometry.morphAttributes.position = [new THREE.BufferAttribute(new Float32Array(morphed.geometry.getAttribute('position').array), 3)];
  const reflected = box(m, 5, 0, 0, 'reflected');
  reflected.scale.x = -1;
  const singular = box(m, 6, 0, 0, 'singular');
  singular.scale.y = 0;
  const instanced = new THREE.InstancedMesh(new THREE.BoxGeometry(), m, 2);
  instanced.name = 'instanced';
  const skinned = new THREE.SkinnedMesh(new THREE.BoxGeometry(), m);
  skinned.name = 'skinned';
  const callback = box(m, 7, 0, 0, 'callback');
  callback.onBeforeRender = () => undefined;
  const parentMesh = box(m, 8, 0, 0, 'parentMesh');
  parentMesh.add(new THREE.Group());
  const multi = new THREE.Mesh(new THREE.BoxGeometry(), [m, m]);
  multi.name = 'multi';
  const unsupported = [transparent, transparent2, ranged, morphed, reflected, singular, instanced, skinned, callback, parentMesh, multi];
  root.add(keep, ...unsupported, keep2);
  const before = snapshot(root);
  const report = batchStaticMeshes(root);
  assert.equal(report.batches, 1);
  assert.equal(report.merged, 2);
  assert.equal(report.skipped, unsupported.length);
  for (const mesh of unsupported) assert.equal(mesh.parent, root, `${mesh.name} should stay attached`);
  assert.equal(root.children[0], root.getObjectByName('keep+1'));
  assertParity(root, before, 'unsupported');
});

check('geometry still used by an unbatched mesh survives; exclusive geometry disposed once', () => {
  const m = lambert(0x444444);
  const shared = new THREE.BoxGeometry();
  const exclusive = new THREE.BoxGeometry(2, 2, 2);
  const root = new THREE.Group();
  const a = new THREE.Mesh(shared, m);
  const b = new THREE.Mesh(exclusive, m);
  b.position.x = 3;
  const other = new THREE.Mesh(shared, new THREE.MeshLambertMaterial({ transparent: true }));
  root.add(a, b, other);
  const counts = countDisposes([shared, exclusive]);
  let materialDisposed = 0;
  m.addEventListener('dispose', () => { materialDisposed += 1; });
  const report = batchStaticMeshes(root);
  assert.equal(report.batches, 1);
  assert.equal(report.disposedGeometries, 1);
  assert.equal(counts.get(shared), 0);
  assert.equal(counts.get(exclusive), 1);
  assert.equal(materialDisposed, 0);
  assert.equal(other.parent, root);
  assert.equal(other.geometry, shared);
});

check('injected failure disposes only new buffers, leaves the tree untouched and stays idempotent', () => {
  const m = lambert(0x555555);
  const m2 = lambert(0x666666);
  const root = new THREE.Group();
  const children = [box(m, 0, 0, 0, 'a'), box(m, 1, 0, 0, 'b'), box(m2, 2, 0, 0, 'c'), box(m2, 3, 0, 0, 'd')];
  root.add(...children);
  const sourceCounts = countDisposes(children.map((c) => c.geometry));
  const built: THREE.BufferGeometry[] = [];
  const builtDisposes: number[] = [];
  let calls = 0;
  assert.throws(
    () =>
      batchStaticMeshes(root, {
        onPageBuilt: (geometry) => {
          built.push(geometry);
          builtDisposes.push(0);
          const at = built.length - 1;
          geometry.addEventListener('dispose', () => { builtDisposes[at]! += 1; });
          calls += 1;
          if (calls === 2) throw new Error('injected');
        },
      }),
    /injected/,
  );
  assert.equal(built.length, 2);
  assert.deepEqual(builtDisposes, [1, 1], 'both built pages disposed exactly once');
  assert.deepEqual(root.children, children, 'tree untouched after failure');
  for (const c of children) assert.equal(sourceCounts.get(c.geometry), 0);

  const before = snapshot(root);
  const first = batchStaticMeshes(root);
  assert.deepEqual(first, { candidates: 4, skipped: 0, merged: 4, batches: 2, disposedGeometries: 4 });
  for (const c of children) assert.equal(sourceCounts.get(c.geometry), 1);
  assertParity(root, before, 'after-failure');
  const again = batchStaticMeshes(root);
  assert.deepEqual(again, { candidates: 2, skipped: 2, merged: 0, batches: 0, disposedGeometries: 0 }, 'second pass is a no-op');
  assert.equal(stats(root).meshes, 2);
});

check('pages are bounded by vertex and byte limits without inflating the index width', () => {
  const m = lambert(0x777777);
  const root = new THREE.Group();
  for (let i = 0; i < 6; i++) root.add(box(m, i, 0, 0, `b${i}`));
  const perBox = 24;
  const report = batchStaticMeshes(root, { maxVertices: perBox * 2 });
  assert.equal(report.batches, 3);
  assert.equal(report.merged, 6);
  for (const child of root.children) {
    const mesh = child as THREE.Mesh;
    assert.equal(mesh.geometry.getAttribute('position').count, perBox * 2);
    assert.ok(mesh.geometry.index!.array instanceof Uint16Array);
  }
  const root2 = new THREE.Group();
  for (let i = 0; i < 3; i++) root2.add(box(m, i, 0, 0));
  const oneBoxBytes = stats(root2).bytes / 3;
  const report2 = batchStaticMeshes(root2, { maxBytes: oneBoxBytes * 2 });
  assert.equal(report2.batches, 1);
  assert.equal(report2.merged, 2);
  assert.equal(report2.skipped, 1);
});

check('uses Uint32 indices only when a page exceeds 65535 vertices', () => {
  const m = lambert(0x888888);
  const root = new THREE.Group();
  const big = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 200), m);
  const small = new THREE.Mesh(new THREE.BoxGeometry(), m);
  small.position.x = 5;
  root.add(big, small);
  assert.ok(big.geometry.getAttribute('position').count > 40000);
  const before = snapshot(root);
  const report = batchStaticMeshes(root, { maxVertices: 200000 });
  assert.equal(report.batches, 1);
  const mesh = root.children[0] as THREE.Mesh;
  const expectedCtor = mesh.geometry.getAttribute('position').count > 65535 ? Uint32Array : Uint16Array;
  assert.ok(mesh.geometry.index!.array instanceof expectedCtor);
  assertParity(root, before, 'large-page');
});

// Per-asset parity on committed procedural assets.
type AssetRow = { asset: string; before: MeshStats; after: MeshStats; report: StaticBatchReport; ms: number };
const rows: AssetRow[] = [];

function measure(asset: string, build: () => THREE.Group | null): void {
  const group = build();
  if (!group) return;
  const before = snapshot(group);
  const statsBefore = stats(group);
  const t0 = performance.now();
  const report = batchStaticMeshes(group, { keepUniquelyNamed: true });
  const ms = performance.now() - t0;
  assertParity(group, before, asset);
  for (const [, entry] of before) {
    if (entry.mesh.name && [...before.values()].filter((e) => e.mesh.name === entry.mesh.name).length === 1) {
      assert.equal(group.getObjectByName(entry.mesh.name), entry.mesh, `${asset}: uniquely named ${entry.mesh.name} must stay addressable`);
    }
  }
  const statsAfter = stats(group);
  assert.equal(statsAfter.triangles, statsBefore.triangles, `${asset}: triangle count changed`);
  assert.equal(statsAfter.vertices, statsBefore.vertices, `${asset}: vertex count changed`);
  assert.equal(statsBefore.meshes - statsAfter.meshes, report.merged - report.batches, `${asset}: mesh delta mismatch`);
  rows.push({ asset, before: statsBefore, after: statsAfter, report, ms });
}

const proceduralKinds = [...new Set(LANDMARKS.map((l) => l.kind))].filter((kind): kind is LandmarkKind => isPlaytimeProceduralKind(kind));
for (const kind of proceduralKinds) measure(`landmark:${kind}`, () => buildLandmark(kind));
for (const id of UNIQUE_NOTICED_IDS) {
  measure(`noticed:${id}`, () => buildUniqueNoticed({ id, heightWorld: 1.2, ring: uniquePlanRing(id) }));
}

check('eye wheel group survives batching of the procedural London Eye', () => {
  const eye = buildLandmark('eye');
  const wheel = eye.getObjectByName(EYE_WHEEL_NAME)!;
  const wheelRotation = wheel.rotation.y;
  batchStaticMeshes(eye);
  assert.equal(eye.getObjectByName(EYE_WHEEL_NAME), wheel);
  assert.equal(wheel.rotation.y, wheelRotation);
  assert.ok(wheel.children.length >= 1);
  assert.ok(meshes(eye).length < meshes(buildLandmark('eye')).length);
});

check('every committed procedural asset keeps triangle/vertex parity', () => {
  assert.ok(rows.length >= proceduralKinds.length);
});

check('keepUniquelyNamed merges repeated names but leaves unique anchors alone', () => {
  const m = lambert(0x777777);
  const root = new THREE.Group();
  const anchor = box(m, 0, 0, 0, 'east-front');
  root.add(anchor, box(m, 1, 0, 0, 'bay'), box(m, 2, 0, 0, 'bay'), box(m, 3, 0, 0, ''));
  const report = batchStaticMeshes(root, { keepUniquelyNamed: true });
  assert.deepEqual(report, { candidates: 4, skipped: 1, merged: 3, batches: 1, disposedGeometries: 3 });
  assert.equal(root.getObjectByName('east-front'), anchor);
  assert.equal(root.children.length, 2);
});

console.log('\nasset | meshes before>after | tris | bytes before>after | disposed | ms');
for (const row of rows) {
  console.log(
    `${row.asset} | ${row.before.meshes}>${row.after.meshes} | ${row.before.triangles} | ${row.before.bytes}>${row.after.bytes} | ${row.report.disposedGeometries} | ${row.ms.toFixed(2)}`,
  );
}
const totalBefore = rows.reduce((n, r) => n + r.before.meshes, 0);
const totalAfter = rows.reduce((n, r) => n + r.after.meshes, 0);
const totalMs = rows.reduce((n, r) => n + r.ms, 0);
console.log(`total procedural meshes ${totalBefore} -> ${totalAfter}; batching time ${totalMs.toFixed(1)} ms; max per asset ${Math.max(...rows.map((r) => r.ms)).toFixed(2)} ms`);
if (failed > 0) {
  console.log(`\n${failed} of ${passed + failed} static-mesh-batch checks failed.`);
  process.exit(1);
}
console.log(`\nAll ${passed} static-mesh-batch checks passed.`);
