import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { buildCellStockBatch, createScratch } from '../lib/game/render3d/cityBuilder';
import { createCellStockJob, createStockTileJob, MAX_PAGE_INDEX_BYTES, MAX_PAGE_VERTICES, type StockTileReady } from '../lib/game/render3d/cellStockJob';
import { indexCity, type CityCell } from '../lib/game/render3d/cityIndex';
import { indexStockTiles, stockTileIdFor } from '../lib/game/render3d/stockTiles';
import { decodeCity, quantizeX, quantizeY, type CityData } from '../lib/game/render3d/format';

function building(x: number, z: number) {
  return { major: false, heightM: 12, chunkId: 0, style: 4, roof: 0, wall565: 0, roof565: 0,
    verts: new Uint16Array([quantizeX(x), quantizeY(z), quantizeX(x + 8), quantizeY(z), quantizeX(x + 8), quantizeY(z + 6), quantizeX(x), quantizeY(z + 6)]),
    indices: new Uint8Array([0, 1, 2, 0, 2, 3]) };
}
const city: CityData = { buildings: [building(10, 10), building(30, 10), building(50, 10)], roads: [], parks: [], water: [] };
const cell: CityCell = { id: '0,0', bounds: { minX: 0, minZ: 0, maxX: 100, maxZ: 100 }, buildingIndices: [0, 1, 2] };
const material = new THREE.MeshLambertMaterial({ vertexColors: true });
assert.equal(createRequire(import.meta.url)('three').BufferGeometry, THREE.BufferGeometry, 'spies use production Three constructors');
function triangles(group: THREE.Group | null): string[] {
  if (!group) return [];
  const out: string[] = [];
  group.traverse((o) => { if (o instanceof THREE.Mesh) {
    const p = o.geometry.getAttribute('position'), n = o.geometry.getAttribute('normal'), c = o.geometry.getAttribute('color'); const ix = o.geometry.getIndex()!;
    for (let i = 0; i < ix.count; i += 3) out.push([0, 1, 2].map((k) => { const v = ix.getX(i + k); return `${p.getX(v)},${p.getY(v)},${p.getZ(v)}|${n.getX(v)},${n.getY(v)},${n.getZ(v)}|${c.getX(v)},${c.getY(v)},${c.getZ(v)}`; }).join(';'));
  }});
  return out.sort();
}
function drain(job: ReturnType<typeof createCellStockJob>): void { let complete = false; for (let i = 0; i < 1000 && !(complete = job.step()); i++); assert.equal(complete, true, 'bounded drain completes'); }
function run(detail: 'overview' | 'neighbourhood' | 'street'): { group: THREE.Group | null; scratch: ReturnType<typeof createScratch> } {
  let ready: { group: THREE.Group | null; scratch: ReturnType<typeof createScratch> } | undefined;
  drain(createCellStockJob({ id: detail, generation: 1, essential: true, cityData: city, cell, excludedBuildingIndices: new Set(), material, detail, now: () => 0, onReady: (value) => { ready = value; } }));
  assert.ok(ready); return ready;
}
for (const detail of ['overview', 'neighbourhood', 'street'] as const) {
  const actual = run(detail);
  const expectedScratch = createScratch();
  const expected = buildCellStockBatch({ cityData: city, cellId: cell.id, buildingIndices: [0, 1, 2], excludedBuildingIndices: new Set(), material, detail, scratch: expectedScratch });
  if (detail !== 'overview') assert.deepEqual(triangles(actual.group), triangles(expected));
  assert.deepEqual(actual.scratch, expectedScratch);
  const meshes: THREE.Mesh[] = []; actual.group?.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  assert.equal(meshes.length, 1); assert.equal(meshes[0]!.material, material);
  const geometry = meshes[0]!.geometry, normal = geometry.getAttribute('normal'), color = geometry.getAttribute('color');
  if (detail === 'overview') {
    assert.ok(normal.array instanceof Int8Array); assert.ok(color.array instanceof Uint8Array); assert.equal(normal.normalized, true); assert.equal(color.normalized, true);
    const expectedGeometry = (expected as THREE.Group).children[0]!.constructor === THREE.Mesh ? ((expected as THREE.Group).children[0] as THREE.Mesh).geometry : undefined;
    assert.ok(expectedGeometry);
    const expectedNormal = expectedGeometry!.getAttribute('normal'), expectedColor = expectedGeometry!.getAttribute('color');
    for (let i = 0; i < normal.count; i++) { assert.ok(Math.abs(normal.getX(i) - expectedNormal.getX(i)) <= 0.5 / 127 + 1e-6); assert.ok(Math.abs(normal.getY(i) - expectedNormal.getY(i)) <= 0.5 / 127 + 1e-6); assert.ok(Math.abs(normal.getZ(i) - expectedNormal.getZ(i)) <= 0.5 / 127 + 1e-6); assert.ok(Math.abs(color.getX(i) - expectedColor.getX(i)) <= 0.5 / 255 + 1e-6); assert.ok(Math.abs(color.getY(i) - expectedColor.getY(i)) <= 0.5 / 255 + 1e-6); assert.ok(Math.abs(color.getZ(i) - expectedColor.getZ(i)) <= 0.5 / 255 + 1e-6); }
    assert.ok(geometry.getIndex()!.array instanceof Uint16Array); assert.ok(geometry.getAttribute('position').array instanceof Float32Array);
    assert.deepEqual(Array.from(geometry.getAttribute('position').array), Array.from(expectedGeometry!.getAttribute('position').array));
    assert.deepEqual(Array.from(geometry.getIndex()!.array), Array.from(expectedGeometry!.getIndex()!.array));
    expectedGeometry!.computeBoundingBox(); assert.deepEqual(geometry.boundingBox?.min.toArray(), expectedGeometry!.boundingBox?.min.toArray()); assert.deepEqual(geometry.boundingBox?.max.toArray(), expectedGeometry!.boundingBox?.max.toArray());
    assert.equal(geometry.getAttribute('position').array.byteLength + normal.array.byteLength + color.array.byteLength + geometry.getIndex()!.array.byteLength, geometry.getAttribute('position').count * 4 * 3 + normal.count * 3 + color.count * 3 + geometry.getIndex()!.count * 2);
  }
}
let ticks = 0;
const paused = createCellStockJob({ id: 'deadline', generation: 1, essential: true, cityData: city, cell, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => ticks++ * 5, sliceMs: 4, onReady: () => assert.fail('must pause') });
assert.equal(paused.step(), false);
let ready: THREE.Group | null | undefined;
const cancelled = createCellStockJob({ id: 'cancel', generation: 1, essential: true, cityData: city, cell, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => 0, onReady: (v) => { ready = v.group; } });
cancelled.cancel(); assert.equal(cancelled.step(), true); assert.equal(ready, undefined);
let complete: THREE.Group | null | undefined;
const adopted = new THREE.Group(); let completedScratch: ReturnType<typeof createScratch> | undefined; let completedIds: readonly number[] | undefined;
const completed = createCellStockJob({ id: 'complete', generation: 1, essential: true, cityData: city, cell, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => 0, onReady: (v) => { complete = v.group; completedScratch = v.scratch; completedIds = v.sourceBuildingIndices; adopted.add(v.group!); } });
drain(completed); const geometry = (complete!.children[0] as THREE.Mesh).geometry; let disposed = 0; geometry.addEventListener('dispose', () => disposed++); const scratchJson = JSON.stringify(completedScratch); completed.cancel(); assert.equal(disposed, 0); assert.equal(complete!.parent, adopted); assert.equal(JSON.stringify(completedScratch), scratchJson); assert.deepEqual(completedIds, [0, 1, 2]); assert.equal(completed.step(), true);
assert.throws(() => createCellStockJob({ id: 'bad', generation: 1, essential: true, cityData: city, cell: { ...cell, buildingIndices: [0, 0] }, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => 0, onReady: () => {} }));
assert.throws(() => createCellStockJob({ id: 'bad-time', generation: 1, essential: true, cityData: city, cell, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => 0, sliceMs: 5, onReady: () => {} }));
const many: CityData = { ...city, buildings: Array.from({ length: 20 }, (_, i) => building(10 + i * 10, 40)) };
let selectedReads = 0; let unrelatedReads = 0;
const proxied = new Proxy(many.buildings, { get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) { if (Number(key) < 20) selectedReads++; else unrelatedReads++; } return Reflect.get(target, key, receiver); } });
const capped = createCellStockJob({ id: 'cap', generation: 1, essential: true, cityData: { ...many, buildings: proxied }, cell: { ...cell, buildingIndices: Array.from({ length: 20 }, (_, i) => i) }, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => 0, onReady: () => {} });
assert.equal(capped.step(), false); assert.equal(selectedReads, 16, 'constant clock starts at most sixteen source records'); assert.equal(unrelatedReads, 0);
const parent = new THREE.Group(); let thrownRoot: THREE.Group | null = null; let thrownGeometry: THREE.BufferGeometry | null = null;
const throwing = createCellStockJob({ id: 'throw', generation: 1, essential: true, cityData: city, cell, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => 0, onReady: (v) => { thrownRoot = v.group; thrownGeometry = (v.group!.children[0] as THREE.Mesh).geometry; parent.add(v.group!); throw new Error('publish-error'); } });
assert.throws(() => drain(throwing), /publish-error/); assert.equal(thrownRoot!.parent, null); assert.ok(thrownGeometry);
// Lifecycle cases use the actual Three constructors; restore prototype spies even on assertion failure.
function oneUnitClock() { const values = [0, 0, 5]; return () => values.shift() ?? 5; }
function disposeSpy<T>(run: (disposed: THREE.BufferGeometry[]) => T): T { const original = THREE.BufferGeometry.prototype.dispose; const disposed: THREE.BufferGeometry[] = []; THREE.BufferGeometry.prototype.dispose = function () { disposed.push(this); return original.call(this); }; try { return run(disposed); } finally { THREE.BufferGeometry.prototype.dispose = original; } }
disposeSpy((disposed) => { const job = createCellStockJob({ id: 'mid-emit', generation: 1, essential: true, cityData: city, cell, excludedBuildingIndices: new Set(), material, detail: 'overview', now: oneUnitClock(), onReady: () => assert.fail('published') }); assert.equal(job.step(), false); job.cancel(); assert.equal(disposed.length, 1, 'cancel after emitted fragment disposes it once'); });
disposeSpy((disposed) => { let clock = oneUnitClock(); const job = createCellStockJob({ id: 'mid-copy', generation: 1, essential: true, cityData: city, cell, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => clock(), onReady: () => assert.fail('published') }); for (let i = 0; i < 8; i++) { clock = oneUnitClock(); job.step(); } job.cancel(); assert.ok(disposed.length >= 3, 'cancel during copy drains target and fragments'); assert.equal(new Set(disposed).size, disposed.length, 'each owned geometry disposed once'); });
disposeSpy((disposed) => { const scene = new THREE.Group(); const reentrant = createCellStockJob({ id: 'publish-cancel', generation: 1, essential: true, cityData: city, cell, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => 0, onReady: (v) => { scene.add(v.group!); reentrant.cancel(); } }); drain(reentrant); assert.equal(scene.children.length, 0); assert.equal(new Set(disposed).size, disposed.length, 'reentrant publication cancellation disposes each resource once'); });
const guardedBuildings = city.buildings.slice(); Object.defineProperty(guardedBuildings, '2', { get() { throw new Error('unselected building read'); } });
let safeReady = false; drain(createCellStockJob({ id: 'unselected', generation: 1, essential: true, cityData: { ...city, buildings: guardedBuildings }, cell: { ...cell, buildingIndices: [0, 1] }, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => 0, onReady: () => { safeReady = true; } })); assert.ok(safeReady, 'unselected getter remains untouched');
{ const original = THREE.BufferGeometry.prototype.getAttribute; const disposed: THREE.BufferGeometry[] = []; const originalDispose = THREE.BufferGeometry.prototype.dispose; THREE.BufferGeometry.prototype.getAttribute = function (name) { return name === 'normal' ? undefined : original.call(this, name); }; THREE.BufferGeometry.prototype.dispose = function () { disposed.push(this); return originalDispose.call(this); }; try { const invalid = createCellStockJob({ id: 'invalid-attributes', generation: 1, essential: true, cityData: city, cell: { ...cell, buildingIndices: [0] }, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => 0, onReady: () => {} }); assert.throws(() => invalid.step(), /stock fragment/); assert.equal(disposed.length, 1, 'validation failure disposes staged geometry once'); } finally { THREE.BufferGeometry.prototype.getAttribute = original; THREE.BufferGeometry.prototype.dispose = originalDispose; } }
{ let synchronous: ReturnType<typeof createCellStockJob>; const proxied = new Proxy(city.buildings, { get(target, key, receiver) { if (key === '0') synchronous.cancel(); return Reflect.get(target, key, receiver); } }); const original = THREE.BufferGeometry.prototype.dispose; THREE.BufferGeometry.prototype.dispose = function () { throw false; }; try { synchronous = createCellStockJob({ id: 'cancel-during-build', generation: 1, essential: true, cityData: { ...city, buildings: proxied }, cell: { ...cell, buildingIndices: [0] }, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => 0, onReady: () => {} }); assert.throws(() => synchronous.step(), AggregateError); } finally { THREE.BufferGeometry.prototype.dispose = original; } }
{ let materialDisposals = 0; const originalMaterialDispose = material.dispose; material.dispose = () => { materialDisposals++; }; try { disposeSpy(() => { const job = createCellStockJob({ id: 'material-safe', generation: 1, essential: true, cityData: city, cell, excludedBuildingIndices: new Set(), material, detail: 'overview', now: oneUnitClock(), onReady: () => {} }); job.step(); job.cancel(); }); assert.equal(materialDisposals, 0, 'caller material is never disposed during cancellation'); } finally { material.dispose = originalMaterialDispose; } }
{ let clock = oneUnitClock(); let job: ReturnType<typeof createCellStockJob>; const original = THREE.BufferGeometry.prototype.dispose; const disposed: THREE.BufferGeometry[] = []; let first = true; THREE.BufferGeometry.prototype.dispose = function () { disposed.push(this); if (first) { first = false; job.cancel(); throw false; } return original.call(this); }; try { job = createCellStockJob({ id: 'reentrant-dispose', generation: 1, essential: true, cityData: city, cell, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => clock(), onReady: () => {} }); for (let i = 0; i < 3; i++) { clock = oneUnitClock(); job.step(); } let thrown: unknown; try { job.cancel(); } catch (error) { thrown = error; } assert.ok(thrown instanceof AggregateError, 'throwing disposer retains cleanup error'); assert.ok((thrown as AggregateError).errors.includes(false), 'falsy disposal error is retained'); assert.equal(new Set(disposed).size, disposed.length, 'reentrant cleanup disposes each geometry once'); assert.equal(disposed.length, 3, 'later fragments drain after first disposer throws'); } finally { THREE.BufferGeometry.prototype.dispose = original; } }
for (const cleanupError of [false, undefined]) {
  const originalGetAttribute = THREE.BufferGeometry.prototype.getAttribute, originalDispose = THREE.BufferGeometry.prototype.dispose, originalMaterialDispose = material.dispose;
  const visited: THREE.BufferGeometry[] = [], disposed: THREE.BufferGeometry[] = [];
  let stagedGeometry: THREE.BufferGeometry | undefined, materialDisposals = 0;
  THREE.BufferGeometry.prototype.getAttribute = function (name) {
    if (name === 'normal') {
      if (!visited.includes(this)) visited.push(this);
      if (visited.length === 2) { stagedGeometry = visited[1]; return undefined; }
    }
    return originalGetAttribute.call(this, name);
  };
  THREE.BufferGeometry.prototype.dispose = function () { disposed.push(this); originalDispose.call(this); if (this === stagedGeometry) throw cleanupError; };
  material.dispose = () => { materialDisposals++; };
  try {
    const job = createCellStockJob({ id: 'invalid-attributes-cleanup-throws', generation: 1, essential: true, cityData: city, cell, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => 0, onReady: () => assert.fail('invalid fragment must not publish') });
    assert.throws(() => job.step(), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.errors.length, 2);
      assert.ok(error.errors[0] instanceof Error);
      assert.equal(error.errors[0].message, 'stock fragment is not indexed and complete');
      assert.equal(error.errors[1], cleanupError, 'falsy staged disposal error is retained');
      return true;
    });
    assert.equal(visited.length, 2, 'a valid fragment is owned before the invalid fragment');
    assert.deepEqual(disposed, [stagedGeometry, visited[0]], 'staged geometry and earlier owned fragment both drain');
    assert.equal(new Set(disposed).size, disposed.length, 'each geometry is disposed exactly once');
    job.cancel(); assert.equal(job.step(), true); assert.equal(disposed.length, 2, 'terminal job does not dispose again');
    assert.equal(materialDisposals, 0, 'caller material remains untouched');
  } finally { THREE.BufferGeometry.prototype.getAttribute = originalGetAttribute; THREE.BufferGeometry.prototype.dispose = originalDispose; material.dispose = originalMaterialDispose; }
}
// Dense committed data proves real Uint32 offset behaviour and a finite winding tuple above 65535.
const { readFileSync } = createRequire(import.meta.url)('node:fs'); const binary = readFileSync('public/map/london-city.bin'); const denseCity = decodeCity(binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength)); const denseCell = [...indexCity(denseCity, 400).cells.values()].sort((a, b) => b.buildingIndices.length - a.buildingIndices.length)[0]!; let dense: THREE.Group | null = null; drain(createCellStockJob({ id: 'dense', generation: 1, essential: true, cityData: denseCity, cell: denseCell, excludedBuildingIndices: new Set(), material, detail: 'street', now: () => 0, onReady: (v) => { dense = v.group; } })); const denseMesh = dense!.children[0] as THREE.Mesh; const denseIndex = denseMesh.geometry.getIndex()!.array as Uint32Array; let denseMax = 0; for (const value of denseIndex) denseMax = Math.max(denseMax, value); assert.ok(denseIndex instanceof Uint32Array); assert.ok(denseMax > 65535, 'real packed index offsets exceed Uint16'); const densePosition = denseMesh.geometry.getAttribute('position').array as Float32Array; const denseNormal = denseMesh.geometry.getAttribute('normal').array as Float32Array; const ia = denseIndex.findIndex((value) => value > 65535); const a = denseIndex[ia - (ia % 3)]! * 3, b = denseIndex[ia - (ia % 3) + 1]! * 3, c = denseIndex[ia - (ia % 3) + 2]! * 3; const ux = densePosition[b]! - densePosition[a]!, uy = densePosition[b + 1]! - densePosition[a + 1]!, uz = densePosition[b + 2]! - densePosition[a + 2]!, vx = densePosition[c]! - densePosition[a]!, vy = densePosition[c + 1]! - densePosition[a + 1]!, vz = densePosition[c + 2]! - densePosition[a + 2]!; assert.ok((uy * vz - uz * vy) * denseNormal[a]! + (uz * vx - ux * vz) * denseNormal[a + 1]! + (ux * vy - uy * vx) * denseNormal[a + 2]! > 0, 'high-offset packed tuple retains winding');
// A bounded synthetic cell exercises the overview Uint32 fallback once its
// packed vertex count crosses the Uint16 limit.
const complexBuilding = denseCity.buildings[76922]!;
const overflowBuildings = Array.from({ length: 64 }, () => complexBuilding);
const overflowCity: CityData = { ...denseCity, buildings: overflowBuildings };
const overflowCell: CityCell = { ...denseCell, buildingIndices: overflowBuildings.map((_, i) => i) };
let overflow: THREE.Group | null = null;
drain(createCellStockJob({ id: 'overview-overflow', generation: 1, essential: true, cityData: overflowCity, cell: overflowCell, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => 0, onReady: (v) => { overflow = v.group; } }));
const overflowMesh = overflow!.children[0] as THREE.Mesh, overflowGeometry = overflowMesh.geometry;
const overflowIndex = overflowGeometry.getIndex()!.array as Uint32Array;
let overflowMax = 0; for (const value of overflowIndex) overflowMax = Math.max(overflowMax, value);
assert.ok(overflowIndex instanceof Uint32Array); assert.ok(overflowMax > 65535);
const overflowNormal = overflowGeometry.getAttribute('normal'), overflowColor = overflowGeometry.getAttribute('color');
const overflowExpectedScratch = createScratch(); const overflowExpected = buildCellStockBatch({ cityData: overflowCity, cellId: overflowCell.id, buildingIndices: [0], excludedBuildingIndices: new Set(), material, detail: 'overview', scratch: overflowExpectedScratch })!; const overflowExpectedGeometry = (overflowExpected.children[0] as THREE.Mesh).geometry; const sourceCount = overflowExpectedGeometry.getAttribute('position').count; const high = overflowIndex.findIndex((value) => value > 65535); const triStart = high - (high % 3); const highIa = overflowIndex[triStart]!, highIb = overflowIndex[triStart + 1]!, highIc = overflowIndex[triStart + 2]!; const highPosition = overflowGeometry.getAttribute('position'), highNormal = overflowNormal, highColor = overflowColor; const sourcePosition = overflowExpectedGeometry.getAttribute('position'), sourceNormal = overflowExpectedGeometry.getAttribute('normal'), sourceColor = overflowExpectedGeometry.getAttribute('color');
for (const index of [highIa, highIb, highIc]) { const local = index % sourceCount; assert.equal(highPosition.getX(index), sourcePosition.getX(local)); assert.equal(highPosition.getY(index), sourcePosition.getY(local)); assert.equal(highPosition.getZ(index), sourcePosition.getZ(local)); assert.ok(Math.abs(highNormal.getX(index) - sourceNormal.getX(local)) <= 0.5 / 127 + 1e-6); assert.ok(Math.abs(highNormal.getY(index) - sourceNormal.getY(local)) <= 0.5 / 127 + 1e-6); assert.ok(Math.abs(highNormal.getZ(index) - sourceNormal.getZ(local)) <= 0.5 / 127 + 1e-6); assert.ok(Math.abs(highColor.getX(index) - sourceColor.getX(local)) <= 0.5 / 255 + 1e-6); assert.ok(Math.abs(highColor.getY(index) - sourceColor.getY(local)) <= 0.5 / 255 + 1e-6); assert.ok(Math.abs(highColor.getZ(index) - sourceColor.getZ(local)) <= 0.5 / 255 + 1e-6); }
const ax = highPosition.getX(highIb) - highPosition.getX(highIa), ay = highPosition.getY(highIb) - highPosition.getY(highIa), az = highPosition.getZ(highIb) - highPosition.getZ(highIa), bx = highPosition.getX(highIc) - highPosition.getX(highIa), by = highPosition.getY(highIc) - highPosition.getY(highIa), bz = highPosition.getZ(highIc) - highPosition.getZ(highIa); assert.ok((ay * bz - az * by) * highNormal.getX(highIa) + (az * bx - ax * bz) * highNormal.getY(highIa) + (ax * by - ay * bx) * highNormal.getZ(highIa) > 0, 'overview high-offset packed tuple retains winding');
overflowExpected.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });

// Multi-cell overview pages: ordered indexed-attribute parity per source cell against the
// unchanged single-cell path, cell-aligned page bounds and complete coverage.
function singleCell(cityData: CityData, cell: CityCell): { group: THREE.Group | null; scratch: ReturnType<typeof createScratch>; sources: readonly number[] } {
  let out: { group: THREE.Group | null; scratch: ReturnType<typeof createScratch>; sources: readonly number[] } | undefined;
  drain(createCellStockJob({ id: `single:${cell.id}`, generation: 1, essential: true, cityData, cell, excludedBuildingIndices: new Set(), material, detail: 'overview', now: () => 0, onReady: (v) => { out = { group: v.group, scratch: v.scratch, sources: v.sourceBuildingIndices }; } }));
  assert.ok(out); return out;
}
function tileJob(cityData: CityData, cells: readonly CityCell[], caps: { maxPageVertices?: number; maxPageIndexBytes?: number } = {}): StockTileReady {
  let out: StockTileReady | undefined;
  drain(createStockTileJob({ id: 'tile', generation: 1, essential: true, cityData, tileId: 'tile:0,0', cells, excludedBuildingIndices: new Set(), material, now: () => 0, ...caps, onReady: (v) => { out = v; } }));
  assert.ok(out); return out;
}
function geometryOf(group: THREE.Group | null): THREE.BufferGeometry | null { return group ? (group.children[0] as THREE.Mesh).geometry : null; }
function assertTileParity(cityData: CityData, cells: readonly CityCell[], ready: StockTileReady, caps = { maxPageVertices: MAX_PAGE_VERTICES, maxPageIndexBytes: MAX_PAGE_INDEX_BYTES }): void {
  assert.deepEqual([...ready.cellIds], cells.map((cell) => cell.id));
  assert.deepEqual(ready.pages.flatMap((page) => [...page.cellIds]), cells.map((cell) => cell.id), 'pages cover every cell exactly once in tile order');
  const singles = new Map(cells.map((cell) => [cell.id, singleCell(cityData, cell)] as const));
  const expectedSources = cells.flatMap((cell) => [...singles.get(cell.id)!.sources]);
  assert.deepEqual([...ready.sourceBuildingIndices], expectedSources, 'tile source order equals per-cell source order');
  assert.equal(new Set(ready.sourceBuildingIndices).size, ready.sourceBuildingIndices.length, 'no duplicate source identity');
  assert.deepEqual(ready.scratch.picks, cells.flatMap((cell) => singles.get(cell.id)!.scratch.picks), 'picks are the ordered per-cell picks');
  assert.deepEqual(ready.pages.flatMap((page) => [...page.sourceBuildingIndices]), expectedSources);
  const meshes: THREE.Mesh[] = []; ready.group?.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  assert.deepEqual(meshes, ready.pages.map((page) => page.mesh), 'group children are exactly the pages');
  let geometryBytes = 0;
  for (const page of ready.pages) {
    const geometry = page.mesh.geometry, position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), color = geometry.getAttribute('color'), index = geometry.getIndex()!;
    assert.equal(page.mesh.material, material); assert.equal(page.mesh.userData.tileId, 'tile:0,0'); assert.deepEqual(page.mesh.userData.cellIds, page.cellIds);
    assert.equal(position.count, page.vertices); assert.equal(index.array.byteLength, page.indexBytes);
    assert.ok(normal.array instanceof Int8Array && color.array instanceof Uint8Array);
    const oversized = page.cellIds.length === 1 && page.vertices > caps.maxPageVertices;
    if (!oversized) { assert.ok(page.vertices <= caps.maxPageVertices, 'page stays within the vertex cap'); assert.ok(page.indexBytes <= caps.maxPageIndexBytes, 'page stays within the index-byte cap'); }
    assert.ok(page.vertices <= 65535 ? index.array instanceof Uint16Array : index.array instanceof Uint32Array, 'Uint16 pages never overflow');
    geometryBytes += position.array.byteLength + normal.array.byteLength + color.array.byteLength + index.array.byteLength;
    assert.equal(page.geometryBytes, position.array.byteLength + normal.array.byteLength + color.array.byteLength + index.array.byteLength);
    let vertexAt = 0, indexAt = 0;
    for (const cellId of page.cellIds) {
      const expected = geometryOf(singles.get(cellId)!.group); if (!expected) continue;
      const ep = expected.getAttribute('position'), en = expected.getAttribute('normal'), ec = expected.getAttribute('color'), ei = expected.getIndex()!;
      assert.deepEqual(Array.from((position.array as Float32Array).subarray(vertexAt * 3, (vertexAt + ep.count) * 3)), Array.from(ep.array), `positions for ${cellId}`);
      assert.deepEqual(Array.from((normal.array as Int8Array).subarray(vertexAt * 3, (vertexAt + ep.count) * 3)), Array.from(en.array), `packed normals for ${cellId}`);
      assert.deepEqual(Array.from((color.array as Uint8Array).subarray(vertexAt * 3, (vertexAt + ep.count) * 3)), Array.from(ec.array), `packed colors for ${cellId}`);
      assert.deepEqual(Array.from(index.array.subarray(indexAt, indexAt + ei.count)), Array.from(ei.array).map((v) => v + vertexAt), `offset indices for ${cellId}`);
      vertexAt += ep.count; indexAt += ei.count;
    }
    assert.equal(vertexAt, position.count, 'page holds exactly its cells');
    assert.equal(indexAt, index.count);
    const box = geometry.boundingBox!; const check = new THREE.BufferGeometry(); check.setAttribute('position', position); check.computeBoundingBox();
    assert.deepEqual(box.min.toArray(), check.boundingBox!.min.toArray()); assert.deepEqual(box.max.toArray(), check.boundingBox!.max.toArray());
  }
  assert.equal(ready.geometryBytes, geometryBytes);
  // Greedy cell-aligned packing: each page break is forced by the next whole cell.
  const cellVertices = (cellId: string) => geometryOf(singles.get(cellId)!.group)?.getAttribute('position').count ?? 0;
  const cellIndices = (cellId: string) => geometryOf(singles.get(cellId)!.group)?.getIndex()!.count ?? 0;
  for (let i = 0; i + 1 < ready.pages.length; i++) {
    const page = ready.pages[i]!, next = ready.pages[i + 1]!.cellIds[0]!;
    const vertices = page.vertices + cellVertices(next), indices = page.mesh.geometry.getIndex()!.count + cellIndices(next);
    assert.ok(vertices > caps.maxPageVertices || indices * (vertices <= 65535 ? 2 : 4) > caps.maxPageIndexBytes, `page ${i} closes only when the next cell would overflow a cap`);
  }
  for (const single of singles.values()) single.group?.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
}
{
  const denseIndex = indexCity(denseCity, 400), tiles = indexStockTiles(denseIndex);
  for (const cell of denseIndex.cells.values()) assert.equal(tiles.tileOf.get(cell.id), stockTileIdFor(cell.id));
  assert.equal([...tiles.tiles.values()].reduce((n, tile) => n + tile.cells.length, 0), denseIndex.cells.size, 'every source cell belongs to exactly one tile');
  for (const tile of tiles.tiles.values()) { assert.ok(tile.cells.length <= 16); for (const cell of tile.cells) { const [ix, iz] = cell.id.split(',').map(Number); assert.equal(tile.id, `tile:${Math.floor(ix! / 4)},${Math.floor(iz! / 4)}`); } }
  const byBuildings = [...tiles.tiles.values()].sort((a, b) => b.cells.reduce((n, c) => n + c.buildingIndices.length, 0) - a.cells.reduce((n, c) => n + c.buildingIndices.length, 0));
  const byCells = [...tiles.tiles.values()].sort((a, b) => b.cells.length - a.cells.length);
  for (const tile of new Set([byBuildings[0]!, byCells[0]!, byBuildings[Math.floor(byBuildings.length / 2)]!])) {
    const ready = tileJob(denseCity, tile.cells);
    assertTileParity(denseCity, tile.cells, ready);
    for (const page of ready.pages) assert.ok(page.indexBytes <= MAX_PAGE_INDEX_BYTES && page.mesh.geometry.getIndex()!.array instanceof Uint16Array, 'committed tiles stay in Uint16 pages under the draw-range cap');
    console.log(JSON.stringify({ tile: tile.id, cells: tile.cells.length, buildings: ready.sourceBuildingIndices.length, pages: ready.pages.map((page) => ({ cells: page.cellIds.length, vertices: page.vertices, indexBytes: page.indexBytes })) }));
    ready.group?.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  }
}
{
  // Adversarial synthetic tile: small, empty, oversized (>65535 vertices) and excluded cells.
  const smallA: CityCell = { id: '0,0', bounds: { minX: 0, minZ: 0, maxX: 1, maxZ: 1 }, buildingIndices: [64, 65] };
  const empty: CityCell = { id: '1,0', bounds: { minX: 1, minZ: 0, maxX: 2, maxZ: 1 }, buildingIndices: [] };
  const oversized: CityCell = { id: '2,0', bounds: { minX: 2, minZ: 0, maxX: 3, maxZ: 1 }, buildingIndices: overflowCell.buildingIndices };
  const smallB: CityCell = { id: '3,0', bounds: { minX: 3, minZ: 0, maxX: 4, maxZ: 1 }, buildingIndices: [66] };
  const synthetic: CityData = { ...overflowCity, buildings: [...overflowBuildings, building(10, 10), building(30, 10), building(50, 10)] };
  const ready = tileJob(synthetic, [smallA, empty, oversized, smallB]);
  assertTileParity(synthetic, [smallA, empty, oversized, smallB], ready);
  assert.deepEqual(ready.pages.map((page) => [...page.cellIds]), [['0,0', '1,0'], ['2,0'], ['3,0']], 'an oversized cell becomes its own page at cell boundaries');
  assert.ok(ready.pages[1]!.mesh.geometry.getIndex()!.array instanceof Uint32Array && ready.pages[1]!.vertices > 65535, 'oversized cell falls back to Uint32 without dropping geometry');
  assert.ok(ready.pages[0]!.mesh.geometry.getIndex()!.array instanceof Uint16Array && ready.pages[2]!.mesh.geometry.getIndex()!.array instanceof Uint16Array);
  ready.group?.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  const excludedReady = tileJob(synthetic, [smallA, smallB]);
  let excludedOut: StockTileReady | undefined;
  drain(createStockTileJob({ id: 'tile-excluded', generation: 1, essential: true, cityData: synthetic, tileId: 'tile:0,0', cells: [smallA, smallB], excludedBuildingIndices: new Set([65]), material, now: () => 0, onReady: (v) => { excludedOut = v; } }));
  assert.deepEqual([...excludedOut!.sourceBuildingIndices], [64, 66], 'exclusions drop only the excluded source');
  assert.deepEqual([...excludedReady.sourceBuildingIndices], [64, 65, 66]);
  assert.ok(excludedOut!.geometryBytes < excludedReady.geometryBytes);
  excludedReady.group?.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); }); excludedOut!.group?.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  // Tight caps force page breaks strictly at cell boundaries by vertices and by index bytes.
  const small: CityCell[] = [64, 65, 66].map((n, i) => ({ id: `${i},1` as const, bounds: { minX: i, minZ: 1, maxX: i + 1, maxZ: 2 }, buildingIndices: [n] }));
  const one = singleCell(synthetic, small[0]!), oneGeometry = geometryOf(one.group)!, oneVertices = oneGeometry.getAttribute('position').count, oneIndexBytes = oneGeometry.getIndex()!.array.byteLength;
  one.group?.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  const byVertices = tileJob(synthetic, small, { maxPageVertices: oneVertices * 2 });
  assertTileParity(synthetic, small, byVertices, { maxPageVertices: oneVertices * 2, maxPageIndexBytes: MAX_PAGE_INDEX_BYTES });
  assert.deepEqual(byVertices.pages.map((page) => [...page.cellIds]), [['0,1', '1,1'], ['2,1']]);
  byVertices.group?.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  const byIndex = tileJob(synthetic, small, { maxPageIndexBytes: oneIndexBytes });
  assertTileParity(synthetic, small, byIndex, { maxPageVertices: MAX_PAGE_VERTICES, maxPageIndexBytes: oneIndexBytes });
  assert.deepEqual(byIndex.pages.map((page) => [...page.cellIds]), [['0,1'], ['1,1'], ['2,1']]);
  byIndex.group?.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  assert.throws(() => createStockTileJob({ id: 'dup', generation: 1, essential: true, cityData: synthetic, tileId: 'tile:0,0', cells: [smallA, smallA], excludedBuildingIndices: new Set(), material, now: () => 0, onReady: () => {} }), /duplicate/);
  assert.throws(() => createStockTileJob({ id: 'empty', generation: 1, essential: true, cityData: synthetic, tileId: 'tile:0,0', cells: [], excludedBuildingIndices: new Set(), material, now: () => 0, onReady: () => {} }), RangeError);
  assert.throws(() => createStockTileJob({ id: 'cap', generation: 1, essential: true, cityData: synthetic, tileId: 'tile:0,0', cells: small, excludedBuildingIndices: new Set(), material, now: () => 0, maxPageVertices: 65536, onReady: () => {} }), RangeError);
  // Lifecycle: cancellation during emit and copy, publication throw and reentrant cancellation dispose each page exactly once.
  const tileArgs = { generation: 1, essential: true, cityData: synthetic, tileId: 'tile:0,0', cells: small, excludedBuildingIndices: new Set<number>(), material } as const;
  disposeSpy((disposed) => { const job = createStockTileJob({ ...tileArgs, id: 'tile-mid-emit', now: oneUnitClock(), onReady: () => assert.fail('published') }); assert.equal(job.step(), false); job.cancel(); assert.equal(disposed.length, 1, 'cancel after the first emitted fragment disposes it once'); assert.equal(job.step(), true); });
  disposeSpy((disposed) => { let clock = oneUnitClock(); const job = createStockTileJob({ ...tileArgs, id: 'tile-mid-copy', maxPageVertices: oneVertices * 2, now: () => clock(), onReady: () => assert.fail('published') }); for (let i = 0; i < 12; i++) { clock = oneUnitClock(); job.step(); } job.cancel(); assert.ok(disposed.length >= 3, 'cancel during copy drains the open page target and staged fragments'); assert.equal(new Set(disposed).size, disposed.length, 'each owned geometry disposed once'); });
  disposeSpy((disposed) => { const parent = new THREE.Group(); let published: StockTileReady | undefined; const job = createStockTileJob({ ...tileArgs, id: 'tile-throw', maxPageVertices: oneVertices * 2, now: () => 0, onReady: (v) => { published = v; parent.add(v.group!); throw new Error('publish-error'); } }); assert.throws(() => drain(job), /publish-error/); assert.equal(published!.pages.length, 2); assert.equal(published!.group!.parent, null, 'thrown publication detaches the root'); for (const page of published!.pages) assert.ok(disposed.includes(page.mesh.geometry), 'every sealed page is disposed after a publication throw'); assert.equal(new Set(disposed).size, disposed.length); });
  disposeSpy((disposed) => { const scene = new THREE.Group(); let published: StockTileReady | undefined; const reentrant = createStockTileJob({ ...tileArgs, id: 'tile-publish-cancel', maxPageVertices: oneVertices * 2, now: () => 0, onReady: (v) => { published = v; scene.add(v.group!); reentrant.cancel(); } }); drain(reentrant); assert.equal(scene.children.length, 0); for (const page of published!.pages) assert.ok(disposed.includes(page.mesh.geometry)); assert.equal(new Set(disposed).size, disposed.length, 'reentrant cancellation disposes each page once'); });
  disposeSpy((disposed) => { let published: StockTileReady | undefined; const adopted = new THREE.Group(); const job = createStockTileJob({ ...tileArgs, id: 'tile-complete', maxPageVertices: oneVertices * 2, now: () => 0, onReady: (v) => { published = v; adopted.add(v.group!); } }); drain(job); job.cancel(); assert.equal(disposed.length, 3, 'only the consumed fragments are disposed after transfer'); assert.equal(published!.group!.parent, adopted, 'late cancellation leaves transferred pages with the owner'); assert.equal(job.step(), true); for (const page of published!.pages) page.mesh.geometry.dispose(); });
}
console.log('cell stock job checks passed');
