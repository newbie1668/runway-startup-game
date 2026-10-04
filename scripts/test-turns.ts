import assert from 'node:assert/strict';
import { STAGES } from '@/lib/game/content';
import { LANDMARKS, METERS_TO_WORLD, project } from '@/lib/game/geo';
import { JOURNAL_HYPE } from '@/lib/rts/content';
import {
  movePeople,
  newRtsGame,
  pitchPreview,
  resolveDilemma,
  searchForLead,
  tick,
  travelDays,
} from '@/lib/rts/sim';
import {
  SLOT_DAYS,
  SLOTS_PER_WEEK,
  advanceWeek,
  beginWeek,
  defaultStop,
  summarizePlan,
  tryAddStop,
  type PlanStop,
  type WeekRun,
} from '@/lib/rts/turns';
import type { Lead, MoveTarget, RtsFx, RtsState } from '@/lib/rts/types';
import { polylineLength, streetPath } from '@/lib/rts/walk';

let checks = 0;

function check(name: string, fn: () => void): void {
  fn();
  checks += 1;
  console.log(`✓ ${name}`);
}

function game(seed = 'turns-test', mode: 'turns' | 'realtime' = 'turns'): RtsState {
  return newRtsGame({
    seed,
    companyName: 'Test Startup',
    sectorId: 'devtools',
    hqHub: 'shoreditch',
    mode,
  });
}

function quiet(state: RtsState): RtsState {
  state.nextLeadDay = 1_000;
  state.nextDilemmaDay = 1_000;
  state.nextAiDay = 1_000;
  return state;
}

function runWeek(
  state: RtsState,
  stops: PlanStop[],
): { state: RtsState; run: WeekRun; fx: RtsFx[] } {
  const begun = beginWeek(state, stops);
  assert.equal(begun.error, undefined);
  let current = begun.state;
  let run = begun.run;
  let done = false;
  let steps = 0;
  const fx: RtsFx[] = [];
  while (!done && steps++ < 2_000) {
    if (current.phase === 'dilemma') {
      current = resolveDilemma(current, 0).state;
      continue;
    }
    const advanced = advanceWeek(current, run, 0.25);
    current = advanced.state;
    run = advanced.run;
    fx.push(...advanced.fx);
    done = advanced.done;
  }
  assert.ok(done, 'weekly run should finish');
  return { state: current, run, fx };
}

function pointDistanceToPath(point: { x: number; y: number }, path: number[]): number {
  let closest = Number.POSITIVE_INFINITY;
  for (let index = 2; index < path.length; index += 2) {
    const x0 = path[index - 2]!;
    const y0 = path[index - 1]!;
    const x1 = path[index]!;
    const y1 = path[index + 1]!;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSquared = dx * dx + dy * dy;
    const progress =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((point.x - x0) * dx + (point.y - y0) * dy) / lengthSquared));
    closest = Math.min(closest, Math.hypot(point.x - (x0 + dx * progress), point.y - (y0 + dy * progress)));
  }
  return closest;
}

function leadOnRouteState(seed: string, discover: boolean): RtsState {
  const state = quiet(game(seed));
  const founder = state.people.find((person) => person.company === 'player' && person.role === 'founder')!;
  const targetPlace = [...state.places]
    .filter((place) => place.kind === 'customers')
    .map((place) => ({
      place,
      path: streetPath(founder.x, founder.y, place.x, place.y),
    }))
    .sort((left, right) => polylineLength(right.path) - polylineLength(left.path))[0]!;
  const path = targetPlace.path;
  let longest = { x0: 0, y0: 0, x1: 0, y1: 0, length: 0 };
  for (let index = 2; index < path.length; index += 2) {
    const x0 = path[index - 2]!;
    const y0 = path[index - 1]!;
    const x1 = path[index]!;
    const y1 = path[index + 1]!;
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length > longest.length) longest = { x0, y0, x1, y1, length };
  }
  assert.ok(longest.length > 0, 'selected founder route has a path segment');
  const midpoint = { x: (longest.x0 + longest.x1) / 2, y: (longest.y0 + longest.y1) / 2 };
  let clue = midpoint;
  if (!discover) {
    const nx = -(longest.y1 - longest.y0) / longest.length;
    const ny = (longest.x1 - longest.x0) / longest.length;
    const offsets = [800, 1_200, 1_800].map((meters) => meters * METERS_TO_WORLD);
    const candidates = offsets.flatMap((offset) => [
      { x: midpoint.x + nx * offset, y: midpoint.y + ny * offset },
      { x: midpoint.x - nx * offset, y: midpoint.y - ny * offset },
    ]);
    clue = candidates.find((candidate) => pointDistanceToPath(candidate, path) > 400 * METERS_TO_WORLD)!;
    assert.ok(clue, 'miss clue should remain more than 400m from the route');
  }
  const lead: Lead = {
    id: 'test-clue',
    kind: 'candidate',
    name: 'Hidden lead',
    venue: 'Secret venue',
    hubId: 'shoreditch',
    x: targetPlace.place.x,
    y: targetPlace.place.y,
    spawnDay: 0,
    expiresDay: 100,
    takenBy: ['founder'],
    clue: { ...clue, radius: 300 * METERS_TO_WORLD, hint: 'A clue near the route — until Tue' },
  };
  state.leads = [lead];
  const target: MoveTarget = {
    kind: 'point',
    x: targetPlace.place.x,
    y: targetPlace.place.y,
    label: 'Route end',
  };
  const movement = movePeople(state, [founder.id], target);
  assert.equal(movement.error, undefined);
  const movedFounder = movement.state.people.find((person) => person.id === founder.id)!;
  const duration = movedFounder.order!.durationDays;
  return tick(movement.state, duration + 0.1).state;
}

function shardState(mode: 'turns' | 'realtime'): RtsState {
  const state = quiet(game(`shard-${mode}`, mode));
  const shard = LANDMARKS.find((landmark) => landmark.kind === 'shard')!;
  const point = project(shard.at);
  const founder = state.people.find((person) => person.company === 'player' && person.role === 'founder')!;
  for (const landmark of LANDMARKS) {
    if (landmark.kind !== 'shard') state.journal[landmark.kind] = 0;
  }
  founder.x = point.x;
  founder.y = point.y;
  founder.at = null;
  state.companies.player.hype = 0;
  state.campaign.bonusDone = true;
  return state;
}

function clueSearchState(seed: string): { state: RtsState; lead: Lead; founderId: string } {
  const state = quiet(game(seed));
  const founder = state.people.find((person) => person.company === 'player' && person.role === 'founder')!;
  const lead: Lead = {
    id: 'search-target',
    kind: 'angel',
    name: 'Angel at Brick Lane',
    venue: 'Brick Lane',
    hubId: 'shoreditch',
    x: founder.x + 180 * METERS_TO_WORLD,
    y: founder.y,
    spawnDay: state.day,
    expiresDay: 5,
    takenBy: ['founder'],
    clue: {
      x: founder.x,
      y: founder.y,
      radius: 300 * METERS_TO_WORLD,
      hint: 'An angel investor is having coffee somewhere near Brick Lane — this week only',
    },
  };
  state.leads = [lead];
  return { state, lead, founderId: founder.id };
}

function routeClueSearchState(seed: string): { state: RtsState; lead: Lead; stop: PlanStop } {
  const state = quiet(game(seed));
  const founder = state.people.find((person) => person.company === 'player' && person.role === 'founder')!;
  const destination = state.places
    .filter((place) => place.kind === 'customers')
    .map((place) => ({
      place,
      path: streetPath(founder.x, founder.y, place.x, place.y),
    }))
    .filter((item) => polylineLength(item.path) > 100 * METERS_TO_WORLD)
    .sort((left, right) => polylineLength(left.path) - polylineLength(right.path))[0]!;
  const lead: Lead = {
    id: 'route-search-target',
    kind: 'angel',
    name: 'Angel at route destination',
    venue: 'Route Cafe',
    hubId: 'shoreditch',
    x: destination.place.x,
    y: destination.place.y,
    spawnDay: state.day,
    expiresDay: 5,
    takenBy: ['founder'],
    clue: {
      x: destination.place.x,
      y: destination.place.y,
      radius: 300 * METERS_TO_WORLD,
      hint: 'An angel investor is having coffee near Route Cafe — this week only',
    },
  };
  state.leads = [lead];
  state.leadHistory = {};
  return {
    state,
    lead,
    stop: defaultStop(state, { kind: 'lead', id: lead.id }),
  };
}

function closeEnough(actual: number, expected: number, tolerance = 0.1): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be within ${tolerance} of ${expected}`);
}

check('weekly slot math, current-location zero travel, and over-budget refusal', () => {
  const state = game();
  const founder = state.people.find((person) => person.company === 'player' && person.role === 'founder')!;
  const current = defaultStop(state, {
    kind: 'point',
    x: founder.x,
    y: founder.y,
    label: 'Here',
  });
  const atCurrent = summarizePlan(state, [current]);
  assert.equal(atCurrent.legs[0]?.travelSlots, 0);
  assert.equal(atCurrent.slotsUsed, 0);

  const farPlace = [...state.places]
    .map((place) => ({ place, days: travelDays(founder.x, founder.y, place.x, place.y) }))
    .sort((left, right) => right.days - left.days)[0]!.place;
  const travelStop = defaultStop(state, { kind: 'place', id: farPlace.id });
  const travel = summarizePlan(state, [travelStop]);
  assert.equal(
    travel.legs[0]?.travelSlots,
    Math.ceil(travelDays(founder.x, founder.y, farPlace.x, farPlace.y) / SLOT_DAYS - 1e-9),
  );

  const office = state.offices.find((item) => item.company === 'player')!;
  const tooLong = [
    { target: { kind: 'office' as const, id: office.id }, action: 'build' as const, actionSlots: 6 },
    { target: { kind: 'office' as const, id: office.id }, action: 'build' as const, actionSlots: 6 },
  ];
  assert.equal(summarizePlan(state, tooLong).slotsUsed, SLOTS_PER_WEEK + 2);
  assert.equal(summarizePlan(state, tooLong).error, 'Not enough time this week');
  assert.equal(beginWeek(state, tooLong).error, 'Not enough time this week');
});

check('safe plan additions reject over-budget, ineligible, and duplicate stops', () => {
  const state = game('safe-plan-additions');
  const founder = state.people.find((person) => person.company === 'player' && person.role === 'founder')!;
  const longAction: PlanStop = {
    target: { kind: 'point', x: founder.x, y: founder.y, label: 'Here' },
    action: 'build',
    actionSlots: 6,
  };
  const farPlace = state.places
    .filter((place) => place.kind === 'customers')
    .map((place) => ({
      place,
      travelSlots: Math.ceil(
        travelDays(founder.x, founder.y, place.x, place.y) / SLOT_DAYS - 1e-9,
      ),
    }))
    .sort((left, right) => right.travelSlots - left.travelSlots)
    .find((item) => item.travelSlots + 2 > 4)?.place;
  assert.ok(farPlace, 'a customer place should require more than four total slots after the base action');
  const overBudget = tryAddStop(state, [longAction], { kind: 'place', id: farPlace.id });
  assert.equal(overBudget.ok, false);
  if (!overBudget.ok) assert.match(overBudget.error, /slots, you have/);

  const investor = state.places.find((place) => place.kind === 'investor')!;
  const pitch = tryAddStop(state, [], { kind: 'place', id: investor.id });
  assert.equal(pitch.ok, false);
  if (!pitch.ok) {
    assert.match(pitch.error, /won't see you yet/);
    assert.match(pitch.error, /150 users/);
    assert.match(pitch.error, /product 15/);
  }

  const customer = state.places.find((place) => place.kind === 'customers')!;
  const existing = defaultStop(state, { kind: 'place', id: customer.id });
  const duplicate = tryAddStop(state, [existing], { kind: 'place', id: customer.id });
  assert.deepEqual(duplicate, { ok: false, error: `Already going to ${customer.name}` });
});

check('safe plan additions accept a normal stop and empty weeks finish on Friday', () => {
  const state = quiet(game('safe-plan-acceptance'));
  const customer = state.places.find((place) => place.kind === 'customers')!;
  const accepted = tryAddStop(state, [], { kind: 'place', id: customer.id });
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.equal(accepted.stops.length, 1);
    assert.equal(accepted.summary.legs.length, 1);
  }

  const emptyWeek = runWeek(quiet(game('empty-week')), []);
  assert.equal(emptyWeek.state.day, 7);
  assert.equal(emptyWeek.state.day % 7, 0);
});

check('a weekly hire, build, and growth route completes on Friday in order', () => {
  const state = quiet(game());
  const office = state.offices.find((item) => item.company === 'player')!;
  const talentPlaces = state.places.filter((place) => place.kind === 'talent');
  const customerPlaces = state.places.filter((place) => place.kind === 'customers');
  let stops: PlanStop[] | undefined;
  for (const talent of talentPlaces) {
    for (const customer of customerPlaces) {
      const candidate = [
        defaultStop(state, { kind: 'place', id: talent.id }),
        defaultStop(state, { kind: 'office', id: office.id }),
        defaultStop(state, { kind: 'place', id: customer.id }),
      ];
      if (!summarizePlan(state, candidate).error) {
        stops = candidate;
        break;
      }
    }
    if (stops) break;
  }
  assert.ok(stops, 'a three-stop route should fit the ten-slot week');
  const founder = state.people.find((person) => person.company === 'player' && person.role === 'founder')!;
  const previousTeamSize = state.people.filter((person) => person.company === 'player').length;
  const labels = summarizePlan(state, stops).legs.map((leg) => leg.label);
  const result = runWeek(state, stops);
  assert.equal(result.state.people.filter((person) => person.company === 'player').length, previousTeamSize + 1);
  assert.equal(result.state.people.filter((person) => person.company === 'player' && person.role === 'engineer').length, 2);
  assert.deepEqual(
    result.run.log.filter((line) => line.startsWith('Visited ')).map((line) => line.slice('Visited '.length, -1)),
    labels,
  );
  assert.ok(Math.abs(result.state.day / 7 - Math.round(result.state.day / 7)) < 1e-9);
  const growthTarget = stops[2]!.target;
  assert.equal(growthTarget.kind, 'place');
  if (growthTarget.kind === 'place')
    assert.equal(result.state.people.find((person) => person.id === founder.id)?.at, growthTarget.id);
});

check('an eligible investor pitch in the weekly engine closes a round', () => {
  const state = quiet(game('turns-pitch'));
  const player = state.companies.player;
  const nextStage = STAGES[1]!;
  player.users = nextStage.minTraction * 4;
  player.product = nextStage.minProduct + 40;
  player.hype = 100;
  state.rng = 0;
  const investor = state.places.find((place) => place.kind === 'investor')!;
  assert.equal(pitchPreview(state, 'player').eligible, true);
  const stop = defaultStop(state, { kind: 'place', id: investor.id });
  assert.equal(stop.action, 'pitch');
  const result = runWeek(state, [stop]);
  assert.equal(result.state.companies.player.stageIndex, 1);
  assert.ok(result.state.news.some((item) => item.text.includes('closes its Pre-Seed round')));
});

check('turn-mode clue discovery uses the route while a 400m miss does not', () => {
  const discovered = leadOnRouteState('clue-hit', true);
  assert.equal(discovered.stats.leadsWon, 1);
  assert.equal(discovered.leads.some((lead) => lead.id === 'test-clue'), false);
  const missed = leadOnRouteState('clue-miss', false);
  assert.equal(missed.stats.leadsWon, 0);
  assert.equal(missed.leads.some((lead) => lead.id === 'test-clue'), true);

  const realtime = quiet(game('realtime-leads', 'realtime'));
  realtime.nextLeadDay = 0;
  realtime.nextDilemmaDay = 1_000;
  const spawned = tick(realtime, 0.1).state;
  assert.ok(spawned.leads.length > 0);
  assert.ok(spawned.leads.every((lead) => lead.clue === undefined));
});

check('a clue search routes to its centre and finds the lead within its radius', () => {
  const { state, lead, founderId } = clueSearchState('clue-search');
  const stop = defaultStop(state, { kind: 'lead', id: lead.id });
  assert.equal(stop.action, 'search');
  assert.equal(stop.actionSlots, 1);
  assert.equal(stop.leadId, lead.id);
  assert.equal(stop.target.kind, 'point');
  if (stop.target.kind !== 'point') return;
  closeEnough(stop.target.x, lead.clue!.x, 1e-8);
  closeEnough(stop.target.y, lead.clue!.y, 1e-8);

  const summary = summarizePlan(state, [stop]);
  const path = summary.legs[0]!.path;
  closeEnough(path[path.length - 2]!, lead.clue!.x, 1e-8);
  closeEnough(path[path.length - 1]!, lead.clue!.y, 1e-8);
  assert.ok(Math.hypot(path[path.length - 2]! - lead.x, path[path.length - 1]! - lead.y) > 100 * METERS_TO_WORLD);

  const result = searchForLead(state, founderId, lead.id);
  assert.equal(result.error, undefined);
  assert.equal(result.state.stats.leadsWon, 1);
  assert.equal(result.state.leads.some((item) => item.id === lead.id), false);
  assert.ok(result.fx.some((item) => item.kind === 'focus' && item.x === lead.x && item.y === lead.y));
  assert.ok(result.fx.some((item) => item.kind === 'float' && item.x === lead.x && item.y === lead.y));

  const week = runWeek(state, [stop]);
  assert.deepEqual(
    week.run.log.filter((line) => line.startsWith('Found the ')),
    ['Found the angel investor near Brick Lane'],
  );
});

check('a clue search found along the route logs and cues the lead once', () => {
  const { state, lead, stop } = routeClueSearchState('route-search-passby');
  const summary = summarizePlan(state, [stop]);
  assert.equal(summary.error, undefined);
  assert.ok(
    pointDistanceToPath({ x: lead.x, y: lead.y }, summary.legs[0]!.path) <=
      120 * METERS_TO_WORLD,
  );

  const week = runWeek(state, [stop]);
  assert.equal(week.state.stats.leadsWon, 1);
  assert.equal(week.state.leadHistory?.[lead.id]?.claimedBy, 'player');
  assert.deepEqual(
    week.run.log.filter((line) => line.startsWith('Found the ')),
    ['Found the angel investor near Route Cafe'],
  );
  assert.ok(week.fx.some((item) => item.kind === 'float' && item.text.startsWith('Found')));
});

check('a rival can take a clue lead before arrival and the search failure is logged', () => {
  const { state, lead } = clueSearchState('clue-search-rival');
  const stop = defaultStop(state, { kind: 'lead', id: lead.id });
  const rival = state.people.find((person) => person.company !== 'player' && person.role === 'founder')!;
  rival.x = lead.x;
  rival.y = lead.y;
  rival.at = null;
  const begun = beginWeek(state, [stop]);
  assert.equal(begun.error, undefined);
  const rivalInRun = begun.state.people.find((person) => person.id === rival.id)!;
  const rivalPath = streetPath(rivalInRun.x, rivalInRun.y, lead.x, lead.y);
  rivalInRun.order = {
    target: { kind: 'lead', id: lead.id },
    fromX: rivalInRun.x,
    fromY: rivalInRun.y,
    toX: lead.x,
    toY: lead.y,
    path: rivalPath,
    length: polylineLength(rivalPath),
    progress: 0,
    durationDays: 0.001,
  };
  const advanced = advanceWeek(begun.state, begun.run, 0.1);
  const rivalName = advanced.state.companies[rival.company].name;
  assert.equal(advanced.state.stats.leadsWon, 0);
  assert.equal(advanced.state.leads.some((item) => item.id === lead.id), false);
  assert.ok(advanced.run.log.some((line) => line.includes('Searched near Brick Lane') && line.includes(`${rivalName} got there first`)));
});

check('turns mode spawns clue batches at day zero and weekly boundaries only', () => {
  const state = quiet(game('weekly-lead-batches'));
  for (const person of state.people.filter((item) => item.company === 'player')) {
    person.x = 1_000_000;
    person.y = 1_000_000;
    person.at = null;
    person.order = null;
  }
  assert.equal(state.day, 0);
  assert.equal(state.leads.length, 3);
  assert.ok(state.leads.every((lead) => lead.expiresDay === 5 && lead.clue?.hint.endsWith('— this week only')));

  const midweek = tick(state, 3).state;
  assert.equal(midweek.leads.length, 3);
  const weekTwo = runWeek(midweek, []).state;
  assert.equal(weekTwo.day, 7);
  assert.equal(weekTwo.leads.length, 3);
  assert.ok(weekTwo.leads.every((lead) => Math.abs(lead.spawnDay - 7) < 1e-9 && lead.expiresDay === 12));

  const realtime = quiet(game('realtime-lead-timing', 'realtime'));
  realtime.nextLeadDay = 0;
  const firstRealtimeLead = tick(realtime, 0.1).state.leads[0];
  assert.ok(firstRealtimeLead);
  assert.ok(firstRealtimeLead.spawnDay >= 0);
  assert.equal(firstRealtimeLead.clue, undefined);
});

check('Shard landmark perk applies once in turns and not in real time', () => {
  const turns = shardState('turns');
  const before = turns.companies.player.hype;
  const first = tick(turns, 1e-7).state;
  closeEnough(first.companies.player.hype - before, JOURNAL_HYPE + 6, 0.1);
  assert.equal(first.journal.shard !== undefined, true);
  const second = tick(first, 1e-7).state;
  assert.ok(second.companies.player.hype < first.companies.player.hype);
  assert.ok(first.companies.player.hype - second.companies.player.hype < 0.1);

  const realtime = shardState('realtime');
  const realtimeBefore = realtime.companies.player.hype;
  const discovered = tick(realtime, 1e-7).state;
  closeEnough(discovered.companies.player.hype - realtimeBefore, JOURNAL_HYPE, 0.1);
});

check('turn landmark perks use the reduced user, cash, product, and hype values', () => {
  const cases = [
    { kind: 'eye', field: 'hype', amount: 5 },
    { kind: 'shard', field: 'hype', amount: 6 },
    { kind: 'westminsterbr', field: 'hype', amount: 2 },
    { kind: 'monument', field: 'hype', amount: 3 },
    { kind: 'gherkin', field: 'cash', amount: 1_500 },
    { kind: 'oldstreet', field: 'users', amount: 40 },
    { kind: 'battersea', field: 'users', amount: 60 },
    { kind: 'bttower', field: 'product', amount: 2 },
  ] as const;
  for (const { kind, field, amount } of cases) {
    const state = quiet(game(`perk-${kind}`));
    const landmark = LANDMARKS.find((item) => item.kind === kind)!;
    const point = project(landmark.at);
    for (const item of LANDMARKS) {
      if (item.kind !== kind) state.journal[item.kind] = 0;
    }
    state.campaign.bonusDone = true;
    const founder = state.people.find((person) => person.company === 'player' && person.role === 'founder')!;
    founder.x = point.x;
    founder.y = point.y;
    founder.at = null;
    const before = state.companies.player[field];
    const discovered = tick(state, 1e-7).state;
    const expected = amount + (field === 'hype' ? JOURNAL_HYPE : 0);
    closeEnough(discovered.companies.player[field] - before, expected, 0.1);
  }
});

check('the same seed and weekly plans replay identically for three weeks', () => {
  const replay = () => {
    let state = quiet(game('three-week-determinism'));
    const office = state.offices.find((item) => item.company === 'player')!;
    for (let week = 0; week < 3; week++) {
      const stop = defaultStop(state, { kind: 'office', id: office.id });
      state = runWeek(state, [stop]).state;
    }
    return state;
  };
  assert.deepEqual(replay(), replay());
});

console.log(`\n${checks} turn-mode checks passed.`);
