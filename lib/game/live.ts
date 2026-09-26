/**
 * RUNWAY — the live week (playtest prototype).
 *
 * A layer over the classic engine: each in-game week is 10 half-day slots
 * (Mon AM … Fri PM), actions happen at places on the map, and travel between
 * hubs costs slots. The classic engine (engine.ts) is reused untouched for
 * every stat change, weekly tick, rival and dilemma, so its balance knobs
 * still apply.
 *
 * Like the classic engine this is pure and deterministic: all live-layer
 * randomness comes from Dice seeded by (game seed, week, salt), and every
 * player move is appended to `moves`, so `replayLive(config, moves)` rebuilds
 * the exact same run. That is what a server will use to verify leaderboard
 * scores.
 */

import { HUBS, STAGES, UNICORN_TARGET, VENUES_BY_HUB, hubById } from './content';
import {
  applyDilemmaChoice,
  endWeek,
  newGame,
  performAction,
  pitchOdds,
  pitchReadiness,
  weeklyBurn,
  weeklyRevenue,
} from './engine';
import { Dice, seedFromString } from './rng';
import type { DilemmaEffectId, GameState, HubId, NewGameConfig, SectorId } from './types';

export const SLOTS_PER_WEEK = 10;

/**
 * Balance knobs for the live layer. The classic engine's numbers are left
 * alone; these tune how much a live week can do and what it costs. Kept in
 * one mutable object so scripts/test-live.ts can sweep them.
 */
export const LIVE_TUNING = {
  /** Extra weekly burn on top of the classic burn (more done per week costs more). */
  burnMult: 1.6,
  /**
   * After a raise the company deploys it: weekly burn is at least the last
   * round divided by this many weeks, so every round buys a finite runway to
   * the next milestone (0 disables).
   */
  roundRunwayWeeks: 7,
  /** Starting cash multiplier, so doubled burn doesn't end runs in week 4. */
  startCashMult: 1.5,
  /** Half-days per action. */
  slots: { build: 4, hire: 3, press: 3, growth: 3, retreat: 2, pitch: 4 } as Record<string, number>,
  /** Base share sold per round (preseed … unicorn). */
  dilution: [0, 0.15, 0.2, 0.2, 0.15, 0.12, 0.08],
  /** How strongly weak pitch odds raise dilution. */
  dilutionSpread: 1.0,
};
export const LIVE_SAVE_VERSION = 1;
const SLOT_NAMES = [
  'Mon AM',
  'Mon PM',
  'Tue AM',
  'Tue PM',
  'Wed AM',
  'Wed PM',
  'Thu AM',
  'Thu PM',
  'Fri AM',
  'Fri PM',
];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export function slotName(slot: number): string {
  return SLOT_NAMES[Math.min(SLOTS_PER_WEEK - 1, Math.max(0, slot))];
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

export type PlaceActionId = 'build' | 'hire' | 'press' | 'growth' | 'retreat' | 'pitch';

export const PLACE_ACTIONS: Record<PlaceActionId, { name: string; icon: string; slots: number }> = {
  build: { name: 'Build product', icon: '🛠', slots: 4 },
  hire: { name: 'Recruit', icon: '🧑‍💻', slots: 3 },
  press: { name: 'Work the press', icon: '📣', slots: 3 },
  growth: { name: 'Street growth push', icon: '📈', slots: 3 },
  retreat: { name: 'Team day in the park', icon: '🌳', slots: 2 },
  pitch: { name: 'Pitch investors', icon: '💼', slots: 4 },
};

const TALENT_HUBS: readonly HubId[] = [
  'kingscross',
  'farringdon',
  'shoreditch',
  'canarywharf',
  'battersea',
];
const MEDIA_HUBS: readonly HubId[] = ['soho', 'shoreditch', 'camden'];
const PARK_HUBS: readonly HubId[] = ['camden', 'battersea', 'londonbridge'];

const PARK_NAMES: Partial<Record<HubId, string>> = {
  camden: "Regent's Park",
  battersea: 'Battersea Park',
  londonbridge: 'the South Bank',
};

/** Where you pitch the next round: Mayfair money early, Canary Wharf funds later. */
export function pitchHub(state: LiveState): HubId {
  return state.game.stageIndex + 1 >= 4 ? 'canarywharf' : 'soho';
}

export function pitchVenue(state: LiveState): string {
  return pitchHub(state) === 'soho' ? 'Mayfair VC row (by Soho)' : 'Canary Wharf growth funds';
}

/** What a hub offers, independent of the week's leads. Used for map badges. */
export function hubOffers(state: LiveState, hubId: HubId): PlaceActionId[] {
  const out: PlaceActionId[] = [];
  if (hubId === state.game.hubId) out.push('build');
  if (TALENT_HUBS.includes(hubId)) out.push('hire');
  if (MEDIA_HUBS.includes(hubId)) out.push('press');
  out.push('growth');
  if (PARK_HUBS.includes(hubId)) out.push('retreat');
  if (hubId === pitchHub(state)) out.push('pitch');
  return out;
}

export function actionSlots(action: PlaceActionId): number {
  return LIVE_TUNING.slots[action] ?? PLACE_ACTIONS[action].slots;
}

export function placeLabel(hubId: HubId, action: PlaceActionId): string {
  if (action === 'retreat') return PARK_NAMES[hubId] ?? hubById(hubId).name;
  return hubById(hubId).name;
}

// ---------------------------------------------------------------------------
// Travel
// ---------------------------------------------------------------------------

export type TravelMode = 'tube' | 'taxi';

function hubKm(a: HubId, b: HubId): number {
  const A = hubById(a);
  const B = hubById(b);
  const kx = 111.32 * Math.cos(((A.lat + B.lat) / 2) * (Math.PI / 180));
  return Math.hypot((A.lng - B.lng) * kx, (A.lat - B.lat) * 110.57);
}

export interface TravelQuote {
  mode: TravelMode;
  slots: number;
  cost: number;
  km: number;
}

export function travelQuote(from: HubId, to: HubId, mode: TravelMode): TravelQuote {
  const km = hubKm(from, to);
  if (from === to) return { mode, slots: 0, cost: 0, km: 0 };
  if (mode === 'tube') return { mode, slots: km < 3.2 ? 1 : 2, cost: 0, km };
  return { mode, slots: 1, cost: Math.round(120 + km * 45), km };
}

// ---------------------------------------------------------------------------
// Leads: timed, located opportunities
// ---------------------------------------------------------------------------

export type LeadKind = 'angel' | 'talent' | 'journalist' | 'customer';

export interface Lead {
  id: string;
  kind: LeadKind;
  hubId: HubId;
  title: string;
  venue: string;
  /** Slot window (inclusive) in which the lead can be taken. */
  opens: number;
  closes: number;
  taken: boolean;
}

const LEAD_META: Record<LeadKind, { icon: string; title: string; blurb: string }> = {
  angel: { icon: '👼', title: 'Angel investor', blurb: 'Warm intros: connections +3, hype +3' },
  talent: {
    icon: '⭐',
    title: 'Star engineer',
    blurb: 'Poach a star: team +1, product +4 (£1.5k fee)',
  },
  journalist: {
    icon: '📰',
    title: 'Tech journalist',
    blurb: 'A feature: hype +12 (more in media hubs)',
  },
  customer: { icon: '🤝', title: 'Pilot customer', blurb: 'A paid pilot: cash and users now' },
};

export function leadMeta(kind: LeadKind) {
  return LEAD_META[kind];
}

/** Events keep their classic effects but only run on one day. */
export interface EventWindow {
  eventId: string;
  opens: number;
  closes: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type LiveMode = 'daily' | 'practice';

export type LiveMove =
  | { t: 'go'; hub: HubId; mode: TravelMode }
  | { t: 'do'; action: PlaceActionId }
  | { t: 'event'; id: string }
  | { t: 'lead'; id: string }
  | { t: 'wait' }
  | { t: 'choose'; effect: DilemmaEffectId };

export interface LiveConfig extends NewGameConfig {
  seed: number;
  mode: LiveMode;
  /** YYYY-MM-DD for daily runs. */
  dayKey?: string;
}

export interface LiveState {
  version: number;
  config: LiveConfig;
  game: GameState;
  slot: number;
  founderHub: HubId;
  /** Founder's share of the company, 0..1. */
  equity: number;
  peakValuation: number;
  leads: Lead[];
  eventWindows: EventWindow[];
  moves: LiveMove[];
  /** Short log of what the founder did this week, for the Friday recap. */
  weekLog: string[];
  /** Last travel, for the avatar animation. */
  lastTrip: { from: HubId; to: HubId; slots: number; mode: TravelMode } | null;
}

export function dailyKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dailySeed(dayKey: string): number {
  return seedFromString(`runway-daily|${dayKey}`) >>> 0;
}

export function newLive(config: LiveConfig): LiveState {
  const game = newGame(config);
  game.stats.cash = Math.round(game.stats.cash * LIVE_TUNING.startCashMult);
  const state: LiveState = {
    version: LIVE_SAVE_VERSION,
    config,
    game,
    slot: 0,
    founderHub: game.hubId,
    equity: 1,
    peakValuation: 0,
    leads: [],
    eventWindows: [],
    moves: [],
    weekLog: [],
    lastTrip: null,
  };
  rollWeek(state);
  return state;
}

function liveDice(state: LiveState, salt: string): Dice {
  return new Dice(seedFromString(`${state.game.seed}|w${state.game.week}|${salt}`));
}

function rollWeek(state: LiveState) {
  const dice = liveDice(state, 'week');
  state.eventWindows = state.game.eventsThisWeek.map((ev) => {
    const day = dice.int(0, 4);
    return { eventId: ev.id, opens: day * 2, closes: day * 2 + 1 };
  });
  const kinds: LeadKind[] = ['angel', 'talent', 'journalist', 'customer'];
  const count = 1 + (dice.chance(0.55) ? 1 : 0);
  state.leads = [];
  for (let i = 0; i < count; i++) {
    const kind = dice.pick(kinds);
    const hub = dice.pick(HUBS);
    const opens = dice.int(0, 6);
    const closes = Math.min(SLOTS_PER_WEEK - 1, opens + dice.int(2, 4));
    state.leads.push({
      id: `w${state.game.week}-l${i}`,
      kind,
      hubId: hub.id,
      title: LEAD_META[kind].title,
      venue: dice.pick(VENUES_BY_HUB[hub.id]),
      opens,
      closes,
      taken: false,
    });
  }
  state.slot = 0;
  state.founderHub = state.game.hubId;
  state.weekLog = [];
  state.lastTrip = null;
}

function clone(state: LiveState): LiveState {
  return structuredClone(state);
}

export function isOver(state: LiveState): boolean {
  const p = state.game.phase;
  return p === 'won' || p === 'bankrupt' || p === 'acquired';
}

export function isPaused(state: LiveState): boolean {
  return state.game.phase === 'dilemma';
}

// ---------------------------------------------------------------------------
// Queries for the UI
// ---------------------------------------------------------------------------

export interface PlaceOption {
  action: PlaceActionId;
  slots: number;
  ok: boolean;
  why?: string;
}

export function optionsHere(state: LiveState): PlaceOption[] {
  const left = SLOTS_PER_WEEK - state.slot;
  return hubOffers(state, state.founderHub).map((action) => {
    const slots = actionSlots(action);
    let why: string | undefined;
    if (slots > left) why = `Needs ${slots} half-days; ${left} left this week`;
    else if (action === 'pitch') {
      const r = pitchReadiness(state.game);
      if (!r.ready) why = r.reasons.join(' · ');
    } else if (action === 'hire' && state.game.stats.cash < 4_500) why = 'Too broke to hire';
    return { action, slots, ok: !why, why };
  });
}

export function openLeadsAt(state: LiveState, hubId: HubId) {
  return state.leads.filter((l) => l.hubId === hubId && !l.taken && l.closes >= state.slot);
}

export function openEventsAt(state: LiveState, hubId: HubId) {
  return state.game.eventsThisWeek
    .filter((e) => e.hubId === hubId && !e.attended)
    .map((e) => ({ ev: e, win: state.eventWindows.find((w) => w.eventId === e.id)! }))
    .filter(({ win }) => win && win.closes >= state.slot);
}

export function eventDay(win: EventWindow): string {
  return DAY_NAMES[Math.floor(win.opens / 2)];
}

/** Share of the company sold in the next round at the current odds. */
export function nextDilution(state: LiveState): number {
  const base = LIVE_TUNING.dilution[state.game.stageIndex + 1] ?? 0;
  const odds = pitchOdds(state.game);
  const k = LIVE_TUNING.dilutionSpread;
  return Math.min(0.45, base * (1 + k / 2 - odds * k));
}

/** Weekly burn in the live week, which fits more work into each week than classic turns. */
export function liveBurn(state: LiveState): number {
  const base = weeklyBurn(state.game) * LIVE_TUNING.burnMult;
  const weeks = LIVE_TUNING.roundRunwayWeeks;
  const deploy = weeks > 0 ? STAGES[state.game.stageIndex].raise / weeks : 0;
  return Math.round(Math.max(base, deploy));
}

export function liveRunwayWeeks(state: LiveState): number {
  const net = liveBurn(state) - weeklyRevenue(state.game);
  return net <= 0 ? Infinity : Math.max(0, state.game.stats.cash) / net;
}

export function payout(state: LiveState): number {
  if (state.game.phase === 'bankrupt') return 0;
  return Math.round(state.equity * state.game.valuation);
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

export interface LiveResult {
  state: LiveState;
  ok: boolean;
  message: string;
}

const fail = (state: LiveState, message: string): LiveResult => ({ state, ok: false, message });

function canAct(state: LiveState): string | null {
  if (isOver(state)) return 'The run is over.';
  if (isPaused(state)) return 'Decide the card first.';
  return null;
}

/** Spend slots; rolls the week over if they run out. */
function spend(state: LiveState, slots: number) {
  state.slot += slots;
  if (state.slot >= SLOTS_PER_WEEK) wrapWeek(state);
}

export function goTo(prev: LiveState, hub: HubId, mode: TravelMode): LiveResult {
  const blocked = canAct(prev);
  if (blocked) return fail(prev, blocked);
  if (hub === prev.founderHub) return fail(prev, "You're already here.");
  const q = travelQuote(prev.founderHub, hub, mode);
  if (prev.slot + q.slots > SLOTS_PER_WEEK)
    return fail(prev, 'Not enough week left for that trip.');
  if (q.cost > prev.game.stats.cash) return fail(prev, "Can't afford the taxi.");
  const state = clone(prev);
  state.moves.push({ t: 'go', hub, mode });
  state.game.stats.cash -= q.cost;
  state.lastTrip = { from: prev.founderHub, to: hub, slots: q.slots, mode };
  state.founderHub = hub;
  const message =
    mode === 'taxi'
      ? `Taxi to ${hubById(hub).name} (£${q.cost}).`
      : `Tube to ${hubById(hub).name}.`;
  spend(state, q.slots);
  return { state, ok: true, message };
}

/** Run a classic action as if the company were based at `hub` for the moment. */
function classicAt(
  state: LiveState,
  hub: HubId,
  action: Parameters<typeof performAction>[1],
  payload?: { eventId?: string },
) {
  const hq = state.game.hubId;
  const g = { ...state.game, hubId: hub, focusLeft: 99 };
  const res = performAction(g, action, payload);
  res.state.hubId = hq;
  res.state.focusLeft = 0;
  return res;
}

export function doAction(prev: LiveState, action: PlaceActionId): LiveResult {
  const blocked = canAct(prev);
  if (blocked) return fail(prev, blocked);
  const opt = optionsHere(prev).find((o) => o.action === action);
  if (!opt) return fail(prev, `You can't ${PLACE_ACTIONS[action].name.toLowerCase()} here.`);
  if (!opt.ok) return fail(prev, opt.why ?? 'Not now.');

  const hub = prev.founderHub;
  const stageBefore = prev.game.stageIndex;
  const tractionBefore = prev.game.stats.traction;
  const dilution = action === 'pitch' ? nextDilution(prev) : 0;
  const res = classicAt(prev, hub, action);
  if (!res.ok) return fail(prev, res.message);

  const state = clone(prev);
  state.game = res.state;
  state.moves.push({ t: 'do', action });
  let message = res.message;

  if (action === 'growth') {
    // Footfall: busier neighbourhoods convert more of the push.
    const footfall = hubById(hub).eventFrequencyMult;
    const gain = state.game.stats.traction - tractionBefore;
    state.game.stats.traction = tractionBefore + gain * footfall;
    message = `+${Math.round(gain * footfall).toLocaleString()} users from a street push in ${hubById(hub).name}.`;
  }
  if (action === 'pitch' && state.game.stageIndex > stageBefore) {
    state.equity *= 1 - dilution;
    message += ` You sold ${(dilution * 100).toFixed(0)}% — you now own ${(state.equity * 100).toFixed(0)}%.`;
    if (STAGES[state.game.stageIndex].id === 'unicorn') {
      state.game.valuation = unicornValuation(state.game);
    }
  }
  state.peakValuation = Math.max(state.peakValuation, state.game.valuation);
  state.weekLog.push(`${PLACE_ACTIONS[action].icon} ${message}`);
  spend(state, actionSlots(action));
  return { state, ok: true, message };
}

function unicornValuation(game: GameState): number {
  const stage = STAGES[STAGES.length - 1];
  const s = game.stats;
  const m =
    1 +
    Math.min(1, Math.max(0, s.traction / Math.max(1, stage.minTraction) - 1)) * 0.6 +
    Math.max(0, s.hype - 50) / 150 +
    Math.max(0, s.product - stage.minProduct) / 40;
  return Math.round(UNICORN_TARGET.valuation * Math.min(3, m));
}

export function attendEvent(prev: LiveState, eventId: string): LiveResult {
  const blocked = canAct(prev);
  if (blocked) return fail(prev, blocked);
  const ev = prev.game.eventsThisWeek.find((e) => e.id === eventId);
  const win = prev.eventWindows.find((w) => w.eventId === eventId);
  if (!ev || !win || ev.attended) return fail(prev, 'That event is over.');
  if (ev.hubId !== prev.founderHub) return fail(prev, `Go to ${hubById(ev.hubId).name} first.`);
  if (prev.slot < win.opens) return fail(prev, `It's on ${eventDay(win)}. Come back then.`);
  if (prev.slot > win.closes) return fail(prev, 'You missed it.');
  const res = classicAt(prev, prev.founderHub, 'attend', { eventId });
  if (!res.ok) return fail(prev, res.message);
  const state = clone(prev);
  state.game = res.state;
  state.moves.push({ t: 'event', id: eventId });
  state.weekLog.push(`★ ${ev.name}: ${res.message}`);
  spend(state, 1);
  return { state, ok: true, message: res.message };
}

export function takeLead(prev: LiveState, leadId: string): LiveResult {
  const blocked = canAct(prev);
  if (blocked) return fail(prev, blocked);
  const lead = prev.leads.find((l) => l.id === leadId);
  if (!lead || lead.taken) return fail(prev, 'That lead is gone.');
  if (lead.hubId !== prev.founderHub) return fail(prev, `Go to ${hubById(lead.hubId).name} first.`);
  if (prev.slot < lead.opens) return fail(prev, `They arrive ${slotName(lead.opens)}.`);
  if (prev.slot > lead.closes) return fail(prev, 'They left.');
  if (lead.kind === 'talent' && prev.game.stats.cash < 4_500)
    return fail(prev, 'Too broke to poach anyone.');

  const state = clone(prev);
  const s = state.game.stats;
  const tier = state.game.stageIndex + 1;
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  let message = '';
  switch (lead.kind) {
    case 'angel':
      s.connections += 3;
      s.hype = clamp(s.hype + 3);
      message = 'Coffee with an angel. Three warm intros in your inbox.';
      break;
    case 'talent':
      s.cash -= 1_500;
      s.team += 1;
      s.product = clamp(s.product + 4);
      s.morale = clamp(s.morale + 5);
      message = `Poached a star engineer. Team is now ${s.team}.`;
      break;
    case 'journalist': {
      const gain = 12 * hubById(lead.hubId).hypeMult;
      s.hype = clamp(s.hype + gain);
      message = `A feature is coming. Hype +${Math.round(gain)}.`;
      break;
    }
    case 'customer':
      s.cash += 6_000 * tier;
      s.traction += 120 * tier;
      message = `Paid pilot signed: +£${(6 * tier).toFixed(0)}k and ${120 * tier} users.`;
      break;
  }
  state.leads = state.leads.map((l) => (l.id === leadId ? { ...l, taken: true } : l));
  state.moves.push({ t: 'lead', id: leadId });
  state.weekLog.push(`${LEAD_META[lead.kind].icon} ${message}`);
  spend(state, 1);
  return { state, ok: true, message };
}

/** Let one half-day pass (the clock ticking while the player thinks). */
export function wait(prev: LiveState): LiveResult {
  const blocked = canAct(prev);
  if (blocked) return fail(prev, blocked);
  const state = clone(prev);
  state.moves.push({ t: 'wait' });
  spend(state, 1);
  return { state, ok: true, message: '' };
}

export function chooseLive(prev: LiveState, effect: DilemmaEffectId): LiveResult {
  if (!isPaused(prev)) return fail(prev, 'Nothing to decide.');
  const game = applyDilemmaChoice(prev.game, effect);
  if (game === prev.game) return fail(prev, 'Not an option.');
  const state = clone(prev);
  state.game = game;
  state.moves.push({ t: 'choose', effect });
  state.peakValuation = Math.max(state.peakValuation, game.valuation);
  return { state, ok: true, message: '' };
}

function wrapWeek(state: LiveState) {
  const before = state.game.week;
  state.game.stats.cash -= liveBurn(state) - weeklyBurn(state.game);
  state.game = endWeek({ ...state.game, focusLeft: 0 });
  state.peakValuation = Math.max(state.peakValuation, state.game.valuation);
  if (!isOver(state) && state.game.week !== before) rollWeek(state);
  else state.slot = SLOTS_PER_WEEK;
}

// ---------------------------------------------------------------------------
// Replay (for server-side score verification) and scoring
// ---------------------------------------------------------------------------

export function applyMove(state: LiveState, m: LiveMove): LiveResult {
  switch (m.t) {
    case 'go':
      return goTo(state, m.hub, m.mode);
    case 'do':
      return doAction(state, m.action);
    case 'event':
      return attendEvent(state, m.id);
    case 'lead':
      return takeLead(state, m.id);
    case 'wait':
      return wait(state);
    case 'choose':
      return chooseLive(state, m.effect);
  }
}

export function replayLive(config: LiveConfig, moves: readonly LiveMove[]): LiveState {
  let state = newLive(config);
  for (const m of moves) {
    const r = applyMove(state, m);
    if (!r.ok)
      throw new Error(
        `Illegal move at #${state.moves.length}: ${JSON.stringify(m)} — ${r.message}`,
      );
    state = r.state;
  }
  return state;
}

export interface RunSummary {
  outcome: 'unicorn' | 'acquired' | 'bust';
  weeks: number;
  payout: number;
  equity: number;
  valuation: number;
  peakValuation: number;
  hub: HubId;
  sectorId: SectorId;
}

export function summarize(state: LiveState): RunSummary {
  const p = state.game.phase;
  return {
    outcome: p === 'won' ? 'unicorn' : p === 'acquired' ? 'acquired' : 'bust',
    weeks: state.game.week,
    payout: payout(state),
    equity: state.equity,
    valuation: state.game.valuation,
    peakValuation: state.peakValuation,
    hub: state.config.hubId,
    sectorId: state.config.sectorId,
  };
}

export function formatMoney(n: number): string {
  if (n >= 1e9) return `£${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `£${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e3) return `£${Math.round(n / 1e3)}k`;
  return `£${Math.round(n)}`;
}

/** Wordle-style share text. */
export function shareText(state: LiveState, url: string): string {
  const r = summarize(state);
  const hub = hubById(r.hub).name;
  const head =
    r.outcome === 'unicorn'
      ? `🦄 ${state.game.companyName} (${hub}) hit unicorn in ${r.weeks} weeks`
      : r.outcome === 'acquired'
        ? `🤝 ${state.game.companyName} (${hub}) got acquired in week ${r.weeks}`
        : `💀 ${state.game.companyName} (${hub}) ran out of runway in week ${r.weeks}`;
  const ladder = STAGES.slice(1)
    .map((_, i) =>
      i < state.game.stageIndex
        ? '🟩'
        : r.outcome === 'bust' && i === state.game.stageIndex
          ? '🟥'
          : '⬜',
    )
    .join('');
  const lines = [
    `RUNWAY ${state.config.mode === 'daily' ? `Daily London ${state.config.dayKey}` : 'practice run'}`,
    head,
    ladder,
    r.outcome === 'bust'
      ? `Peak valuation ${formatMoney(r.peakValuation)}`
      : `Founders kept ${(r.equity * 100).toFixed(0)}% → walked away with ${formatMoney(r.payout)}`,
    url,
  ];
  return lines.join('\n');
}
