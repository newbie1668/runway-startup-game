/**
 * RUNWAY — the game engine.
 *
 * A pure, deterministic state machine: every function takes a GameState and
 * returns a new one, with all randomness drawn from the seeded RNG stored in
 * the state itself. No DOM, no React, no Date.now() — which means the entire
 * game can be replayed from a seed and simulated headless in
 * scripts/test-game.ts (the balance bot).
 */

import {
  ACTIONS,
  DILEMMAS,
  EVENT_TEMPLATES,
  HUBS,
  NEWS_FLAVOUR,
  RIVAL_TAUNTS,
  STAGES,
  UNICORN_TARGET,
  VENUES_BY_HUB,
  generateCompanyName,
  hubById,
  sectorById,
} from './content';
import { Dice, seedFromString } from './rng';
import type {
  ActionId,
  Dilemma,
  DilemmaEffectId,
  FxEvent,
  CompanyStats,
  GameState,
  HubId,
  NewGameConfig,
  NewsTone,
  Rival,
  SectorId,
  WeekEvent,
} from './types';

export const SAVE_VERSION = 3;
export const FOCUS_PER_WEEK = 2;
export const STARTING_CASH = 48_000;

const BURN_PER_HEAD = 1_150; // £/week before sector multiplier
const HIRE_FEE = 1_500;
const MOVE_FEE = 3_000;
const RETREAT_BASE_COST = 400;
const DILEMMA_CHANCE = 0.24;
const MAX_NEWS = 120;

// Revenue per user per week, in £. Fintech monetises harder.
const REV_PER_USER: Record<SectorId, number> = {
  ai: 0.3,
  fintech: 0.85,
  climate: 0.4,
  healthtech: 0.45,
  devtools: 0.5,
  consumer: 0.18,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

export function newGame(config: NewGameConfig): GameState {
  const seed =
    config.seed ??
    seedFromString(`${config.companyName}|${config.sectorId}|${config.hubId}`) ^
      Math.floor(Math.random() * 0xffffffff);
  const dice = new Dice(seed >>> 0);

  const rivals = makeRivals(dice, config);

  const state: GameState = {
    version: SAVE_VERSION,
    seed: seed >>> 0,
    rng: 0, // set below after all setup draws
    phase: 'playing',
    companyName: config.companyName.trim() || 'Untitled Ltd',
    sectorId: config.sectorId,
    hubId: config.hubId,
    week: 1,
    focusLeft: FOCUS_PER_WEEK,
    stats: {
      cash: STARTING_CASH,
      team: 2,
      product: 5,
      traction: 0,
      hype: 12,
      morale: 75,
      connections: 1,
    },
    stageIndex: 0,
    valuation: 0,
    pitchCooldown: 0,
    bridgeUsed: false,
    eventsThisWeek: [],
    pendingDilemma: null,
    firedDilemmas: [],
    rivals,
    news: [],
    fx: [],
  };

  state.eventsThisWeek = rollEvents(state, dice);
  state.rng = dice.state;

  pushNews(
    state,
    'neutral',
    `Week 1. Two founders, one laptop each, and £${(STARTING_CASH / 1000).toFixed(0)}k of savings. Welcome to ${hubById(config.hubId).name}.`,
  );
  return state;
}

function makeRivals(dice: Dice, config: NewGameConfig): Rival[] {
  const sectors: SectorId[] = ['ai', 'fintech', 'climate', 'healthtech', 'devtools', 'consumer'];
  const rivals: Rival[] = [];
  const usedNames = new Set<string>([config.companyName.toLowerCase()]);
  const hubs = dice.shuffle(HUBS.map((h) => h.id)).filter((h) => h !== config.hubId);

  for (let i = 0; i < 4; i++) {
    let name = generateCompanyName(dice);
    while (usedNames.has(name.toLowerCase())) name = generateCompanyName(dice);
    usedNames.add(name.toLowerCase());
    rivals.push({
      id: `rival-${i}`,
      name,
      sectorId: i === 0 ? config.sectorId : dice.pick(sectors), // one direct competitor
      hubId: hubs[i % hubs.length],
      stageIndex: dice.chance(0.5) ? 1 : 0,
      heat: 0.55 + dice.float() * 0.45,
      alive: true,
    });
  }
  return rivals;
}

// ---------------------------------------------------------------------------
// News + fx helpers (mutate the freshly-cloned state inside reducers)
// ---------------------------------------------------------------------------

function pushNews(state: GameState, tone: NewsTone, text: string) {
  state.news.push({ week: state.week, tone, text });
  if (state.news.length > MAX_NEWS) state.news.splice(0, state.news.length - MAX_NEWS);
}

function pushFx(state: GameState, fx: FxEvent) {
  state.fx.push(fx);
}

function clone(state: GameState): GameState {
  // structuredClone exists in Node 17+ and all modern browsers.
  return structuredClone(state);
}

// ---------------------------------------------------------------------------
// Derived values the UI also needs
// ---------------------------------------------------------------------------

export function weeklyBurn(state: GameState): number {
  const sector = sectorById(state.sectorId);
  const hub = hubById(state.hubId);
  return Math.round(state.stats.team * BURN_PER_HEAD * sector.burnMult + hub.rent);
}

export function weeklyRevenue(state: GameState): number {
  return Math.round(state.stats.traction * REV_PER_USER[state.sectorId]);
}

/** Weeks of cash left at current net burn; Infinity if profitable. */
export function runwayWeeks(state: GameState): number {
  const net = weeklyBurn(state) - weeklyRevenue(state);
  if (net <= 0) return Infinity;
  return Math.max(0, state.stats.cash) / net;
}

export function nextStage(state: GameState) {
  return state.stageIndex + 1 < STAGES.length ? STAGES[state.stageIndex + 1] : null;
}

/** Soft ceiling on product for the current team size — forces hiring to scale. */
export function productCap(state: GameState): number {
  return Math.min(100, 26 + state.stats.team * 9);
}

/** Add positive product progress without ever erasing work above a reduced team cap. */
function addProductToCap(state: GameState, gain: number): number {
  const before = state.stats.product;
  const ceiling = Math.max(before, productCap(state));
  state.stats.product = clamp(before + Math.max(0, gain), 0, ceiling);
  return state.stats.product - before;
}

/** Add to a 0..100 company stat and return the gain that survived the cap. */
function addBoundedStat(stats: CompanyStats, key: 'hype' | 'morale', gain: number): number {
  const before = stats[key];
  stats[key] = clamp(before + gain, 0, 100);
  return stats[key] - before;
}

export interface PitchReadiness {
  ready: boolean;
  reasons: string[];
  odds: number;
}

export function pitchReadiness(state: GameState): PitchReadiness {
  const stage = nextStage(state);
  const reasons: string[] = [];
  if (!stage) return { ready: false, reasons: ['You already did the thing.'], odds: 0 };
  if (state.stats.product < stage.minProduct)
    reasons.push(`Product ${Math.floor(state.stats.product)}/${stage.minProduct}`);
  if (state.stats.traction < stage.minTraction)
    reasons.push(
      `Users ${Math.floor(state.stats.traction).toLocaleString()}/${stage.minTraction.toLocaleString()}`,
    );
  if (state.pitchCooldown > 0)
    reasons.push(
      `Investors need ${state.pitchCooldown} more week${state.pitchCooldown > 1 ? 's' : ''}`,
    );
  return { ready: reasons.length === 0, reasons, odds: pitchOdds(state) };
}

export function pitchOdds(state: GameState): number {
  const stage = nextStage(state);
  if (!stage) return 0;
  const s = state.stats;
  const sector = sectorById(state.sectorId);
  let odds = stage.baseOdds;
  odds += clamp((s.product - stage.minProduct) * 0.007, 0, 0.14);
  odds += clamp((s.traction / Math.max(1, stage.minTraction) - 1) * 0.1, 0, 0.12);
  odds += s.hype * 0.0022;
  odds += clamp(s.connections * 0.028, 0, 0.17);
  odds += (s.morale - 60) * 0.001;
  odds -= sector.pitchBar / 100;
  return clamp(odds, 0.05, 0.93);
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

export interface ActionResult {
  state: GameState;
  ok: boolean;
  message: string;
}

export function performAction(
  prev: GameState,
  actionId: ActionId,
  payload?: { eventId?: string; hubId?: HubId },
): ActionResult {
  if (prev.phase !== 'playing') return { state: prev, ok: false, message: 'The game is over.' };
  const info = ACTIONS.find((a) => a.id === actionId);
  const focusCost = actionId === 'attend' || actionId === 'move' ? 1 : (info?.focusCost ?? 1);
  if (prev.focusLeft < focusCost)
    return { state: prev, ok: false, message: 'Out of focus this week — advance to next week.' };

  const state = clone(prev);
  const dice = new Dice(state.rng);
  const s = state.stats;
  const sector = sectorById(state.sectorId);
  const hub = hubById(state.hubId);
  const sceneMult = hub.synergySector === state.sectorId ? 1.1 : 1;
  let message = '';

  switch (actionId) {
    case 'build': {
      const moraleFactor = 0.55 + s.morale * 0.006;
      const cap = productCap(state);
      // Gain shrinks to zero at the team's cap — hiring is the only way past it.
      const headroom = clamp(1 - s.product / cap, 0, 1);
      const gain =
        (2.3 + 1.9 * Math.sqrt(s.team)) *
        moraleFactor *
        sector.buildMult *
        sceneMult *
        Math.sqrt(headroom);
      const actualGain = addProductToCap(state, gain);
      message =
        headroom < 0.15
          ? `Product +${actualGain.toFixed(1)} — the team of ${s.team} is at its limit. Hire to go further.`
          : `Product +${actualGain.toFixed(1)}. The demo gets better every week.`;
      break;
    }
    case 'growth': {
      const gain =
        (18 + s.traction * 0.085) *
        (0.25 + s.product / 70) *
        sector.tractionMult *
        sceneMult *
        (1 + s.hype / 140);
      s.traction = Math.max(0, s.traction + gain);
      s.hype = clamp(s.hype + 2, 0, 100);
      message = `+${Math.round(gain).toLocaleString()} users from launches and outreach.`;
      break;
    }
    case 'hire': {
      if (s.cash < HIRE_FEE * 3) {
        return { state: prev, ok: false, message: 'Too broke to hire responsibly.' };
      }
      s.cash -= HIRE_FEE;
      s.team += 1;
      const great = dice.chance(0.22 * hub.hireQualityMult);
      if (great) {
        s.product = clamp(s.product + 4, 0, 100);
        s.morale = clamp(s.morale + 5, 0, 100);
        message = `Hired a star — a ${hub.name} local. Product +4, morale +5, burn up.`;
      } else {
        s.morale = clamp(s.morale + 2, 0, 100);
        message = `Team is now ${s.team}. Output up — and so is the burn.`;
      }
      break;
    }
    case 'press': {
      const gain = (8 + s.product * 0.09) * sector.hypeGainMult * hub.hypeMult;
      const actualHypeGain = addBoundedStat(s, 'hype', gain);
      s.traction += Math.round(s.traction * 0.02 + 4);
      message = `Hype +${actualHypeGain.toFixed(0)}. A journalist replied with "interesting!!"`;
      break;
    }
    case 'retreat': {
      const cost = RETREAT_BASE_COST + 150 * s.team;
      s.cash -= cost;
      s.morale = clamp(s.morale + 13, 0, 100);
      message = `Morale +13 for £${cost.toLocaleString()}. Someone put karaoke on the culture deck.`;
      break;
    }
    case 'pitch': {
      const readiness = pitchReadiness(state);
      if (!readiness.ready) {
        return {
          state: prev,
          ok: false,
          message: `Investors pass: ${readiness.reasons.join(' · ')}`,
        };
      }
      const stage = nextStage(state)!;
      if (dice.chance(readiness.odds)) {
        state.stageIndex += 1;
        state.valuation = stage.valuation;
        s.cash += stage.raise;
        s.hype = clamp(s.hype + 18, 0, 100);
        s.morale = clamp(s.morale + 10, 0, 100);
        s.connections = Math.ceil(s.connections / 2);
        state.pitchCooldown = 4;
        const line = dice
          .pick(NEWS_FLAVOUR.raiseClosed)
          .replace('{co}', state.companyName)
          .replace('{stage}', stage.name);
        pushNews(state, 'money', line);
        pushFx(state, { kind: 'confetti' });
        pushFx(state, { kind: 'cash', note: `+£${(stage.raise / 1_000_000).toFixed(1)}M` });
        message = `${stage.name} CLOSED — £${(stage.raise / 1_000_000).toFixed(1)}M in the bank.`;
        if (stage.id === 'unicorn') {
          finishGame(state, 'won');
        }
      } else {
        s.hype = clamp(s.hype - 10, 0, 100);
        s.morale = clamp(s.morale - 6, 0, 100);
        s.connections = Math.max(0, s.connections - 1);
        state.pitchCooldown = 3;
        const line = dice.pick(NEWS_FLAVOUR.pitchFailed).replace('{co}', state.companyName);
        pushNews(state, 'bad', line);
        pushFx(state, { kind: 'bad' });
        message = 'Passed. "Come back with more traction." Hype and morale took a hit.';
      }
      break;
    }
    case 'attend': {
      const ev = state.eventsThisWeek.find((e) => e.id === payload?.eventId);
      if (!ev || ev.attended)
        return { state: prev, ok: false, message: 'That event is over (or you already went).' };
      ev.attended = true;
      const synergy = ev.sectorId === state.sectorId;
      const mult = synergy ? 2 : 1;
      switch (ev.kind) {
        case 'social': {
          s.connections += Math.round(2 * mult);
          const moraleGain = addBoundedStat(s, 'morale', 3 * mult);
          message = `Met ${Math.round(2 * mult)} useful people over lukewarm wine. Morale +${Math.round(moraleGain)}.`;
          break;
        }
        case 'pitch':
          s.connections += Math.round(3 * mult);
          message = `Investor intros +${Math.round(3 * mult)}. Business cards still exist, apparently.`;
          break;
        case 'talk': {
          const contacts = Math.round(mult);
          s.connections += contacts;
          message = `Took actual notes. Product +${addProductToCap(state, 2 * mult).toFixed(1)} and ${contacts} new contact${contacts === 1 ? '' : 's'}.`;
          break;
        }
        case 'demo': {
          const contacts = Math.round(mult);
          const hypeGain = addBoundedStat(s, 'hype', 6 * mult);
          s.connections += contacts;
          message = `Demoed on stage. Hype +${Math.round(hypeGain)} and investor intros +${contacts}.`;
          break;
        }
        case 'party': {
          const contacts = Math.round(mult);
          const moraleGain = addBoundedStat(s, 'morale', 6 * mult);
          const hypeGain = addBoundedStat(s, 'hype', 3 * mult);
          s.connections += contacts;
          message = `Danced badly with two angels and a unicorn intern. Morale +${Math.round(moraleGain)}, hype +${Math.round(hypeGain)}, intros +${contacts}.`;
          break;
        }
      }
      if (synergy) message += ' (Your scene — double value.)';
      break;
    }
    case 'move': {
      const target = payload?.hubId;
      if (!target || target === state.hubId)
        return { state: prev, ok: false, message: 'Pick a different neighbourhood.' };
      if (s.cash < MOVE_FEE)
        return { state: prev, ok: false, message: `Moving costs £${MOVE_FEE.toLocaleString()}.` };
      s.cash -= MOVE_FEE;
      state.hubId = target;
      s.morale = clamp(s.morale - 3, 0, 100);
      pushFx(state, { kind: 'stamp', hubId: target });
      message = `Moved to ${hubById(target).name}. New rent: £${hubById(target).rent.toLocaleString()}/wk.`;
      pushNews(state, 'neutral', `${state.companyName} relocates to ${hubById(target).name}.`);
      break;
    }
  }

  state.focusLeft -= focusCost;
  state.rng = dice.state;
  return { state, ok: true, message };
}

// ---------------------------------------------------------------------------
// End of week
// ---------------------------------------------------------------------------

export function endWeek(prev: GameState): GameState {
  if (prev.phase !== 'playing') return prev;
  const state = clone(prev);
  const dice = new Dice(state.rng);
  const s = state.stats;
  const sector = sectorById(state.sectorId);

  // Cash flow.
  const burn = weeklyBurn(state);
  const revenue = weeklyRevenue(state);
  s.cash += revenue - burn;

  // Organic traction: hype and a real product attract users; misery churns them.
  const organic = s.traction * (0.002 + s.hype * 0.0006) + (s.product > 18 ? s.product * 0.25 : 0);
  const churn = s.morale < 35 ? s.traction * 0.04 : 0;
  s.traction = Math.max(0, s.traction + organic - churn);

  // Drift: hype decays, morale creeps toward its resting point.
  s.hype = clamp(s.hype * (1 - 0.055 * sector.hypeDecayMult), 0, 100);
  s.morale = clamp(s.morale + (60 - s.morale) * 0.05 - 0.6, 0, 100);
  state.pitchCooldown = Math.max(0, state.pitchCooldown - 1);

  // Unused focus becomes idle tinkering.
  if (state.focusLeft > 0) {
    addProductToCap(state, 0.4 * state.focusLeft);
  }

  // Rivals hustle too.
  tickRivals(state, dice);

  // Money trouble?
  if (s.cash < 0) {
    if (!state.bridgeUsed && state.stageIndex >= 1) {
      state.pendingDilemma = bridgeDilemma();
      state.phase = 'dilemma';
      state.bridgeUsed = true;
      state.week += 1;
      state.focusLeft = FOCUS_PER_WEEK;
      state.eventsThisWeek = rollEvents(state, dice);
      state.rng = dice.state;
      return state;
    }
    finishGame(state, 'bankrupt');
    state.rng = dice.state;
    return state;
  }

  // A dilemma may land (only when nothing else is pending).
  if (!state.pendingDilemma && dice.chance(DILEMMA_CHANCE)) {
    const card = drawDilemma(state, dice);
    if (card) {
      state.pendingDilemma = card;
      state.phase = 'dilemma';
    }
  }

  // Flavour so quiet weeks still feel alive.
  if (dice.chance(0.3)) {
    pushNews(state, 'neutral', dice.pick(NEWS_FLAVOUR.weekQuiet));
  }

  // Next week begins.
  state.week += 1;
  state.focusLeft = FOCUS_PER_WEEK;
  state.eventsThisWeek = rollEvents(state, dice);
  state.rng = dice.state;
  return state;
}

function tickRivals(state: GameState, dice: Dice) {
  for (const rival of state.rivals) {
    if (!rival.alive || rival.stageIndex >= STAGES.length - 1) continue;
    if (dice.chance(0.0035)) {
      rival.alive = false;
      pushNews(state, 'rival', `${rival.name} has quietly shut down. Pour one out.`);
      continue;
    }
    const nextIndex = rival.stageIndex + 1;
    const p = rival.heat * 0.085 * (1 - nextIndex * 0.055);
    if (dice.chance(p)) {
      rival.stageIndex = nextIndex;
      const stage = STAGES[nextIndex];
      if (stage.id === 'unicorn') {
        rival.unicornWeek = state.week;
        pushNews(
          state,
          'rival',
          `🦄 ${rival.name} just hit a ${UNICORN_TARGET.compactLabel} valuation. The race is real.`,
        );
      } else {
        pushNews(
          state,
          'rival',
          `${rival.name} closed their ${stage.name}. ${dice.pick(RIVAL_TAUNTS)}`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Weekly events on the map
// ---------------------------------------------------------------------------

function rollEvents(state: GameState, dice: Dice): WeekEvent[] {
  const localScene = hubById(state.hubId).eventFrequencyMult;
  const count =
    1 +
    (dice.chance(clamp(0.65 * localScene, 0, 1)) ? 1 : 0) +
    (dice.chance(clamp(0.3 * localScene, 0, 1)) ? 1 : 0);
  const events: WeekEvent[] = [];
  const templates = dice.shuffle(EVENT_TEMPLATES);
  for (let i = 0; i < count && i < templates.length; i++) {
    const t = templates[i];
    // Busier hubs host more events; the player's own hub gets a nudge so the
    // neighbourhood choice is felt.
    const hub = dice.weighted(HUBS, (h) => h.eventFrequencyMult * (h.id === state.hubId ? 1.5 : 1));
    events.push({
      id: `w${state.week}-e${i}`,
      name: t.name,
      venue: dice.pick(VENUES_BY_HUB[hub.id]),
      hubId: hub.id,
      kind: t.kind,
      sectorId: t.sectorId,
      attended: false,
    });
  }
  return events;
}

// ---------------------------------------------------------------------------
// Dilemmas
// ---------------------------------------------------------------------------

function dilemmaAllowed(state: GameState, d: Dilemma): boolean {
  if (d.once && state.firedDilemmas.includes(d.id)) return false;
  switch (d.condition) {
    case undefined:
      return true;
    case 'funded':
      return state.stageIndex >= 1;
    case 'team3':
      return state.stats.team >= 3;
    case 'hype40':
      return state.stats.hype >= 40;
    case 'traction1k':
      return state.stats.traction >= 1000;
    case 'lowMorale':
      return state.stats.morale < 45;
  }
  return assertNeverCondition(d.condition);
}

function assertNeverCondition(condition: never): boolean {
  throw new Error(`Unhandled dilemma condition: ${condition}`);
}

function drawDilemma(state: GameState, dice: Dice): Dilemma | null {
  const pool = DILEMMAS.filter((d) => dilemmaAllowed(state, d));
  if (pool.length === 0) return null;
  const card = dice.weighted(pool, (d) => d.weight);
  state.firedDilemmas.push(card.id);
  return card;
}

function bridgeDilemma(): Dilemma {
  return {
    id: 'bridge',
    title: 'The bank balance is red',
    body: 'You cannot make payroll. Your lead investor offers an emergency bridge — cash to survive, at a punishing valuation haircut.',
    weight: 0,
    once: true,
    options: [
      {
        label: 'Take the bridge',
        detail: 'Survive. Valuation takes a 25% haircut; the team notices.',
        effectId: 'bridge_accept',
      },
      {
        label: 'Wind it down with dignity',
        detail: 'Game over — but on your own terms.',
        effectId: 'bridge_decline',
      },
    ],
  };
}

export function applyDilemmaChoice(prev: GameState, effectId: DilemmaEffectId): GameState {
  if (
    !prev.pendingDilemma ||
    !prev.pendingDilemma.options.some((option) => option.effectId === effectId)
  ) {
    return prev;
  }
  const state = clone(prev);
  const dice = new Dice(state.rng);
  const s = state.stats;
  state.pendingDilemma = null;
  state.phase = 'playing';

  switch (effectId) {
    case 'acquihire_accept': {
      const offer = Math.max(2_000_000, Math.round(state.valuation * 0.35));
      state.valuation = offer;
      finishGame(state, 'acquired');
      pushNews(state, 'money', `${state.companyName} acquired. The Slack goes quiet forever.`);
      break;
    }
    case 'acquihire_decline':
      s.morale = clamp(s.morale + 8, 0, 100);
      s.hype = clamp(s.hype + 10, 0, 100);
      pushNews(
        state,
        'good',
        `${state.companyName} turns down an acquisition. "We're just getting started."`,
      );
      break;
    case 'poach_counter':
      s.cash -= 4_000;
      s.morale = clamp(s.morale + 4, 0, 100);
      pushNews(state, 'neutral', 'Counter-offered. They stayed. Payroll winces.');
      break;
    case 'poach_release':
      s.team = Math.max(1, s.team - 1);
      s.morale = clamp(s.morale - 9, 0, 100);
      pushNews(state, 'bad', 'Your engineer left for the rival. The standup is quieter.');
      break;
    case 'viral_leanin':
      s.hype = clamp(s.hype + 22, 0, 100);
      s.product = clamp(s.product - 2, 0, 100);
      s.traction += Math.round(60 + s.traction * 0.12);
      pushNews(state, 'good', 'You leaned into the meme. The sign-ups are real.');
      break;
    case 'viral_ignore':
      s.hype = clamp(s.hype + 6, 0, 100);
      pushNews(state, 'neutral', 'You stayed heads-down. The internet moved on by Tuesday.');
      break;
    case 'flood_pay':
      s.cash -= 6_000;
      pushNews(state, 'neutral', 'Flood repairs paid. The office smells of paint and resilience.');
      break;
    case 'flood_cafes':
      s.morale = clamp(s.morale - 8, 0, 100);
      s.product = clamp(s.product - 3, 0, 100);
      pushNews(state, 'bad', 'Three weeks of café WiFi. The baristas know your standup by heart.');
      break;
    case 'enterprise_sign':
      s.cash += 45_000;
      s.hype = clamp(s.hype - 5, 0, 100);
      s.morale = clamp(s.morale - 4, 0, 100);
      pushNews(state, 'money', 'Enterprise deal signed. The roadmap now has a corner office.');
      break;
    case 'enterprise_decline':
      s.morale = clamp(s.morale + 6, 0, 100);
      pushNews(state, 'good', 'Stayed product-led. The whale swam on.');
      break;
    case 'journalist_open': {
      if (dice.chance(0.65)) {
        s.hype = clamp(s.hype + 18, 0, 100);
        s.traction += Math.round(40 + s.traction * 0.08);
        pushNews(
          state,
          'good',
          `The feature ran: "${state.companyName}: the most interesting startup in London?"`,
        );
      } else {
        s.hype = clamp(s.hype - 12, 0, 100);
        s.morale = clamp(s.morale - 8, 0, 100);
        pushNews(
          state,
          'bad',
          'The piece ran with the headline "Chaos, cold brew and missed payroll".',
        );
      }
      break;
    }
    case 'journalist_decline':
      pushNews(state, 'neutral', 'You declined the profile. Mystique intact.');
      break;
    case 'accelerator_join':
      s.cash += 100_000;
      s.connections += 5;
      s.morale = clamp(s.morale - 8, 0, 100);
      state.valuation = Math.round(state.valuation * 0.93);
      pushNews(state, 'money', 'Joined the accelerator batch. Demo day looms.');
      break;
    case 'accelerator_decline':
      pushNews(state, 'neutral', 'Passed on the accelerator. The cap table thanks you.');
      break;
    case 'outage_warroom':
      s.morale = clamp(s.morale - 10, 0, 100);
      s.product = clamp(s.product + 3, 0, 100);
      pushNews(state, 'neutral', 'Back up in 6 hours. The post-incident pizza was medicinal.');
      break;
    case 'outage_postmortem':
      s.traction = Math.max(0, s.traction * 0.94);
      s.hype = clamp(s.hype + 6, 0, 100);
      s.morale = clamp(s.morale + 4, 0, 100);
      pushNews(state, 'good', 'Your candid post-mortem trended on Hacker News. Respect earned.');
      break;
    case 'burnout_rest':
      s.morale = clamp(s.morale + 20, 0, 100);
      s.product = clamp(s.product - 1.5, 0, 100);
      pushNews(state, 'good', 'Everyone took a real week off. The office plants survived.');
      break;
    case 'burnout_push': {
      if (dice.chance(0.5)) {
        s.product = clamp(s.product + 5, 0, 100);
        s.morale = clamp(s.morale - 6, 0, 100);
        pushNews(state, 'neutral', 'The milestone shipped. The team is proud and exhausted.');
      } else {
        s.team = Math.max(1, s.team - 1);
        s.morale = clamp(s.morale - 14, 0, 100);
        pushNews(state, 'bad', 'Someone quit via a calendar invite titled "resignation :(".');
      }
      break;
    }
    case 'regulator_lawyers':
      s.cash -= 12_000;
      pushNews(state, 'neutral', 'The lawyers handled it. The invoice has its own gravity.');
      break;
    case 'regulator_inhouse': {
      if (dice.chance(0.6)) {
        pushNews(state, 'good', 'Your in-house response satisfied the regulator. Bullet dodged.');
      } else {
        s.cash -= 25_000;
        s.hype = clamp(s.hype - 8, 0, 100);
        pushNews(
          state,
          'bad',
          'The regulator disagreed. The fine stings; the headline stings more.',
        );
      }
      break;
    }
    case 'bridge_accept': {
      const lastStage = STAGES[state.stageIndex];
      const injection = Math.max(40_000, Math.round(lastStage.raise * 0.3));
      s.cash = Math.max(s.cash, 0) + injection;
      state.valuation = Math.round(state.valuation * 0.75);
      s.morale = clamp(s.morale - 8, 0, 100);
      pushNews(
        state,
        'money',
        `Bridge round: +£${Math.round(injection / 1000)}k. Valuation haircut accepted through gritted teeth.`,
      );
      break;
    }
    case 'bridge_decline':
      finishGame(state, 'bankrupt');
      break;
    default:
      return assertNeverEffect(effectId);
  }

  state.rng = dice.state;
  return state;
}

function assertNeverEffect(effectId: never): GameState {
  throw new Error(`Unhandled dilemma effect: ${effectId}`);
}

// ---------------------------------------------------------------------------
// Endings
// ---------------------------------------------------------------------------

function finishGame(state: GameState, phase: 'won' | 'bankrupt' | 'acquired') {
  state.phase = phase;
  const rivalUnicorns = state.rivals.filter((r) => r.unicornWeek !== undefined).length;
  if (phase === 'won') {
    pushFx(state, { kind: 'unicorn' });
    state.endSummary =
      rivalUnicorns === 0
        ? `Unicorn in ${state.week} weeks — first in your cohort. The pigeons of ${hubById(state.hubId).name} coo your name.`
        : `Unicorn in ${state.week} weeks — ${rivalUnicorns} rival${rivalUnicorns > 1 ? 's' : ''} got there first, but a billion is a billion.`;
    pushNews(state, 'money', `🦄 ${state.companyName} is a UNICORN. Drinks are on the cap table.`);
  } else if (phase === 'acquired') {
    state.endSummary = `Acquired in week ${state.week}. Not the fairy tale — but a real exit, and everyone got paid.`;
  } else {
    pushFx(state, { kind: 'bad' });
    state.endSummary = `Out of runway in week ${state.week}. The domain lapses in 12 months; the lessons never will.`;
    pushNews(state, 'bad', `${state.companyName} has shut down. Laptop stickers remain.`);
  }
}

/** Final score for the end screen. */
export function score(state: GameState): number {
  return Math.max(0, Math.round(state.valuation + Math.max(0, state.stats.cash)));
}

/** UI consumes pending fx and clears the queue. */
export function drainFx(prev: GameState): { state: GameState; fx: FxEvent[] } {
  if (prev.fx.length === 0) return { state: prev, fx: [] };
  const state = clone(prev);
  const fx = state.fx;
  state.fx = [];
  return { state, fx };
}
