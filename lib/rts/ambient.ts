import { HUBS } from '@/lib/game/content';
import { project } from '@/lib/game/geo';
import { nextFloat, seedFromString } from '@/lib/game/rng';
import { PLACE_AT, TRAVEL_SPEED } from './content';
import { streetPath } from './walk';
import graph from './walkGraph.json';

const COMMUTER_COUNT = 650;
const ROUTE_COUNT = 240;
const HUB_RADIUS_SQUARED = 20 * 20;
const ANCHOR_RADIUS_SQUARED = 6 * 6;
const WALK_SPEED = TRAVEL_SPEED * 1.5;
const hubCenters = HUBS.map((hub) => ({
  point: project([hub.lng, hub.lat]),
}));
const anchorPoints = [
  ...Object.values(PLACE_AT).map((point) => project(point)),
  ...hubCenters.map(({ point }) => point),
];
const visibleNodeGroups = anchorPoints.map(() => [] as number[]);
const hubNodes: number[] = [];
for (let node = 0; node < graph.nodes.length / 2; node++) {
  const x = graph.nodes[node * 2]!;
  const y = graph.nodes[node * 2 + 1]!;
  if (
    hubCenters.some(
      ({ point }) => (x - point.x) ** 2 + (y - point.y) ** 2 <= HUB_RADIUS_SQUARED,
    )
  )
    hubNodes.push(node);
  for (let anchor = 0; anchor < anchorPoints.length; anchor++) {
    const point = anchorPoints[anchor]!;
    if ((x - point.x) ** 2 + (y - point.y) ** 2 <= ANCHOR_RADIUS_SQUARED)
      visibleNodeGroups[anchor]!.push(node);
  }
}
const visibleAnchors = visibleNodeGroups.filter((nodes) => nodes.length > 0);

export interface AmbientRoute {
  path: number[];
  cumulative: number[];
  length: number;
}

export interface AmbientCommuter {
  routeIndex: number;
  stride: number;
  distance: number;
  x: number;
  y: number;
  cyclist: boolean;
}

interface RandomState {
  rng: number;
}

export interface AmbientState {
  rng: number;
  routes: AmbientRoute[];
  commuters: AmbientCommuter[];
}

function random(state: RandomState): number {
  const next = nextFloat(state.rng);
  state.rng = next.state;
  return next.value;
}

function pointForNode(node: number): { x: number; y: number } {
  return { x: graph.nodes[node * 2]!, y: graph.nodes[node * 2 + 1]! };
}

function pickEndpointNode(state: RandomState): number {
  const candidates =
    random(state) < 0.7
      ? visibleAnchors[Math.floor(random(state) * visibleAnchors.length)]!
      : hubNodes;
  return candidates[Math.floor(random(state) * candidates.length)]!;
}

function routeLengths(path: number[]): number[] {
  const cumulative = [0];
  for (let i = 2; i < path.length; i += 2)
    cumulative.push(
      cumulative[cumulative.length - 1]! +
        Math.hypot(path[i]! - path[i - 2]!, path[i + 1]! - path[i - 1]!),
    );
  return cumulative;
}

function buildRoutePool(): AmbientRoute[] {
  const state = { rng: seedFromString('london-live-ambient-routes-v1') };
  const routes: AmbientRoute[] = [];
  while (routes.length < ROUTE_COUNT) {
    const startNode = pickEndpointNode(state);
    let endNode = pickEndpointNode(state);
    for (let tries = 0; tries < 16 && endNode === startNode; tries++)
      endNode = pickEndpointNode(state);
    if (endNode === startNode) continue;
    const start = pointForNode(startNode);
    const end = pointForNode(endNode);
    const path = streetPath(start.x, start.y, end.x, end.y);
    const cumulative = routeLengths(path);
    const length = cumulative[cumulative.length - 1]!;
    if (length > 1e-9) routes.push({ path, cumulative, length });
  }
  return routes;
}

let cachedRoutePool: AmbientRoute[] | null = null;

function getRoutePool(): AmbientRoute[] {
  if (!cachedRoutePool) cachedRoutePool = buildRoutePool();
  return cachedRoutePool;
}

function setPosition(route: AmbientRoute, commuter: AmbientCommuter): void {
  if (commuter.distance >= route.length) {
    commuter.x = route.path[route.path.length - 2]!;
    commuter.y = route.path[route.path.length - 1]!;
    return;
  }
  let low = 0;
  let high = route.cumulative.length - 2;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (route.cumulative[middle + 1]! < commuter.distance) low = middle + 1;
    else high = middle;
  }
  const startOffset = low * 2;
  const startDistance = route.cumulative[low]!;
  const endDistance = route.cumulative[low + 1]!;
  const amount =
    endDistance > startDistance
      ? (commuter.distance - startDistance) / (endDistance - startDistance)
      : 0;
  commuter.x =
    route.path[startOffset]! +
    (route.path[startOffset + 2]! - route.path[startOffset]!) * amount;
  commuter.y =
    route.path[startOffset + 1]! +
    (route.path[startOffset + 3]! - route.path[startOffset + 1]!) * amount;
}

export function createAmbient(seed = 'london-live-commuters-v1'): AmbientState {
  const state: AmbientState = {
    rng: seedFromString(seed),
    routes: getRoutePool(),
    commuters: [],
  };
  for (let index = 0; index < COMMUTER_COUNT; index++) {
    const routeIndex = Math.floor(random(state) * state.routes.length);
    const route = state.routes[routeIndex]!;
    const commuter: AmbientCommuter = {
      routeIndex,
      stride: 1 + Math.floor(random(state) * (state.routes.length - 1)),
      distance: random(state) * route.length,
      x: 0,
      y: 0,
      cyclist: random(state) < 0.15,
    };
    setPosition(route, commuter);
    state.commuters.push(commuter);
  }
  return state;
}

export function advanceAmbient(state: AmbientState, gameDays: number): void {
  if (!Number.isFinite(gameDays) || gameDays <= 0) return;
  for (const commuter of state.commuters) {
    let remaining = gameDays * WALK_SPEED;
    while (remaining > 1e-9) {
      const route = state.routes[commuter.routeIndex]!;
      const routeRemaining = route.length - commuter.distance;
      const moved = Math.min(remaining, routeRemaining);
      commuter.distance += moved;
      remaining -= moved;
      if (commuter.distance >= route.length - 1e-9) {
        commuter.routeIndex = (commuter.routeIndex + commuter.stride) % state.routes.length;
        commuter.distance = 0;
      }
    }
    setPosition(state.routes[commuter.routeIndex]!, commuter);
  }
}
