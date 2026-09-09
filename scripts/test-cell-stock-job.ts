import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { buildCellStockBatch, createScratch } from '../lib/game/render3d/cityBuilder';
import { createCellStockJob } from '../lib/game/render3d/cellStockJob';
import type { CityCell } from '../lib/game/render3d/cityIndex';
import { quantizeX, quantizeY, type CityData } from '../lib/game/render3d/format';

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
    const p = o.geometry.getAttribute('position').array as Float32Array; const n = o.geometry.getAttribute('normal').array as Float32Array;
    const c = o.geometry.getAttribute('color').array as Float32Array; const ix = o.geometry.getIndex()!.array;
    for (let i = 0; i < ix.length; i += 3) out.push([0, 1, 2].map((k) => { const v = Number(ix[i + k]) * 3; return `${p[v]},${p[v + 1]},${p[v + 2]}|${n[v]},${n[v + 1]},${n[v + 2]}|${c[v]},${c[v + 1]},${c[v + 2]}`; }).join(';'));
  }});
  return out.sort();
}
function drain(job: ReturnType<typeof createCellStockJob>): void { for (let i = 0; i < 1000 && !job.step(); i++); }
function run(detail: 'overview' | 'neighbourhood' | 'street'): { group: THREE.Group | null; scratch: ReturnType<typeof createScratch> } {
  let ready: { group: THREE.Group | null; scratch: ReturnType<typeof createScratch> } | undefined;
  drain(createCellStockJob({ id: detail, generation: 1, essential: true, cityData: city, cell, excludedBuildingIndices: new Set(), material, detail, now: () => 0, onReady: (value) => { ready = value; } }));
  assert.ok(ready); return ready;
}
for (const detail of ['overview', 'neighbourhood', 'street'] as const) {
  const actual = run(detail);
  const expectedScratch = createScratch();
  const expected = buildCellStockBatch({ cityData: city, cellId: cell.id, buildingIndices: [0, 1, 2], excludedBuildingIndices: new Set(), material, detail, scratch: expectedScratch });
  assert.deepEqual(triangles(actual.group), triangles(expected));
  assert.deepEqual(actual.scratch, expectedScratch);
  const meshes: THREE.Mesh[] = []; actual.group?.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  assert.equal(meshes.length, 1); assert.equal(meshes[0]!.material, material);
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
console.log('cell stock job checks passed');
