/**
 * RUNWAY live-week prototype checks + balance bot.
 *
 * Guards the playtest targets from docs/gameplay/map-as-gameplay.md:
 * a reasonable bot wins a minority-to-half of runs in ~30–40 weeks, payouts
 * spread out (so a leaderboard has room), and every run replays exactly
 * from its move log (so a server can verify scores).
 */
import assert from 'node:assert/strict';
import { HUBS, SECTORS } from '../lib/game/content';
import {
  SLOTS_PER_WEEK,
  dailySeed,
  goTo,
  isOver,
  isPaused,
  newLive,
  optionsHere,
  replayLive,
  summarize,
  travelQuote,
  wait,
  type LiveConfig,
  type LiveState,
} from '../lib/game/live';
import { playOut } from './liveBot';
import type { HubId } from '../lib/game/types';

let passed = 0;
function check(label: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${label}`);
}

function config(seed: number, sectorId = SECTORS[0].id, hubId: HubId = 'shoreditch'): LiveConfig {
  return { companyName: `Live${seed}`, sectorId, hubId, seed, mode: 'practice' };
}

function assertSane(s: LiveState, ctx: string) {
  const st = s.game.stats;
  for (const [k, v] of Object.entries(st)) assert.ok(Number.isFinite(v), `${ctx}: ${k} not finite`);
  assert.ok(s.slot >= 0 && s.slot <= SLOTS_PER_WEEK, `${ctx}: slot ${s.slot}`);
  assert.ok(s.equity > 0 && s.equity <= 1, `${ctx}: equity ${s.equity}`);
}

console.log('RUNWAY live-week prototype');

check('travel: same hub is free, taxis are faster and cost cash', () => {
  assert.deepEqual(travelQuote('soho', 'soho', 'tube'), { mode: 'tube', slots: 0, cost: 0, km: 0 });
  const tube = travelQuote('camden', 'canarywharf', 'tube');
  const taxi = travelQuote('camden', 'canarywharf', 'taxi');
  assert.ok(tube.slots === 2 && tube.cost === 0);
  assert.ok(taxi.slots === 1 && taxi.cost > 0);
});

check('actions only happen at their places', () => {
  const s = newLive(config(1, 'ai', 'camden'));
  assert.ok(!optionsHere(s).some((o) => o.action === 'hire'), 'Camden is not a talent hub');
  assert.ok(
    optionsHere(s).some((o) => o.action === 'build'),
    'HQ always builds',
  );
  const moved = goTo(s, 'kingscross', 'tube');
  assert.ok(moved.ok);
  assert.ok(optionsHere(moved.state).some((o) => o.action === 'hire'));
  assert.ok(!optionsHere(moved.state).some((o) => o.action === 'build'), 'build is HQ-only');
});

check('the week clock rolls the week over', () => {
  let s = newLive(config(2));
  const week = s.game.week;
  for (let i = 0; i < SLOTS_PER_WEEK && !isPaused(s); i++) s = wait(s).state;
  assert.ok(s.game.week === week + 1, 'ten half-days make a week');
  assert.strictEqual(s.slot, 0);
  assert.strictEqual(s.founderHub, s.game.hubId, 'Monday starts at HQ');
});

check('runs replay exactly from their move log', () => {
  for (const seed of [11, 12, 13]) {
    const cfg = config(seed, 'fintech', 'farringdon');
    const s = playOut(cfg);
    const r = replayLive(cfg, s.moves);
    assert.deepStrictEqual(summarize(r), summarize(s));
    assert.deepStrictEqual(r.game.stats, s.game.stats);
  }
});

check('daily seeds are stable per day and differ across days', () => {
  assert.strictEqual(dailySeed('2026-09-26'), dailySeed('2026-09-26'));
  assert.notStrictEqual(dailySeed('2026-09-26'), dailySeed('2026-09-27'));
});

check('live bot: hard but winnable, ~30–40 week wins, payouts spread', () => {
  const runs: ReturnType<typeof summarize>[] = [];
  for (let si = 0; si < SECTORS.length; si++) {
    for (let hi = 0; hi < HUBS.length; hi++) {
      for (let k = 0; k < 4; k++) {
        const seed = 500_000 + si * 10_000 + hi * 100 + k;
        const s = playOut(config(seed, SECTORS[si].id, HUBS[hi].id));
        assertSane(s, `seed ${seed}`);
        assert.ok(isOver(s), `seed ${seed} timed out at week ${s.game.week}`);
        runs.push(summarize(s));
      }
    }
  }
  const wins = runs.filter((r) => r.outcome === 'unicorn');
  const rate = wins.length / runs.length;
  const avgWeek = wins.reduce((a, r) => a + r.weeks, 0) / Math.max(1, wins.length);
  const payouts = wins.map((r) => r.payout).sort((a, b) => a - b);
  const q = (p: number) => payouts[Math.floor(p * (payouts.length - 1))] ?? 0;
  console.log(
    `    bot: ${wins.length}/${runs.length} unicorns (${Math.round(rate * 100)}%), avg week ${avgWeek.toFixed(1)}; ` +
      `payout p10 £${(q(0.1) / 1e6).toFixed(0)}M · median £${(q(0.5) / 1e6).toFixed(0)}M · p90 £${(q(0.9) / 1e6).toFixed(0)}M`,
  );
  const busts = runs.filter((r) => r.outcome === 'bust');
  const early = busts.filter((r) => r.weeks < 8).length;
  console.log(`    busts: ${busts.length} (${early} before week 8)`);
  assert.ok(rate >= 0.35 && rate <= 0.65, `win rate ${(rate * 100).toFixed(0)}% outside 35–65%`);
  assert.ok(avgWeek >= 28 && avgWeek <= 42, `avg win week ${avgWeek.toFixed(1)} outside 28–42`);
  assert.ok(
    early <= busts.length * 0.25,
    'most failures should come mid-run, not in the opening weeks',
  );
  assert.ok(q(0.9) > q(0.1) * 1.3, 'winning payouts should spread out for a leaderboard');
});

console.log(`\nAll ${passed} live checks passed.`);
