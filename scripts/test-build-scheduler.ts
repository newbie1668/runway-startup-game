import assert from 'node:assert/strict';
import { createBuildScheduler, type BuildJob } from '../lib/game/render3d/buildScheduler';
let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}
function clock(): { now: () => number; advance: (ms: number) => void } {
  let time = 0;
  return {
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
  };
}
function job(
  id: string,
  generation: number,
  steps: number,
  c: ReturnType<typeof clock>,
  log: string[],
  essential = false,
): BuildJob {
  let left = steps;
  return {
    id,
    generation,
    essential,
    step: () => {
      log.push(id);
      c.advance(3);
      return --left === 0;
    },
    cancel: () => {
      log.push(`cancel:${id}`);
    },
  };
}
console.log('Build scheduler');
check('FIFO priority and budget', () => {
  const c = clock();
  const log: string[] = [];
  const s = createBuildScheduler();
  s.enqueue(job('a', 1, 1, c, log, true));
  s.enqueue(job('b', 1, 1, c, log));
  s.enqueue(job('c', 1, 1, c, log));
  const r = s.drain(4, c.now);
  assert.deepEqual(log, ['a', 'b']);
  assert.deepEqual(r.completed, ['a', 'b']);
  assert.equal(r.pending, 1);
  assert.deepEqual(s.drain(4, c.now).completed, ['c']);
});
check('multistep and constant clock bounded', () => {
  const c = clock();
  const s = createBuildScheduler();
  s.enqueue(job('multi', 1, 2, c, [], false));
  assert.deepEqual(s.drain(4, c.now).completed, ['multi']);
  const stuck = createBuildScheduler();
  let calls = 0;
  stuck.enqueue({
    id: 'stuck',
    generation: 1,
    essential: false,
    step: () => {
      calls += 1;
      return false;
    },
    cancel() {},
  });
  assert.equal(stuck.drain(4, () => 0).pending, 1);
  assert.equal(calls, 1);
});
check('keeps an incomplete head ahead of later jobs across drains', () => {
  const c = clock();
  const log: string[] = [];
  const s = createBuildScheduler();
  s.enqueue(job('head', 1, 3, c, log));
  s.enqueue(job('follower', 1, 1, c, log));
  assert.deepEqual(s.drain(3, c.now).completed, []);
  assert.deepEqual(log, ['head']);
  assert.deepEqual(s.drain(3, c.now).completed, []);
  assert.deepEqual(log, ['head', 'head']);
  assert.deepEqual(s.drain(3, c.now).completed, ['head']);
  assert.deepEqual(s.drain(3, c.now).completed, ['follower']);
});
check('constant clocks still drain multiple completed jobs', () => {
  const s = createBuildScheduler();
  const log: string[] = [];
  s.enqueue({
    id: 'first',
    generation: 1,
    essential: false,
    step: () => {
      log.push('first');
      return true;
    },
    cancel() {},
  });
  s.enqueue({
    id: 'second',
    generation: 1,
    essential: false,
    step: () => {
      log.push('second');
      return true;
    },
    cancel() {},
  });
  assert.deepEqual(s.drain(4, () => 0).completed, ['first', 'second']);
  assert.deepEqual(log, ['first', 'second']);
});
check('reports failures and cleanup errors while continuing', () => {
  const c = clock();
  const cleanups: string[] = [];
  const s = createBuildScheduler();
  const bad = (id: string, essential: boolean, throws = false): BuildJob => ({
    id,
    generation: 1,
    essential,
    step: () => {
      c.advance(1);
      throw new Error(id);
    },
    cancel: () => {
      cleanups.push(id);
      if (throws) throw new Error(`cleanup:${id}`);
    },
  });
  s.enqueue(bad('optional', false));
  s.enqueue(bad('essential', true, true));
  s.enqueue(job('survivor', 1, 1, c, cleanups));
  const r = s.drain(20, c.now);
  assert.deepEqual(
    r.failed.map((x) => [x.id, x.essential]),
    [
      ['optional', false],
      ['essential', true],
    ],
  );
  assert(r.failed[1]!.error instanceof AggregateError);
  assert.deepEqual(r.completed, ['survivor']);
  assert.deepEqual(cleanups.slice(0, 2), ['optional', 'essential']);
});
check('obsolete cancellation and late jobs', () => {
  const s = createBuildScheduler();
  const cleaned: string[] = [];
  const make = (id: string, generation: number, throws = false): BuildJob => ({
    id,
    generation,
    essential: false,
    step: () => true,
    cancel: () => {
      cleaned.push(id);
      if (throws) throw new Error(id);
    },
  });
  s.enqueue(make('old-a', 7));
  s.enqueue(make('old-b', 7, true));
  s.enqueue(make('new', 8));
  assert.throws(() => s.cancelGeneration(7), AggregateError);
  assert.deepEqual(cleaned, ['old-a', 'old-b']);
  assert.throws(() => s.enqueue(make('late', 7, true)), /late/);
  assert.deepEqual(s.drain(1, () => 0).completed, ['new']);
});
check('duplicate, reuse, and zero budget', () => {
  const s = createBuildScheduler();
  const make = (id: string): BuildJob => ({
    id,
    generation: 1,
    essential: false,
    step: () => true,
    cancel() {},
  });
  s.enqueue(make('same'));
  assert.throws(() => s.enqueue(make('same')), /Duplicate/);
  assert.deepEqual(
    s.drain(0, () => 0),
    { completed: [], failed: [], pending: 1 },
  );
  assert.deepEqual(
    s.drain(1, () => 0),
    { completed: ['same'], failed: [], pending: 0 },
  );
  s.enqueue(make('same'));
});
check('reentrant drain and cancellation from step', () => {
  const s = createBuildScheduler();
  let nested: unknown;
  let canceled = 0;
  s.enqueue({
    id: 'active',
    generation: 3,
    essential: true,
    step: () => {
      try {
        s.drain(1, () => 0);
      } catch (error) {
        nested = error;
      }
      s.cancelGeneration(3);
      return true;
    },
    cancel: () => {
      canceled += 1;
    },
  });
  const r = s.drain(1, () => 0);
  assert(nested instanceof Error);
  assert.equal(canceled, 1);
  assert.deepEqual(r.completed, []);
  assert.equal(r.pending, 0);
});
check('slow overrun prevents next start', () => {
  const c = clock();
  const log: string[] = [];
  const s = createBuildScheduler();
  s.enqueue(job('slow', 1, 1, c, log));
  s.enqueue(job('next', 1, 1, c, log));
  assert.deepEqual(s.drain(2, c.now).completed, ['slow']);
  assert.equal(s.drain(2, c.now).pending, 0);
  assert.deepEqual(log, ['slow', 'next']);
});
console.log(`Passed ${passed} scheduler checks.`);
