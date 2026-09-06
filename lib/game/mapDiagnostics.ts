export type MapLoadState = 'loading' | 'ready' | 'degraded' | 'failed' | 'fallback' | 'disposed';

export type MapDiagnostics = {
  mode: '2d' | '3d' | null;
  state: MapLoadState;
  generation: number;
  camera: { x: number; y: number; zoom: number } | null;
  queuedJobs: number;
  pendingEssentialJobs: number;
  completedJobs: number;
  failedJobs: number;
  errorCount: number;
  errors: { jobId: string; essential: boolean; message: string }[];
  activeJobId: string | null;
  lastJob: { id: string; ms: number } | null;
  slowestJob: { id: string; ms: number } | null;
  residentCells: number | null;
  stockBuildings: number | null;
  stockDrawn: boolean | null;
  drawCalls: number | null;
  triangles: number | null;
  geometryBytes: number | null;
  textures: number | null;
  firstUsefulFrameMs: number | null;
  frameP95Ms: number | null;
  fallbackReason: string | null;
};

export type MapQaBridge = { snapshot(): Readonly<MapDiagnostics> };

export type FrameMetrics =
  | { mode: '2d'; durationMs: number }
  | { mode: '3d'; durationMs: number; stockDrawn: boolean; stockBuildings: number; drawCalls: number; triangles: number; geometryBytes: number; textures: number };

export interface MapDiagnosticsReporter extends MapQaBridge {
  getState(): MapLoadState;
  selectMode(mode: '2d' | '3d', reason?: string): void;
  setCamera(camera: { x: number; y: number; zoom: number }): void;
  registerJob(id: string, essential: boolean): void;
  startJob(id: string): void;
  completeJob(id: string): void;
  failJob(id: string, error: unknown): void;
  recordError(jobId: string, essential: boolean, error: unknown): void;
  recordFrame(metrics: FrameMetrics): void;
  dispose(): void;
}

type Job = { essential: boolean; startedAt: number | null };

const messageOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
const elapsed = (now: number, start: number): number => Math.max(0, now - start);

export function createMapDiagnostics(generation: number, now: () => number): MapDiagnosticsReporter {
  const startedAt = now();
  const pending = new Map<string, Job>();
  const seen = new Set<string>();
  const samples: number[] = [];
  let mode: '2d' | '3d' | null = null;
  let state: MapLoadState = 'loading';
  let camera: { x: number; y: number; zoom: number } | null = null;
  let completedJobs = 0;
  let failedJobs = 0;
  let errorCount = 0;
  let errors: { jobId: string; essential: boolean; message: string }[] = [];
  let activeJobId: string | null = null;
  let lastJob: { id: string; ms: number } | null = null;
  let slowestJob: { id: string; ms: number } | null = null;
  let essentialPending = 0;
  let essentialFailure = false;
  let optionalFailure = false;
  let sawEssential = false;
  let usefulFrame = false;
  let firstUsefulFrameMs: number | null = null;
  let stockBuildings: number | null = null;
  let drawCalls: number | null = null;
  let triangles: number | null = null;
  let geometryBytes: number | null = null;
  let textures: number | null = null;
  let stockDrawn: boolean | null = null;

  const active = () => state !== 'disposed' && state !== 'fallback';
  const finishJob = (id: string, failed: boolean, error?: unknown) => {
    if (!active()) return;
    const job = pending.get(id);
    if (!job) return;
    pending.delete(id);
    if (job.essential) essentialPending--;
    if (failed) {
      failedJobs++;
      reporter.recordError(id, job.essential, error);
    } else completedJobs++;
    if (job.startedAt !== null) {
      const result = { id, ms: elapsed(now(), job.startedAt) };
      lastJob = result;
      if (slowestJob === null || result.ms > slowestJob.ms) slowestJob = result;
    }
    if (activeJobId === id) activeJobId = null;
  };
  const reporter: MapDiagnosticsReporter = {
    snapshot() {
      const sorted = samples.slice().sort((a, b) => a - b);
      const frameP95Ms = sorted.length === 0 ? null : sorted[Math.ceil(sorted.length * 0.95) - 1];
      const copy = {
        mode, state, generation, camera: camera && Object.freeze({ ...camera }),
        queuedJobs: pending.size, pendingEssentialJobs: essentialPending, completedJobs, failedJobs, errorCount,
        errors: Object.freeze(errors.map((entry) => Object.freeze({ ...entry }))),
        activeJobId, lastJob: lastJob && Object.freeze({ ...lastJob }),
        slowestJob: slowestJob && Object.freeze({ ...slowestJob }),
        residentCells: null, stockBuildings, stockDrawn, drawCalls, triangles, geometryBytes, textures,
        firstUsefulFrameMs, frameP95Ms, fallbackReason: fallbackReason,
      } as MapDiagnostics;
      return Object.freeze(copy);
    },
    getState: () => state,
    selectMode(next, reason) {
      if (state === 'disposed' || state === 'fallback') return;
      if (next === '3d') { mode = '3d'; return; }
      mode = '2d'; state = 'fallback'; fallbackReason = reason || '2D selected';
      pending.clear(); essentialPending = 0; activeJobId = null;
      stockBuildings = drawCalls = triangles = geometryBytes = textures = null;
      stockDrawn = null;
    },
    setCamera(next) { if (state !== 'disposed') camera = { ...next }; },
    registerJob(id, essential) {
      if (!active()) return;
      if (seen.has(id)) throw new Error(`Job already registered: ${id}`);
      pending.set(id, { essential, startedAt: null }); seen.add(id);
      if (essential) { essentialPending++; sawEssential = true; usefulFrame = false; if (!essentialFailure) state = 'loading'; }
    },
    startJob(id) {
      if (!active()) return;
      const job = pending.get(id); if (!job) throw new Error(`Unknown job: ${id}`);
      job.startedAt = now(); activeJobId = id;
    },
    completeJob(id) { finishJob(id, false); },
    failJob(id, error) { finishJob(id, true, error); },
    recordError(jobId, essential, error) {
      if (!active()) return;
      errorCount++; errors = [...errors, { jobId, essential, message: messageOf(error) }].slice(-20);
      if (essential) { essentialFailure = true; state = 'failed'; }
      else { optionalFailure = true; if (state === 'ready') state = 'degraded'; }
    },
    recordFrame(metrics) {
      if (state === 'disposed' || metrics.mode !== mode) return;
      if (Number.isFinite(metrics.durationMs) && metrics.durationMs >= 0) { samples.push(metrics.durationMs); if (samples.length > 120) samples.shift(); }
      if (metrics.mode === '2d') { if (firstUsefulFrameMs === null) firstUsefulFrameMs = elapsed(now(), startedAt); return; }
      stockDrawn = metrics.stockDrawn;
      stockBuildings = metrics.stockBuildings; drawCalls = metrics.drawCalls; triangles = metrics.triangles;
      geometryBytes = metrics.geometryBytes; textures = metrics.textures;
      if (!usefulFrame && sawEssential && essentialPending === 0 && !essentialFailure && stockDrawn === true && (stockBuildings ?? 0) > 0 && (drawCalls ?? 0) > 0 && (triangles ?? 0) > 0) {
        usefulFrame = true; firstUsefulFrameMs ??= elapsed(now(), startedAt); state = optionalFailure ? 'degraded' : 'ready';
      }
    },
    dispose() { if (state !== 'disposed') state = 'disposed'; },
  };
  let fallbackReason: string | null = null;
  return reporter;
}

export function createBufferLedger() {
  const owners = new Map<object, Set<ArrayBufferLike>>();
  const refs = new Map<ArrayBufferLike, number>();
  let total = 0;
  const releaseOwner = (owner: object) => {
    const buffers = owners.get(owner); if (!buffers) return; owners.delete(owner);
    for (const buffer of buffers) { const count = refs.get(buffer)!; if (count === 1) { refs.delete(buffer); total -= buffer.byteLength; } else refs.set(buffer, count - 1); }
  };
  return {
    retain(owner: object, buffers: readonly ArrayBufferLike[]) {
      if (owners.has(owner)) releaseOwner(owner);
      const unique = new Set(buffers); owners.set(owner, unique);
      for (const buffer of unique) { const count = refs.get(buffer) ?? 0; refs.set(buffer, count + 1); if (count === 0) total += buffer.byteLength; }
    },
    release: releaseOwner,
    bytes: () => total,
    clear() { owners.clear(); refs.clear(); total = 0; },
  };
}
