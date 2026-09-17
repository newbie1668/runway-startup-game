/**
 * RUNWAY — incremental cover spatial index (R5b-4a, architecture C3/C4).
 *
 * Pure CPU selection seam for camera-driven road/park/water generation. Roads,
 * parks and water records are bucketed into a world-origin 400 m grid by every
 * cell their dequantized AABB intersects, so long roads and enclosing polygons
 * are selected even when none of their vertices lie inside the view. The index
 * stores original numeric record indices only; it never wraps or subsets
 * `CityData`, and no source typed array is copied or mutated.
 *
 * Construction is a resumable `BuildJob`: each step performs at most
 * `MAX_UNITS_PER_STEP` atomic units (one record setup/transition, one
 * vertex-pair AABB update, one bucket insertion, or the single publication),
 * checking the clock between units. No geometry, Three or browser dependency.
 */

import { METERS_TO_WORLD } from '../geo';
import { dequantizeX, dequantizeY, type CityData } from './format';
import type { BuildJob } from './buildScheduler';
import type { BoundsXZ, CellId } from './cityIndex';

export type CoverLayer = 'roads' | 'parks' | 'water';

export interface CoverSelection {
  readonly roads: readonly number[];
  readonly parks: readonly number[];
  readonly water: readonly number[];
}

export interface CoverIndex {
  readonly cellSizeM: number;
  /** World-origin aligned grid cells; every bucket list is ascending and unique per layer. */
  readonly cells: ReadonlyMap<CellId, CoverSelection>;
  /** Dequantized AABB per original record, indexed by original layer index. */
  readonly featureBounds: {
    readonly roads: readonly BoundsXZ[];
    readonly parks: readonly BoundsXZ[];
    readonly water: readonly BoundsXZ[];
  };
  /** Union of every feature AABB, or null when the city has no cover records. */
  readonly bounds: BoundsXZ | null;
}

export interface CoverIndexJobArgs {
  id: string;
  generation: number;
  essential: boolean;
  cityData: CityData;
  now: () => number;
  sliceMs?: number;
  onReady(index: CoverIndex): void;
}

const CELL_SIZE_M = 400;
const CELL_WORLD = CELL_SIZE_M * METERS_TO_WORLD;
const MAX_UNITS_PER_STEP = 64;
const DEFAULT_SLICE_MS = 4;
const LAYERS: readonly CoverLayer[] = ['roads', 'parks', 'water'];
/** Minimum vertex pairs: a road is a polyline (2), a polygon needs a triangle (3). */
const MIN_PAIRS: Readonly<Record<CoverLayer, number>> = { roads: 2, parks: 3, water: 3 };

type MutableSelection = { roads: number[]; parks: number[]; water: number[] };
type MutableFeatureBounds = { roads: BoundsXZ[]; parks: BoundsXZ[]; water: BoundsXZ[] };

interface LayerCursor {
  readonly layer: CoverLayer;
  /** Original index of the record currently being processed. */
  record: number;
  phase: 'record' | 'vertex' | 'bucket';
  /** Points of the current record, read once at record setup. */
  points: Uint16Array | null;
  pairs: number;
  vertex: number;
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
  ix: number;
  iz: number;
  startIx: number;
  endIx: number;
  endIz: number;
}

interface PrivateState {
  cityData: CityData;
  cells: Map<CellId, MutableSelection>;
  featureBounds: MutableFeatureBounds;
  cursors: LayerCursor[];
  layerAt: number;
  overall: BoundsXZ | null;
}

function cellId(ix: number, iz: number): CellId {
  return `${ix},${iz}` as CellId;
}

function cellCoord(world: number): number {
  return Math.floor(world / CELL_WORLD);
}

function newCursor(layer: CoverLayer): LayerCursor {
  return {
    layer,
    record: 0,
    phase: 'record',
    points: null,
    pairs: 0,
    vertex: 0,
    minX: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxZ: -Infinity,
    ix: 0,
    iz: 0,
    startIx: 0,
    endIx: 0,
    endIz: 0,
  };
}

function recordsOf(cityData: CityData, layer: CoverLayer): readonly unknown[] {
  return cityData[layer];
}

function pointsOf(cityData: CityData, layer: CoverLayer, index: number): Uint16Array | undefined {
  if (layer === 'roads') return cityData.roads[index]?.pts;
  return cityData[layer][index]?.verts;
}

function malformed(layer: CoverLayer, index: number): RangeError {
  return new RangeError(`${layer} ${index} has a malformed geometry record`);
}

/**
 * One atomic unit of index construction. Returns true once the whole index is
 * built and ready for publication.
 */
function advance(state: PrivateState): boolean {
  if (state.layerAt >= LAYERS.length) return true;
  const cursor = state.cursors[state.layerAt]!;
  const layer = cursor.layer;

  if (cursor.phase === 'record') {
    const records = recordsOf(state.cityData, layer);
    if (cursor.record >= records.length) {
      state.layerAt += 1;
      return state.layerAt >= LAYERS.length;
    }
    const points = pointsOf(state.cityData, layer, cursor.record);
    const length = points?.length;
    if (
      !points ||
      typeof length !== 'number' ||
      !Number.isInteger(length) ||
      length % 2 !== 0 ||
      length < MIN_PAIRS[layer] * 2
    ) {
      throw malformed(layer, cursor.record);
    }
    cursor.points = points;
    cursor.pairs = length / 2;
    cursor.vertex = 0;
    cursor.minX = Infinity;
    cursor.minZ = Infinity;
    cursor.maxX = -Infinity;
    cursor.maxZ = -Infinity;
    cursor.phase = 'vertex';
    return false;
  }

  if (cursor.phase === 'vertex') {
    const points = cursor.points!;
    const x = dequantizeX(points[cursor.vertex * 2]!);
    const z = dequantizeY(points[cursor.vertex * 2 + 1]!);
    if (!Number.isFinite(x) || !Number.isFinite(z)) throw malformed(layer, cursor.record);
    if (x < cursor.minX) cursor.minX = x;
    if (z < cursor.minZ) cursor.minZ = z;
    if (x > cursor.maxX) cursor.maxX = x;
    if (z > cursor.maxZ) cursor.maxZ = z;
    cursor.vertex += 1;
    if (cursor.vertex >= cursor.pairs) {
      const bounds: BoundsXZ = {
        minX: cursor.minX,
        minZ: cursor.minZ,
        maxX: cursor.maxX,
        maxZ: cursor.maxZ,
      };
      state.featureBounds[layer][cursor.record] = bounds;
      const overall = state.overall;
      if (overall) {
        if (bounds.minX < overall.minX) overall.minX = bounds.minX;
        if (bounds.minZ < overall.minZ) overall.minZ = bounds.minZ;
        if (bounds.maxX > overall.maxX) overall.maxX = bounds.maxX;
        if (bounds.maxZ > overall.maxZ) overall.maxZ = bounds.maxZ;
      } else {
        state.overall = { ...bounds };
      }
      cursor.points = null;
      cursor.startIx = cellCoord(bounds.minX);
      cursor.ix = cursor.startIx;
      cursor.iz = cellCoord(bounds.minZ);
      cursor.endIx = cellCoord(bounds.maxX);
      cursor.endIz = cellCoord(bounds.maxZ);
      cursor.phase = 'bucket';
    }
    return false;
  }

  const id = cellId(cursor.ix, cursor.iz);
  let bucket = state.cells.get(id);
  if (!bucket) {
    bucket = { roads: [], parks: [], water: [] };
    state.cells.set(id, bucket);
  }
  bucket[layer].push(cursor.record);
  if (cursor.ix < cursor.endIx) {
    cursor.ix += 1;
  } else if (cursor.iz < cursor.endIz) {
    cursor.ix = cursor.startIx;
    cursor.iz += 1;
  } else {
    cursor.record += 1;
    cursor.phase = 'record';
  }
  return false;
}

/**
 * Bounded, resumable construction of a `CoverIndex` as a scheduler `BuildJob`.
 *
 * The constructor stores cursors only: it reads no record, point or array
 * length. Publication happens exactly once via `onReady`; the job is marked
 * terminal and all private references (including `cityData`, `now` and
 * `onReady`) are detached before the callback runs, so a reentrant `step` or
 * `cancel` inside the callback is inert and can never mutate the published
 * index. Thrown clock/input/callback values are rethrown exactly as thrown
 * (including falsy values), after which the job is terminal and never retried.
 */
export function createCoverIndexJob(args: CoverIndexJobArgs): BuildJob {
  const sliceMs = args.sliceMs ?? DEFAULT_SLICE_MS;
  if (typeof sliceMs !== 'number' || !Number.isFinite(sliceMs) || sliceMs <= 0) {
    throw new RangeError('sliceMs must be a finite positive number');
  }
  let now: (() => number) | null = args.now;
  let onReady: ((index: CoverIndex) => void) | null = args.onReady;
  let state: PrivateState | null = {
    cityData: args.cityData,
    cells: new Map(),
    featureBounds: { roads: [], parks: [], water: [] },
    cursors: LAYERS.map(newCursor),
    layerAt: 0,
    overall: null,
  };
  let terminal = false;

  const detach = (): void => {
    terminal = true;
    state = null;
    now = null;
    onReady = null;
  };

  return {
    id: args.id,
    generation: args.generation,
    essential: args.essential,
    step(): boolean {
      if (terminal) return true;
      try {
        const clock = now!;
        const start = clock();
        let units = 0;
        while (units < MAX_UNITS_PER_STEP) {
          if (units > 0 && clock() - start >= sliceMs) return false;
          units += 1;
          const live = state!;
          if (live.layerAt >= LAYERS.length) {
            const index: CoverIndex = {
              cellSizeM: CELL_SIZE_M,
              cells: live.cells,
              featureBounds: live.featureBounds,
              bounds: live.overall,
            };
            const publish = onReady!;
            detach();
            publish(index);
            return true;
          }
          advance(live);
        }
        return false;
      } catch (error) {
        detach();
        throw error;
      }
    },
    cancel(): void {
      detach();
    },
  };
}

function assertBounds(bounds: BoundsXZ): void {
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minZ) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxZ) ||
    bounds.minX > bounds.maxX ||
    bounds.minZ > bounds.maxZ
  ) {
    throw new RangeError('bounds must be finite and ordered (min <= max)');
  }
}

function emptySelection(): CoverSelection {
  return { roads: [], parks: [], water: [] };
}

function ascending(a: number, b: number): number {
  return a - b;
}

/**
 * Original record indices whose dequantized AABB intersects `bounds` expanded
 * by `padM` metres (inclusive). Bucket enumeration is clamped to the index's
 * overall bounds, so far-outside or enormous queries never loop over empty
 * coordinate space. Results are fresh ascending arrays, never bucket aliases.
 * Conservative false positives at AABB corners are permitted; `CityData` is
 * never read.
 */
export function coverForBounds(index: CoverIndex, bounds: BoundsXZ, padM = 0): CoverSelection {
  assertBounds(bounds);
  if (typeof padM !== 'number' || !Number.isFinite(padM) || padM < 0) {
    throw new RangeError('padM must be a finite nonnegative number of metres');
  }
  const pad = padM * METERS_TO_WORLD;
  const qMinX = bounds.minX - pad;
  const qMinZ = bounds.minZ - pad;
  const qMaxX = bounds.maxX + pad;
  const qMaxZ = bounds.maxZ + pad;
  if (
    !Number.isFinite(qMinX) ||
    !Number.isFinite(qMinZ) ||
    !Number.isFinite(qMaxX) ||
    !Number.isFinite(qMaxZ)
  ) {
    throw new RangeError('padded query bounds overflow');
  }
  const extent = index.bounds;
  if (
    !extent ||
    index.cells.size === 0 ||
    qMaxX < extent.minX ||
    qMinX > extent.maxX ||
    qMaxZ < extent.minZ ||
    qMinZ > extent.maxZ
  ) {
    return emptySelection();
  }
  const cellWorld = index.cellSizeM * METERS_TO_WORLD;
  const minIx = Math.floor(Math.max(qMinX, extent.minX) / cellWorld);
  const maxIx = Math.floor(Math.min(qMaxX, extent.maxX) / cellWorld);
  const minIz = Math.floor(Math.max(qMinZ, extent.minZ) / cellWorld);
  const maxIz = Math.floor(Math.min(qMaxZ, extent.maxZ) / cellWorld);

  const seen: Record<CoverLayer, Set<number>> = {
    roads: new Set(),
    parks: new Set(),
    water: new Set(),
  };
  const gather = (bucket: CoverSelection): void => {
    for (const layer of LAYERS) {
      const featureBounds = index.featureBounds[layer];
      for (const n of bucket[layer]) {
        const b = featureBounds[n]!;
        if (b.maxX >= qMinX && b.minX <= qMaxX && b.maxZ >= qMinZ && b.minZ <= qMaxZ) {
          seen[layer].add(n);
        }
      }
    }
  };

  const rectCells = (maxIx - minIx + 1) * (maxIz - minIz + 1);
  if (rectCells <= index.cells.size) {
    for (let iz = minIz; iz <= maxIz; iz++) {
      for (let ix = minIx; ix <= maxIx; ix++) {
        const bucket = index.cells.get(cellId(ix, iz));
        if (bucket) gather(bucket);
      }
    }
  } else {
    for (const [id, bucket] of index.cells) {
      const comma = id.indexOf(',');
      const ix = Number(id.slice(0, comma));
      const iz = Number(id.slice(comma + 1));
      if (ix >= minIx && ix <= maxIx && iz >= minIz && iz <= maxIz) gather(bucket);
    }
  }

  return {
    roads: [...seen.roads].sort(ascending),
    parks: [...seen.parks].sort(ascending),
    water: [...seen.water].sort(ascending),
  };
}
