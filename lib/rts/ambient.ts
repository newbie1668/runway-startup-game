import { HUBS } from '@/lib/game/content';
import { project } from '@/lib/game/geo';
import { nextFloat, seedFromString } from '@/lib/game/rng';
import { PLACE_AT, TRAVEL_SPEED } from './content';
import { polylineLength, streetPath } from './walk';
import graph from './walkGraph.json';

const COMMUTER_COUNT = 650;
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
const endpointNodes = [...new Set([...hubNodes, ...visibleAnchors.flat()])];

export interface AmbientCommuter {
  path: number[];
  cumulative: number[];
  length: number;
  distance: number;
  segment: number;
  x: number;
  y: number;
  cyclist: boolean;
}

export interface AmbientState {
  rng: number;
  commuters: AmbientCommuter[];
}

function random(state: AmbientState): number {
  const next = nextFloat(state.rng);
  state.rng = next.state;
  return next.value;
}

function pointForNode(node: number): { x: number; y: number } {
  return { x: graph.nodes[node * 2]!, y: graph.nodes[node * 2 + 1]! };
}

function pickEndpointNode(state: AmbientState): number {
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

function setPosition(commuter: AmbientCommuter): void {
  if (commuter.distance >= commuter.length) {
    commuter.x = commuter.path[commuter.path.length - 2]!;
    commuter.y = commuter.path[commuter.path.length - 1]!;
    commuter.segment = Math.max(0, commuter.cumulative.length - 2);
    return;
  }
  while (
    commuter.segment < commuter.cumulative.length - 2 &&
    commuter.cumulative[commuter.segment + 1]! < commuter.distance
  )
    commuter.segment += 1;
  const startOffset = commuter.segment * 2;
  const startDistance = commuter.cumulative[commuter.segment]!;
  const endDistance = commuter.cumulative[commuter.segment + 1]!;
  const amount =
    endDistance > startDistance
      ? (commuter.distance - startDistance) / (endDistance - startDistance)
      : 0;
  commuter.x =
    commuter.path[startOffset]! +
    (commuter.path[startOffset + 2]! - commuter.path[startOffset]!) * amount;
  commuter.y =
    commuter.path[startOffset + 1]! +
    (commuter.path[startOffset + 3]! - commuter.path[startOffset + 1]!) * amount;
}

function setRoute(state: AmbientState, commuter: AmbientCommuter): void {
  const startX = commuter.x;
  const startY = commuter.y;
  const isTooClose = (node: number) => {
    const point = pointForNode(node);
    return (point.x - startX) ** 2 + (point.y - startY) ** 2 < 0.01;
  };
  let endNode = pickEndpointNode(state);
  for (let tries = 0; tries < 16 && isTooClose(endNode); tries++)
    endNode = pickEndpointNode(state);
  if (isTooClose(endNode)) {
    const alternatives = endpointNodes.filter((node) => !isTooClose(node));
    if (alternatives.length > 0)
      endNode = alternatives[Math.floor(random(state) * alternatives.length)]!;
  }
  const end = pointForNode(endNode);
  const path = streetPath(startX, startY, end.x, end.y);
  const length = polylineLength(path);
  commuter.path = path;
  commuter.cumulative = routeLengths(path);
  commuter.length = length;
  commuter.distance = 0;
  commuter.segment = 0;
  setPosition(commuter);
}

export function createAmbient(seed = 'london-live-commuters-v1'): AmbientState {
  const state: AmbientState = { rng: seedFromString(seed), commuters: [] };
  for (let index = 0; index < COMMUTER_COUNT; index++) {
    const startNode = pickEndpointNode(state);
    const start = pointForNode(startNode);
    const commuter: AmbientCommuter = {
      path: [start.x, start.y, start.x, start.y],
      cumulative: [0, 0],
      length: 0,
      distance: 0,
      segment: 0,
      x: start.x,
      y: start.y,
      cyclist: random(state) < 0.15,
    };
    setRoute(state, commuter);
    commuter.distance = random(state) * commuter.length;
    setPosition(commuter);
    state.commuters.push(commuter);
  }
  return state;
}

export function advanceAmbient(state: AmbientState, gameDays: number): void {
  if (!Number.isFinite(gameDays) || gameDays <= 0) return;
  for (const commuter of state.commuters) {
    let remaining = gameDays * WALK_SPEED;
    while (remaining > 1e-9) {
      const routeRemaining = commuter.length - commuter.distance;
      if (routeRemaining <= 1e-9) {
        setRoute(state, commuter);
        continue;
      }
      const moved = Math.min(remaining, routeRemaining);
      commuter.distance += moved;
      remaining -= moved;
      setPosition(commuter);
      if (commuter.distance >= commuter.length - 1e-9) {
        commuter.distance = commuter.length;
        setPosition(commuter);
        setRoute(state, commuter);
      }
    }
  }
}
