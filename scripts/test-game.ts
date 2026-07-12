/**
 * RUNWAY engine tests + balance bot. Offline, no DOM, no network.
 *
 * 1. Determinism: same seed + same choices ⇒ byte-identical final state.
 * 2. No free lunch: a founder who does nothing goes bankrupt fast.
 * 3. Winnability: a simple greedy bot wins often enough (and within a sane
 *    number of weeks) that a thoughtful human has a fair shot at unicorn.
 * 4. Sanity: stats never go NaN/negative-infinite across thousands of weeks.
 *
 * Run: pnpm test:game
 */
import assert from 'node:assert';
import {
  applyDilemmaChoice,
  endWeek,
  newGame,
  performAction,
  pitchReadiness,
  productCap,
  weeklyBurn,
} from '../lib/game/engine';
import { HUBS, SECTORS } from '../lib/game/content';
import type { GameState } from '../lib/game/types';

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

function assertSane(state: GameState, context: string) {
  const s = state.stats;
  for (const [key, v] of Object.entries(s)) {
    assert.ok(Number.isFinite(v), `${context}: stat ${key} is not finite (${v})`);
  }
  assert.ok(s.product >= 0 && s.product <= 100, `${context}: product out of range`);
  assert.ok(s.hype >= 0 && s.hype <= 100, `${context}: hype out of range`);
  assert.ok(s.morale >= 0 && s.morale <= 100, `${context}: morale out of range`);
  assert.ok(s.traction >= 0, `${context}: negative traction`);
  assert.ok(state.focusLeft >= 0, `${context}: negative focus`);
}

/** Deterministically resolve dilemmas: never take game-ending options. */
function resolveDilemma(state: GameState): GameState {
  const d = state.pendingDilemma!;
  const opt =
    d.options.find((o) => o.effectId !== 'acquihire_accept' && o.effectId !== 'bridge_decline') ??
    d.options[0];
  return applyDilemmaChoice(state, opt.effectId);
}

/** A reasonable-but-not-perfect greedy policy. */
function botWeek(state: GameState): GameState {
  let g = state;
  while (g.phase === 'dilemma') g = resolveDilemma(g);

  let guard = 0;
  while (g.phase === 'playing' && g.focusLeft > 0 && guard++ < 10) {
    const s = g.stats;
    const readiness = pitchReadiness(g);
    const next = g.stageIndex + 1;
    const burn = weeklyBurn(g);

    let did = false;
    const tryAct = (id: Parameters<typeof performAction>[1], payload?: { eventId?: string }) => {
      const res = performAction(g, id, payload);
      if (res.ok) {
        g = res.state;
        did = true;
      }
      return res.ok;
    };

    if (readiness.ready && g.focusLeft >= 2 && readiness.odds >= 0.5) {
      tryAct('pitch');
    } else if (s.morale < 38 && s.cash > 6000) {
      tryAct('retreat');
    } else if (
      s.product >= productCap(g) - 4 &&
      s.cash > burn * 10 &&
      g.stageIndex >= 1 &&
      s.team < 40
    ) {
      tryAct('hire');
    } else {
      // Work toward the next stage's gates.
      const stageNeedsProduct = next < 7 && s.product < readinessTargetProduct(g);
      const pitchEvent = g.eventsThisWeek.find((e) => !e.attended && e.kind === 'pitch');
      if (s.connections < 3 && pitchEvent) {
        tryAct('attend', { eventId: pitchEvent.id });
      } else if (stageNeedsProduct) {
        tryAct('build');
      } else if (s.hype < 25) {
        tryAct('press');
      } else {
        tryAct('growth');
      }
    }
    if (!did) {
      // Fallback so the bot can never stall with focus in hand.
      if (!tryAct('build')) break;
    }
  }
  if (g.phase === 'playing') g = endWeek(g);
  while (g.phase === 'dilemma') g = resolveDilemma(g);
  return g;
}

function readinessTargetProduct(g: GameState): number {
  const stages = [0, 15, 32, 50, 66, 80, 90];
  return stages[Math.min(6, g.stageIndex + 1)];
}

// ---------------------------------------------------------------------------

console.log('RUNWAY engine tests');

check('determinism: same seed + same script ⇒ identical state', () => {
  const run = () => {
    let g = newGame({ companyName: 'DetCo', sectorId: 'devtools', hubId: 'farringdon', seed: 42 });
    for (let w = 0; w < 60 && g.phase !== 'bankrupt' && g.phase !== 'won'; w++) g = botWeek(g);
    return JSON.stringify(g);
  };
  assert.strictEqual(run(), run());
});

check('doing nothing ⇒ bankrupt, and quickly', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    let g = newGame({ companyName: 'IdleCo', sectorId: 'ai', hubId: 'soho', seed });
    let weeks = 0;
    while (g.phase !== 'bankrupt' && weeks < 80) {
      if (g.phase === 'dilemma') g = resolveDilemma(g);
      else g = endWeek(g);
      weeks++;
    }
    assert.strictEqual(g.phase, 'bankrupt', `seed ${seed}: idler should go bankrupt`);
    assert.ok(
      weeks < 30,
      `seed ${seed}: idler survived ${weeks} weeks — starting cash too generous`,
    );
  }
});

check('greedy bot: winnable, fair, and never insane', () => {
  const results: { phase: string; week: number }[] = [];
  const seeds = Array.from({ length: 40 }, (_, i) => i + 100);
  for (const seed of seeds) {
    const sector = SECTORS[seed % SECTORS.length].id;
    const hub = HUBS[seed % HUBS.length].id;
    let g = newGame({ companyName: `Bot${seed}`, sectorId: sector, hubId: hub, seed });
    let weeks = 0;
    while (g.phase !== 'won' && g.phase !== 'bankrupt' && g.phase !== 'acquired' && weeks < 400) {
      g = botWeek(g);
      assertSane(g, `seed ${seed} week ${g.week}`);
      weeks++;
    }
    results.push({ phase: g.phase, week: g.week });
  }
  const wins = results.filter((r) => r.phase === 'won');
  const bankrupt = results.filter((r) => r.phase === 'bankrupt');
  const unresolved = results.filter((r) => r.phase === 'playing' || r.phase === 'dilemma');
  const avgWinWeek = wins.length
    ? Math.round(wins.reduce((a, r) => a + r.week, 0) / wins.length)
    : 0;
  console.log(
    `    bot: ${wins.length}/${results.length} unicorns (avg week ${avgWinWeek}), ` +
      `${bankrupt.length} bankruptcies, ${unresolved.length} timeouts`,
  );
  assert.ok(wins.length >= results.length * 0.5, `bot should win >=50% (won ${wins.length}/40)`);
  assert.ok(wins.length < results.length, 'bot should NOT win every game — some tension required');
  assert.ok(avgWinWeek >= 50 && avgWinWeek <= 250, `avg win week ${avgWinWeek} outside 50..250`);
  assert.strictEqual(unresolved.length, 0, 'no games should time out at 400 weeks');
});

check('rivals live their own lives', () => {
  let g = newGame({ companyName: 'WatchCo', sectorId: 'fintech', hubId: 'canarywharf', seed: 7 });
  for (let w = 0; w < 150 && g.phase === 'playing'; w++) {
    g = endWeek(g);
    while (g.phase === 'dilemma') g = resolveDilemma(g);
    if (g.phase !== 'playing') break;
  }
  const maxRivalStage = Math.max(...g.rivals.map((r) => r.stageIndex));
  assert.ok(maxRivalStage >= 2, `rivals should progress (max stage ${maxRivalStage})`);
});

console.log(`\nAll ${passed} checks passed.`);
