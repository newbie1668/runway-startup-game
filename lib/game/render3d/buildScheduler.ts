export interface BuildJob {
  id: string;
  generation: number;
  essential: boolean;
  step(): boolean;
  cancel(): void;
}

export interface DrainResult {
  completed: string[];
  failed: { id: string; essential: boolean; error: unknown }[];
  pending: number;
}

export interface BuildScheduler {
  enqueue(job: BuildJob): void;
  cancelGeneration(generation: number): void;
  drain(budgetMs: number, now: () => number): DrainResult;
}

function aggregateErrors(errors: unknown[], message: string): AggregateError {
  return new AggregateError(errors, message);
}

export function createBuildScheduler(): BuildScheduler {
  const queue: BuildJob[] = [];
  const pending = new Map<string, BuildJob>();
  const obsoleteGenerations = new Set<number>();
  const cancelled = new WeakSet<BuildJob>();
  let draining = false;
  const cancelOnce = (job: BuildJob): unknown => {
    if (cancelled.has(job)) return undefined;
    cancelled.add(job);
    try {
      job.cancel();
      return undefined;
    } catch (error) {
      return error;
    }
  };
  const remove = (job: BuildJob): void => {
    if (pending.get(job.id) === job) pending.delete(job.id);
    const index = queue.indexOf(job);
    if (index >= 0) queue.splice(index, 1);
  };
  const scheduler: BuildScheduler = {
    enqueue(job) {
      if (pending.has(job.id)) throw new Error(`Duplicate pending build job ID: ${job.id}`);
      if (obsoleteGenerations.has(job.generation)) {
        const error = cancelOnce(job);
        if (error !== undefined) throw error;
        return;
      }
      pending.set(job.id, job);
      queue.push(job);
    },
    cancelGeneration(generation) {
      obsoleteGenerations.add(generation);
      const jobs = [...pending.values()].filter((job) => job.generation === generation);
      const errors: unknown[] = [];
      for (const job of jobs) {
        remove(job);
        const error = cancelOnce(job);
        if (error !== undefined) errors.push(error);
      }
      if (errors.length > 0)
        throw aggregateErrors(errors, `Failed to cancel generation ${generation}`);
    },
    drain(budgetMs, now) {
      if (draining) throw new Error('Reentrant build scheduler drain is unsupported');
      if (!Number.isFinite(budgetMs) || budgetMs < 0)
        throw new RangeError('Drain budget must be a finite non-negative number');
      draining = true;
      try {
        const completed: string[] = [];
        const failed: DrainResult['failed'] = [];
        if (budgetMs === 0 || queue.length === 0)
          return { completed, failed, pending: pending.size };
        const startedAt = now();
        while (queue.length > 0) {
          const beforeStart = now();
          if (beforeStart - startedAt >= budgetMs) break;
          const job = queue.shift()!;
          let isComplete = false;
          let didThrow = false;
          let thrown: unknown;
          try {
            isComplete = job.step();
          } catch (error) {
            didThrow = true;
            thrown = error;
          }
          if (didThrow) {
            if (pending.get(job.id) === job) {
              remove(job);
              const cleanupError = cancelOnce(job);
              if (cleanupError !== undefined)
                thrown = aggregateErrors(
                  [thrown, cleanupError],
                  `Build job ${job.id} failed and cleanup failed`,
                );
            }
            failed.push({ id: job.id, essential: job.essential, error: thrown });
          } else if (pending.get(job.id) === job) {
            if (isComplete) {
              pending.delete(job.id);
              completed.push(job.id);
            } else queue.push(job);
          }
          const afterStep = now();
          if (afterStep <= beforeStart) break;
        }
        return { completed, failed, pending: pending.size };
      } finally {
        draining = false;
      }
    },
  };
  return scheduler;
}
