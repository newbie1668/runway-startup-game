/**
 * Seeded pseudo-random number generator (mulberry32).
 *
 * The whole game engine draws randomness through this so that a given seed
 * always replays the exact same game — which is what makes the balance bot
 * in scripts/test-game.ts deterministic and debuggable.
 *
 * State is a plain number stored inside GameState, so saves stay
 * JSON-serializable and a reload continues the same random stream.
 */

export type RngState = number;

export function seedFromString(text: string): RngState {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** Advance the stream once; returns the new state and a float in [0, 1). */
export function nextFloat(state: RngState): { state: RngState; value: number } {
  const a = (state + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { state: a, value };
}

/**
 * Mutable convenience wrapper for a burst of draws. Call `.state` afterwards
 * to persist the advanced stream back into GameState.
 */
export class Dice {
  state: RngState;

  constructor(state: RngState) {
    this.state = state;
  }

  float(): number {
    const r = nextFloat(this.state);
    this.state = r.state;
    return r.value;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.float() * items.length)];
  }

  /** Pick with weights; weights need not sum to 1. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    let total = 0;
    for (const item of items) total += Math.max(0, weightOf(item));
    if (total <= 0) return this.pick(items);
    let roll = this.float() * total;
    for (const item of items) {
      roll -= Math.max(0, weightOf(item));
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}
