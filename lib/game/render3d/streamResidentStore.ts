import type { CellId } from './cityIndex';

export interface StreamResident<K extends string = CellId> {
  readonly id: K;
  attach(): void;
  dispose(): void;
}

export interface StreamResidentStore<T extends StreamResident<K>, K extends string = CellId> {
  beginGeneration(): number;
  currentGeneration(): number;
  publish(generation: number, resident: T): boolean;
  get(id: K): T | undefined;
  ids(): readonly K[];
  evict(ids: Iterable<K>): void;
  evictOutside(retain: ReadonlySet<K>): void;
  dispose(): void;
}

function disposeAll<T extends StreamResident<string>>(residents: Iterable<T>, message: string): void {
  const errors: unknown[] = [];
  for (const resident of residents) {
    try {
      resident.dispose();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, message);
}

export function createStreamResidentStore<
  T extends StreamResident<K>,
  K extends string = CellId,
>(): StreamResidentStore<T, K> {
  const residents = new Map<K, T>();
  let generation = 0;
  let closed = false;

  return {
    beginGeneration() {
      if (closed) throw new Error('stream resident store is disposed');
      generation += 1;
      return generation;
    },
    currentGeneration: () => generation,
    publish(candidateGeneration, resident) {
      if (closed || candidateGeneration !== generation) {
        resident.dispose();
        return false;
      }
      const previous = residents.get(resident.id);
      if (previous === resident) return true;
      try {
        resident.attach();
      } catch (error) {
        try {
          resident.dispose();
        } catch (cleanup) {
          throw new AggregateError(
            [error, cleanup],
            `Failed to attach and dispose stream cell ${resident.id}`,
          );
        }
        throw error;
      }
      if (closed || candidateGeneration !== generation || residents.get(resident.id) !== previous) {
        resident.dispose();
        return false;
      }
      residents.set(resident.id, resident);
      if (previous) previous.dispose();
      return true;
    },
    get: (id) => residents.get(id),
    ids: () => Object.freeze([...residents.keys()]),
    evict(ids) {
      const evicted: T[] = [];
      for (const id of ids) {
        const resident = residents.get(id);
        if (!resident) continue;
        residents.delete(id);
        evicted.push(resident);
      }
      disposeAll(evicted, 'Failed to dispose evicted stream cells');
    },
    evictOutside(retain) {
      const evicted: T[] = [];
      for (const [id, resident] of residents) {
        if (retain.has(id)) continue;
        residents.delete(id);
        evicted.push(resident);
      }
      disposeAll(evicted, 'Failed to dispose evicted stream cells');
    },
    dispose() {
      if (closed) return;
      closed = true;
      const live = [...residents.values()];
      residents.clear();
      disposeAll(live, 'Failed to dispose stream cells');
    },
  };
}
