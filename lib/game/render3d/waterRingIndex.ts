import { METERS_TO_WORLD } from '../geo';
import type { WaterSourceRing } from './waterQuery';

interface RingPage {
  readonly rings: WaterSourceRing[];
  next: RingPage | null;
}

interface RingBucket {
  readonly first: RingPage;
  last: RingPage;
}

export interface WaterRingIndex {
  readonly cells: ReadonlyMap<string, RingBucket>;
  readonly fallback: RingBucket;
}

const CELL_WORLD = 400 * METERS_TO_WORLD;

function bucket(): RingBucket {
  const first: RingPage = { rings: [], next: null };
  return { first, last: first };
}

function append(bucket: RingBucket, ring: WaterSourceRing): void {
  if (bucket.last.rings.length === 64) {
    const next: RingPage = { rings: [], next: null };
    bucket.last.next = next;
    bucket.last = next;
  }
  bucket.last.rings.push(ring);
}

export function* buildWaterRingIndex(
  rings: readonly WaterSourceRing[],
): Generator<void, WaterRingIndex> {
  const cells = new Map<string, RingBucket>();
  const fallback = bucket();
  for (const ring of rings) {
    yield;
    const minX = Math.floor(ring.minX / CELL_WORLD);
    const maxX = Math.floor(ring.maxX / CELL_WORLD);
    const minZ = Math.floor(ring.minZ / CELL_WORLD);
    const maxZ = Math.floor(ring.maxZ / CELL_WORLD);
    if (
      ![minX, maxX, minZ, maxZ].every(Number.isSafeInteger) ||
      (maxX - minX + 1) * (maxZ - minZ + 1) > 4096
    ) {
      append(fallback, ring);
      continue;
    }
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const key = `${x}:${z}`;
        let cell = cells.get(key);
        if (!cell) {
          cell = bucket();
          cells.set(key, cell);
        }
        append(cell, ring);
        yield;
      }
    }
  }
  return { cells, fallback };
}

export function* waterRingsAt(
  index: WaterRingIndex,
  x: number,
  z: number,
): Generator<WaterSourceRing> {
  const cell = index.cells.get(`${Math.floor(x / CELL_WORLD)}:${Math.floor(z / CELL_WORLD)}`);
  for (const bucket of [cell, index.fallback]) {
    let page = bucket?.first;
    while (page) {
      yield* page.rings;
      page = page.next ?? undefined;
    }
  }
}
