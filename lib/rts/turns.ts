import { HUBS } from '@/lib/game/content';
import { hire, movePeople, pitch, tick, travelDays } from './sim';
import type { MoveTarget, Person, RtsFx, RtsState } from './types';
import { streetPath } from './walk';

export const SLOT_DAYS = 0.5;
export const SLOTS_PER_WEEK = 10;

export type StopAction =
  | 'build'
  | 'growth'
  | 'hire-engineer'
  | 'hire-growth'
  | 'pitch'
  | 'visit';

export interface PlanStop {
  target: MoveTarget;
  action: StopAction;
  actionSlots: number;
}

export interface PlannedLeg {
  stop: PlanStop;
  label: string;
  path: number[];
  travelSlots: number;
  startSlot: number;
  endSlot: number;
}

export interface PlanSummary {
  legs: PlannedLeg[];
  slotsUsed: number;
  slotsLeft: number;
  error?: string;
}

export interface WeekRun {
  stops: PlanStop[];
  index: number;
  step: 'travel' | 'act' | 'idle';
  actUntil: number;
  weekEndDay: number;
  log: string[];
}

const PLAN_OVER_BUDGET = 'Not enough time this week';
const EPSILON = 1e-9;

function targetPosition(state: RtsState, target: MoveTarget): { x: number; y: number } | null {
  if (target.kind === 'point') return { x: target.x, y: target.y };
  if (target.kind === 'place') {
    const place = state.places.find((item) => item.id === target.id);
    return place ? { x: place.x, y: place.y } : null;
  }
  if (target.kind === 'office') {
    const office = state.offices.find((item) => item.id === target.id);
    return office ? { x: office.x, y: office.y } : null;
  }
  const lead = state.leads.find((item) => item.id === target.id);
  return lead ? { x: lead.x, y: lead.y } : null;
}

function targetLabel(state: RtsState, target: MoveTarget): string {
  if (target.kind === 'point') return target.label;
  if (target.kind === 'place') return state.places.find((item) => item.id === target.id)?.name ?? 'Place';
  if (target.kind === 'office') {
    const office = state.offices.find((item) => item.id === target.id);
    return office?.siteName ?? `${HUBS.find((hub) => hub.id === office?.hubId)?.name ?? 'London'} office`;
  }
  const lead = state.leads.find((item) => item.id === target.id);
  return lead?.clue?.hint ?? lead?.name ?? 'Opportunity';
}

function founderOf(state: RtsState): Person | undefined {
  return state.people.find((person) => person.company === 'player' && person.role === 'founder');
}

export function defaultStop(state: RtsState, target: MoveTarget): PlanStop {
  if (target.kind === 'office') return { target: { ...target }, action: 'build', actionSlots: 2 };
  if (target.kind === 'place') {
    const place = state.places.find((item) => item.id === target.id);
    if (place?.kind === 'customers')
      return { target: { ...target }, action: 'growth', actionSlots: 2 };
    if (place?.kind === 'talent')
      return { target: { ...target }, action: 'hire-engineer', actionSlots: 1 };
    if (place?.kind === 'investor')
      return { target: { ...target }, action: 'pitch', actionSlots: 2 };
  }
  return { target: { ...target }, action: 'visit', actionSlots: 0 };
}

export function summarizePlan(state: RtsState, stops: PlanStop[]): PlanSummary {
  const founder = founderOf(state);
  if (!founder) return { legs: [], slotsUsed: 0, slotsLeft: SLOTS_PER_WEEK, error: 'Founder not found' };

  const legs: PlannedLeg[] = [];
  let x = founder.x;
  let y = founder.y;
  let slotsUsed = 0;
  let error: string | undefined;

  for (const stop of stops) {
    const destination = targetPosition(state, stop.target);
    if (!destination) {
      error = 'A planned stop no longer exists';
      break;
    }
    const path = streetPath(x, y, destination.x, destination.y);
    const alreadyThere = x === destination.x && y === destination.y;
    const days = alreadyThere ? 0 : travelDays(x, y, destination.x, destination.y);
    const travelSlots = days === 0 ? 0 : Math.ceil(days / SLOT_DAYS - EPSILON);
    const startSlot = slotsUsed;
    slotsUsed += travelSlots + stop.actionSlots;
    legs.push({
      stop,
      label: targetLabel(state, stop.target),
      path,
      travelSlots,
      startSlot,
      endSlot: slotsUsed,
    });
    x = destination.x;
    y = destination.y;
  }

  if (!error && slotsUsed > SLOTS_PER_WEEK) error = PLAN_OVER_BUDGET;
  return {
    legs,
    slotsUsed,
    slotsLeft: Math.max(0, SLOTS_PER_WEEK - slotsUsed),
    ...(error ? { error } : {}),
  };
}

function cloneRun(run: WeekRun): WeekRun {
  return {
    ...run,
    stops: run.stops.map((stop) => ({
      ...stop,
      target: { ...stop.target },
    })),
    log: [...run.log],
  };
}

function initialRun(state: RtsState, stops: PlanStop[]): WeekRun {
  return {
    stops: stops.map((stop) => ({ ...stop, target: { ...stop.target } })),
    index: 0,
    step: stops.length ? 'travel' : 'idle',
    actUntil: 0,
    weekEndDay: (Math.floor(state.day / 7 + EPSILON) + 1) * 7,
    log: [],
  };
}

export function beginWeek(
  state: RtsState,
  stops: PlanStop[],
): { state: RtsState; run: WeekRun; fx: RtsFx[]; error?: string } {
  const run = initialRun(state, stops);
  if (state.phase !== 'playing')
    return { state, run, fx: [], error: 'The company cannot start a week right now.' };
  if (state.mode !== 'turns')
    return { state, run, fx: [], error: 'Weekly planning is only available in turns mode.' };
  const summary = summarizePlan(state, stops);
  if (summary.error) return { state, run, fx: [], error: summary.error };
  if (stops.length === 0) return { state, run, fx: [] };
  const founder = founderOf(state);
  if (!founder) return { state, run, fx: [], error: 'Founder not found' };
  const movement = movePeople(state, [founder.id], stops[0]!.target);
  if (movement.error) return { state, run, fx: [], error: movement.error };
  return { state: movement.state, run, fx: movement.fx };
}

function applyStopAction(
  state: RtsState,
  run: WeekRun,
  stop: PlanStop,
  fx: RtsFx[],
): RtsState {
  if (stop.action === 'hire-engineer' || stop.action === 'hire-growth') {
    if (stop.target.kind !== 'place') {
      run.log.push(`Could not hire at ${targetLabel(state, stop.target)}: choose a talent place.`);
      return state;
    }
    const result = hire(
      state,
      stop.action === 'hire-engineer' ? 'engineer' : 'growth',
      stop.target.id,
    );
    if (result.error) run.log.push(result.error);
    else {
      fx.push(...result.fx);
      return result.state;
    }
  } else if (stop.action === 'pitch') {
    if (stop.target.kind !== 'place') {
      run.log.push(`Could not pitch at ${targetLabel(state, stop.target)}: choose an investor.`);
      return state;
    }
    const result = pitch(state, stop.target.id);
    if (result.error) run.log.push(result.error);
    else {
      fx.push(...result.fx);
      return result.state;
    }
  }
  return state;
}

function startNextStop(state: RtsState, run: WeekRun, fx: RtsFx[]): RtsState {
  const founder = founderOf(state);
  while (founder && run.index < run.stops.length) {
    const stop = run.stops[run.index]!;
    if (stop.target.kind === 'lead') {
      const leadId = stop.target.id;
      const lead = state.leads.find((item) => item.id === leadId);
      if (!lead || lead.expiresDay <= state.day || !lead.takenBy.includes('founder')) {
        run.log.push(`Skipped ${targetLabel(state, stop.target)}: the opportunity expired or was claimed.`);
        run.index += 1;
        continue;
      }
    }
    const movement = movePeople(state, [founder.id], stop.target);
    if (movement.error) {
      run.log.push(`Skipped ${targetLabel(state, stop.target)}: ${movement.error}`);
      run.index += 1;
      continue;
    }
    fx.push(...movement.fx);
    run.step = 'travel';
    run.actUntil = 0;
    return movement.state;
  }
  run.step = 'idle';
  run.actUntil = 0;
  return state;
}

function processArrival(
  state: RtsState,
  run: WeekRun,
  fx: RtsFx[],
  leadClaimedDuringTick: boolean,
): RtsState {
  const stop = run.stops[run.index];
  if (!stop) {
    run.step = 'idle';
    return state;
  }
  const label = targetLabel(state, stop.target);
  run.log.push(`Visited ${label}.`);
  if (stop.target.kind === 'lead' && !leadClaimedDuringTick) {
    const leadId = stop.target.id;
    const lead = state.leads.find((item) => item.id === leadId);
    if (!lead || lead.expiresDay <= state.day || !lead.takenBy.includes('founder')) {
      run.log.push(`Skipped the visit: the opportunity expired or was claimed.`);
      run.index += 1;
      return startNextStop(state, run, fx);
    }
  }
  state = applyStopAction(state, run, stop, fx);
  run.step = 'act';
  run.actUntil = state.day + stop.actionSlots * SLOT_DAYS;
  if (stop.actionSlots === 0) {
    run.index += 1;
    return startNextStop(state, run, fx);
  }
  return state;
}

function doneFor(state: RtsState, run: WeekRun): boolean {
  return (
    state.phase === 'won' ||
    state.phase === 'bankrupt' ||
    (state.phase !== 'dilemma' && state.day >= run.weekEndDay - EPSILON)
  );
}

export function advanceWeek(
  state: RtsState,
  run: WeekRun,
  dtDays: number,
): { state: RtsState; run: WeekRun; fx: RtsFx[]; done: boolean } {
  const nextRun = cloneRun(run);
  const fx: RtsFx[] = [];
  if (state.phase === 'dilemma')
    return { state, run: nextRun, fx, done: false };
  if (!Number.isFinite(dtDays) || dtDays <= 0 || doneFor(state, nextRun))
    return { state, run: nextRun, fx, done: doneFor(state, nextRun) };

  let next = state;
  let remaining = Math.min(dtDays, Math.max(0, nextRun.weekEndDay - next.day));
  while (remaining > EPSILON && !doneFor(next, nextRun)) {
    if (next.phase === 'dilemma') break;
    if (nextRun.step === 'travel') {
      const founder = founderOf(next);
      if (!founder) {
        nextRun.log.push('The founder is no longer available; the week ends here.');
        nextRun.step = 'idle';
        continue;
      }
      if (!founder.order) {
        next = processArrival(next, nextRun, fx, false);
        continue;
      }
    } else if (nextRun.step === 'act' && next.day >= nextRun.actUntil - EPSILON) {
      nextRun.index += 1;
      next = startNextStop(next, nextRun, fx);
      continue;
    }

    const untilWeekEnd = nextRun.weekEndDay - next.day;
    const untilActionEnd =
      nextRun.step === 'act' ? Math.max(0, nextRun.actUntil - next.day) : Number.POSITIVE_INFINITY;
    const dt = Math.min(remaining, untilWeekEnd, untilActionEnd, 0.1);
    if (dt <= EPSILON) break;
    const dayBeforeTick = next.day;
    const leadsWonBefore = next.stats.leadsWon;
    const result = tick(next, dt);
    next = result.state;
    fx.push(...result.fx);
    remaining = Math.max(0, remaining - (next.day - dayBeforeTick));
    const leadClaimedDuringTick = next.stats.leadsWon > leadsWonBefore;
    if (next.phase === 'dilemma') break;
    if (nextRun.step === 'travel') {
      const founder = founderOf(next);
      if (founder && !founder.order)
        next = processArrival(next, nextRun, fx, leadClaimedDuringTick);
    }
  }

  if (next.phase !== 'dilemma' && next.day >= nextRun.weekEndDay - EPSILON)
    next = { ...next, day: nextRun.weekEndDay };
  return { state: next, run: nextRun, fx, done: doneFor(next, nextRun) };
}
