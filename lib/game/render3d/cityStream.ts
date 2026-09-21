import * as THREE from 'three';
import { METERS_TO_WORLD } from '../geo';
import type { MapDiagnosticsReporter } from '../mapDiagnostics';
import { createBuildScheduler, type BuildJob } from './buildScheduler';
import {
  createCellStockJob,
  createStockTileJob,
  type CellStockReady,
  type StockJob,
  type StockTileReady,
} from './cellStockJob';
import {
  createTreeCoverJob,
  roadCoverContextSteps,
  type BuildingPick,
  type CityScratch,
  type RoadCoverContext,
} from './cityBuilder';
import type { BoundsXZ, CellId, CityIndex } from './cityIndex';
import { createCoverCellJob, type CoverCellReady } from './coverCellJob';
import { coverForBounds, type CoverIndex } from './coverIndex';
import type { StockDetail } from './detailPolicy';
import type { createGeometryTracker } from './diagnostics';
import type { CityData } from './format';
import type { ResourcePool } from './sceneResources';
import { retainSceneResources } from './sceneResourceTree';
import { planStreamCoverage, type StreamCoveragePlan } from './streamCoverage';
import { createStreamResidentStore, type StreamResident } from './streamResidentStore';
import { createStockDecorJob } from './stockDecorJob';
import { createCoverJob } from './coverGeometry';
import { MAX_INDEX_BYTES, StockDrawRanges } from './stockDrawRanges';
import { indexStockTiles, type StockTile, type StockTileId, type StockTileIndex } from './stockTiles';

interface StockResident extends StreamResident {
  readonly detail: StockDetail;
  readonly scratch: CityScratch;
  readonly meshes: readonly THREE.Mesh[];
  /** Stock geometry bytes the resident holds (decoration excluded). */
  readonly bytes: number;
  hasDecor(): boolean;
  attachDecor(ready: CoverCellReady): void;
  /** Own and track the geometry without rendering it while a tile still covers the cell. */
  stage(): void;
  /** Enrol the meshes in draw-range partitioning, or restore their full ranges and leave it. */
  partition(enabled: boolean): void;
}

interface TileResident extends StreamResident<StockTileId> {
  readonly cellIds: readonly CellId[];
  readonly scratch: CityScratch;
  readonly meshes: readonly THREE.Mesh[];
  readonly bytes: number;
  partition(enabled: boolean): void;
}

interface CoverResident extends StreamResident {
  readonly detail: StockDetail;
}

interface CellRequest {
  readonly kind: 'stock' | 'cover' | 'trees' | 'decor';
  readonly id: CellId;
  readonly detail: StockDetail;
  readonly essential: boolean;
}

interface TileRequest {
  readonly kind: 'tile';
  readonly id: StockTileId;
  readonly tile: StockTile;
  readonly detail: 'overview';
  readonly essential: boolean;
}

type Request = CellRequest | TileRequest;

/** Resident geometry ceiling and the level above which background work waits. */
export interface ResidentBudget {
  readonly maxBytes: number;
  readonly backgroundBytes: number;
}

export interface CityStreamOptions {
  readonly data: CityData;
  readonly cityIndex: CityIndex;
  readonly coverIndex: CoverIndex;
  readonly exclusions: ReadonlySet<number>;
  readonly material: THREE.Material;
  readonly root: THREE.Group;
  readonly resources: ResourcePool;
  readonly tracker: ReturnType<typeof createGeometryTracker>;
  readonly diagnostics: MapDiagnosticsReporter;
  /** Defaults to the 128 MiB / 96 MiB product budget; may only be lowered, never raised. */
  readonly residentBudget?: ResidentBudget;
  now(): number;
  onRoadContextReady?(context: RoadCoverContext): void;
  onStockDrawn(): void;
  onStockEvicted(picks: readonly BuildingPick[]): void;
  onFatal(reason: string): void;
}

const MAX_PENDING = 4;
const MAX_REQUESTS_PER_DRAIN = 64;
const MAX_RESIDENT_BYTES = 128 * 1024 * 1024;
const BACKGROUND_RESIDENT_BYTES = 96 * 1024 * 1024;
export const DEFAULT_RESIDENT_BUDGET: ResidentBudget = {
  maxBytes: MAX_RESIDENT_BYTES,
  backgroundBytes: BACKGROUND_RESIDENT_BYTES,
};

function validateBudget(budget: ResidentBudget): ResidentBudget {
  const { maxBytes, backgroundBytes } = budget;
  if (
    !Number.isSafeInteger(maxBytes) || !Number.isSafeInteger(backgroundBytes) ||
    maxBytes > MAX_RESIDENT_BYTES || maxBytes <= MAX_INDEX_BYTES ||
    backgroundBytes <= 0 || backgroundBytes > maxBytes
  )
    throw new RangeError(
      `resident budget must satisfy ${MAX_INDEX_BYTES} < maxBytes <= ${MAX_RESIDENT_BYTES} and 0 < backgroundBytes <= maxBytes`,
    );
  return budget;
}

type Candidate = { id: string; distance: number; evict: () => void };

const farthestFirst = (a: Candidate, b: Candidate): number =>
  b.distance - a.distance || compareIds(b.id, a.id);

function clearScratch(scratch: CityScratch): void {
  scratch.picks.length = 0;
  scratch.windows.length = scratch.windowColors.length = 0;
  scratch.rooftops.length = scratch.rooftopColors.length = 0;
  scratch.signs.length = 0;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function centreDistance(a: BoundsXZ, b: BoundsXZ): number {
  return Math.hypot(
    (a.minX + a.maxX) / 2 - (b.minX + b.maxX) / 2,
    (a.minZ + a.maxZ) / 2 - (b.minZ + b.maxZ) / 2,
  );
}

export class CityStream {
  private scheduler = createBuildScheduler();
  private readonly contextScheduler = createBuildScheduler();
  private roadContext: RoadCoverContext | null = null;
  private readonly tileIndex: StockTileIndex;
  private readonly stocks = createStreamResidentStore<StockResident>();
  private readonly tiles = createStreamResidentStore<TileResident, StockTileId>();
  private readonly hidden = new Map<CellId, StockResident>();
  private readonly covers = createStreamResidentStore<CoverResident>();
  private readonly trees = createStreamResidentStore<CoverResident>();
  private readonly pending = new Map<string, Request>();
  private readonly staging = new Map<string, StockJob>();
  private requests: Request[] = [];
  private cursor = 0;
  private essentialEnd = 0;
  private generation = 0;
  private plan: StreamCoveragePlan | null = null;
  private visible = new Set<CellId>();
  private detailed = new Set<CellId>();
  private wanted = new Set<CellId>();
  private retain = new Set<CellId>();
  private readonly budget: ResidentBudget;
  private signature = '';
  private coverageJob: string | null = null;
  private closed = false;
  private buildings = 0;
  private failure: { id: string; error: unknown } | null = null;
  private readonly drawRanges: StockDrawRanges;

  constructor(private readonly options: CityStreamOptions) {
    this.budget = validateBudget(options.residentBudget ?? DEFAULT_RESIDENT_BUDGET);
    this.tileIndex = indexStockTiles(options.cityIndex);
    this.drawRanges = new StockDrawRanges(
      options.now,
      (error) => options.diagnostics.recordError('stock:draw-range', false, error),
    );
    const result: { value: RoadCoverContext | null } = { value: null };
    const contextId = 'stream:road-context';
    let started = false;
    const job = createCoverJob(
      {
        id: contextId,
        generation: 0,
        essential: true,
        now: options.now,
        onReady: () => {
          this.roadContext = result.value;
          if (result.value) options.onRoadContextReady?.(result.value);
        },
      },
      function* () {
        result.value = yield* roadCoverContextSteps(options.data);
      },
    );
    options.diagnostics.registerJob(contextId, true);
    this.contextScheduler.enqueue({
      ...job,
      step: () => {
        if (!started) {
          started = true;
          options.diagnostics.startJob(contextId);
        }
        return job.step();
      },
    });
  }

  get stockBuildings(): number {
    return this.buildings;
  }

  get idle(): boolean {
    return (
      this.roadContext !== null && this.pending.size === 0 &&
      this.cursor >= this.requests.length && this.drawRanges.idle
    );
  }

  get residentCells(): number {
    let tileCells = 0;
    for (const id of this.tiles.ids()) tileCells += this.tiles.get(id)!.cellIds.length;
    return (
      this.stocks.ids().length + this.hidden.size + tileCells +
      this.covers.ids().length + this.trees.ids().length
    );
  }

  /** Source cells currently covered by a whole-tile page group. */
  get tileCoveredCells(): number {
    let tileCells = 0;
    for (const id of this.tiles.ids()) tileCells += this.tiles.get(id)!.cellIds.length;
    return tileCells;
  }

  /** Replacement cells owned and tracked but not yet exposed because a tile still covers them. */
  get hiddenCells(): number {
    return this.hidden.size;
  }

  /**
   * Geometry bytes live outside the tracker: stock-job fragments, open targets and sealed
   * unpublished pages, plus the draw-range controller's single scratch index.
   * Excludes cover, tree and decoration staging.
   */
  get stagingBytes(): number {
    let bytes = this.drawRanges.stagingBytes;
    for (const job of this.staging.values()) bytes += job.stagingBytes();
    return bytes;
  }

  /** Stock/tile geometry bytes resident outside the current retain ring: kept only until needed. */
  get staleStockBytes(): number {
    let bytes = 0;
    for (const id of this.stocks.ids())
      if (!this.retain.has(id)) bytes += this.stocks.get(id)!.bytes;
    for (const tileId of this.tiles.ids())
      if (!this.tileRetained(tileId)) bytes += this.tiles.get(tileId)!.bytes;
    return bytes;
  }

  /** Tracked residents plus every stock job's staging; the draw-range scratch is reserved at its cap. */
  private heldBytes(): number {
    let bytes = this.options.tracker.bytes();
    for (const job of this.staging.values()) bytes += job.stagingBytes();
    return bytes;
  }

  buildingMeshes(): THREE.Mesh[] {
    return [
      ...this.stocks.ids().flatMap((id) => [...this.stocks.get(id)!.meshes]),
      ...this.tiles.ids().flatMap((id) => [...this.tiles.get(id)!.meshes]),
    ];
  }

  prepareDrawRanges(camera: THREE.Camera, shadows: boolean): void {
    this.drawRanges.prepare(camera, shadows);
  }

  *picks(): Generator<BuildingPick> {
    for (const id of this.stocks.ids()) yield* this.stocks.get(id)!.scratch.picks;
    for (const id of this.tiles.ids()) yield* this.tiles.get(id)!.scratch.picks;
  }

  private coverCellBounds(id: CellId): BoundsXZ {
    const [ix, iz] = id.split(',').map(Number);
    const size = this.options.coverIndex.cellSizeM * METERS_TO_WORLD;
    return { minX: ix! * size, minZ: iz! * size, maxX: (ix! + 1) * size, maxZ: (iz! + 1) * size };
  }

  private ordered(
    ids: readonly CellId[],
    bounds: BoundsXZ,
    grid: 'city' | 'cover',
  ): CellId[] {
    const distances = new Map<CellId, number>();
    for (const id of ids) {
      const cell =
        grid === 'city'
          ? this.options.cityIndex.cells.get(id)!.bounds
          : this.coverCellBounds(id);
      distances.set(id, centreDistance(cell, bounds));
    }
    return [...ids].sort((a, b) => distances.get(a)! - distances.get(b)! || compareIds(a, b));
  }

  private tileOf(id: CellId): StockTileId {
    const tileId = this.tileIndex.tileOf.get(id);
    if (tileId === undefined) throw new Error(`unknown source cell: ${id}`);
    return tileId;
  }

  private tile(tileId: StockTileId): StockTile {
    return this.tileIndex.tiles.get(tileId)!;
  }

  private tileRetained(tileId: StockTileId): boolean {
    return this.tile(tileId).cells.some((cell) => this.retain.has(cell.id));
  }

  /** Representation the current plan wants for a source cell, or null when it is not wanted. */
  private wantedDetail(id: CellId): StockDetail | null {
    if (!this.plan || !this.wanted.has(id)) return null;
    return this.detailed.has(id) ? this.plan.detail : 'overview';
  }

  /** A resident tile whose members now need per-cell detail keeps rendering until every visible member is staged. */
  private dissolving(tileId: StockTileId): boolean {
    return (
      this.tiles.get(tileId) !== undefined &&
      this.tile(tileId).cells.some((cell) => this.detailed.has(cell.id))
    );
  }

  private tileCovers(id: CellId): boolean {
    const tileId = this.tileOf(id);
    return this.tiles.get(tileId) !== undefined && !this.dissolving(tileId);
  }

  /** Detail of the representation currently exposing a source cell in the scene. */
  private coverage(id: CellId): StockDetail | undefined {
    return this.stocks.get(id)?.detail ?? (this.tileCovers(id) ? 'overview' : undefined);
  }

  /** Whole-tile requests only when every member is wanted and none needs detailed stock. */
  private tileEligible(tileId: StockTileId): boolean {
    return this.tile(tileId).cells.every(
      (cell) => this.wanted.has(cell.id) && !this.detailed.has(cell.id),
    );
  }

  update(bounds: BoundsXZ): void {
    if (this.closed) return;
    const plan = planStreamCoverage(this.options.cityIndex, this.options.coverIndex, bounds);
    const signature = [
      plan.detail,
      plan.visibleStock.join(';'),
      plan.detailedStock.join(';'),
      plan.prefetchStock.join(';'),
      plan.visibleCover.join(';'),
      plan.prefetchCover.join(';'),
    ].join('|');
    this.plan = plan;
    this.visible = new Set(plan.visibleStock);
    this.detailed = new Set(plan.detail === 'overview' ? [] : plan.detailedStock);
    this.wanted = new Set([...plan.visibleStock, ...plan.prefetchStock]);
    this.retain = new Set(plan.retainStock);
    // Residents outside the retain ring stay resident and visible until their bytes are needed
    // (admit) or the new coverage settles (trimResidents); they only leave draw-range partitioning.
    for (const id of this.stocks.ids()) this.stocks.get(id)!.partition(this.retain.has(id));
    for (const tileId of this.tiles.ids())
      this.tiles.get(tileId)!.partition(this.tileRetained(tileId));
    if (signature === this.signature) return;
    this.signature = signature;
    this.cancelPending();
    this.generation = this.stocks.beginGeneration();
    this.tiles.beginGeneration();
    this.covers.beginGeneration();
    this.trees.beginGeneration();
    this.reconcile();
    this.coverageJob = `stream:coverage:${this.generation}`;
    this.options.diagnostics.registerJob(this.coverageJob, true);
    this.options.diagnostics.startJob(this.coverageJob);
    const requests: Request[] = [];
    const append = (
      kind: CellRequest['kind'],
      ids: readonly CellId[],
      detail: StockDetail,
      essential: boolean,
      grid: 'city' | 'cover',
    ): void => {
      for (const id of this.ordered(ids, bounds, grid))
        requests.push({ kind, id, detail, essential });
    };
    const cellRequests = new Map<CellId, CellRequest>();
    const tileRequests = new Map<StockTileId, TileRequest>();
    const classify = (id: CellId, essential: boolean): void => {
      const detail = this.wantedDetail(id)!;
      const current = this.stocks.get(id);
      if (detail !== 'overview') {
        if (current?.detail !== detail)
          cellRequests.set(id, { kind: 'stock', id, detail, essential });
        return;
      }
      if (this.tileCovers(id)) return;
      const covered = current !== undefined && (current.detail === 'overview' || !essential);
      const tileId = this.tileOf(id);
      if (this.tiles.get(tileId) === undefined && this.tileEligible(tileId)) {
        const uncovered = essential && !covered;
        const existing = tileRequests.get(tileId);
        if (!existing || (uncovered && !existing.essential))
          tileRequests.set(tileId, {
            kind: 'tile',
            id: tileId,
            tile: this.tile(tileId),
            detail: 'overview',
            essential: uncovered,
          });
        return;
      }
      if (!covered) cellRequests.set(id, { kind: 'stock', id, detail: 'overview', essential });
    };
    for (const id of plan.visibleStock) classify(id, true);
    for (const id of plan.prefetchStock) classify(id, false);
    const pushedTiles = new Set<StockTileId>();
    const orderedVisible = this.ordered(plan.visibleStock, bounds, 'city');
    // Tiles whose cutover releases resident member cells come first: each one is a net release
    // of resident bytes, so they open room for the tiles that only add.
    for (const id of orderedVisible) {
      const tile = tileRequests.get(this.tileOf(id));
      if (!tile?.essential || pushedTiles.has(tile.id)) continue;
      if (!tile.tile.cells.some((cell) => this.stocks.get(cell.id) !== undefined)) continue;
      pushedTiles.add(tile.id);
      requests.push(tile);
    }
    for (const id of orderedVisible) {
      const cell = cellRequests.get(id);
      if (cell) {
        requests.push(cell);
        continue;
      }
      const tile = tileRequests.get(this.tileOf(id));
      if (tile?.essential && !pushedTiles.has(tile.id)) {
        pushedTiles.add(tile.id);
        requests.push(tile);
      }
    }
    append('cover', plan.visibleCover, plan.detail, true, 'cover');
    this.essentialEnd = requests.length;
    for (const id of this.ordered(plan.prefetchStock, bounds, 'city')) {
      const cell = cellRequests.get(id);
      if (cell) requests.push(cell);
    }
    const backgroundTiles = [...tileRequests.values()].filter((tile) => !pushedTiles.has(tile.id));
    backgroundTiles.sort(
      (a, b) =>
        centreDistance(a.tile.bounds, bounds) - centreDistance(b.tile.bounds, bounds) ||
        compareIds(a.id, b.id),
    );
    for (const tile of backgroundTiles) requests.push({ ...tile, essential: false });
    append('cover', plan.prefetchCover, 'overview', false, 'cover');
    if (plan.detail !== 'overview')
      append('trees', plan.visibleCover, plan.detail, false, 'cover');
    if (plan.detail !== 'overview')
      append('decor', plan.detailedStock, plan.detail, false, 'city');
    this.requests = requests;
    this.cursor = 0;
  }

  private resident(request: Request): boolean {
    if (request.kind === 'tile') return this.tiles.get(request.id) !== undefined;
    if (request.kind === 'decor') {
      const stock = this.stocks.get(request.id);
      return stock !== undefined && stock.detail === request.detail && stock.hasDecor();
    }
    if (request.kind === 'stock') {
      const current = this.stocks.get(request.id);
      if (current !== undefined && (current.detail === request.detail || !request.essential))
        return true;
      if (this.hidden.get(request.id)?.detail === request.detail) return true;
      return request.detail === 'overview' && this.tileCovers(request.id);
    }
    const store = request.kind === 'cover' ? this.covers : this.trees;
    const current = store.get(request.id);
    return current !== undefined && (current.detail === request.detail || !request.essential);
  }

  private cancelPending(): void {
    try {
      this.drawRanges.beginGeneration();
      this.scheduler.cancelGeneration(this.generation);
    } finally {
      this.scheduler = createBuildScheduler();
      for (const id of this.pending.keys()) this.options.diagnostics.cancelJob(id);
      this.pending.clear();
      this.staging.clear();
      if (this.coverageJob) this.options.diagnostics.cancelJob(this.coverageJob);
      this.coverageJob = null;
      this.requests = [];
      this.cursor = 0;
      this.essentialEnd = 0;
    }
  }

  private createStockResident(id: CellId, detail: StockDetail, ready: CellStockReady): StockResident {
    const { root, resources, tracker, onStockDrawn, onStockEvicted } = this.options;
    const meshes: THREE.Mesh[] = [];
    ready.group?.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.onAfterRender = onStockDrawn;
        meshes.push(object);
      }
    });
    const release = ready.group ? retainSceneResources(resources, ready.group) : () => undefined;
    let attached = false;
    let disposed = false;
    let partitioned = false;
    let decoration: CoverCellReady | null = null;
    const partition = (enabled: boolean): void => {
      if (disposed || detail !== 'overview' || enabled === partitioned) return;
      partitioned = enabled;
      for (const mesh of meshes) {
        if (enabled) this.drawRanges.add(mesh);
        else this.drawRanges.remove(mesh);
      }
    };
    return {
      id,
      detail,
      scratch: ready.scratch,
      meshes,
      bytes: ready.geometryBytes,
      partition,
      hasDecor: () => decoration !== null,
      attachDecor: (next) => {
        if (disposed || decoration) {
          next.dispose();
          return;
        }
        (ready.group ?? root).add(next.group);
        tracker.trackTree(next.group);
        decoration = next;
      },
      stage: () => {
        if (ready.group) tracker.trackTree(ready.group);
      },
      attach: () => {
        if (ready.group) {
          root.add(ready.group);
          tracker.trackTree(ready.group);
        }
        partition(true);
        attached = true;
        this.buildings += ready.sourceBuildingIndices.length;
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        try {
          for (const mesh of meshes) this.drawRanges.remove(mesh);
          if (attached) this.buildings -= ready.sourceBuildingIndices.length;
          ready.group?.removeFromParent();
          onStockEvicted(ready.scratch.picks);
        } finally {
          clearScratch(ready.scratch);
          meshes.length = 0;
          try {
            decoration?.dispose();
          } finally {
            decoration = null;
            release();
          }
        }
      },
    };
  }

  private publishStock(request: CellRequest, generation: number, ready: CellStockReady): void {
    const resident = this.createStockResident(request.id, request.detail, ready);
    try {
      const tileId = this.tileOf(request.id);
      if (!this.closed && generation === this.generation && this.tiles.get(tileId) !== undefined) {
        // The tile keeps rendering; the replacement is owned but hidden until the cutover.
        if (!this.dissolving(tileId) || this.wantedDetail(request.id) !== request.detail) {
          resident.dispose();
          return;
        }
        try {
          resident.stage();
        } catch (error) {
          resident.dispose();
          throw error;
        }
        const previous = this.hidden.get(request.id);
        this.hidden.set(request.id, resident);
        previous?.dispose();
        this.reconcile();
        return;
      }
      this.stocks.publish(generation, resident);
    } catch (error) {
      this.fatal(`stock:${request.id}`, error);
    }
  }

  private publishTile(request: TileRequest, generation: number, ready: StockTileReady): void {
    const { root, resources, tracker, onStockDrawn, onStockEvicted } = this.options;
    const meshes: THREE.Mesh[] = [];
    ready.group?.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.onAfterRender = onStockDrawn;
        meshes.push(object);
      }
    });
    const release = ready.group ? retainSceneResources(resources, ready.group) : () => undefined;
    let attached = false;
    let disposed = false;
    let partitioned = false;
    const partition = (enabled: boolean): void => {
      if (disposed || enabled === partitioned) return;
      partitioned = enabled;
      for (const mesh of meshes) {
        if (enabled) this.drawRanges.add(mesh);
        else this.drawRanges.remove(mesh);
      }
    };
    const resident: TileResident = {
      id: request.id,
      cellIds: ready.cellIds,
      scratch: ready.scratch,
      meshes,
      bytes: ready.geometryBytes,
      partition,
      attach: () => {
        if (ready.group) {
          root.add(ready.group);
          tracker.trackTree(ready.group);
        }
        partition(true);
        attached = true;
        this.buildings += ready.sourceBuildingIndices.length;
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        try {
          for (const mesh of meshes) this.drawRanges.remove(mesh);
          if (attached) this.buildings -= ready.sourceBuildingIndices.length;
          ready.group?.removeFromParent();
          onStockEvicted(ready.scratch.picks);
        } finally {
          clearScratch(ready.scratch);
          meshes.length = 0;
          release();
        }
      },
    };
    try {
      if (!this.tiles.publish(generation, resident)) return;
      // Same synchronous step: the tile now exposes its members, so per-cell residents and
      // staged replacements for those cells are released before anything else can observe them.
      const errors: unknown[] = [];
      try {
        this.stocks.evict(ready.cellIds);
      } catch (error) {
        errors.push(error);
      }
      for (const id of ready.cellIds) {
        const staged = this.hidden.get(id);
        if (!staged) continue;
        this.hidden.delete(id);
        try {
          staged.dispose();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length)
        throw new AggregateError(errors, `Failed to release cells covered by ${request.id}`);
    } catch (error) {
      this.fatal(`tile:${request.id}`, error);
    }
  }

  /**
   * Drop staged replacements the plan no longer wants, expose replacements whose tile is gone,
   * and cut over each dissolving tile once every visible member is staged: reveal the members and
   * release the tile in one synchronous step so the scene never shows a source twice or not at all.
   */
  private reconcile(): void {
    if (this.closed || !this.plan) return;
    const errors: unknown[] = [];
    for (const [id, staged] of [...this.hidden]) {
      const tileId = this.tileOf(id);
      const covered = this.tiles.get(tileId) !== undefined;
      const wanted = covered && !this.dissolving(tileId) ? null : this.wantedDetail(id);
      if (wanted !== staged.detail) {
        this.hidden.delete(id);
        try {
          staged.dispose();
        } catch (error) {
          errors.push(error);
        }
        continue;
      }
      if (covered) continue;
      this.hidden.delete(id);
      try {
        this.stocks.publish(this.generation, staged);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const tileId of this.tiles.ids()) {
      if (!this.dissolving(tileId)) continue;
      const members = this.tile(tileId).cells;
      const ready = members.every((cell) => {
        if (!this.visible.has(cell.id)) return true;
        const wanted = this.wantedDetail(cell.id);
        return (
          this.hidden.get(cell.id)?.detail === wanted || this.stocks.get(cell.id)?.detail === wanted
        );
      });
      if (!ready) continue;
      for (const cell of members) {
        const staged = this.hidden.get(cell.id);
        if (!staged) continue;
        this.hidden.delete(cell.id);
        try {
          this.stocks.publish(this.generation, staged);
        } catch (error) {
          errors.push(error);
        }
      }
      try {
        this.tiles.evict([tileId]);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 1) this.fatal('stream:cutover', errors[0]);
    else if (errors.length)
      this.fatal('stream:cutover', new AggregateError(errors, 'Stock representation cutover failed'));
  }

  private publishCover(request: CellRequest, generation: number, ready: CoverCellReady): void {
    const store = request.kind === 'trees' ? this.trees : this.covers;
    try {
      store.publish(generation, {
        id: request.id,
        detail: request.detail,
        attach: () => {
          this.options.root.add(ready.group);
          this.options.tracker.trackTree(ready.group);
        },
        dispose: ready.dispose,
      });
    } catch (error) {
      if (request.essential) this.fatal(`cover:${request.id}`, error);
      else this.options.diagnostics.recordError(`cover:${request.id}`, false, error);
    }
  }

  private build(request: Request, id: string): BuildJob {
    const generation = this.generation;
    const common = {
      id,
      generation,
      essential: request.essential,
      cityData: this.options.data,
      now: this.options.now,
      sliceMs: 4,
    };
    const reserve = (bytes: number): void => this.admit(bytes, request.essential);
    if (request.kind === 'tile') {
      const job = createStockTileJob({
        ...common,
        tileId: request.id,
        cells: request.tile.cells,
        excludedBuildingIndices: this.options.exclusions,
        material: this.options.material,
        reserve,
        onReady: (ready) => this.publishTile(request, generation, ready),
      });
      this.staging.set(id, job);
      return job;
    }
    if (request.kind === 'stock') {
      const job = createCellStockJob({
        ...common,
        cell: this.options.cityIndex.cells.get(request.id)!,
        excludedBuildingIndices: this.options.exclusions,
        material: this.options.material,
        detail: request.detail,
        reserve,
        onReady: (ready) => this.publishStock(request, generation, ready),
      });
      this.staging.set(id, job);
      return job;
    }
    if (request.kind === 'decor') {
      const stock = this.stocks.get(request.id)!;
      if (stock.detail !== request.detail)
        throw new Error(`decor stock detail mismatch: ${stock.detail} != ${request.detail}`);
      return createStockDecorJob({
        ...common,
        scratch: stock.scratch,
        onReady: (group) => {
          const root = group ?? new THREE.Group();
          const release = retainSceneResources(this.options.resources, root);
          const ready = {
            group: root,
            dispose: () => {
              root.removeFromParent();
              release();
            },
          };
          try {
            stock.attachDecor(ready);
          } catch (error) {
            ready.dispose();
            this.options.diagnostics.recordError(id, false, error);
          }
        },
      });
    }
    const bounds = this.coverCellBounds(request.id);
    if (request.kind === 'trees')
      return createTreeCoverJob({
        ...common,
        bounds,
        onReady: (group) => {
          const root = group ?? new THREE.Group();
          const release = retainSceneResources(this.options.resources, root);
          this.publishCover(request, generation, {
            group: root,
            dispose: () => {
              root.removeFromParent();
              release();
            },
          });
        },
      });
    return createCoverCellJob({
      ...common,
      bounds,
      selection: coverForBounds(this.options.coverIndex, bounds, 32),
      paintMarks: request.detail === 'street',
      roadContext: this.roadContext ?? undefined,
      onReady: (ready) => this.publishCover(request, generation, ready),
    });
  }

  private fatal(id: string, error: unknown): void {
    this.failure ??= { id, error };
  }

  private treesRetained(): ReadonlySet<CellId> {
    return new Set(this.plan?.detail === 'overview' ? [] : this.plan?.retainCover);
  }

  private cellBounds(id: CellId): BoundsXZ {
    return this.options.cityIndex.cells.get(id)!.bounds;
  }

  /** Residents outside the retain rings: useful old coverage that yields first, farthest first. */
  private staleResidents(): Candidate[] {
    const { bounds, retainCover } = this.plan!;
    const stale: Candidate[] = [];
    for (const id of this.stocks.ids()) {
      if (this.retain.has(id)) continue;
      stale.push({
        id,
        distance: centreDistance(this.cellBounds(id), bounds),
        evict: () => this.stocks.evict([id]),
      });
    }
    for (const tileId of this.tiles.ids()) {
      if (this.tileRetained(tileId)) continue;
      stale.push({
        id: tileId,
        distance: centreDistance(this.tile(tileId).bounds, bounds),
        evict: () => this.tiles.evict([tileId]),
      });
    }
    const covers = new Set(retainCover);
    const trees = this.treesRetained();
    for (const [store, kept] of [[this.covers, covers], [this.trees, trees]] as const) {
      for (const id of store.ids()) {
        if (kept.has(id)) continue;
        stale.push({
          id: `${store === this.covers ? 'cover' : 'trees'}:${id}`,
          distance: centreDistance(this.coverCellBounds(id), bounds),
          evict: () => store.evict([id]),
        });
      }
    }
    return stale.sort(farthestFirst);
  }

  /** Retained stock nobody sees: staged replacements first, then exposed cells and tiles. */
  private prefetchResidents(): Candidate[] {
    const { bounds } = this.plan!;
    const staged: Candidate[] = [];
    for (const [id, resident] of this.hidden) {
      if (this.visible.has(id)) continue;
      staged.push({
        id,
        distance: centreDistance(this.cellBounds(id), bounds),
        evict: () => {
          this.hidden.delete(id);
          resident.dispose();
        },
      });
    }
    const exposed: Candidate[] = [];
    for (const id of this.stocks.ids()) {
      if (this.visible.has(id) || !this.retain.has(id)) continue;
      exposed.push({
        id,
        distance: centreDistance(this.cellBounds(id), bounds),
        evict: () => this.stocks.evict([id]),
      });
    }
    for (const tileId of this.tiles.ids()) {
      const tile = this.tile(tileId);
      if (tile.cells.some((cell) => this.visible.has(cell.id)) || !this.tileRetained(tileId))
        continue;
      exposed.push({
        id: tileId,
        distance: centreDistance(tile.bounds, bounds),
        evict: () => this.tiles.evict([tileId]),
      });
    }
    return [...staged.sort(farthestFirst), ...exposed.sort(farthestFirst)];
  }

  /**
   * Evict until tracked residents plus stock staging fit `limit`: stale residents always, retained
   * non-visible stock only for `depth === 'wanted'`. Visible coverage is never evicted here.
   */
  private freeResidents(limit: number, depth: 'stale' | 'wanted'): boolean {
    if (!this.plan || this.heldBytes() <= limit) return true;
    let evicted = false;
    try {
      const tiers = [this.staleResidents()];
      if (depth === 'wanted') tiers.push(this.prefetchResidents());
      for (const tier of tiers) {
        for (const candidate of tier) {
          candidate.evict();
          evicted = true;
          if (this.heldBytes() <= limit) return true;
        }
      }
      return false;
    } finally {
      if (evicted) this.reconcile();
    }
  }

  /** A stock job asks to hold `bytes` more; make room or refuse so the ceiling is never crossed. */
  private admit(bytes: number, essential: boolean): void {
    const limit = this.budget.maxBytes - MAX_INDEX_BYTES - bytes;
    if (this.freeResidents(limit, essential ? 'wanted' : 'stale')) return;
    throw new Error(
      `stock geometry needs ${bytes} more bytes than the ${this.budget.maxBytes} byte resident ceiling allows`,
    );
  }

  /** At settle: release everything outside the retain rings, then enforce the ceiling on what remains. */
  private trimResidents(): void {
    if (!this.plan) return;
    this.stocks.evictOutside(this.retain);
    this.tiles.evictOutside(new Set(this.tiles.ids().filter((tileId) => this.tileRetained(tileId))));
    this.covers.evictOutside(new Set(this.plan.retainCover));
    this.trees.evictOutside(this.treesRetained());
    this.reconcile();
    if (this.freeResidents(this.budget.maxBytes - MAX_INDEX_BYTES, 'wanted')) return;
    this.fatal(
      'stream:resident-budget',
      new Error(`Visible geometry exceeds ${this.budget.maxBytes / (1024 * 1024)} MiB`),
    );
  }

  private settleCoverage(): void {
    if (!this.plan || !this.coverageJob) return;
    if (this.cursor < this.essentialEnd) return;
    for (const request of this.pending.values()) if (request.essential) return;
    const detail = this.plan.detail;
    const stocksReady = this.plan.visibleStock.every(
      (id) => this.coverage(id) === this.wantedDetail(id),
    );
    const coverReady = this.plan.visibleCover.every((id) => this.covers.get(id)?.detail === detail);
    if (!stocksReady || !coverReady) return;
    for (const id of this.plan.visibleStock) {
      const meshes = this.stocks.get(id)?.meshes ?? this.tiles.get(this.tileOf(id))!.meshes;
      if (!meshes.every((mesh) => this.drawRanges.settled(mesh))) return;
    }
    this.options.diagnostics.completeJob(this.coverageJob);
    this.coverageJob = null;
    this.trimResidents();
  }

  drain(): void {
    if (this.closed || !this.plan) return;
    const started = this.options.now();
    try {
      this.drawRanges.drain(2);
      let requests = 0;
      let completed = 0;
      for (;;) {
        while (
          this.pending.size < MAX_PENDING &&
          this.cursor < this.requests.length &&
          requests < MAX_REQUESTS_PER_DRAIN &&
          this.options.now() - started < 4
        ) {
          const request = this.requests[this.cursor]!;
          if (request.kind === 'cover' && !this.roadContext) break;
          if (request.kind === 'decor') {
            const stock = this.stocks.get(request.id);
            if (!stock || stock.detail !== request.detail) break;
          }
          this.cursor++;
          requests++;
          if (this.resident(request)) continue;
          // Stale bytes yield to prefetch on demand, so only retained bytes count against the gate.
          if (
            !request.essential &&
            this.options.tracker.bytes() - this.staleStockBytes >= this.budget.backgroundBytes
          )
            continue;
          const id = `stream:${this.generation}:${request.kind}:${request.id}:${request.detail}`;
          const job = this.build(request, id);
          this.options.diagnostics.registerJob(id, request.essential);
          this.pending.set(id, request);
          let started = false;
          this.scheduler.enqueue({
            ...job,
            step: () => {
              if (!started) {
                started = true;
                this.options.diagnostics.startJob(id);
              }
              return job.step();
            },
          });
        }
        let remaining = 4 - (this.options.now() - started);
        if (remaining <= 0) break;
        const result = this.scheduler.drain(remaining, this.options.now);
        completed += result.completed.length;
        for (const id of result.completed) {
          this.pending.delete(id);
          this.staging.delete(id);
          this.options.diagnostics.completeJob(id);
        }
        for (const failure of result.failed) {
          this.pending.delete(failure.id);
          this.staging.delete(failure.id);
          this.options.diagnostics.failJob(failure.id, failure.error);
          if (failure.essential) {
            this.options.onFatal(failure.id);
            return;
          }
        }
        remaining = 4 - (this.options.now() - started);
        if (!this.roadContext && remaining > 0) {
          const context = this.contextScheduler.drain(remaining, this.options.now);
          for (const id of context.completed) this.options.diagnostics.completeJob(id);
          for (const failure of context.failed) {
            this.options.diagnostics.failJob(failure.id, failure.error);
            this.options.onFatal(failure.id);
            return;
          }
        }
        if (
          this.pending.size > 0 ||
          requests >= MAX_REQUESTS_PER_DRAIN ||
          this.cursor >= this.requests.length
        )
          break;
        const next = this.requests[this.cursor]!;
        if (next.kind === 'cover' && !this.roadContext) break;
        if (next.kind === 'decor') {
          const stock = this.stocks.get(next.id);
          if (!stock || stock.detail !== next.detail) break;
        }
      }
      this.settleCoverage();
      if (!this.coverageJob && completed > 0) this.trimResidents();
    } catch (error) {
      this.fatal('stream:drain', error);
    }
    if (this.failure) {
      const { id, error } = this.failure;
      this.failure = null;
      this.options.diagnostics.recordError(id, true, error);
      this.options.onFatal(id);
    }
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const errors: unknown[] = [];
    for (const action of [
      () => this.drawRanges.dispose(),
      () => this.cancelPending(),
      () => {
        try {
          this.contextScheduler.cancelGeneration(0);
        } finally {
          this.roadContext = null;
          this.options.diagnostics.cancelJob('stream:road-context');
        }
      },
      () => {
        const staged = [...this.hidden.values()];
        this.hidden.clear();
        const failures: unknown[] = [];
        for (const resident of staged) {
          try {
            resident.dispose();
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length) throw new AggregateError(failures, 'Failed to dispose staged stock');
      },
      () => this.stocks.dispose(),
      () => this.tiles.dispose(),
      () => this.covers.dispose(),
      () => this.trees.dispose(),
    ]) {
      try {
        action();
      } catch (error) {
        errors.push(error);
      }
    }
    this.plan = null;
    if (errors.length) throw new AggregateError(errors, 'City stream disposal failed');
  }
}
