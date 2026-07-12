/**
 * RUNWAY — the London startup game.
 *
 * All game domain types live here. The engine (engine.ts) is a pure state
 * machine over these types: no DOM, no React, no globals — so the whole game
 * can be simulated headless in scripts/test-game.ts.
 */

import type { RngState } from './rng';

// ---------------------------------------------------------------------------
// Static content shapes (defined in content.ts)
// ---------------------------------------------------------------------------

export type SectorId = 'ai' | 'fintech' | 'climate' | 'healthtech' | 'devtools' | 'consumer';

export interface Sector {
  id: SectorId;
  name: string;
  emoji: string;
  tagline: string;
  /** Plain-English strengths/weaknesses shown on the picker card. */
  perk: string;
  drawback: string;
  /** Stat multipliers applied by the engine. 1 = neutral. */
  hypeGainMult: number;
  hypeDecayMult: number;
  buildMult: number;
  tractionMult: number;
  burnMult: number;
  /** Extra pitch difficulty (positive = investors are warier). */
  pitchBar: number;
}

export type HubId =
  | 'shoreditch'
  | 'kingscross'
  | 'soho'
  | 'farringdon'
  | 'canarywharf'
  | 'londonbridge'
  | 'camden'
  | 'battersea';

export interface Hub {
  id: HubId;
  name: string;
  areaLabel: string;
  lng: number;
  lat: number;
  /** Weekly office rent in £. */
  rent: number;
  /** Plain-English pitch for the picker. */
  blurb: string;
  /** Bonus knobs the engine reads. 1 = neutral. */
  eventFrequencyMult: number;
  hireQualityMult: number;
  hypeMult: number;
  /** Sector that feels at home here (small synergy bonus), if any. */
  synergySector?: SectorId;
}

export type StageId = 'garage' | 'preseed' | 'seed' | 'seriesA' | 'seriesB' | 'seriesC' | 'unicorn';

export interface Stage {
  id: StageId;
  name: string;
  /** Cash injected when the round closes, in £. */
  raise: number;
  /** Post-money valuation reached, in £. */
  valuation: number;
  /** Minimum stats before investors will even take the meeting. */
  minProduct: number;
  minTraction: number;
  /** Base success chance at exactly the minimums (modifiers push it up). */
  baseOdds: number;
}

// ---------------------------------------------------------------------------
// Dynamic world objects
// ---------------------------------------------------------------------------

export interface Rival {
  id: string;
  name: string;
  sectorId: SectorId;
  hubId: HubId;
  stageIndex: number; // index into STAGES
  /** Hidden momentum: how likely they are to advance each week. */
  heat: number;
  alive: boolean;
  /** Week they reached unicorn, if they did. */
  unicornWeek?: number;
}

export type EventKind = 'demo' | 'social' | 'talk' | 'pitch' | 'party';

export interface WeekEvent {
  id: string;
  name: string;
  venue: string;
  hubId: HubId;
  kind: EventKind;
  sectorId?: SectorId; // sector-themed events give a synergy bonus
  attended: boolean;
}

export interface Dilemma {
  id: string;
  title: string;
  body: string;
  options: DilemmaOption[];
  /** Engine-side gate: can this card fire in the current state? */
  condition?: string; // documented key checked in engine.ts
  weight: number;
  once: boolean;
}

export interface DilemmaOption {
  label: string;
  detail: string;
  effectId: string; // resolved in engine.ts applyDilemmaChoice
}

export type NewsTone = 'good' | 'bad' | 'neutral' | 'money' | 'rival';

export interface NewsItem {
  week: number;
  tone: NewsTone;
  text: string;
}

// ---------------------------------------------------------------------------
// Player actions
// ---------------------------------------------------------------------------

export type ActionId =
  | 'build'
  | 'growth'
  | 'hire'
  | 'press'
  | 'retreat'
  | 'pitch'
  | 'attend' // takes an event id payload
  | 'move'; // takes a hub id payload

export interface ActionInfo {
  id: ActionId;
  name: string;
  focusCost: number;
  hotkey: string;
  blurb: string;
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export type GamePhase = 'playing' | 'dilemma' | 'won' | 'bankrupt' | 'acquired';

export interface CompanyStats {
  cash: number;
  team: number;
  product: number; // 0..100
  traction: number; // users, unbounded
  hype: number; // 0..100
  morale: number; // 0..100
  connections: number; // investor intros collected at events
}

export interface GameState {
  /** Bumped when the save format changes; old saves are discarded. */
  version: number;
  seed: number;
  rng: RngState;
  phase: GamePhase;

  companyName: string;
  sectorId: SectorId;
  hubId: HubId;

  week: number;
  focusLeft: number;
  stats: CompanyStats;
  stageIndex: number; // index into STAGES; the stage already CLOSED
  valuation: number;

  /** Weeks until investors will hear another pitch (0 = ready). */
  pitchCooldown: number;
  /** One emergency bridge round is offered on first bankruptcy. */
  bridgeUsed: boolean;

  eventsThisWeek: WeekEvent[];
  pendingDilemma: Dilemma | null;
  firedDilemmas: string[];

  rivals: Rival[];
  news: NewsItem[];

  /** Set when the game ends, for the end screen. */
  endSummary?: string;
  /** Transient render hints consumed by the UI (confetti, shake...). */
  fx: FxEvent[];
}

export interface FxEvent {
  kind: 'confetti' | 'cash' | 'bad' | 'unicorn' | 'stamp';
  /** World anchor; defaults to player HQ when omitted. */
  hubId?: HubId;
  note?: string;
}

export interface NewGameConfig {
  companyName: string;
  sectorId: SectorId;
  hubId: HubId;
  seed?: number;
}
