/**
 * A reasonable-but-not-perfect live-week policy, shared by the checks in
 * scripts/test-live.ts and ad-hoc balance sweeps.
 */
import { HUBS } from '../lib/game/content';
import { pitchReadiness, productCap, weeklyBurn } from '../lib/game/engine';
import {
  attendEvent,
  chooseLive,
  doAction,
  goTo,
  hubOffers,
  isOver,
  isPaused,
  newLive,
  openEventsAt,
  openLeadsAt,
  optionsHere,
  pitchHub,
  takeLead,
  travelQuote,
  wait,
  type LiveConfig,
  type LiveState,
  type PlaceActionId,
} from '../lib/game/live';
import type { HubId } from '../lib/game/types';

// ---------------------------------------------------------------------------
// Bot: pick a goal, travel to where it happens, do it; grab leads en route.
// ---------------------------------------------------------------------------

function goal(s: LiveState): PlaceActionId {
  const g = s.game;
  const st = g.stats;
  const r = pitchReadiness(g);
  const targets = [0, 15, 32, 50, 66, 80, 90];
  if (r.ready && r.odds >= 0.5) return 'pitch';
  if (st.morale < 38 && st.cash > 6000) return 'retreat';
  if (
    st.product >= productCap(g) - 4 &&
    st.cash > weeklyBurn(g) * 10 &&
    g.stageIndex >= 1 &&
    st.team < 40
  )
    return 'hire';
  if (st.product < targets[Math.min(6, g.stageIndex + 1)]) return 'build';
  if (st.hype < 25) return 'press';
  return 'growth';
}

function nearestHubFor(s: LiveState, action: PlaceActionId): HubId {
  let best: HubId = s.founderHub;
  let bestSlots = Infinity;
  for (const h of HUBS) {
    if (!hubOffers(s, h.id).includes(action)) continue;
    const q = travelQuote(s.founderHub, h.id, 'tube').slots;
    if (q < bestSlots) {
      bestSlots = q;
      best = h.id;
    }
  }
  return best;
}

export function botStep(s: LiveState): LiveState {
  if (isPaused(s)) {
    const d = s.game.pendingDilemma!;
    const opt =
      d.options.find((o) => o.effectId !== 'acquihire_accept' && o.effectId !== 'bridge_decline') ??
      d.options[0];
    return chooseLive(s, opt.effectId).state;
  }
  const tryR = (r: { ok: boolean; state: LiveState }) => (r.ok ? r.state : null);

  // Opportunistic: leads and events right here.
  for (const l of openLeadsAt(s, s.founderHub)) {
    const n = tryR(takeLead(s, l.id));
    if (n) return n;
  }
  for (const { ev } of openEventsAt(s, s.founderHub)) {
    const n = tryR(attendEvent(s, ev.id));
    if (n) return n;
  }

  const want = goal(s);
  const here = optionsHere(s).find((o) => o.action === want);
  if (here?.ok) return tryR(doAction(s, want)) ?? wait(s).state;

  const target = want === 'pitch' ? pitchHub(s) : nearestHubFor(s, want);
  if (target !== s.founderHub) {
    const rich = s.game.stats.cash > weeklyBurn(s.game) * 24;
    const n = tryR(goTo(s, target, rich ? 'taxi' : 'tube'));
    if (n) return n;
  }
  // Fallbacks: anything useful here, else let time pass.
  for (const o of optionsHere(s)) {
    if (o.ok && o.action !== 'retreat') {
      const n = tryR(doAction(s, o.action));
      if (n) return n;
    }
  }
  return wait(s).state;
}

export function playOut(cfg: LiveConfig, maxWeeks = 300): LiveState {
  let s = newLive(cfg);
  let guard = 0;
  while (!isOver(s) && s.game.week <= maxWeeks && guard++ < 20_000) {
    s = botStep(s);
  }
  return s;
}
