/**
 * RUNWAY: London Live — map-based startup sim prototype (domain types).
 *
 * StarCraft/Civ-style control of a startup: your team are people you send
 * around London. Work only happens at places — engineers ship the roadmap at
 * your office, growth people sign users at customer spots, anyone can recruit
 * at talent spots, and the founder pitches at investor offices. Rival
 * startups play by the same rules and compete for the same customers, hires,
 * pins and investors. No territory, no combat.
 *
 * Time is in in-game days (floats). The sim is pure and deterministic: same
 * seed + same command log => same state. No DOM, Math.random or Date.
 */

import type { HubId, SectorId } from '@/lib/game/types';
import type { RngState } from '@/lib/game/rng';
import type { LandmarkKind } from '@/lib/game/geo';

export type CompanyId = 'player' | 'rival1' | 'rival2' | 'rival3';
export type Role = 'founder' | 'engineer' | 'growth';

/** Roadmap ("tech tree") features. */
export type FeatureId =
  | 'mvp'
  | 'onboarding'
  | 'payments'
  | 'mobile'
  | 'api'
  | 'analytics'
  | 'enterprise'
  | 'aiAssist';

/** Customer segments. Each customer spot sells to one; most need a feature first. */
export type Segment = 'earlyAdopters' | 'consumers' | 'smb' | 'developers' | 'enterprise';

export type ObjectiveSpec =
  | { kind: 'stage'; atLeast: number; label: string }          // company.stageIndex >= atLeast
  | { kind: 'users'; atLeast: number; label: string }
  | { kind: 'shipped'; count: number; label: string }          // company.shipped.length >= count
  | { kind: 'feature'; id: FeatureId; label: string }
  | { kind: 'segment'; id: Segment; label: string }            // unlockedSegments(player) includes id
  | { kind: 'officeLevel'; atLeast: number; label: string }    // any player office level >= atLeast
  | { kind: 'offices'; count: number; label: string }          // player office count >= count
  | { kind: 'team'; count: number; label: string }             // player people count >= count
  | { kind: 'journal'; count: number; label: string }          // journalProgress().found >= count
  | { kind: 'leadsWon'; count: number; label: string };        // stats.leadsWon >= count (cumulative)

export interface ChapterSpec {
  id: string;
  title: string;
  /** Where the briefing camera flies. 'hq' = player's HQ office. */
  focus: { kind: 'hq' } | { kind: 'landmark'; landmark: LandmarkKind };
  briefing: string;
  objectives: ObjectiveSpec[];
  bonus: ObjectiveSpec;
  /** Days from chapter start; finishing within par earns the third star. */
  parDays: number;
  /** Applied once when the bonus is completed (while the chapter is active). */
  bonusReward: { cash: number; hype: number };
}

export interface Feature {
  id: FeatureId;
  name: string;
  blurb: string;
  /** Build points engineers must put in to ship it. */
  cost: number;
  requires: FeatureId[];
  /** Product score added on ship (product is capped at 100). */
  quality: number;
  /** Segment this feature opens up, if any. */
  unlocks?: Segment;
  /** Multiplier on revenue per user once shipped (stacks multiplicatively). */
  arpuMult?: number;
  /** Multiplier on signup speed once shipped (stacks multiplicatively). */
  signupMult?: number;
  /** One-off hype on ship. */
  hype?: number;
}

export interface OfficeLevel {
  name: string;
  /** Team members this office adds to your team cap. */
  capacity: number;
  /** Weekly rent, as a multiple of the hub's base rent (0 = free). */
  rentMult: number;
  /** One-off cost to upgrade *to* this level (level 0 is never bought). */
  cost: number;
}

export interface Company {
  id: CompanyId;
  name: string;
  sectorId: SectorId;
  color: string;
  hqHub: HubId;
  cash: number;
  /** Signed-up users (all segments). Churns slowly. */
  users: number;
  /** 0..100. Rises when features ship and when engineers polish with nothing queued. */
  product: number;
  /** 0..100 buzz. Pins/press raise it, it decays daily. */
  hype: number;
  /** Index into STAGES (lib/game/content.ts). 0 = Bootstrapped. */
  stageIndex: number;
  /** Founder ownership 0..1. Each closed round dilutes it. */
  equity: number;
  /** Post-money valuation of the last closed round, in £. */
  valuation: number;
  shipped: FeatureId[];
  /** Feature engineers are currently building, or null (= polish product). */
  researching: FeatureId | null;
  /** Build points put into `researching` so far. */
  researchProgress: number;
  alive: boolean;
}

export interface Office {
  id: string;
  company: CompanyId;
  hubId: HubId;
  x: number;
  y: number;
  siteName?: string;
  /** Index into OFFICE_LEVELS. HQ starts at 0 (kitchen table); new offices at 1. */
  level: number;
}

interface PlaceBase {
  id: string;
  name: string;
  hubId: HubId;
  /** World position in geo.ts world units (project()), offset from the hub centre. */
  x: number;
  y: number;
}

/** Recruit here: someone from your team must be standing at it to hire. */
export interface TalentPlace extends PlaceBase {
  kind: 'talent';
  /** Multiplies new hires' skill (on top of the hub's hireQualityMult). */
  quality: number;
}

/** Sign users here: a shared, slowly-refilling pool that every company drains. */
export interface CustomerPlace extends PlaceBase {
  kind: 'customers';
  segment: Segment;
  pool: number;
  poolMax: number;
  /** Cumulative gross signups by company, used to identify its strongest customer hub. */
  userSignups?: Partial<Record<CompanyId, number>>;
}

/** Pitch here: only your founder, in person. */
export interface InvestorPlace extends PlaceBase {
  kind: 'investor';
  /** Day before which this investor won't see a company again (after a no). */
  cooldownUntil: Partial<Record<CompanyId, number>>;
}

export type Place = TalentPlace | CustomerPlace | InvestorPlace;

/** What a move order is heading to. */
export type MoveTarget =
  | { kind: 'place'; id: string }
  | { kind: 'office'; id: string }
  | { kind: 'lead'; id: string };

export interface MoveOrder {
  target: MoveTarget;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Street route as flat x/y pairs, including the start and end. */
  path: number[];
  /** Street-route arc length in world units. */
  length: number;
  /** 0..1 along the street route. */
  progress: number;
  durationDays: number;
  /** Founder only: pitch this investor on arrival. */
  pitchOnArrival?: boolean;
}

export interface Person {
  id: string;
  company: CompanyId;
  role: Role;
  /** First name, e.g. "Priya". */
  name: string;
  x: number;
  y: number;
  /** Where they're standing (a Place id or an Office id), or null when travelling / idle on the street. */
  at: string | null;
  order: MoveOrder | null;
  /** Weekly salary in £ (founder = 0). */
  salary: number;
  /** Work multiplier, rolled at hire time. Founder = 1. */
  skill: number;
}

export type LeadKind = 'meetup' | 'candidate' | 'journalist' | 'angel';

/** Timed pop-up pin. First person (any company) who can take it and arrives wins it. */
export interface Lead {
  id: string;
  kind: LeadKind;
  name: string;
  venue: string;
  hubId: HubId;
  x: number;
  y: number;
  spawnDay: number;
  expiresDay: number;
  takenBy: Role[];
}

export interface DilemmaOptionRts {
  label: string;
  /** Short plain-English consequence shown on the button. */
  hint: string;
}

export interface ActiveDilemma {
  id: string;
  title: string;
  body: string;
  hubId: HubId;
  options: DilemmaOptionRts[];
}

export type RtsPhase = 'playing' | 'dilemma' | 'won' | 'bankrupt';

export interface NewsItemRts {
  day: number;
  text: string;
  tone: 'good' | 'bad' | 'neutral' | 'rival' | 'money';
  hubId?: HubId;
}

export type MomentKind =
  | 'first-customer'
  | 'first-hire'
  | 'launch-day'
  | 'feature-shipped'
  | 'round-closed'
  | 'office-move'
  | 'rival-steal';

/** Visual/audio side effects for the renderer. Never read back by the sim. */
export type RtsFx =
  | { kind: 'float'; x: number; y: number; text: string; color?: string }
  | { kind: 'confetti'; x: number; y: number }
  | { kind: 'sparkle'; x: number; y: number }
  | { kind: 'focus'; x: number; y: number }
  | { kind: 'postcard'; landmark: LandmarkKind; x: number; y: number }
  | { kind: 'bonus'; label: string }
  | { kind: 'chapter'; index: number; stars: number }
  | {
      kind: 'moment';
      moment: MomentKind;
      title: string;
      text: string;
      x: number;
      y: number;
      tone: 'good' | 'bad';
    };

export interface RtsState {
  seed: string;
  rng: RngState;
  /** In-game days since founding (float). Week = floor(day / 7) + 1. */
  day: number;
  phase: RtsPhase;
  companies: Record<CompanyId, Company>;
  people: Person[];
  offices: Office[];
  places: Place[];
  leads: Lead[];
  milestones: Record<string, true>;
  journal: Partial<Record<LandmarkKind, number>>;
  campaign: {
    chapter: number;
    chapterStartDay: number;
    bonusDone: boolean;
    results: { chapterId: string; days: number; stars: number }[];
  };
  stats: { leadsWon: number };
  dilemma: ActiveDilemma | null;
  news: NewsItemRts[];
  /** Monotonic id counter for people/offices/leads. */
  nextId: number;
  nextLeadDay: number;
  nextDilemmaDay: number;
  nextAiDay: number;
}

export interface NewRtsConfig {
  seed: string;
  companyName: string;
  sectorId: SectorId;
  hqHub: HubId;
}

/** Result of every sim call. `error` is a player-facing reason a command was refused. */
export interface RtsResult {
  state: RtsState;
  fx: RtsFx[];
  error?: string;
}

/** Pitch preview shown before committing (odds are 0 when not eligible). */
export interface PitchPreview {
  eligible: boolean;
  /** Plain-English blockers, e.g. "Needs 1,600 users (you have 420)". */
  blockers: string[];
  odds: number;
  nextStageName: string;
  raise: number;
  /** Fraction of the company this round would sell, 0..1. */
  dilution: number;
}
