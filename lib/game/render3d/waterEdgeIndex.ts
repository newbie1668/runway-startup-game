import type { CoverSequence } from './coverSequence';

type Point = Readonly<{ x: number; z: number }>;

interface EdgeBounds {
  readonly minZ: number;
  readonly maxZ: number;
}

export type WaterEdgeIndex = EdgeBounds &
  (
    | {
        readonly kind: 'leaf';
        readonly start: number;
        readonly end: number;
        readonly points: CoverSequence<Point>;
      }
    | { readonly kind: 'branch'; readonly left: WaterEdgeIndex; readonly right: WaterEdgeIndex }
  );

export function* buildWaterEdgeIndex(
  points: CoverSequence<Point>,
  start = 0,
  end = points.length,
): Generator<void, WaterEdgeIndex> {
  if (end - start <= 4) {
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = start; i < end; i++) {
      const previous = i === 0 ? points.length - 1 : i - 1;
      minZ = Math.min(minZ, points.at(i)!.z, points.at(previous)!.z);
      maxZ = Math.max(maxZ, points.at(i)!.z, points.at(previous)!.z);
      yield;
    }
    return { kind: 'leaf', minZ, maxZ, start, end, points };
  }
  const middle = Math.floor((start + end) / 2);
  const left = yield* buildWaterEdgeIndex(points, start, middle);
  const right = yield* buildWaterEdgeIndex(points, middle, end);
  yield;
  return {
    kind: 'branch',
    minZ: Math.min(left.minZ, right.minZ),
    maxZ: Math.max(left.maxZ, right.maxZ),
    left,
    right,
  };
}

export function* indexedPointInRingSteps(
  x: number,
  z: number,
  index: WaterEdgeIndex,
): Generator<void, boolean> {
  let inside = false;
  const pending = [index];
  let units = 0;
  while (pending.length) {
    if (units === 16) {
      yield;
      units = 0;
    }
    const node = pending.pop()!;
    units++;
    if (z < node.minZ || z >= node.maxZ) continue;
    if (node.kind === 'branch') {
      pending.push(node.right, node.left);
      continue;
    }
    const points = node.points;
    for (let i = node.start; i < node.end; i++) {
      const j = i === 0 ? points.length - 1 : i - 1;
      const a = points.at(i)!;
      const b = points.at(j)!;
      const xi = a.x;
      const zi = a.z;
      const xj = b.x;
      const zj = b.z;
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi)
        inside = !inside;
    }
  }
  return inside;
}
