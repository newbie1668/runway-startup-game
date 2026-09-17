import * as THREE from 'three';
import { METERS_TO_WORLD } from '../geo';
import type { MapDiagnosticsReporter } from '../mapDiagnostics';
import { createBuildScheduler, type BuildJob } from './buildScheduler';
import { createCellStockJob, type CellStockReady } from './cellStockJob';
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

interface StockResident extends StreamResident {
  readonly detail: StockDetail;
  readonly scratch: CityScratch;
  readonly meshes: readonly THREE.Mesh[];
  hasDecor(): boolean;
  attachDecor(ready: CoverCellReady): void;
}

interface CoverResident extends StreamResident {
  readonly detail: StockDetail;
}

interface Request {
  readonly kind: 'stock' | 'cover' | 'trees' | 'decor';
  readonly id: CellId;
  readonly detail: StockDetail;
  readonly essential: boolean;
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
  now(): number;
  onRoadContextReady?(context: RoadCoverContext): void;
  onStockDrawn(): void;
  onStockEvicted(picks: readonly BuildingPick[]): void;
  onFatal(reason: string): void;
}

const MAX_PENDING = 4;
const MAX_RESIDENT_BYTES = 128 * 1024 * 1024;
const BACKGROUND_RESIDENT_BYTES = 96 * 1024 * 1024;

function clearScratch(scratch: CityScratch): void {
  scratch.picks.length = 0;
  scratch.windows.length = scratch.windowColors.length = 0;
  scratch.rooftops.length = scratch.rooftopColors.length = 0;
  scratch.signs.length = 0;
}

export class CityStream {
  private scheduler = createBuildScheduler();
  private readonly contextScheduler = createBuildScheduler();
  private roadContext: RoadCoverContext | null = null;
  private readonly stocks = createStreamResidentStore<StockResident>();
  private readonly covers = createStreamResidentStore<CoverResident>();
  private readonly trees = createStreamResidentStore<CoverResident>();
  private readonly pending = new Map<string, Request>();
  private requests: Request[] = [];
  private cursor = 0;
  private generation = 0;
  private plan: StreamCoveragePlan | null = null;
  private signature = '';
  private coverageJob: string | null = null;
  private closed = false;
  private buildings = 0;
  private failure: { id: string; error: unknown } | null = null;

  constructor(private readonly options: CityStreamOptions) {
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
      this.roadContext !== null && this.pending.size === 0 && this.cursor >= this.requests.length
    );
  }

  get residentCells(): number {
    return this.stocks.ids().length + this.covers.ids().length + this.trees.ids().length;
  }

  buildingMeshes(): THREE.Mesh[] {
    return this.stocks.ids().flatMap((id) => [...this.stocks.get(id)!.meshes]);
  }

  *picks(): Generator<BuildingPick> {
    for (const id of this.stocks.ids()) yield* this.stocks.get(id)!.scratch.picks;
  }

  private cellBounds(id: CellId): BoundsXZ {
    const [ix, iz] = id.split(',').map(Number);
    const size = this.options.coverIndex.cellSizeM * METERS_TO_WORLD;
    return { minX: ix! * size, minZ: iz! * size, maxX: (ix! + 1) * size, maxZ: (iz! + 1) * size };
  }

  private ordered(ids: readonly CellId[], bounds: BoundsXZ): CellId[] {
    const x = (bounds.minX + bounds.maxX) / 2;
    const z = (bounds.minZ + bounds.maxZ) / 2;
    const distances = new Map<CellId, number>();
    for (const id of ids) {
      const cell = this.cellBounds(id);
      distances.set(
        id,
        Math.hypot((cell.minX + cell.maxX) / 2 - x, (cell.minZ + cell.maxZ) / 2 - z),
      );
    }
    return [...ids].sort(
      (a, b) => distances.get(a)! - distances.get(b)! || (a < b ? -1 : a > b ? 1 : 0),
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
    if (signature === this.signature) return;
    this.signature = signature;
    this.cancelPending();
    this.generation = this.stocks.beginGeneration();
    this.covers.beginGeneration();
    this.trees.beginGeneration();
    this.coverageJob = `stream:coverage:${this.generation}`;
    this.options.diagnostics.registerJob(this.coverageJob, true);
    this.options.diagnostics.startJob(this.coverageJob);
    const requests: Request[] = [];
    const append = (
      kind: Request['kind'],
      ids: readonly CellId[],
      detail: StockDetail,
      essential: boolean,
    ): void => {
      for (const id of this.ordered(ids, bounds)) requests.push({ kind, id, detail, essential });
    };
    const detailed = new Set(plan.detailedStock);
    for (const id of this.ordered(plan.visibleStock, bounds)) {
      requests.push({
        kind: 'stock',
        id,
        detail: detailed.has(id) ? plan.detail : 'overview',
        essential: true,
      });
    }
    append('cover', plan.visibleCover, plan.detail, true);
    append('stock', plan.prefetchStock, 'overview', false);
    append('cover', plan.prefetchCover, 'overview', false);
    if (plan.detail !== 'overview') append('trees', plan.visibleCover, plan.detail, false);
    if (plan.detail !== 'overview') append('decor', plan.detailedStock, plan.detail, false);
    this.requests = requests;
    this.cursor = 0;
  }

  private resident(request: Request): boolean {
    if (request.kind === 'decor') {
      const stock = this.stocks.get(request.id);
      return stock !== undefined && stock.detail === request.detail && stock.hasDecor();
    }
    const store =
      request.kind === 'stock' ? this.stocks : request.kind === 'cover' ? this.covers : this.trees;
    const current = store.get(request.id);
    return current !== undefined && (current.detail === request.detail || !request.essential);
  }

  private cancelPending(): void {
    try {
      this.scheduler.cancelGeneration(this.generation);
    } finally {
      this.scheduler = createBuildScheduler();
      for (const id of this.pending.keys()) this.options.diagnostics.cancelJob(id);
      this.pending.clear();
      if (this.coverageJob) this.options.diagnostics.cancelJob(this.coverageJob);
      this.coverageJob = null;
      this.requests = [];
      this.cursor = 0;
    }
  }

  private publishStock(request: Request, generation: number, ready: CellStockReady): void {
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
    let decoration: CoverCellReady | null = null;
    const resident: StockResident = {
      id: request.id,
      detail: request.detail,
      scratch: ready.scratch,
      meshes,
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
      attach: () => {
        if (ready.group) {
          root.add(ready.group);
          tracker.trackTree(ready.group);
        }
        attached = true;
        this.buildings += ready.sourceBuildingIndices.length;
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        try {
          if (attached) this.buildings -= ready.sourceBuildingIndices.length;
          onStockEvicted(ready.scratch.picks);
          ready.group?.removeFromParent();
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
    try {
      this.stocks.publish(generation, resident);
    } catch (error) {
      this.fatal(`stock:${request.id}`, error);
    }
  }

  private publishCover(request: Request, generation: number, ready: CoverCellReady): void {
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
    if (request.kind === 'stock')
      return createCellStockJob({
        ...common,
        cell: this.options.cityIndex.cells.get(request.id)!,
        excludedBuildingIndices: this.options.exclusions,
        material: this.options.material,
        detail: request.detail,
        onReady: (ready) => this.publishStock(request, generation, ready),
      });
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
    const bounds = this.cellBounds(request.id);
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

  private trimResidents(): void {
    if (!this.plan) return;
    const retain = new Set(this.plan.retainStock);
    this.stocks.evictOutside(retain);
    this.covers.evictOutside(new Set(this.plan.retainCover));
    this.trees.evictOutside(new Set(this.plan.detail === 'overview' ? [] : this.plan.retainCover));
    if (this.options.tracker.bytes() <= MAX_RESIDENT_BYTES) return;
    const visible = new Set(this.plan.visibleStock);
    const candidates = this.ordered(
      this.stocks.ids().filter((id) => !visible.has(id)),
      this.plan.bounds,
    ).reverse();
    for (const id of candidates) {
      retain.delete(id);
      this.stocks.evictOutside(retain);
      if (this.options.tracker.bytes() <= MAX_RESIDENT_BYTES) return;
    }
    this.fatal('stream:resident-budget', new Error('Visible geometry exceeds 128 MiB'));
  }

  private settleCoverage(): void {
    if (!this.plan || !this.coverageJob) return;
    const detail = this.plan.detail;
    const detailed = new Set(this.plan.detailedStock);
    const stocksReady = this.plan.visibleStock.every(
      (id) => this.stocks.get(id)?.detail === (detailed.has(id) ? detail : 'overview'),
    );
    const coverReady = this.plan.visibleCover.every((id) => this.covers.get(id)?.detail === detail);
    if (!stocksReady || !coverReady) return;
    this.options.diagnostics.completeJob(this.coverageJob);
    this.coverageJob = null;
    this.trimResidents();
  }

  drain(): void {
    if (this.closed || !this.plan) return;
    const started = this.options.now();
    try {
      this.settleCoverage();
      while (this.pending.size < MAX_PENDING && this.cursor < this.requests.length) {
        const request = this.requests[this.cursor]!;
        if (request.kind === 'cover' && !this.roadContext) break;
        if (request.kind === 'decor') {
          const stock = this.stocks.get(request.id);
          if (!stock || stock.detail !== request.detail) break;
        }
        this.cursor++;
        if (this.resident(request)) continue;
        if (!request.essential && this.options.tracker.bytes() >= BACKGROUND_RESIDENT_BYTES)
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
      const result = this.scheduler.drain(4, this.options.now);
      for (const id of result.completed) {
        this.pending.delete(id);
        this.options.diagnostics.completeJob(id);
      }
      for (const failure of result.failed) {
        this.pending.delete(failure.id);
        this.options.diagnostics.failJob(failure.id, failure.error);
        if (failure.essential) {
          this.options.onFatal(failure.id);
          return;
        }
      }
      const remaining = 4 - (this.options.now() - started);
      if (!this.roadContext && remaining > 0) {
        const context = this.contextScheduler.drain(remaining, this.options.now);
        for (const id of context.completed) this.options.diagnostics.completeJob(id);
        for (const failure of context.failed) {
          this.options.diagnostics.failJob(failure.id, failure.error);
          this.options.onFatal(failure.id);
          return;
        }
      }
      this.settleCoverage();
      if (!this.coverageJob && result.completed.length > 0) this.trimResidents();
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
      () => this.cancelPending(),
      () => {
        try {
          this.contextScheduler.cancelGeneration(0);
        } finally {
          this.roadContext = null;
          this.options.diagnostics.cancelJob('stream:road-context');
        }
      },
      () => this.stocks.dispose(),
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
