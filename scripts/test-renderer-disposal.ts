import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CityRenderer3D } from '../lib/game/render3d/CityRenderer3D';
import { createResourcePool } from '../lib/game/render3d/sceneResources';

const require = createRequire(import.meta.url);
const three = require('three') as typeof import('three');
const originalRenderer = three.WebGLRenderer;

const originalWindow = globalThis.window;
const listeners: string[] = [];
const debug = () => undefined;
const newerDebug = () => undefined;
const fixture = Object.create(CityRenderer3D.prototype) as Record<string, unknown>;
const pool = createResourcePool();
let disposed = 0;
pool.retain({
  dispose: () => {
    disposed++;
    throw new Error('expected cleanup failure');
  },
});
fixture.disposed = false;
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
fixture.diagnostics = {
  dispose: () => {
    disposed++;
  },
};
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
  assert.equal(disposed, 4, 'cleanup continues after a throwing resource disposer');
  (
    globalThis.window as unknown as { __runwayForceContextLoss?: () => void }
  ).__runwayForceContextLoss = newerDebug;
  CityRenderer3D.prototype.dispose.call(fixture);
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
  assert.throws(
    () => new CityRenderer3D(canvas, overlay, { onFatal: () => undefined }),
    /pixel ratio failed/,
  );
  assert.equal(
    rendererDisposals,
    1,
    'an allocated renderer is disposed when later construction fails',
  );
  assert.deepEqual(constructionListeners, ['remove:webglcontextlost']);
  console.log('renderer disposal passed');
} finally {
  (three as unknown as { WebGLRenderer: typeof originalRenderer }).WebGLRenderer = originalRenderer;
  globalThis.window = originalWindow;
}
