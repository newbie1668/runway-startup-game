import { HUBS } from '@/lib/game/content';
import { project } from '@/lib/game/geo';
import { nextFloat, seedFromString } from '@/lib/game/rng';
import type { HubId } from '@/lib/game/types';
import { TRAVEL_SPEED } from './content';
import { polylineLength, streetPath } from './walk';
import graph from './walkGraph.json';

const COMMUTER_COUNT = 220;
const HUB_RADIUS_SQUARED = 25 * 25;
const WALK_SPEED = TRAVEL_SPEED * 1.5;
const hubNodes = new Map<HubId, number[]>();
const hubCenters = HUBS.map((hub) => ({
  id: hub.id,
  point: project([hub.lng, hub.lat]),
}));

for (const hub of HUBS) hubNodes.set(hub.id, []);
for (let node = 0; node < graph.nodes.length / 2; node++) {
  const x = graph.nodes[node * 2]!;
  const y = graph.nodes[node * 2 + 1]!;
  for (const hub of hubCenters)
    if ((x - hub.point.x) ** 2 + (y - hub.point.y) ** 2 <= HUB_RADIUS_SQUARED)
      hubNodes.get(hub.id)!.push(node);
}

export interface AmbientCommuter {
  hubId: HubId;
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

function setRoute(
  state: AmbientState,
  commuter: AmbientCommuter,
  candidates: number[],
): void {
  let endNode = candidates[Math.floor(random(state) * candidates.length)]!;
  const startX = commuter.x;
  const startY = commuter.y;
  const separation = (node: number) => {
    const point = pointForNode(node);
    return Math.hypot(point.x - startX, point.y - startY);
  };
  for (let tries = 0; tries < 8 && separation(endNode) < 0.1; tries++)
    endNode = candidates[Math.floor(random(state) * candidates.length)]!;
  if (separation(endNode) < 0.1) {
    const alternatives = candidates.filter((node) => separation(node) >= 0.1);
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
  const eligibleHubs = HUBS.filter((hub) => (hubNodes.get(hub.id)?.length ?? 0) > 1);
  for (let index = 0; index < COMMUTER_COUNT; index++) {
    const hub = eligibleHubs[Math.floor(random(state) * eligibleHubs.length)]!;
    const candidates = hubNodes.get(hub.id)!;
    const startNode = candidates[Math.floor(random(state) * candidates.length)]!;
    const start = pointForNode(startNode);
    const commuter: AmbientCommuter = {
      hubId: hub.id,
      path: [start.x, start.y, start.x, start.y],
      cumulative: [0, 0],
      length: 0,
      distance: 0,
      segment: 0,
      x: start.x,
      y: start.y,
      cyclist: random(state) < 0.15,
    };
    setRoute(state, commuter, candidates);
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
    const candidates = hubNodes.get(commuter.hubId)!;
    while (remaining > 1e-9) {
      const routeRemaining = commuter.length - commuter.distance;
      if (routeRemaining <= 1e-9) {
        setRoute(state, commuter, candidates);
        continue;
      }
      const moved = Math.min(remaining, routeRemaining);
      commuter.distance += moved;
      remaining -= moved;
      setPosition(commuter);
      if (commuter.distance >= commuter.length - 1e-9) {
        commuter.distance = commuter.length;
        setPosition(commuter);
        setRoute(state, commuter, candidates);
      }
    }
  }
}
