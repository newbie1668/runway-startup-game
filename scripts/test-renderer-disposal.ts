import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CityRenderer3D } from '../lib/game/render3d/CityRenderer3D';
import { createResourcePool } from '../lib/game/render3d/sceneResources';
import { createMapDiagnostics } from '../lib/game/mapDiagnostics';

const require = createRequire(import.meta.url);
const three = require('three') as typeof import('three');
const originalRenderer = three.WebGLRenderer;

const originalWindow = globalThis.window;
const listeners: string[] = [];
const debug = () => undefined;
const newerDebug = () => undefined;
const fixture = Object.create(CityRenderer3D.prototype) as Record<string, unknown>;
const pool = createResourcePool();
const hostDiagnostics = createMapDiagnostics(0, () => 0);
let disposed = 0;
let idleDisposals = 0;
pool.retain({
  dispose: () => {
    disposed++;
    throw new Error('expected cleanup failure');
  },
});
fixture.disposed = false;
fixture.idleGeneration = { dispose: () => idleDisposals++ };
fixture.generation = 4;
fixture.loadController = new AbortController();
fixture.contextLostTimer = null;
fixture.cityCanvas = { removeEventListener: (type: string) => listeners.push(type) };
fixture.debugContextLoss = debug;
fixture.buildQueue = [{ id: 'pending' }];
fixture.scratch = {};
fixture.buildingMeshes = [{}];
fixture.minorMeshes = [{}];
fixture.landmarkPrefabs = new Map([['a', {}]]);
fixture.noticedPrefabs = new Map([['b', {}]]);
fixture.noticedEntries = [{}];
fixture.hubGlowSprites = new Map([['hub', {}]]);
fixture.selected = {};
fixture.lastPlayerHubId = 'hub';
fixture.tier2RoadMesh = {};
fixture.markMesh = {};
fixture.lampGroup = {};
fixture.windowMesh = {};
fixture.scene3d = { clear: () => undefined };
fixture.resources = pool;
fixture.renderer = {
  dispose: () => {
    disposed++;
  },
};
fixture.geometryTracker = {
  clear: () => {
    disposed++;
  },
};
fixture.diagnostics = hostDiagnostics;
fixture.ownsDiagnostics = false;
globalThis.window = { __runwayForceContextLoss: debug } as unknown as Window & typeof globalThis;

try {
  CityRenderer3D.prototype.dispose.call(fixture);
  assert.equal(fixture.disposed, true);
  assert.equal(fixture.generation as number, 5);
  assert.equal((fixture.loadController as AbortController).signal.aborted, true);
  assert.deepEqual(fixture.buildQueue, []);
  assert.equal((fixture.landmarkPrefabs as Map<unknown, unknown>).size, 0);
  assert.equal((fixture.noticedPrefabs as Map<unknown, unknown>).size, 0);
  assert.equal((fixture.hubGlowSprites as Map<unknown, unknown>).size, 0);
  assert.equal(
    (globalThis.window as unknown as { __runwayForceContextLoss?: unknown })
      .__runwayForceContextLoss,
    undefined,
  );
  assert.deepEqual(listeners, ['webglcontextlost']);
  assert.equal(disposed, 3, 'cleanup continues after a throwing resource disposer');
  assert.equal(idleDisposals, 1, 'idle generation stops before renderer teardown');
  hostDiagnostics.recordError('init', false, new Error('3D init failed'));
  hostDiagnostics.selectMode('2d', '3D fallback');
  hostDiagnostics.recordFrame({ mode: '2d', durationMs: 1 });
  const hostSnapshot = hostDiagnostics.snapshot();
  assert.equal(hostSnapshot.state, 'fallback');
  assert.equal(hostSnapshot.fallbackReason, '3D fallback');
  assert.equal(hostSnapshot.firstUsefulFrameMs, 0);
  (
    globalThis.window as unknown as { __runwayForceContextLoss?: () => void }
  ).__runwayForceContextLoss = newerDebug;
  CityRenderer3D.prototype.dispose.call(fixture);
  assert.equal(idleDisposals, 1, 'repeated teardown does not cancel a new idle callback');
  assert.equal(
    (globalThis.window as unknown as { __runwayForceContextLoss?: () => void })
      .__runwayForceContextLoss,
    newerDebug,
  );

  let rendererDisposals = 0;
  const constructionListeners: string[] = [];
  class FakeRenderer {
    dispose(): void {
      rendererDisposals++;
    }
  }
  (three as unknown as { WebGLRenderer: typeof FakeRenderer }).WebGLRenderer = FakeRenderer;
  globalThis.window = {
    location: { search: '' },
    get devicePixelRatio(): number {
      throw new Error('pixel ratio failed');
    },
  } as unknown as Window & typeof globalThis;
  const canvas = {
    addEventListener: (type: string) => constructionListeners.push(`add:${type}`),
    removeEventListener: (type: string) => constructionListeners.push(`remove:${type}`),
  } as unknown as HTMLCanvasElement;
  const overlay = { getContext: () => ({}) } as unknown as HTMLCanvasElement;
  const constructionDiagnostics = createMapDiagnostics(0, () => 0);
  assert.throws(
    () => new CityRenderer3D(canvas, overlay, { onFatal: () => undefined, diagnostics: constructionDiagnostics }),
    /pixel ratio failed/,
  );
  assert.equal(
    rendererDisposals,
    1,
    'an allocated renderer is disposed when later construction fails',
  );
  assert.deepEqual(constructionListeners, ['remove:webglcontextlost']);
  constructionDiagnostics.recordError('init', false, new Error('3D init failed'));
  constructionDiagnostics.selectMode('2d', '3D fallback');
  constructionDiagnostics.recordFrame({ mode: '2d', durationMs: 1 });
  const constructionSnapshot = constructionDiagnostics.snapshot();
  assert.equal(constructionSnapshot.state, 'fallback');
  assert.equal(constructionSnapshot.fallbackReason, '3D fallback');
  assert.equal(constructionSnapshot.firstUsefulFrameMs, 0);
  console.log('renderer disposal passed');
} finally {
  (three as unknown as { WebGLRenderer: typeof originalRenderer }).WebGLRenderer = originalRenderer;
  globalThis.window = originalWindow;
}
