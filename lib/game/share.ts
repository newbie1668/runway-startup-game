import { STAGES, hubById, sectorById } from './content';
import { fmtMoney, fmtUsers } from './format';
import type { GamePhase, GameState } from './types';

export interface ShareSnapshot {
  companyName: string;
  week: number;
  phase: GamePhase;
  stage: string;
  sector: string;
  hub: string;
  valuation: number;
  cash: number;
  traction: number;
  team: number;
}

function clean(value: string | null | undefined, fallback: string, maxLength = 48): string {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, maxLength) : fallback;
}

function number(value: string | null | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function phase(value: string | null | undefined): GamePhase {
  if (value === 'won' || value === 'bankrupt' || value === 'acquired' || value === 'dilemma') {
    return value;
  }
  return 'playing';
}

export function snapshotFromGame(game: GameState): ShareSnapshot {
  return {
    companyName: game.companyName,
    week: game.week,
    phase: game.phase,
    stage: STAGES[game.stageIndex].name,
    sector: sectorById(game.sectorId).name,
    hub: hubById(game.hubId).name,
    valuation: game.valuation,
    cash: game.stats.cash,
    traction: game.stats.traction,
    team: game.stats.team,
  };
}

export function fallbackShareText(snapshot: ShareSnapshot): string {
  const progress =
    snapshot.valuation > 0
      ? `${fmtMoney(snapshot.valuation)} valuation`
      : `${fmtUsers(snapshot.traction)} users`;
  const duration = snapshot.week === 1 ? '1 week' : `${snapshot.week} weeks`;
  if (snapshot.phase === 'won') {
    return `I took ${snapshot.companyName} from ${snapshot.hub} to a £1B unicorn in ${duration}. Think you can beat my RUNWAY?`;
  }
  if (snapshot.phase === 'acquired') {
    return `${snapshot.companyName} got acquired after ${duration} in RUNWAY. Final checkpoint: ${progress}. Can you build a bigger London startup?`;
  }
  if (snapshot.phase === 'bankrupt') {
    return `${snapshot.companyName} ran out of runway after ${duration} with ${progress}. My comeback starts now — can you do better?`;
  }
  return `Week ${snapshot.week} of RUNWAY: ${snapshot.companyName} is a ${snapshot.stage} ${snapshot.sector} startup in ${snapshot.hub}, now at ${progress}. Can you out-build me?`;
}

export function shareSearchParams(snapshot: ShareSnapshot): URLSearchParams {
  return new URLSearchParams({
    company: snapshot.companyName,
    week: String(snapshot.week),
    phase: snapshot.phase,
    stage: snapshot.stage,
    sector: snapshot.sector,
    hub: snapshot.hub,
    valuation: String(Math.round(snapshot.valuation)),
    cash: String(Math.round(snapshot.cash)),
    traction: String(Math.round(snapshot.traction)),
    team: String(Math.round(snapshot.team)),
  });
}

export function sharePageUrl(origin: string, snapshot: ShareSnapshot): string {
  return `${origin}/game/share?${shareSearchParams(snapshot)}`;
}

export function shareImageUrl(origin: string, snapshot: ShareSnapshot): string {
  return `${origin}/game/share-card?${shareSearchParams(snapshot)}`;
}

export function snapshotFromSearchParams(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): ShareSnapshot {
  const get = (key: string) => {
    if (params instanceof URLSearchParams) return params.get(key);
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  return {
    companyName: clean(get('company'), 'A London startup'),
    week: Math.max(1, Math.round(number(get('week'), 1))),
    phase: phase(get('phase')),
    stage: clean(get('stage'), 'Bootstrapped'),
    sector: clean(get('sector'), 'startup'),
    hub: clean(get('hub'), 'London'),
    valuation: number(get('valuation')),
    cash: number(get('cash')),
    traction: number(get('traction')),
    team: Math.max(1, Math.round(number(get('team'), 1))),
  };
}
