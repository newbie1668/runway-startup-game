import { createResourcePool, type DisposableResource } from "../lib/game/render3d/sceneResources";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectThrow(action: () => void, message: string, expected?: unknown): void {
  let thrown = false;
  try {
    action();
  } catch (error) {
    thrown = true;
    if (expected !== undefined) assert(error === expected, `${message}: wrong error`);
  }
  assert(thrown, `${message}: did not throw`);
}

function resource(dispose: () => void): DisposableResource {
  return { dispose };
}

{
  const pool = createResourcePool();
  const error = new Error("final release");
  let disposals = 0;
  const item = resource(() => {
    disposals += 1;
    throw error;
  });
  const release = pool.retain(item);
  expectThrow(release, "final release should propagate its disposer error", error);
  release();
  assert(disposals === 1, "throwing final release was not recorded exactly once");
}

{
  const pool = createResourcePool();
  let disposals = 0;
  const item = resource(() => {
    disposals += 1;
  });
  const releaseA = pool.retain(item);
  const releaseB = pool.retain(item);
  releaseA();
  assert(disposals === 0, "shared resource disposed before final release");
  releaseB();
  releaseB();
  assert(disposals === 1, "final release did not dispose exactly once");
}

{
  const pool = createResourcePool();
  let disposals = 0;
  const item = resource(() => {
    disposals += 1;
  });
  const release = pool.retain(item);
  pool.dispose();
  release();
  pool.dispose();
  assert(disposals === 1, "pool dispose or late release disposed twice");
}

{
  const pool = createResourcePool();
  let oldDisposals = 0;
  let newDisposals = 0;
  const oldItem = resource(() => {
    oldDisposals += 1;
  });
  const newItem = resource(() => {
    newDisposals += 1;
  });
  pool.retain(oldItem);
  pool.dispose();
  const oldRelease = pool.retain(oldItem);
  const newRelease = pool.retain(newItem);
  oldRelease();
  newRelease();
  assert(oldDisposals === 1 && newDisposals === 1, "closed-pool retention did not clean up once");
}

{
  const pool = createResourcePool();
  let firstDisposals = 0;
  let secondDisposals = 0;
  const first = resource(() => {
    firstDisposals += 1;
    pool.retain(first);
  });
  const second = resource(() => {
    secondDisposals += 1;
  });
  pool.retain(first);
  pool.retain(second);
  pool.dispose();
  assert(firstDisposals === 1 && secondDisposals === 1, "reentrant disposer resurrected a resource");
}

{
  const pool = createResourcePool();
  const firstError = new Error("first");
  let firstDisposals = 0;
  let secondDisposals = 0;
  const first = resource(() => {
    firstDisposals += 1;
    throw firstError;
  });
  const second = resource(() => {
    secondDisposals += 1;
  });
  const release = pool.retain(first);
  pool.retain(first);
  pool.retain(second);
  release();
  assert(firstDisposals === 0, "shared throwing resource disposed before final release");
  let aggregate: unknown;
  try {
    pool.dispose();
  } catch (error) {
    aggregate = error;
  }
  assert(aggregate instanceof AggregateError, "pool disposal errors were not aggregated");
  assert(firstDisposals === 1 && secondDisposals === 1, "pool did not clean all unique resources");
  pool.dispose();
}

console.log("scene resource tests passed");
