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
  FOCUS_PER_WEEK,
  applyDilemmaChoice,
  endWeek,
  newGame,
  performAction,
  pitchReadiness,
  productCap,
  weeklyBurn,
} from '../lib/game/engine';
import { DILEMMAS, HUBS, SECTORS, STAGES } from '../lib/game/content';
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
  assert.ok(state.focusLeft <= FOCUS_PER_WEEK, `${context}: focus exceeds weekly allowance`);
  assert.ok(Number.isInteger(s.team) && s.team >= 1, `${context}: invalid team size`);
  assert.ok(
    Number.isInteger(s.connections) && s.connections >= 0,
    `${context}: invalid investor intros`,
  );
  assert.ok(
    Number.isInteger(state.stageIndex) && state.stageIndex >= 0 && state.stageIndex < STAGES.length,
    `${context}: invalid stage index`,
  );
  assert.strictEqual(
    state.phase === 'dilemma',
    state.pendingDilemma !== null,
    `${context}: dilemma phase and pending card disagree`,
  );
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
    let guard = 0;
    while (g.phase !== 'bankrupt' && guard++ < 80) {
      if (g.phase === 'dilemma') g = resolveDilemma(g);
      else g = endWeek(g);
    }
    assert.strictEqual(g.phase, 'bankrupt', `seed ${seed}: idler should go bankrupt`);
    assert.ok(
      g.week < 30,
      `seed ${seed}: idler survived ${g.week} weeks — starting cash too generous`,
    );
  }
});

check('product cap never destroys progress already earned', () => {
  const base = newGame({
    companyName: 'CapCo',
    sectorId: 'devtools',
    hubId: 'farringdon',
    seed: 71,
  });
  base.stats.team = 2;
  base.stats.product = 52;
  base.focusLeft = 2;

  const built = performAction(base, 'build');
  assert.ok(built.ok);
  assert.ok(
    built.state.stats.product >= 52,
    'building above a reduced team cap must not lose product',
  );

  const talk = structuredClone(base);
  talk.eventsThisWeek = [
    {
      id: 'cap-talk',
      name: 'Architecture Meetup',
      venue: 'a test venue',
      hubId: 'farringdon',
      kind: 'talk',
      attended: false,
    },
  ];
  const attended = performAction(talk, 'attend', { eventId: 'cap-talk' });
  assert.ok(attended.ok);
  assert.ok(
    attended.state.stats.product >= 52,
    'attending a talk above a reduced team cap must not lose product',
  );

  const advanced = endWeek(base);
  assert.ok(advanced.stats.product >= 52, 'unused focus above a reduced cap must not lose product');
});

check('an accelerator card cannot make an inactive company immortal', () => {
  let g = newGame({
    companyName: 'IdleAcceleratorCo',
    sectorId: 'climate',
    hubId: 'camden',
    seed: 920_602,
  });
  let guard = 0;
  while (g.phase !== 'bankrupt' && g.phase !== 'won' && guard++ < 1_000 && g.week <= 300) {
    g = g.phase === 'dilemma' ? resolveDilemma(g) : endWeek(g);
  }
  assert.strictEqual(g.phase, 'bankrupt', 'doing nothing must still end in bankruptcy');
  assert.ok(g.week < 30, `inactive company survived until week ${g.week}`);
});

check('matching a sector to its neighbourhood gives a real scene bonus', () => {
  const make = (hubId: 'kingscross' | 'farringdon') => {
    const g = newGame({ companyName: 'SceneCo', sectorId: 'ai', hubId, seed: 808 });
    g.stats.product = 25;
    g.stats.traction = 200;
    g.stats.hype = 20;
    g.stats.morale = 70;
    g.focusLeft = 2;
    return g;
  };

  const matchingBuild = performAction(make('kingscross'), 'build');
  const neutralBuild = performAction(make('farringdon'), 'build');
  assert.ok(matchingBuild.ok && neutralBuild.ok);
  assert.ok(
    matchingBuild.state.stats.product > neutralBuild.state.stats.product,
    "King's Cross should boost AI product work",
  );

  const matchingGrowth = performAction(make('kingscross'), 'growth');
  const neutralGrowth = performAction(make('farringdon'), 'growth');
  assert.ok(matchingGrowth.ok && neutralGrowth.ok);
  assert.ok(
    matchingGrowth.state.stats.traction > neutralGrowth.state.stats.traction,
    "King's Cross should boost AI growth",
  );
});

check('event-scene neighbourhoods create more weekly opportunities', () => {
  const averageEvents = (hubId: 'shoreditch' | 'battersea') => {
    let total = 0;
    const runs = 600;
    for (let seed = 1; seed <= runs; seed++) {
      total += newGame({ companyName: 'EventCo', sectorId: 'ai', hubId, seed }).eventsThisWeek
        .length;
    }
    return total / runs;
  };

  const shoreditch = averageEvents('shoreditch');
  const battersea = averageEvents('battersea');
  assert.ok(
    shoreditch > battersea + 0.4,
    `Shoreditch ${shoreditch.toFixed(2)} events vs Battersea ${battersea.toFixed(2)}`,
  );
});

check('events labelled double value really double every reward', () => {
  const eventKinds = ['social', 'pitch', 'talk', 'demo', 'party'] as const;
  const trackedStats = ['product', 'hype', 'morale', 'connections'] as const;

  const attend = (kind: (typeof eventKinds)[number], sectorId: 'ai' | 'climate') => {
    const g = newGame({ companyName: 'SynergyCo', sectorId: 'ai', hubId: 'kingscross', seed: 909 });
    g.stats.product = 20;
    g.stats.hype = 20;
    g.stats.morale = 50;
    g.stats.connections = 0;
    g.eventsThisWeek = [
      {
        id: `${sectorId}-${kind}`,
        name: `${sectorId} ${kind}`,
        venue: 'a test venue',
        hubId: 'kingscross',
        kind,
        sectorId,
        attended: false,
      },
    ];
    const result = performAction(g, 'attend', { eventId: `${sectorId}-${kind}` });
    assert.ok(result.ok);
    return { before: g.stats, after: result.state.stats, message: result.message };
  };

  for (const kind of eventKinds) {
    const regular = attend(kind, 'climate');
    const matched = attend(kind, 'ai');
    for (const stat of trackedStats) {
      const regularGain = regular.after[stat] - regular.before[stat];
      if (regularGain === 0) continue;
      const matchedGain = matched.after[stat] - matched.before[stat];
      assert.strictEqual(
        matchedGain,
        regularGain * 2,
        `${kind} ${stat}: matched event should double ${regularGain} to ${regularGain * 2}`,
      );
    }
    assert.match(matched.message, /double value/i);
  }
});

check('action feedback reports the gain that was actually applied', () => {
  const g = newGame({ companyName: 'HonestCopyCo', sectorId: 'ai', hubId: 'soho', seed: 1_010 });
  g.stats.product = 90;
  g.stats.hype = 99;
  const pressed = performAction(g, 'press');
  assert.ok(pressed.ok);
  assert.strictEqual(pressed.state.stats.hype, 100);
  assert.match(pressed.message, /Hype \+1\b/, `unexpected feedback: ${pressed.message}`);
});

check('a dilemma only accepts one of the choices currently on screen', () => {
  const g = newGame({
    companyName: 'ChoiceCo',
    sectorId: 'fintech',
    hubId: 'farringdon',
    seed: 11,
  });
  g.pendingDilemma = structuredClone(DILEMMAS.find((d) => d.id === 'flood')!);
  g.phase = 'dilemma';
  const invalid = applyDilemmaChoice(g, 'accelerator_join');
  assert.deepStrictEqual(invalid, g, 'an unrelated hidden effect must not mutate the game');
});

check('weekly event ids match the week shown to the player', () => {
  let g = newGame({
    companyName: 'CalendarCo',
    sectorId: 'consumer',
    hubId: 'shoreditch',
    seed: 12,
  });
  assert.ok(g.eventsThisWeek.every((event) => event.id.startsWith('w1-')));
  g = endWeek(g);
  while (g.phase === 'dilemma') g = resolveDilemma(g);
  assert.strictEqual(g.week, 2);
  assert.ok(g.eventsThisWeek.every((event) => event.id.startsWith('w2-')));
});

check('dilemma copy describes the mechanic the player will actually receive', () => {
  const poach = DILEMMAS.find((d) => d.id === 'poach')!;
  const counter = poach.options.find((option) => option.effectId === 'poach_counter')!;
  assert.match(counter.detail, /£4,000/);
  assert.doesNotMatch(counter.detail, /burn rises for good/i);
});

check('greedy bot: winnable, fair, and never insane', () => {
  const results: { phase: string; week: number; combo: string; sector: string; hub: string }[] = [];
  for (let sectorIndex = 0; sectorIndex < SECTORS.length; sectorIndex++) {
    for (let hubIndex = 0; hubIndex < HUBS.length; hubIndex++) {
      const sector = SECTORS[sectorIndex].id;
      const hub = HUBS[hubIndex].id;
      for (let sample = 0; sample < 5; sample++) {
        const seed = 100_000 + sectorIndex * 10_000 + hubIndex * 100 + sample;
        let g = newGame({ companyName: `Bot${seed}`, sectorId: sector, hubId: hub, seed });
        let weeks = 0;
        while (
          g.phase !== 'won' &&
          g.phase !== 'bankrupt' &&
          g.phase !== 'acquired' &&
          weeks < 400
        ) {
          g = botWeek(g);
          assertSane(g, `seed ${seed} week ${g.week}`);
          weeks++;
        }
        results.push({ phase: g.phase, week: g.week, combo: `${sector}/${hub}`, sector, hub });
      }
    }
  }
  assert.strictEqual(new Set(results.map((result) => result.combo)).size, 48);
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
  const rate = (group: typeof results) =>
    Math.round((group.filter((result) => result.phase === 'won').length / group.length) * 100);
  console.log(
    `    sectors: ${SECTORS.map((sector) => {
      const group = results.filter((result) => result.sector === sector.id);
      return `${sector.name} ${rate(group)}%`;
    }).join(' · ')}`,
  );
  console.log(
    `    hubs: ${HUBS.map((hub) => {
      const group = results.filter((result) => result.hub === hub.id);
      return `${hub.name} ${rate(group)}%`;
    }).join(' · ')}`,
  );
  assert.ok(
    wins.length >= results.length * 0.5,
    `bot should win >=50% (won ${wins.length}/${results.length})`,
  );
  assert.ok(wins.length < results.length, 'bot should NOT win every game — some tension required');
  assert.ok(avgWinWeek >= 50 && avgWinWeek <= 250, `avg win week ${avgWinWeek} outside 50..250`);
  assert.strictEqual(unresolved.length, 0, 'no games should time out at 400 weeks');
});

check('rivals live their own lives', () => {
  let g = newGame({ companyName: 'WatchCo', sectorId: 'fintech', hubId: 'canarywharf', seed: 7 });
  // Keep the observer alive long enough to watch the cohort without relying
  // on a lucky bailout card.
  g.stats.cash = 10_000_000;
  for (let w = 0; w < 150 && g.phase === 'playing'; w++) {
    g = endWeek(g);
    while (g.phase === 'dilemma') g = resolveDilemma(g);
    if (g.phase !== 'playing') break;
  }
  const maxRivalStage = Math.max(...g.rivals.map((r) => r.stageIndex));
  assert.ok(maxRivalStage >= 2, `rivals should progress (max stage ${maxRivalStage})`);
});

console.log(`\nAll ${passed} checks passed.`);
