/**
 * Fixed-capacity cover geometry pages: bounded allocation/append sizes as the
 * selection grows, logical (ordered triangle + material) equivalence with the
 * legacy synchronous builders across page boundaries, valid page-local
 * indices, clipping, determinism, laziness and cancellation cleanup.
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { METERS_TO_WORLD } from '../lib/game/geo';
import {
  buildParks,
  buildRoads,
  buildWater,
  createParkCoverJob,
  createRoadCoverJob,
} from '../lib/game/render3d/cityBuilder';
import { clipCoverPolygon } from '../lib/game/render3d/coverClip';
import {
  COVER_ATTACH_CHUNK,
  COVER_PAGE_INDICES,
  COVER_PAGE_VERTICES,
  coverMesh,
  createCoverJob,
  createCoverPageWriter,
} from '../lib/game/render3d/coverGeometry';
import type { BuildJob } from '../lib/game/render3d/buildScheduler';
import type { BoundsXZ } from '../lib/game/render3d/cityIndex';
import { quantizeX, quantizeY, type CityData, type CityPoly } from '../lib/game/render3d/format';
import { createWaterCoverJob } from '../lib/game/render3d/waterCoverJob';

const M = METERS_TO_WORLD;
const jobOptions = { generation: 1, essential: true, now: () => 0 };

function meshes(root: THREE.Object3D | null): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  root?.traverse((object) => {
    if (object instanceof THREE.Mesh) result.push(object);
  });
  return result;
}

function run(job: BuildJob): number {
  let steps = 0;
  while (!job.step()) assert(++steps < 50_000_000, 'job terminates');
  return steps;
}

function colorKey(mesh: THREE.Mesh): string {
  const material = mesh.material as THREE.Material & { color?: THREE.Color };
  const tier = mesh.parent?.userData.roadTier;
  return `${material.type}:${material.color?.getHexString() ?? '-'}:${tier ?? '-'}:${mesh.renderOrder}`;
}

/** Ordered per-material triangle streams, independent of mesh/page layout. */
function triangleStreams(root: THREE.Object3D | null): Map<string, number[]> {
  const streams = new Map<string, number[]>();
  for (const mesh of meshes(root)) {
    const key = colorKey(mesh);
    const out = streams.get(key) ?? [];
    streams.set(key, out);
    const position = mesh.geometry.getAttribute('position');
    const normal = mesh.geometry.getAttribute('normal');
    const color = mesh.geometry.getAttribute('color');
    const index = mesh.geometry.getIndex()!;
    for (let i = 0; i < index.count; i++) {
      const v = index.getX(i);
      out.push(position.getX(v), position.getY(v), position.getZ(v));
      out.push(normal.getX(v), normal.getY(v), normal.getZ(v));
      if (color) out.push(color.getX(v), color.getY(v), color.getZ(v));
    }
  }
  return streams;
}

function assertValidPages(root: THREE.Object3D | null): number {
  let pages = 0;
  for (const mesh of meshes(root)) {
    pages++;
    const position = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex()!;
    assert(position.count > 0 && position.count <= COVER_PAGE_VERTICES, 'page vertex cap');
    assert(index.count > 0 && index.count <= COVER_PAGE_INDICES, 'page index cap');
    assert.equal(index.count % 3, 0);
    assert(index.array instanceof Uint16Array, 'page-local 16-bit indices');
    assert.equal(mesh.geometry.getAttribute('normal').count, position.count);
    const color = mesh.geometry.getAttribute('color');
    if (color) assert.equal(color.count, position.count);
    for (let i = 0; i < index.count; i++) assert(index.getX(i) < position.count, 'index in page');
    assert(mesh.geometry.boundingSphere, 'bounding sphere computed');
    assert(mesh.geometry.boundingBox, 'bounding box computed');
  }
  return pages;
}

function disposeAll(...roots: (THREE.Object3D | null)[]): void {
  for (const root of roots)
    for (const mesh of meshes(root)) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
}

/** Tracks the largest native allocation/append receiver seen while `fn` runs. */
function measureAllocations(fn: () => void): { typed: number; push: number } {
  const F32 = Float32Array,
    U16 = Uint16Array,
    U32 = Uint32Array,
    push = Array.prototype.push;
  const peak = { typed: 0, push: 0 };
  function track<T extends typeof Float32Array | typeof Uint16Array | typeof Uint32Array>(
    Base: T,
  ): T {
    return new Proxy(Base, {
      construct(target, args, newTarget) {
        const first = args[0];
        const length =
          typeof first === 'number'
            ? first
            : first instanceof ArrayBuffer
              ? (args[2] ?? first.byteLength / target.BYTES_PER_ELEMENT)
              : (first?.length ?? 0);
        peak.typed = Math.max(peak.typed, length);
        return Reflect.construct(target, args, newTarget);
      },
    });
  }
  globalThis.Float32Array = track(F32);
  globalThis.Uint16Array = track(U16);
  globalThis.Uint32Array = track(U32);
  Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
    peak.push = Math.max(peak.push, this.length + items.length);
    return push.apply(this, items);
  };
  try {
    fn();
  } finally {
    globalThis.Float32Array = F32;
    globalThis.Uint16Array = U16;
    globalThis.Uint32Array = U32;
    Array.prototype.push = push;
  }
  return peak;
}

function q(points: { x: number; z: number }[]): Uint16Array {
  const out = new Uint16Array(points.length * 2);
  points.forEach((p, i) => {
    out[i * 2] = quantizeX(p.x);
    out[i * 2 + 1] = quantizeY(p.z);
  });
  return out;
}

/** A wiggling serpentine road of `n` points ~1 m apart in 8 km rows 30 m apart. */
function road(n: number, z: number, tier: number): { tier: number; pts: Uint16Array } {
  const points = [];
  const rowLength = 8000;
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / rowLength),
      along = i % rowLength;
    const x = 4 + (row % 2 ? rowLength - along : along) * M;
    points.push({
      x,
      z: z + row * 30 * M + Math.sin(i / 7) * 0.6 * M + Math.cos(i / 3) * 0.3 * M,
    });
  }
  return { tier, pts: q(points) };
}

function city(roads: { tier: number; pts: Uint16Array }[], water: CityPoly[] = []): CityData {
  return { buildings: [], water, parks: [], roads };
}

/* 1. Bounded allocation and append sizes as the selection grows (roads). */
{
  const peaks: { typed: number; push: number; pages: number; points: number }[] = [];
  for (const points of [3000, 12000, 30000]) {
    const data = city([road(points, 12, 0), road(points, 12 + 300 * M, 1)]);
    let output: THREE.Group | null = null;
    const job = createRoadCoverJob({
      ...jobOptions,
      id: `roads-${points}`,
      cityData: data,
      roadIndices: [0, 1],
      onReady(group) {
        output = group;
      },
    });
    const peak = measureAllocations(() => run(job));
    const pages = assertValidPages(output);
    peaks.push({ ...peak, pages, points });
    disposeAll(output);
  }
  const first = peaks[0]!;
  for (const peak of peaks) {
    assert(
      peak.typed <= COVER_PAGE_VERTICES * 3,
      `typed allocations bounded by one page (${peak.typed} at ${peak.points} points)`,
    );
    assert.equal(peak.typed, first.typed, 'typed allocation peak is independent of source size');
    assert(
      peak.push <= peak.points * 2 + 64,
      `JS array growth bounded by the record being decoded (${peak.push} at ${peak.points} points)`,
    );
  }
  assert(peaks[2]!.pages > peaks[0]!.pages && peaks[2]!.pages > 4, 'large selections span pages');
  console.log(
    'allocation peaks',
    peaks.map((p) => `${p.points}pts: typed=${p.typed} push=${p.push} pages=${p.pages}`),
  );
}

/* 2. Ordered triangle/material equivalence with the legacy road builder across pages. */
{
  const data = city([road(30000, 12, 0), road(9000, 12 + 300 * M, 1), road(3000, 12 + 400 * M, 2)]);
  const legacy = buildRoads(data);
  let output: THREE.Group | null = null;
  run(
    createRoadCoverJob({
      ...jobOptions,
      id: 'roads-parity',
      cityData: data,
      roadIndices: [0, 1, 2],
      onReady(group) {
        output = group;
      },
    }),
  );
  const paged = assertValidPages(output);
  assert(paged > meshes(legacy).length, 'paged output splits at least one legacy mesh');
  const want = triangleStreams(legacy),
    got = triangleStreams(output);
  assert.deepEqual([...got.keys()], [...want.keys()], 'material/tier order preserved');
  for (const [key, stream] of want) assert.deepEqual(got.get(key), stream, key);
  // Determinism: a second run is byte-identical page by page.
  let again: THREE.Group | null = null;
  run(
    createRoadCoverJob({
      ...jobOptions,
      id: 'roads-again',
      cityData: data,
      roadIndices: [0, 1, 2],
      onReady(group) {
        again = group;
      },
    }),
  );
  const a = meshes(output),
    b = meshes(again);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(
      b[i]!.geometry.getAttribute('position').array,
      a[i]!.geometry.getAttribute('position').array,
    );
    assert.deepEqual(b[i]!.geometry.getIndex()!.array, a[i]!.geometry.getIndex()!.array);
  }
  disposeAll(legacy, output, again);
}

/* 3. Clipping across pages: every vertex inside bounds, clipped area matches legacy. */
{
  const data = city([road(30000, 12, 0)]);
  const bounds: BoundsXZ = { minX: 5, maxX: 5 + 3000 * M, minZ: 11, maxZ: 12 + 50 * M };
  let output: THREE.Group | null = null;
  run(
    createRoadCoverJob({
      ...jobOptions,
      id: 'roads-clip',
      cityData: data,
      roadIndices: [0],
      bounds,
      paintMarks: false,
      onReady(group) {
        output = group;
      },
    }),
  );
  assertValidPages(output);
  const area = (root: THREE.Object3D | null, clip: BoundsXZ | null) => {
    const totals = new Map<string, number>();
    for (const mesh of meshes(root)) {
      const position = mesh.geometry.getAttribute('position');
      const index = mesh.geometry.getIndex()!;
      let sum = totals.get(colorKey(mesh)) ?? 0;
      for (let i = 0; i < index.count; i += 3) {
        const tri = [0, 1, 2].map((k) => {
          const v = index.getX(i + k);
          if (clip) {
            assert(position.getX(v) >= clip.minX - 1e-5 && position.getX(v) <= clip.maxX + 1e-5);
            assert(position.getZ(v) >= clip.minZ - 1e-5 && position.getZ(v) <= clip.maxZ + 1e-5);
          }
          return { x: position.getX(v), z: position.getZ(v) };
        });
        const poly = clip ? tri : clipCoverPolygon(tri, bounds);
        for (let j = 1; j < poly.length - 1; j++)
          sum +=
            Math.abs(
              (poly[j]!.x - poly[0]!.x) * (poly[j + 1]!.z - poly[0]!.z) -
                (poly[j]!.z - poly[0]!.z) * (poly[j + 1]!.x - poly[0]!.x),
            ) / 2;
      }
      totals.set(colorKey(mesh), sum);
    }
    return totals;
  };
  const legacy = buildRoads(data, null, false);
  const want = area(legacy, null),
    got = area(output, bounds);
  assert.deepEqual([...got.keys()], [...want.keys()]);
  for (const [key, value] of want)
    assert(Math.abs(got.get(key)! - value) < 1e-6 * Math.max(1, value), `clipped area ${key}`);
  disposeAll(legacy, output);
}

/* 4. Water surface and banks across pages: parity with legacy output. */
function waterRing(n: number, cx: number, cz: number, radiusM: number): CityPoly {
  const ring: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = (radiusM + radiusM * 0.07 * Math.sin(t * 9)) * M;
    ring.push({ x: cx + Math.cos(t) * r, z: cz + Math.sin(t) * r });
  }
  const indices: number[] = [];
  for (let i = 1; i < n - 1; i++) indices.push(0, i, i + 1);
  return { verts: q(ring), indices: new Uint16Array(indices) };
}
// Many records that each fit a page: shared fan vertices survive, so even
// accumulated vertex normals match the legacy merged mesh exactly.
{
  const water: CityPoly[] = [];
  for (let i = 0; i < 12; i++)
    water.push(waterRing(3000, 30 + (i % 4) * 45, 20 + Math.floor(i / 4) * 30, 1200));
  const data = city([], water);
  const legacy = buildWater(data);
  let output: THREE.Group | null = null;
  run(
    createWaterCoverJob({
      ...jobOptions,
      id: 'water-records',
      cityData: data,
      waterIndices: water.map((_, i) => i),
      onReady(group) {
        output = group;
      },
    }),
  );
  assert(assertValidPages(output) > meshes(legacy).length, 'water records span pages');
  const want = triangleStreams(legacy),
    got = triangleStreams(output);
  assert.deepEqual([...got.keys()], [...want.keys()], 'water then bank material order');
  for (const [key, stream] of want) assert.deepEqual(got.get(key), stream, key);
  disposeAll(legacy, output);
}
// Records below and above the page thresholds, including one whose fan
// folds back on itself (mixed-sign contributions at shared vertices) and one
// with duplicated source vertices and degenerate triangles: signed indexed
// normals must equal the legacy shared-vertex accumulation exactly.
function foldedRing(n: number): CityPoly {
  const ring: { x: number; z: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = (3000 + 2600 * Math.sin(t * 9)) * M;
    ring.push({ x: 100 + Math.cos(t) * r, z: 50 + Math.sin(t) * r });
  }
  const indices: number[] = [];
  for (let i = 1; i < n - 1; i++) indices.push(0, i, i + 1);
  return { verts: q(ring), indices: new Uint16Array(indices) };
}
function degenerateRing(n: number): CityPoly {
  const base = waterRing(n, 100, 50, 3000);
  const verts = new Uint16Array(base.verts.length + 4);
  verts.set(base.verts);
  verts.set(base.verts.subarray(2, 6), base.verts.length); // duplicates of vertices 1 and 2
  const d1 = n,
    d2 = n + 1;
  const indices = [
    ...base.indices,
    0,
    d1,
    d2, // duplicated corners, same positions as (0, 1, 2)
    d1,
    d1,
    d2, // degenerate: repeated corner
    3,
    4,
    4, // degenerate: zero area
    0,
    d2,
    d1, // reversed winding over duplicated corners
  ];
  return { verts, indices: new Uint16Array(indices) };
}
const waterJob = (id: string, data: CityData, bounds: BoundsXZ | null = null) => {
  let output: THREE.Group | null = null;
  const peak = measureAllocations(() =>
    run(
      createWaterCoverJob({
        ...jobOptions,
        id,
        cityData: data,
        waterIndices: data.water.map((_, i) => i),
        bounds,
        onReady(group) {
          output = group;
        },
      }),
    ),
  );
  return { output, peak };
};
for (const [label, record] of [
  ['below-page', waterRing(16000, 100, 50, 3000)],
  ['above-page', waterRing(20000, 100, 50, 3000)],
  ['folded-above-page', foldedRing(20000)],
  ['degenerate-above-page', degenerateRing(20000)],
  ['degenerate-below-page', degenerateRing(4000)],
] as const) {
  const data = city([], [record]);
  const legacy = buildWater(data);
  const { output, peak } = waterJob(`water-${label}`, data);
  assert(
    peak.typed <= COVER_PAGE_VERTICES * 3,
    `${label} typed allocations bounded (${peak.typed})`,
  );
  assert(peak.push <= 64, `${label} emission keeps no growing JS arrays (${peak.push})`);
  const pages = assertValidPages(output);
  if (label.includes('above')) assert(pages > 2, `${label} surface and banks span pages`);
  const want = triangleStreams(legacy),
    got = triangleStreams(output);
  assert.deepEqual([...got.keys()], [...want.keys()], 'water then bank material order');
  for (const [key, stream] of want) assert.deepEqual(got.get(key), stream, `${label} ${key}`);
  disposeAll(legacy, output);
}
// Clipped water: every emitted vertex that coincides with a source vertex
// keeps the legacy accumulated normal of that vertex; vertices introduced on
// the clip boundary take the face normal of their source triangle.
{
  const record = degenerateRing(20000);
  const data = city([], [record]);
  const legacy = buildWater(data);
  const surface = meshes(legacy)[0]!; // legacy adds the merged surface before the banks
  const sourceNormal = new Map<string, [number, number, number]>();
  {
    const position = surface.geometry.getAttribute('position'),
      normal = surface.geometry.getAttribute('normal');
    for (let i = 0; i < position.count; i++) {
      const key = `${position.getX(i)},${position.getZ(i)}`;
      const value: [number, number, number] = [normal.getX(i), normal.getY(i), normal.getZ(i)];
      const seen = sourceNormal.get(key);
      if (seen && (seen[0] !== value[0] || seen[1] !== value[1] || seen[2] !== value[2]))
        sourceNormal.set(key, [NaN, NaN, NaN]); // duplicated position with distinct normals
      else sourceNormal.set(key, value);
    }
  }
  // A window on the ring itself (angle pi/2, where the lobed radius peaks)
  // holds source vertices as well as fan edges that cross its boundary.
  const edgeZ = 50 + 3210 * M;
  const bounds: BoundsXZ = {
    minX: 100 - 1.2,
    maxX: 100 + 0.9,
    minZ: edgeZ - 2.1,
    maxZ: edgeZ + 1.4,
  };
  const { output } = waterJob('water-clipped', data, bounds);
  assertValidPages(output);
  let matched = 0,
    introduced = 0;
  for (const mesh of meshes(output)) {
    const position = mesh.geometry.getAttribute('position'),
      normal = mesh.geometry.getAttribute('normal');
    const legacyMaterial = surface.material as THREE.MeshLambertMaterial;
    if (
      (mesh.material as THREE.MeshLambertMaterial).color.getHex() !== legacyMaterial.color.getHex()
    )
      continue;
    for (let i = 0; i < position.count; i++) {
      assert(position.getX(i) >= bounds.minX - 1e-4 && position.getX(i) <= bounds.maxX + 1e-4);
      assert(position.getZ(i) >= bounds.minZ - 1e-4 && position.getZ(i) <= bounds.maxZ + 1e-4);
      const expected = sourceNormal.get(`${position.getX(i)},${position.getZ(i)}`);
      const actual = [normal.getX(i), normal.getY(i), normal.getZ(i)];
      if (expected && !Number.isNaN(expected[0])) {
        matched++;
        assert.deepEqual(actual, expected, 'clipped source vertex keeps legacy normal');
      } else {
        introduced++;
        const length = Math.hypot(...actual);
        assert(length < 1e-6 || Math.abs(length - 1) < 1e-6, 'face normal is unit or degenerate');
      }
    }
  }
  assert(matched > 100 && introduced > 10, `clipping exercised (${matched}/${introduced})`);
  disposeAll(legacy, output);
}

/* 5. Park grass and paths across pages: parity, cold vs cached emission, colours. */
{
  const side = 1800 * M;
  const square: CityPoly = {
    verts: q([
      { x: 40, z: 40 },
      { x: 40 + side, z: 40 },
      { x: 40 + side, z: 40 + side },
      { x: 40, z: 40 + side },
    ]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
  const data: CityData = { buildings: [], water: [], roads: [], parks: [square] };
  const legacy = buildParks(data);
  const build = (id: string) => {
    let output: THREE.Group | null = null;
    run(
      createParkCoverJob({
        ...jobOptions,
        id,
        cityData: data,
        parkIndices: [0],
        onReady(group) {
          output = group;
        },
      }),
    );
    return output;
  };
  const cold = build('park-cold'),
    cached = build('park-cached');
  const pages = assertValidPages(cold);
  assert(pages > 2, 'grass spans pages');
  assert.equal(assertValidPages(cached), pages);
  assert(meshes(cold).some((mesh) => mesh.name === 'grass' && mesh.geometry.getAttribute('color')));
  const want = triangleStreams(legacy);
  for (const output of [cold, cached]) {
    const got = triangleStreams(output);
    assert.deepEqual([...got.keys()], [...want.keys()], 'grass then path material order');
    for (const [key, stream] of want) assert.deepEqual(got.get(key), stream, key);
  }
  disposeAll(legacy, cold, cached);
}

/* 6. Source laziness: constructing a job reads nothing; a first step reads a bounded prefix. */
{
  let reads = 0;
  const big = road(30000, 12, 0);
  const lazy = new Proxy(big.pts, {
    get(target, key) {
      if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
      return Reflect.get(target, key);
    },
  });
  const data = city([{ tier: 0, pts: lazy }]);
  const job = createRoadCoverJob({
    ...jobOptions,
    id: 'lazy',
    cityData: data,
    roadIndices: [0],
    onReady() {},
  });
  assert.equal(reads, 0, 'construction reads no source');
  job.step();
  assert(reads <= 256, `first step reads a bounded prefix (${reads})`);
  job.cancel();
  assert.equal(job.step(), true);
}

/* 7. Cancellation and failure mid-page: every page disposed exactly once, none published. */
for (const mode of ['cancel', 'throw'] as const) {
  const disposals = new Map<THREE.BufferGeometry, number>();
  const materialDisposals: number[] = [];
  let published: unknown = 'unset';
  let pagesSeen = 0;
  const job = createCoverJob(
    {
      ...jobOptions,
      id: `pages-${mode}`,
      onReady(group) {
        published = group;
      },
    },
    function* (context) {
      const material = context.own(new THREE.MeshBasicMaterial());
      material.addEventListener('dispose', () => materialDisposals.push(1));
      const writer = createCoverPageWriter(context, material);
      for (let i = 0; i < 40_000; i++) {
        yield* writer.polygon(
          [
            { x: i, z: 0 },
            { x: i + 1, z: 0 },
            { x: i + 1, z: 1 },
            { x: i, z: 1 },
          ],
          0,
          null,
        );
        if (writer.meshes.length > pagesSeen) {
          for (const mesh of writer.meshes.slice(pagesSeen)) {
            disposals.set(mesh.geometry, 0);
            mesh.geometry.addEventListener('dispose', () => {
              disposals.set(mesh.geometry, disposals.get(mesh.geometry)! + 1);
            });
          }
          pagesSeen = writer.meshes.length;
          if (pagesSeen === 3) {
            if (mode === 'cancel') job.cancel();
            else throw 0;
          }
        }
        yield;
      }
      assert.fail('producer must stop after cancellation/failure');
    },
  );
  if (mode === 'cancel') {
    while (!job.step());
  } else {
    let thrown: unknown = 'none';
    try {
      while (!job.step());
    } catch (error) {
      thrown = error;
    }
    assert.equal(thrown, 0, 'falsy failure preserved');
  }
  assert.equal(pagesSeen, 3);
  assert.equal(disposals.size, 3);
  for (const count of disposals.values()) assert.equal(count, 1, 'page disposed exactly once');
  assert.equal(materialDisposals.length, 1);
  assert.equal(published, 'unset', 'nothing published after cancel or failure');
}

/* 7b. Page attachment is never one unsliced loop: with a `parent` option each
 * page is attached as it is finalised; without one, `finish()` attaches at
 * most COVER_ATTACH_CHUNK pages per generator advancement. Cancelling while
 * pages are attached publishes nothing, leaves no scene attachment and
 * disposes every page exactly once. */
for (const pageCount of [100, 1000, 5000]) {
  for (const streamed of [true, false]) {
    let clock = 0;
    let root: THREE.Group | null = null;
    let published: unknown = 'unset';
    let maxAddsPerStep = 0,
      finishSteps = 0,
      childrenBeforeFinish = -1;
    const job = createCoverJob(
      {
        ...jobOptions,
        id: `attach-${pageCount}-${streamed}`,
        now: () => (clock += 4),
        onReady: (g) => (published = g),
      },
      function* (context) {
        root = context.root;
        const material = context.own(new THREE.MeshBasicMaterial());
        const writer = createCoverPageWriter(
          context,
          material,
          streamed ? { parent: context.root } : {},
        );
        for (let i = 0; i < pageCount; i++) {
          writer.vertex(i, 0, 0);
          writer.vertex(i + 1, 0, 0);
          writer.vertex(i, 0, 1);
          writer.triangle(0, 1, 2);
          yield* writer.flush();
        }
        childrenBeforeFinish = context.root.children.length;
        const finish = writer.finish(context.root);
        let before = context.root.children.length;
        for (;;) {
          const next = finish.next();
          maxAddsPerStep = Math.max(maxAddsPerStep, context.root.children.length - before);
          before = context.root.children.length;
          if (next.done) break;
          finishSteps++;
          yield;
        }
      },
    );
    run(job);
    const scene = published as THREE.Group;
    assert.equal(scene, root, 'root published once');
    assert.equal(scene.children.length, pageCount, 'every page attached in order');
    for (let i = 0; i < pageCount; i++)
      assert.equal((scene.children[i] as THREE.Mesh).geometry.getAttribute('position').getX(0), i);
    if (streamed) {
      assert.equal(childrenBeforeFinish, pageCount, 'pages attached as they were finalised');
      assert.equal(maxAddsPerStep, 0, 'finish attaches nothing when pages stream to the parent');
    } else {
      assert.equal(childrenBeforeFinish, 0);
      assert(
        maxAddsPerStep <= COVER_ATTACH_CHUNK,
        `at most ${COVER_ATTACH_CHUNK} additions per advancement (${maxAddsPerStep})`,
      );
      assert(
        finishSteps >= Math.ceil(pageCount / COVER_ATTACH_CHUNK) - 1,
        'finish yields between chunks',
      );
    }
    disposeAll(scene);
  }
}
for (const streamed of [true, false]) {
  const disposals = new Map<THREE.BufferGeometry, number>();
  let published: unknown = 'unset';
  let root: THREE.Group | null = null;
  let cancelAt = -1;
  const pageCount = 200;
  const job = createCoverJob(
    { ...jobOptions, id: `attach-cancel-${streamed}`, onReady: (g) => (published = g) },
    function* (context) {
      root = context.root;
      const material = context.own(new THREE.MeshBasicMaterial());
      const writer = createCoverPageWriter(
        context,
        material,
        streamed ? { parent: context.root } : {},
      );
      for (let i = 0; i < pageCount; i++) {
        writer.vertex(i, 0, 0);
        writer.vertex(i + 1, 0, 0);
        writer.vertex(i, 0, 1);
        writer.triangle(0, 1, 2);
        yield* writer.flush();
        const mesh = writer.meshes[i]!;
        disposals.set(mesh.geometry, 0);
        mesh.geometry.addEventListener('dispose', () =>
          disposals.set(mesh.geometry, disposals.get(mesh.geometry)! + 1),
        );
        if (streamed && i === 120) {
          cancelAt = context.root.children.length;
          job.cancel();
        }
      }
      const finish = writer.finish(context.root);
      while (!finish.next().done) {
        if (!streamed && context.root.children.length >= 3 * COVER_ATTACH_CHUNK && cancelAt < 0) {
          cancelAt = context.root.children.length;
          job.cancel();
        }
        yield;
      }
      assert.fail('producer must stop once cancelled');
    },
  );
  while (!job.step());
  assert(cancelAt > 0 && cancelAt < pageCount, `cancelled mid-attachment (${cancelAt})`);
  assert.equal(published, 'unset', 'no publication after mid-attachment cancel');
  assert.equal(root!.parent, null, 'unpublished root is attached to no scene');
  assert.equal(disposals.size, streamed ? 121 : pageCount);
  for (const count of disposals.values()) assert.equal(count, 1, 'page disposed exactly once');
}

/* 8. Writer invariants and the single-page compatibility helper. */
{
  const owned: { dispose(): void }[] = [];
  const context = {
    root: new THREE.Group(),
    own<T extends { dispose(): void }>(resource: T): T {
      owned.push(resource);
      return resource;
    },
  };
  const material = new THREE.MeshBasicMaterial();
  const writer = createCoverPageWriter(context, material);
  assert.throws(() => writer.triangle(0, 0, 0), RangeError);
  writer.vertex(0, 0, 0);
  writer.vertex(1, 0, 0);
  writer.vertex(0, 0, 1);
  assert.throws(() => writer.triangle(0, 1, 3), RangeError);
  writer.triangle(0, 1, 2);
  assert.throws(() => {
    const gen = writer.reserve(COVER_PAGE_VERTICES + 1, 3);
    while (!gen.next().done);
  }, RangeError);
  // Reserving more than fits flushes the current page first, never straddles.
  const reserve = writer.reserve(COVER_PAGE_VERTICES, 3);
  while (!reserve.next().done);
  assert.equal(writer.meshes.length, 1);
  assert.equal(writer.vertexCount, 0);
  const finish = writer.finish(context.root);
  let result = finish.next();
  while (!result.done) result = finish.next();
  assert.equal(result.value, 1);
  assert.equal(context.root.children.length, 1);
  assert.equal(owned.length, 1, 'each page geometry owned once');
  material.dispose();
  owned[0]!.dispose();

  const tooMany = new Array((COVER_PAGE_VERTICES + 1) * 3).fill(0);
  const gen = coverMesh(context, tooMany, [0, 1, 2], material);
  assert.throws(() => {
    while (!gen.next().done);
  }, RangeError);
}

console.log(
  'Fixed-capacity cover pages: bounded allocations, ordered parity across pages, clipping, water, parks, laziness and cleanup passed',
);
