import graph from './walkGraph.json';

const CELL_SIZE = 2;
const MAX_ROUTE_CACHE = 20_000;

type HeapEntry = { node: number; cost: number; distance: number };

const nodes = graph.nodes;
const nodeCount = nodes.length / 2;
const adjacency: { node: number; weight: number }[][] = Array.from(
  { length: nodeCount },
  () => [],
);
const spatialIndex = new Map<string, number[]>();
const routeCache = new Map<string, number[] | null>();
const distances = new Float64Array(nodeCount);
const previous = new Int32Array(nodeCount);
const seenAt = new Uint32Array(nodeCount);
const closedAt = new Uint32Array(nodeCount);
const heap: HeapEntry[] = [];
let searchId = 0;

const cellKey = (x: number, y: number) => `${x},${y}`;
const nodeX = (node: number) => nodes[node * 2]!;
const nodeY = (node: number) => nodes[node * 2 + 1]!;
const heuristic = (a: number, b: number) => Math.hypot(nodeX(a) - nodeX(b), nodeY(a) - nodeY(b));

for (let i = 0; i < graph.edges.length; i += 2) {
  const a = graph.edges[i]!;
  const b = graph.edges[i + 1]!;
  const weight = heuristic(a, b);
  adjacency[a]!.push({ node: b, weight });
  adjacency[b]!.push({ node: a, weight });
}

for (let node = 0; node < nodeCount; node++) {
  const x = Math.floor(nodeX(node) / CELL_SIZE);
  const y = Math.floor(nodeY(node) / CELL_SIZE);
  const key = cellKey(x, y);
  const cell = spatialIndex.get(key) ?? [];
  cell.push(node);
  spatialIndex.set(key, cell);
}

function entryBefore(a: HeapEntry, b: HeapEntry): boolean {
  return (
    a.cost < b.cost ||
    (a.cost === b.cost &&
      (a.distance < b.distance || (a.distance === b.distance && a.node < b.node)))
  );
}

function push(heap: HeapEntry[], entry: HeapEntry): void {
  let index = heap.length;
  heap.push(entry);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (!entryBefore(heap[index]!, heap[parent]!)) break;
    [heap[index], heap[parent]] = [heap[parent]!, heap[index]!];
    index = parent;
  }
}

function pop(heap: HeapEntry[]): HeapEntry | undefined {
  const first = heap[0];
  const last = heap.pop();
  if (!first || !last || heap.length === 0) return first;
  heap[0] = last;
  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (left < heap.length && entryBefore(heap[left]!, heap[smallest]!)) smallest = left;
    if (right < heap.length && entryBefore(heap[right]!, heap[smallest]!)) smallest = right;
    if (smallest === index) break;
    [heap[index], heap[smallest]] = [heap[smallest]!, heap[index]!];
    index = smallest;
  }
  return first;
}

function nodePath(start: number, end: number): number[] | null {
  const key = `${start}:${end}`;
  if (routeCache.has(key)) return routeCache.get(key)!;

  if (searchId === 0xffff_ffff) {
    seenAt.fill(0);
    closedAt.fill(0);
    searchId = 1;
  } else {
    searchId += 1;
  }
  const currentSearch = searchId;
  heap.length = 0;
  seenAt[start] = currentSearch;
  distances[start] = 0;
  push(heap, { node: start, distance: 0, cost: heuristic(start, end) });

  while (heap.length > 0) {
    const current = pop(heap)!;
    if (
      seenAt[current.node] !== currentSearch ||
      closedAt[current.node] === currentSearch ||
      current.distance !== distances[current.node]
    )
      continue;
    if (current.node === end) break;
    closedAt[current.node] = currentSearch;

    for (const edge of adjacency[current.node]!) {
      if (closedAt[edge.node] === currentSearch) continue;
      const nextDistance = current.distance + edge.weight;
      if (
        seenAt[edge.node] === currentSearch &&
        nextDistance >= distances[edge.node]!
      )
        continue;
      seenAt[edge.node] = currentSearch;
      distances[edge.node] = nextDistance;
      previous[edge.node] = current.node;
      push(heap, {
        node: edge.node,
        distance: nextDistance,
        cost: nextDistance + heuristic(edge.node, end),
      });
    }
  }

  let path: number[] | null = null;
  if (seenAt[end] === currentSearch && Number.isFinite(distances[end]!)) {
    path = [];
    for (let current = end; current >= 0; current = previous[current]!) {
      path.push(current);
      if (current === start) break;
    }
    path.reverse();
  }
  if (routeCache.size >= MAX_ROUTE_CACHE) routeCache.clear();
  routeCache.set(key, path);
  return path;
}

export function nearestNode(x: number, y: number): number {
  if (nodeCount === 0) return -1;
  const centerX = Math.floor(x / CELL_SIZE);
  const centerY = Math.floor(y / CELL_SIZE);
  let bestNode = -1;
  let bestDistanceSquared = Infinity;

  for (let radius = 0; ; radius++) {
    if (radius === 0) {
      for (const node of spatialIndex.get(cellKey(centerX, centerY)) ?? []) {
        const distanceSquared = (nodeX(node) - x) ** 2 + (nodeY(node) - y) ** 2;
        if (distanceSquared < bestDistanceSquared || (distanceSquared === bestDistanceSquared && node < bestNode)) {
          bestDistanceSquared = distanceSquared;
          bestNode = node;
        }
      }
    } else {
      for (let dx = -radius; dx <= radius; dx++) {
        for (const dy of [-radius, radius]) {
          for (const node of spatialIndex.get(cellKey(centerX + dx, centerY + dy)) ?? []) {
            const distanceSquared = (nodeX(node) - x) ** 2 + (nodeY(node) - y) ** 2;
            if (
              distanceSquared < bestDistanceSquared ||
              (distanceSquared === bestDistanceSquared && node < bestNode)
            ) {
              bestDistanceSquared = distanceSquared;
              bestNode = node;
            }
          }
        }
      }
      for (let dy = -radius + 1; dy < radius; dy++) {
        for (const dx of [-radius, radius]) {
          for (const node of spatialIndex.get(cellKey(centerX + dx, centerY + dy)) ?? []) {
            const distanceSquared = (nodeX(node) - x) ** 2 + (nodeY(node) - y) ** 2;
            if (
              distanceSquared < bestDistanceSquared ||
              (distanceSquared === bestDistanceSquared && node < bestNode)
            ) {
              bestDistanceSquared = distanceSquared;
              bestNode = node;
            }
          }
        }
      }
    }

    if (bestNode >= 0) {
      const left = (centerX - radius) * CELL_SIZE;
      const right = (centerX + radius + 1) * CELL_SIZE;
      const top = (centerY - radius) * CELL_SIZE;
      const bottom = (centerY + radius + 1) * CELL_SIZE;
      const outsideDistance = Math.min(x - left, right - x, y - top, bottom - y);
      if (bestDistanceSquared < outsideDistance * outsideDistance) return bestNode;
    }
  }
}

export function streetPath(x0: number, y0: number, x1: number, y1: number): number[] {
  const start = nearestNode(x0, y0);
  const end = nearestNode(x1, y1);
  if (start < 0 || end < 0) return [x0, y0, x1, y1];
  if (
    (nodeX(start) - x0) ** 2 + (nodeY(start) - y0) ** 2 > 9 ||
    (nodeX(end) - x1) ** 2 + (nodeY(end) - y1) ** 2 > 9 ||
    start === end
  ) {
    return [x0, y0, x1, y1];
  }

  const route = nodePath(start, end);
  if (!route) return [x0, y0, x1, y1];
  const path = [x0, y0];
  for (const node of route) path.push(nodeX(node), nodeY(node));
  path.push(x1, y1);
  return path;
}

export function polylineLength(path: number[]): number {
  let length = 0;
  for (let i = 2; i < path.length; i += 2) {
    length += Math.hypot(path[i]! - path[i - 2]!, path[i + 1]! - path[i - 1]!);
  }
  return length;
}
