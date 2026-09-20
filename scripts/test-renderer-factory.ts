import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createMapRenderer } from '../lib/game/render3d/factory';
import { createMapDiagnostics } from '../lib/game/mapDiagnostics';

const require = createRequire(import.meta.url);
const three = require('three') as typeof import('three');
const originalRenderer = three.WebGLRenderer;
const globals = ['window', 'navigator', 'sessionStorage', 'matchMedia', 'document'] as const;
const descriptors = globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
let suppliedContext: WebGL2RenderingContext | undefined;

class FailingRenderer {
  constructor(options: { context?: WebGL2RenderingContext }) {
    suppliedContext = options.context;
    throw new Error('renderer construction failed');
  }
}

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
  suppliedContext = undefined;
  const context = {
    getExtension(name: string) {
      assert.equal(name, 'WEBGL_lose_context');
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
    getContext(name: string, next: WebGLContextAttributes) {
      assert.equal(name, 'webgl2');
      requests++;
      attributes = next;
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
  return { requests, losses, attributes, context, snapshot: diagnostics.snapshot() };
}

async function main(): Promise<void> {
  (three as unknown as { WebGLRenderer: typeof FailingRenderer }).WebGLRenderer = FailingRenderer;
  try {
    for (const options of [{ search: '?map=2d' }, { stored: true }, { memory: 2 }]) {
      const result = await scenario(options);
      assert.equal(result.requests, 0);
      assert.equal(result.losses, 0);
      assert.equal(suppliedContext, undefined);
    }
    const unavailable = await scenario({ unavailable: true });
    assert.equal(unavailable.requests, 1);
    assert.equal(unavailable.losses, 0);
    assert.equal(unavailable.snapshot.fallbackReason, 'WebGL2 unavailable');
    assert.equal(suppliedContext, undefined);

    const desktop = await scenario({ search: '?map=3d', stored: true, memory: 2 });
    assert.equal(desktop.requests, 1);
    assert.equal(suppliedContext, desktop.context, 'the renderer receives the support-check context');
    assert.equal(desktop.losses, 1, 'failed initialization releases the acquired city context');
    assert.deepEqual(desktop.attributes, {
      alpha: false, antialias: true, powerPreference: 'high-performance',
    });
    assert.match(desktop.snapshot.fallbackReason!, /renderer construction failed/);

    const touch = await scenario({ coarse: true });
    assert.equal(touch.attributes?.antialias, false);
    const wide = await scenario({ search: '?view=wide' });
    assert.equal(wide.attributes?.antialias, false);
    const failedCreation = await scenario({ creationThrows: true });
    assert.equal(failedCreation.losses, 0);
    assert.match(failedCreation.snapshot.fallbackReason!, /context creation failed/);
    const failedCleanup = await scenario({ cleanupThrows: true });
    assert.match(failedCleanup.snapshot.fallbackReason!, /renderer construction failed/);
    assert.equal(failedCleanup.snapshot.errors.length, 2);
    console.log('renderer factory context ownership passed');
  } finally {
    (three as unknown as { WebGLRenderer: typeof originalRenderer }).WebGLRenderer = originalRenderer;
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

void main();
