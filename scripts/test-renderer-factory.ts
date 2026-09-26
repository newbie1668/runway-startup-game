import assert from 'node:assert/strict';
import { createMapRenderer } from '../lib/game/render3d/factory';
import { createMapDiagnostics } from '../lib/game/mapDiagnostics';

const globals = ['window', 'navigator', 'sessionStorage', 'matchMedia', 'document'] as const;
const descriptors = globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);

async function scenario(options: {
  search?: string;
  stored?: boolean;
  memory?: number;
  coarse?: boolean;
  unavailable?: boolean;
  creationThrows?: boolean;
  cleanupThrows?: boolean;
}) {
  let requests = 0;
  let losses = 0;
  let attributes: WebGLContextAttributes | undefined;
  const contextRequests: WebGLContextAttributes[] = [];
  const context = {
    getExtension(name: string) {
      if (name !== 'WEBGL_lose_context') throw new Error('renderer initialization failed');
      if (options.cleanupThrows) throw new Error('cleanup failed');
      return { loseContext: () => losses++ };
    },
  } as unknown as WebGL2RenderingContext;
  const values = {
    window: { location: { search: options.search ?? '' } },
    navigator: { deviceMemory: options.memory ?? 8 },
    sessionStorage: { getItem: () => options.stored ? '1' : null },
    matchMedia: () => ({ matches: options.coarse ?? false }),
    document: { createElement: () => { throw new Error('unexpected detached probe'); } },
  };
  for (const name of globals)
    Object.defineProperty(globalThis, name, { configurable: true, value: values[name] });
  const city = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getContext(name: string, next: WebGLContextAttributes) {
      assert.equal(name, 'webgl2');
      requests++;
      attributes = next;
      contextRequests.push(next);
      if (options.creationThrows) throw new Error('context creation failed');
      return options.unavailable ? null : context;
    },
  } as unknown as HTMLCanvasElement;
  const overlay = {
    getContext: (name: string) => {
      assert.equal(name, '2d');
      return {};
    },
  } as unknown as HTMLCanvasElement;
  const diagnostics = createMapDiagnostics(0, () => 0);
  const result = await createMapRenderer(city, overlay, {
    diagnostics,
    onFatal: () => { throw new Error('unexpected late failure'); },
  });
  assert.equal(result.mode, '2d');
  return { requests, losses, attributes, contextRequests, snapshot: diagnostics.snapshot() };
}

async function main(): Promise<void> {
  try {
    for (const options of [{ search: '?map=2d' }, { stored: true }, { memory: 2 }]) {
      const result = await scenario(options);
      assert.equal(result.requests, 0);
      assert.equal(result.losses, 0);
    }
    const unavailable = await scenario({ unavailable: true });
    assert.equal(unavailable.requests, 1);
    assert.equal(unavailable.losses, 0);
    assert.equal(unavailable.snapshot.fallbackReason, 'WebGL2 unavailable');

    const desktop = await scenario({ search: '?map=3d', stored: true, memory: 2 });
    assert.equal(desktop.requests, 2);
    assert.deepEqual(
      desktop.contextRequests[0],
      desktop.contextRequests[1],
      'the support check matches the actual Three.js context attributes',
    );
    assert.equal(desktop.losses, 1, 'failed initialization releases the acquired city context');
    assert.deepEqual(desktop.attributes, {
      alpha: true,
      depth: true,
      stencil: false,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    });
    assert.match(desktop.snapshot.fallbackReason!, /renderer initialization failed/);

    const touch = await scenario({ coarse: true });
    assert.equal(touch.attributes?.antialias, false);
    const wide = await scenario({ search: '?view=wide' });
    assert.equal(wide.attributes?.antialias, false);
    const failedCreation = await scenario({ creationThrows: true });
    assert.equal(failedCreation.losses, 0);
    assert.match(failedCreation.snapshot.fallbackReason!, /context creation failed/);
    const failedCleanup = await scenario({ cleanupThrows: true });
    assert.match(failedCleanup.snapshot.fallbackReason!, /renderer initialization failed/);
    assert.equal(failedCleanup.snapshot.errors.length, 2);
    console.log('renderer factory context ownership passed');
  } finally {
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

void main();
