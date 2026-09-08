import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import {
  buildCellStockBatch,
  buildChunkTier,
  chunkTierMeshes,
  createScratch,
} from '../lib/game/render3d/cityBuilder';
import { indexCity } from '../lib/game/render3d/cityIndex';
import { decodeCity, quantizeX, quantizeY, type CityData } from '../lib/game/render3d/format';

const ORACLE_INDICES = [45401, 71493, 71693, 72128] as const;
const ORACLE_GEOMETRY_SHA256 = 'f30fb062374efe5569f0d311cd652791981df128fc9a60d4c3507f0588032f26';
const ORACLE_SCRATCH_SHA256 = '1b577019bb8844db1ba8736b2d92852a837eccd23b9dc1b7cb966f48f4b5525b';

function city(): CityData {
  const file = readFileSync('public/map/london-city.bin');
  return decodeCity(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
}

function sparseOracle(full: CityData): CityData {
  const filler = { ...full.buildings[0]!, chunkId: -1, major: false };
  const buildings = Array.from({ length: full.buildings.length }, () => filler);
  for (const index of ORACLE_INDICES) buildings[index] = full.buildings[index]!;
  return { ...full, buildings };
}

function tuples(group: THREE.Group | null): string[] {
  const out: string[] = [];
  for (const mesh of chunkTierMeshes(group)) {
    for (const name of ['position', 'normal', 'color'] as const) {
      const attribute = mesh.geometry.getAttribute(name);
      for (let i = 0; i < attribute.count; i++) {
        out.push(`${name}:${attribute.getX(i)},${attribute.getY(i)},${attribute.getZ(i)}`);
      }
    }
  }
  return out.sort();
}

function sha(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function scratchDigest(scratch: ReturnType<typeof createScratch>): string {
  return sha({ p: scratch.picks, w: scratch.windows, r: scratch.rooftops, s: scratch.signs });
}

function building(x0: number, z0: number, x1: number, z1: number) {
  return {
    major: false,
    heightM: 15,
    chunkId: 0,
    style: 4,
    roof: 0,
    wall565: 0,
    roof565: 0,
    verts: new Uint16Array([
      quantizeX(x0), quantizeY(z0), quantizeX(x1), quantizeY(z0),
      quantizeX(x1), quantizeY(z1), quantizeX(x0), quantizeY(z1),
    ]),
    indices: new Uint8Array([0, 1, 2, 0, 2, 3]),
  };
}

function test(): void {
  const full = city();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const legacyScratch = createScratch();
  const legacy = buildChunkTier(sparseOracle(full), 20, true, new Set(), legacyScratch);
  const batchScratch = createScratch();
  const batch = buildCellStockBatch({
    cityData: full,
    cellId: '0,0',
    buildingIndices: ORACLE_INDICES,
    excludedBuildingIndices: new Set(),
    material,
    scratch: batchScratch,
  });
  assert.equal(sha(tuples(legacy).join('\n')), ORACLE_GEOMETRY_SHA256);
  assert.equal(sha(tuples(batch).join('\n')), ORACLE_GEOMETRY_SHA256);
  assert.equal(scratchDigest(legacyScratch), ORACLE_SCRATCH_SHA256);
  assert.equal(scratchDigest(batchScratch), ORACLE_SCRATCH_SHA256);
  assert.deepEqual(batchScratch.picks.map((pick) => pick.sourceIndex), ORACLE_INDICES);
  const mesh = chunkTierMeshes(batch)[0]!;
  assert.equal(mesh.material, material);
  assert.deepEqual(batch!.userData.sourceBuildingIndices, ORACLE_INDICES);
  assert.ok(tuples(batch).every((tuple) => !tuple.includes('NaN') && !tuple.includes('Infinity')));

  const excludedScratch = createScratch();
  const excluded = buildCellStockBatch({
    cityData: full,
    cellId: '0,0',
    buildingIndices: [72128],
    excludedBuildingIndices: new Set([72128]),
    material,
    scratch: excludedScratch,
  });
  assert.equal(excluded, null);
  assert.deepEqual(excludedScratch, createScratch());

  const errorScratch = createScratch();
  const original = JSON.stringify(errorScratch);
  for (const invalid of [[45401, 45401], [-1], [full.buildings.length], Array.from({ length: 17 }, (_, i) => i)]) {
    assert.throws(() =>
      buildCellStockBatch({
        cityData: full, cellId: '0,0', buildingIndices: invalid,
        excludedBuildingIndices: new Set(), material, scratch: errorScratch,
      }),
    );
    assert.equal(JSON.stringify(errorScratch), original);
  }

  const crossing: CityData = {
    buildings: [building(3.55, 10, 3.65, 20), building(10, 10, 10.1, 20)], roads: [], parks: [], water: [],
  };
  const ownership = indexCity(crossing, 400);
  const owner = [...ownership.cells.values()].find((cell) => cell.buildingIndices.includes(0))!;
  assert.deepEqual(owner.buildingIndices, [0]);
  const crossingBatch = buildCellStockBatch({
    cityData: crossing, cellId: owner.id, buildingIndices: owner.buildingIndices,
    excludedBuildingIndices: new Set(), material,
  });
  assert.deepEqual(crossingBatch!.userData.sourceBuildingIndices, [0]);
  assert.ok(tuples(crossingBatch).length > 0);
  console.log('cell stock batch: 8 checks passed');
}

function rawGeometryBytes(group: THREE.Group | null): number {
  return chunkTierMeshes(group).reduce((total, mesh) => {
    const index = mesh.geometry.getIndex();
    return total + ['position', 'normal', 'color'].reduce(
      (sum, name) => sum + mesh.geometry.getAttribute(name)!.array.byteLength, 0,
    ) + (index?.array.byteLength ?? 0);
  }, 0);
}

function measure(): void {
  const full = city();
  const largest = [...indexCity(full, 400).cells.values()].sort(
    (a, b) => b.buildingIndices.length - a.buildingIndices.length,
  )[0]!;
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const batches = Array.from({ length: Math.ceil(largest.buildingIndices.length / 16) }, (_, i) =>
    largest.buildingIndices.slice(i * 16, i * 16 + 16),
  );
  const timings = batches.map((buildingIndices) => {
    const start = performance.now();
    const group = buildCellStockBatch({ cityData: full, cellId: largest.id, buildingIndices, excludedBuildingIndices: new Set(), material });
    return { count: buildingIndices.length, ms: performance.now() - start, rawGeometryBytes: rawGeometryBytes(group), sourceBuildingIndices: group?.userData.sourceBuildingIndices ?? [] };
  });
  console.log(JSON.stringify({ cellId: largest.id, owners: largest.buildingIndices.length, timings }, null, 2));
}

if (process.argv.includes('--measure')) measure();
else test();
