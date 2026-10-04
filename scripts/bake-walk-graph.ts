import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HUBS } from '../lib/game/content';
import { project } from '../lib/game/geo';
import { decodeCity, dequantizeX, dequantizeY } from '../lib/game/render3d/format';
import { LEAD_VENUES, PLACE_AT } from '../lib/rts/content';

const GRID = 0.12;
const SIMPLIFY_TOLERANCE = 0.04;
const TIER_2_RADIUS = 11;
const MAX_FILE_BYTES = 2_000_000;

interface Vertex {
  gx: number;
  gy: number;
}

const keyOf = (point: Vertex) => `${point.gx},${point.gy}`;
const worldX = (point: Vertex) => point.gx * GRID;
const worldY = (point: Vertex) => point.gy * GRID;

function distanceToSegment(point: Vertex, a: Vertex, b: Vertex): number {
  const px = worldX(point);
  const py = worldY(point);
  const ax = worldX(a);
  const ay = worldY(a);
  const dx = worldX(b) - ax;
  const dy = worldY(b) - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function simplifyRange(points: Vertex[], start: number, end: number, kept: Set<number>): void {
  let farthest = -1;
  let maxDistance = SIMPLIFY_TOLERANCE;
  for (let i = start + 1; i < end; i++) {
    const distance = distanceToSegment(points[i]!, points[start]!, points[end]!);
    if (distance > maxDistance) {
      maxDistance = distance;
      farthest = i;
    }
  }
  if (farthest < 0) return;
  kept.add(farthest);
  simplifyRange(points, start, farthest, kept);
  simplifyRange(points, farthest, end, kept);
}

function simplifyRoad(points: Vertex[], shared: Set<string>): Vertex[] {
  if (points.length <= 2) return points;
  const anchors = [0];
  for (let i = 1; i < points.length - 1; i++) {
    if (shared.has(keyOf(points[i]!))) anchors.push(i);
  }
  anchors.push(points.length - 1);

  const kept = new Set(anchors);
  for (let i = 1; i < anchors.length; i++) {
    simplifyRange(points, anchors[i - 1]!, anchors[i]!, kept);
  }
  return [...kept]
    .sort((a, b) => a - b)
    .map((index) => points[index]!);
}

function distanceSquared(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

async function main() {
  const encoded = await readFile(resolve('public/map/london-city.bin'));
  const arrayBuffer = encoded.buffer.slice(
    encoded.byteOffset,
    encoded.byteOffset + encoded.byteLength,
  ) as ArrayBuffer;
  const city = decodeCity(arrayBuffer);
  const anchors = [
    ...HUBS.map((hub) => project([hub.lng, hub.lat])),
    ...Object.values(PLACE_AT).map(project),
    ...LEAD_VENUES.map((venue) => project(venue.at)),
  ];
  const radiusSquared = TIER_2_RADIUS ** 2;

  const roads: Vertex[][] = [];
  for (const road of city.roads) {
    if (road.tier > 2) continue;
    const worldPoints: { x: number; y: number }[] = [];
    for (let i = 0; i < road.pts.length; i += 2) {
      worldPoints.push({
        x: dequantizeX(road.pts[i]!),
        y: dequantizeY(road.pts[i + 1]!),
      });
    }
    if (
      road.tier === 2 &&
      !worldPoints.some((point) => anchors.some((anchor) => distanceSquared(point, anchor) <= radiusSquared))
    ) {
      continue;
    }
    const points: Vertex[] = [];
    for (const { x, y } of worldPoints) {
      const point = { gx: Math.round(x / GRID), gy: Math.round(y / GRID) };
      if (points.length === 0 || keyOf(points.at(-1)!) !== keyOf(point)) points.push(point);
    }
    if (points.length >= 2) roads.push(points);
  }

  const roadUsers = new Map<string, Set<number>>();
  roads.forEach((road, roadIndex) => {
    for (const key of new Set(road.map(keyOf))) {
      let users = roadUsers.get(key);
      if (!users) roadUsers.set(key, (users = new Set()));
      users.add(roadIndex);
    }
  });
  const shared = new Set([...roadUsers].filter(([, users]) => users.size > 1).map(([key]) => key));

  const nodes: Vertex[] = [];
  const nodeIndex = new Map<string, number>();
  const edges = new Set<string>();
  const addNode = (point: Vertex): number => {
    const key = keyOf(point);
    const previous = nodeIndex.get(key);
    if (previous !== undefined) return previous;
    const index = nodes.length;
    nodes.push(point);
    nodeIndex.set(key, index);
    return index;
  };

  for (const road of roads) {
    const simplified = simplifyRoad(road, shared);
    for (let i = 1; i < simplified.length; i++) {
      const a = addNode(simplified[i - 1]!);
      const b = addNode(simplified[i]!);
      if (a === b) continue;
      edges.add(a < b ? `${a},${b}` : `${b},${a}`);
    }
  }

  const adjacency = Array.from({ length: nodes.length }, () => [] as number[]);
  for (const edge of edges) {
    const [a, b] = edge.split(',').map(Number) as [number, number];
    adjacency[a]!.push(b);
    adjacency[b]!.push(a);
  }

  const visited = new Uint8Array(nodes.length);
  let largestComponent: number[] = [];
  for (let start = 0; start < nodes.length; start++) {
    if (visited[start]) continue;
    const component: number[] = [];
    const queue = [start];
    visited[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]!;
      component.push(current);
      for (const next of adjacency[current]!) {
        if (visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    if (component.length > largestComponent.length) largestComponent = component;
  }

  const inLargest = new Uint8Array(nodes.length);
  for (const index of largestComponent) inLargest[index] = 1;
  const remap = new Int32Array(nodes.length);
  remap.fill(-1);
  const outputNodes: number[] = [];
  for (let index = 0; index < nodes.length; index++) {
    if (!inLargest[index]) continue;
    remap[index] = outputNodes.length / 2;
    outputNodes.push(
      Math.round(worldX(nodes[index]!) * 1000) / 1000,
      Math.round(worldY(nodes[index]!) * 1000) / 1000,
    );
  }

  const outputEdges: number[] = [];
  const sortedEdges = [...edges]
    .map((edge) => edge.split(',').map(Number) as [number, number])
    .filter(([a, b]) => inLargest[a] && inLargest[b])
    .map(([a, b]) => {
      const x = remap[a]!;
      const y = remap[b]!;
      return x < y ? [x, y] : [y, x];
    })
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);
  for (const [a, b] of sortedEdges) outputEdges.push(a!, b!);

  const graph = { v: 1, nodes: outputNodes, edges: outputEdges };
  const json = `${JSON.stringify(graph)}\n`;
  const fileSize = Buffer.byteLength(json, 'utf8');
  console.log(
    `Walk graph: ${outputNodes.length / 2} nodes, ${outputEdges.length / 2} edges, ${fileSize} bytes (${(fileSize / 1_000_000).toFixed(3)} MB)`,
  );
  if (fileSize > MAX_FILE_BYTES) {
    throw new Error(`walkGraph.json exceeds 2 MB (${fileSize} bytes); not written as requested`);
  }
  await writeFile(resolve('lib/rts/walkGraph.json'), json);
}

void main();
