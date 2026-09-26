'use client';

/**
 * RUNWAY — live-week playtest prototype (/game/live).
 *
 * Each in-game week is a ~12 second workday on the map: the clock runs,
 * opportunities appear at real places with countdowns, and the founder
 * travels between hubs to act. Rules live in lib/game/live.ts; this file only
 * paces the clock and draws. The classic game at /game is untouched.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HUBS, SECTORS, STAGES, generateCompanyName, hubById } from '@/lib/game/content';
import { drainFx, pitchOdds, pitchReadiness, productCap } from '@/lib/game/engine';
import {
  PLACE_ACTIONS,
  SLOTS_PER_WEEK,
  actionSlots,
  attendEvent,
  chooseLive,
  dailyKey,
  dailySeed,
  doAction,
  eventDay,
  formatMoney,
  goTo,
  hubOffers,
  isOver,
  isPaused,
  leadMeta,
  liveBurn,
  liveRunwayWeeks,
  newLive,
  nextDilution,
  openEventsAt,
  openLeadsAt,
  optionsHere,
  payout,
  pitchHub,
  pitchVenue,
  shareText,
  slotName,
  summarize,
  takeLead,
  travelQuote,
  wait,
  type LiveMode,
  type LiveResult,
  type LiveState,
  type PlaceActionId,
  type TravelMode,
} from '@/lib/game/live';
import { Dice } from '@/lib/game/rng';
import { sfx } from '@/lib/game/audio';
import type { HitTarget, IMapRenderer, Scene, SceneAvatar } from '@/lib/game/scene';
import type { FxEvent, HubId, SectorId } from '@/lib/game/types';
import { MapCanvas } from './MapCanvas';
import { SetupOverlay, type SetupStep } from './SetupOverlay';
import { DilemmaModal } from './Modals';

const SAVE_KEY = 'runway-live-save-v1';
const METRICS_KEY = 'runway-live-metrics-v1';
const DAILY_KEY_PREFIX = 'runway-live-daily-v1-';
/** Real milliseconds per half-day slot at 1× speed. */
const SLOT_MS = 1200;
const RECAP_MS = 2600;

type Screen = 'title' | 'setup' | 'play';

interface Metrics {
  starts: number;
  finishes: number;
  wins: number;
  quickRestarts: number;
  shares: number;
  lastEndAt: number;
}

/** An action in progress, so the week clock can tick through it. */
interface BusySpan {
  start: number;
  end: number;
  fromSlot: number;
  week: number;
}

interface Recap {
  week: number;
  lines: string[];
  cash: number;
  users: number;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or full storage: the run still plays, it just won't resume.
  }
}

function bumpMetrics(fn: (m: Metrics) => void) {
  const m = readJson<Metrics>(METRICS_KEY) ?? {
    starts: 0,
    finishes: 0,
    wins: 0,
    quickRestarts: 0,
    shares: 0,
    lastEndAt: 0,
  };
  fn(m);
  writeJson(METRICS_KEY, m);
}

const ACTION_BADGE: Record<PlaceActionId, string> = {
  build: '🛠',
  hire: '🧑‍💻',
  press: '📣',
  growth: '📈',
  retreat: '🌳',
  pitch: '💼',
};

export function LiveApp() {
  const [screen, setScreen] = useState<Screen>('title');
  const [mode, setMode] = useState<LiveMode>('daily');
  const [setupStep, setSetupStep] = useState<SetupStep>('identity');
  const [draftName, setDraftName] = useState('');
  const [draftSector, setDraftSector] = useState<SectorId | null>(null);
  const [hubChoice, setHubChoice] = useState<HubId | null>(null);

  const [live, setLive] = useState<LiveState | null>(null);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [busyUntil, setBusyUntil] = useState(0);
  const [span, setSpan] = useState<BusySpan | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<SceneAvatar | undefined>(undefined);
  const [selected, setSelected] = useState<HubId | null>(null);
  const [recap, setRecap] = useState<Recap | null>(null);
  const [toast, setToast] = useState<{ text: string; warn: boolean; key: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [boot, setBoot] = useState<{
    save: LiveState | null;
    today: string;
    todayResult: ReturnType<typeof summarize> | null;
    metrics: Metrics | null;
    showStats: boolean;
  } | null>(null);

  const rendererRef = useRef<IMapRenderer | null>(null);
  const liveRef = useRef<LiveState | null>(null);
  const clockRef = useRef({ nextTickAt: 0 });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    liveRef.current = live;
  }, [live]);

  // Browser-only boot data (saves, today's daily key, playtest metrics).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const today = params.get('daily') ?? dailyKey(new Date());
    const id = setTimeout(() =>
      setBoot({
        save: readJson<LiveState>(SAVE_KEY),
        today,
        todayResult: readJson(`${DAILY_KEY_PREFIX}${today}`),
        metrics: readJson<Metrics>(METRICS_KEY),
        showStats: params.get('stats') === '1',
      }),
    );
    return () => clearTimeout(id);
  }, [screen]);

  // Persist in-progress runs.
  useEffect(() => {
    if (!live) return;
    writeJson(SAVE_KEY, isOver(live) ? null : live);
  }, [live]);

  const showToast = useCallback((text: string, warn = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, warn, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const runFx = useCallback((fx: FxEvent[], hub: HubId) => {
    const r = rendererRef.current;
    for (const f of fx) {
      const at = f.hubId ?? hub;
      if (f.kind === 'confetti') {
        r?.burstConfetti(at);
        sfx.play('raise');
      } else if (f.kind === 'cash') {
        r?.floatText(at, f.note ?? '+£££', '#4ade80');
        sfx.play('cash');
      } else if (f.kind === 'bad') {
        r?.puffSmoke(at);
        sfx.play('fail');
      } else if (f.kind === 'unicorn') {
        r?.burstConfetti(at);
        r?.burstConfetti(null);
        r?.sparkle(at);
        sfx.play('unicorn');
      } else r?.sparkle(at);
    }
  }, []);

  /** Commit a live transition: fx, week recap, end-of-run bookkeeping. */
  const commit = useCallback(
    (prev: LiveState, next: LiveState) => {
      const drained = drainFx(next.game);
      if (drained.fx.length) runFx(drained.fx, next.founderHub);
      const state = { ...next, game: drained.state };
      const now = performance.now();
      if (state.game.week !== prev.game.week && !isOver(state)) {
        sfx.play('week');
        setRecap({
          week: prev.game.week,
          lines: prev.weekLog.slice(-4),
          cash: state.game.stats.cash - prev.game.stats.cash,
          users: state.game.stats.traction - prev.game.stats.traction,
        });
        setBusyUntil(now + RECAP_MS);
        setAvatar({ from: state.founderHub, to: state.founderHub, departMs: now, arriveMs: now });
        setSelected(null);
      }
      if (state.game.phase === 'dilemma' && prev.game.phase !== 'dilemma') sfx.play('event');
      if (isOver(state) && !isOver(prev)) {
        sfx.play(state.game.phase === 'won' ? 'unicorn' : 'gameover');
        const summary = summarize(state);
        bumpMetrics((m) => {
          m.finishes++;
          if (summary.outcome === 'unicorn') m.wins++;
          m.lastEndAt = Date.now();
        });
        const key = state.config.dayKey;
        if (state.config.mode === 'daily' && key && !readJson(`${DAILY_KEY_PREFIX}${key}`)) {
          writeJson(`${DAILY_KEY_PREFIX}${key}`, summary);
        }
      }
      setLive(state);
    },
    [runFx],
  );

  // --- the clock -------------------------------------------------------------
  useEffect(() => {
    if (screen !== 'play') return;
    const id = setInterval(() => {
      const s = liveRef.current;
      if (!s || paused || isOver(s) || isPaused(s)) return;
      const now = performance.now();
      if (now < busyUntil) return;
      if (recap && now >= busyUntil) setRecap(null);
      if (busyLabel) setBusyLabel(null);
      const clock = clockRef.current;
      if (clock.nextTickAt === 0 || clock.nextTickAt < busyUntil) {
        clock.nextTickAt = Math.max(now, busyUntil) + SLOT_MS / speed;
        return;
      }
      if (now < clock.nextTickAt) return;
      clock.nextTickAt = now + SLOT_MS / speed;
      const r = wait(s);
      if (r.ok) commit(s, r.state);
    }, 100);
    return () => clearInterval(id);
  }, [screen, paused, speed, busyUntil, recap, busyLabel, commit]);

  /** Run a move, animate the founder, and hold the clock while it plays out. */
  const move = useCallback(
    (fn: (s: LiveState) => LiveResult, slots: number, icon?: string, label?: string) => {
      const s = liveRef.current;
      if (!s) return;
      const now = performance.now();
      if (now < busyUntil) {
        showToast('Busy — wait for the current task to finish.', true);
        return;
      }
      const r = fn(s);
      if (!r.ok) {
        showToast(r.message, true);
        sfx.play('click');
        return;
      }
      const dur = (slots * SLOT_MS) / speed;
      const travelled = r.state.founderHub !== s.founderHub;
      setAvatar(
        travelled
          ? { from: s.founderHub, to: r.state.founderHub, departMs: now, arriveMs: now + dur }
          : {
              from: s.founderHub,
              to: s.founderHub,
              departMs: now,
              arriveMs: now,
              busyUntilMs: now + dur,
              busyIcon: icon,
            },
      );
      setBusyUntil(now + dur);
      setSpan({ start: now, end: now + dur, fromSlot: s.slot, week: s.game.week });
      if (dur > 0) setBusyLabel(label ?? r.message);
      clockRef.current.nextTickAt = now + dur + SLOT_MS / speed;
      if (r.message) showToast(r.message);
      sfx.play('confirm');
      commit(s, r.state);
    },
    [busyUntil, speed, commit, showToast],
  );

  const travel = (hub: HubId, how: TravelMode) => {
    const s = liveRef.current;
    if (!s) return;
    const q = travelQuote(s.founderHub, hub, how);
    move(
      (st) => goTo(st, hub, how),
      q.slots,
      undefined,
      `${how === 'tube' ? '🚇' : '🚕'} En route to ${hubById(hub).name}…`,
    );
  };

  // --- setup -----------------------------------------------------------------
  const startSetup = (m: LiveMode) => {
    setMode(m);
    setSetupStep('identity');
    setHubChoice(null);
    setScreen('setup');
    sfx.play('confirm');
    rendererRef.current?.fitAll();
  };

  const found = () => {
    if (!draftSector || !hubChoice || !boot) return;
    const day = boot.today;
    const seed = mode === 'daily' ? dailySeed(day) : (Math.random() * 0xffffffff) >>> 0;
    const s = newLive({
      companyName: draftName.trim(),
      sectorId: draftSector,
      hubId: hubChoice,
      seed,
      mode,
      dayKey: mode === 'daily' ? day : undefined,
    });
    bumpMetrics((m) => {
      m.starts++;
      if (m.lastEndAt && Date.now() - m.lastEndAt < 60_000) m.quickRestarts++;
    });
    const now = performance.now();
    clockRef.current.nextTickAt = 0;
    setAvatar({ from: hubChoice, to: hubChoice, departMs: now, arriveMs: now });
    setBusyUntil(now + 800);
    setRecap(null);
    setSelected(null);
    setPaused(false);
    setLive(s);
    setScreen('play');
    sfx.play('raise');
    rendererRef.current?.focusHub(hubChoice);
  };

  const runItBack = () => {
    if (!live) return;
    setDraftName(live.game.companyName);
    setDraftSector(live.config.sectorId);
    setHubChoice(live.config.hubId);
    setMode(live.config.mode);
    setLive(null);
    setSetupStep('hq');
    setScreen('setup');
    rendererRef.current?.fitOverview();
  };

  const share = async () => {
    if (!live) return;
    const url = `${window.location.origin}/game/live${live.config.dayKey ? `?daily=${live.config.dayKey}` : ''}`;
    try {
      await navigator.clipboard.writeText(shareText(live, url));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('Could not copy — select the text instead.', true);
    }
    bumpMetrics((m) => {
      m.shares++;
    });
  };

  // --- map --------------------------------------------------------------------
  const scene: Scene = useMemo(() => {
    if (screen === 'play' && live) {
      const g = live.game;
      const events = [
        ...g.eventsThisWeek
          .filter((e) => {
            const w = live.eventWindows.find((x) => x.eventId === e.id);
            return !e.attended && w && w.closes >= live.slot;
          })
          .map((e) => ({
            id: e.id,
            name: `${e.name} · ${eventDay(live.eventWindows.find((x) => x.eventId === e.id)!)}`,
            hubId: e.hubId,
            attended: false,
          })),
        ...live.leads
          .filter((l) => !l.taken && l.closes >= live.slot)
          .map((l) => ({
            id: `lead:${l.id}`,
            name: `${leadMeta(l.kind).title} at ${l.venue} · until ${slotName(l.closes)}`,
            hubId: l.hubId,
            attended: false,
            tone: 'lead' as const,
            glyph: leadMeta(l.kind).icon,
          })),
      ];
      const hubBadges: Partial<Record<HubId, string>> = {};
      for (const h of HUBS)
        hubBadges[h.id] = hubOffers(live, h.id)
          .map((a) => ACTION_BADGE[a])
          .join(' ');
      return {
        mode: 'play',
        playerHubId: g.hubId,
        playerSectorId: g.sectorId,
        companyName: g.companyName,
        stageName: STAGES[g.stageIndex].name,
        rivals: g.rivals.map((r) => ({
          id: r.id,
          name: r.name,
          hubId: r.hubId,
          sectorId: r.sectorId,
          stageName: STAGES[r.stageIndex].name,
          alive: r.alive,
        })),
        events,
        avatar,
        hubBadges,
      };
    }
    return {
      mode: 'setup',
      playerHubId: hubChoice,
      playerSectorId: draftSector,
      companyName: draftName,
      stageName: '',
      rivals: [],
      events: [],
    };
  }, [screen, live, avatar, hubChoice, draftSector, draftName]);

  const onHit = useCallback(
    (t: HitTarget) => {
      if (screen === 'setup' && setupStep === 'hq' && t.type === 'hub') {
        setHubChoice(t.hubId);
        rendererRef.current?.focusHub(t.hubId);
        sfx.play('click');
        return;
      }
      const s = liveRef.current;
      if (screen !== 'play' || !s) return;
      if (t.type === 'hub') setSelected(t.hubId);
      else if (t.type === 'event') {
        const lead = s.leads.find((l) => `lead:${l.id}` === t.eventId);
        const ev = s.game.eventsThisWeek.find((e) => e.id === t.eventId);
        const hub = lead?.hubId ?? ev?.hubId;
        if (hub) setSelected(hub);
      } else if (t.type === 'rival') {
        const r = s.game.rivals.find((x) => x.id === t.rivalId);
        if (r)
          showToast(`${r.name} — ${STAGES[r.stageIndex].name}, based in ${hubById(r.hubId).name}.`);
      }
      sfx.play('click');
    },
    [screen, setupStep, showToast],
  );

  // --- keyboard: space pauses, 1-3 speed ------------------------------------
  useEffect(() => {
    if (screen !== 'play') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === '1' || e.key === '2' || e.key === '3') setSpeed(Number(e.key));
      else if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen]);

  const over = live && isOver(live);

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-[#c5d4e4] text-slate-800 md:block">
      <div
        className={`relative ${screen === 'play' ? 'h-[46dvh] min-h-64 flex-none md:absolute md:inset-0 md:h-full' : 'min-h-0 flex-1 md:h-full'}`}
      >
        <MapCanvas scene={scene} rendererRef={rendererRef} onHit={onHit} />

        {screen === 'title' && (
          <TitleCard
            boot={boot}
            onDaily={() => startSetup('daily')}
            onPractice={() => startSetup('practice')}
            onContinue={() => {
              if (!boot?.save) return;
              const now = performance.now();
              setLive(boot.save);
              setAvatar({
                from: boot.save.founderHub,
                to: boot.save.founderHub,
                departMs: now,
                arriveMs: now,
              });
              clockRef.current.nextTickAt = 0;
              setBusyUntil(now + 800);
              setPaused(true);
              setScreen('play');
            }}
          />
        )}

        {screen === 'setup' && (
          <SetupOverlay
            step={setupStep}
            name={draftName}
            sectorId={draftSector}
            hubChoice={hubChoice}
            onName={setDraftName}
            onSector={(s) => {
              setDraftSector(s);
              sfx.play('click');
            }}
            onHub={(h) => {
              setHubChoice(h);
              rendererRef.current?.focusHub(h);
            }}
            onRollName={() =>
              setDraftName(generateCompanyName(new Dice((Math.random() * 0xffffffff) >>> 0)))
            }
            onToHq={() => {
              setSetupStep('hq');
              rendererRef.current?.fitOverview();
            }}
            onBack={() => (setupStep === 'hq' ? setSetupStep('identity') : setScreen('title'))}
            onConfirm={found}
          />
        )}

        {screen === 'play' && live && (
          <WeekClock
            live={live}
            span={span}
            paused={paused}
            speed={speed}
            onPause={() => setPaused((p) => !p)}
            onSpeed={setSpeed}
          />
        )}

        {recap && screen === 'play' && (
          <div className="pointer-events-none absolute top-20 left-1/2 z-30 w-[min(26rem,90%)] -translate-x-1/2 rounded-2xl border border-white/60 bg-[#0b1226]/90 px-5 py-4 text-slate-100 shadow-2xl backdrop-blur md:left-[calc((100%-min(24.8rem,38vw))/2)]">
            <p className="text-xs font-black tracking-[0.3em] text-amber-300">
              WEEK {recap.week} WRAPPED
            </p>
            <p className="mt-1 text-sm">
              Cash{' '}
              <b className={recap.cash >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                {recap.cash >= 0 ? '+' : '−'}
                {formatMoney(Math.abs(recap.cash))}
              </b>
              {' · '}Users{' '}
              <b className="text-sky-300">+{Math.round(recap.users).toLocaleString()}</b>
            </p>
            {recap.lines.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-slate-300">
                {recap.lines.map((l, i) => (
                  <li key={i} className="truncate">
                    {l}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {toast && screen === 'play' && (
          <div
            key={toast.key}
            className={`pointer-events-none absolute bottom-8 left-1/2 z-30 w-max max-w-[85%] -translate-x-1/2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-xl backdrop-blur md:left-[calc((100%-min(24.8rem,38vw))/2)] ${
              toast.warn
                ? 'border-rose-300/40 bg-rose-950/85 text-rose-100'
                : 'border-sky-300/30 bg-[#0b1226]/92 text-slate-100'
            }`}
          >
            {toast.text}
          </div>
        )}
      </div>

      {screen === 'play' && live && (
        <aside
          aria-label="Live week controls"
          className="min-h-0 flex-1 overflow-y-auto border-t border-white/55 bg-white/70 p-4 text-slate-800 shadow-lg backdrop-blur-xl md:absolute md:top-3 md:right-3 md:bottom-3 md:z-20 md:w-[min(24.8rem,38vw)] md:rounded-2xl md:border"
        >
          <Panel
            live={live}
            selected={selected}
            busyLabel={busyLabel}
            onAct={(a) =>
              move(
                (s) => doAction(s, a),
                actionSlots(a),
                ACTION_BADGE[a],
                `${PLACE_ACTIONS[a].icon} ${PLACE_ACTIONS[a].name}…`,
              )
            }
            onLead={(id) => move((s) => takeLead(s, id), 1, '🤝')}
            onEvent={(id) => move((s) => attendEvent(s, id), 1, '★')}
            onTravel={travel}
            onSelect={(h) => {
              setSelected(h);
              rendererRef.current?.focusHub(h);
            }}
          />
        </aside>
      )}

      {screen === 'play' && live?.game.pendingDilemma && (
        <DilemmaModal
          dilemma={live.game.pendingDilemma}
          week={live.game.week}
          onChoose={(effect) => {
            const s = liveRef.current;
            if (!s) return;
            const r = chooseLive(s, effect);
            if (r.ok) commit(s, r.state);
          }}
        />
      )}

      {screen === 'play' && live && over && (
        <EndCard
          live={live}
          copied={copied}
          onShare={share}
          onAgain={runItBack}
          onTitle={() => {
            setLive(null);
            setScreen('title');
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function TitleCard({
  boot,
  onDaily,
  onPractice,
  onContinue,
}: {
  boot: {
    save: LiveState | null;
    today: string;
    todayResult: ReturnType<typeof summarize> | null;
    metrics: Metrics | null;
    showStats: boolean;
  } | null;
  onDaily: () => void;
  onPractice: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-3xl bg-white/92 px-6 py-8 text-center shadow-2xl backdrop-blur-md md:px-10">
        <p className="text-xs font-black tracking-[0.4em] text-sky-800">
          RUNWAY · LIVE WEEK PLAYTEST
        </p>
        <h1 className="mt-3 bg-gradient-to-br from-amber-200 via-amber-400 to-orange-500 bg-clip-text text-6xl font-black tracking-tight text-transparent">
          RUNWAY
        </h1>
        <p className="mx-auto mt-4 max-w-md text-base leading-relaxed text-slate-600">
          Every week is a workday across London. Chase angels, stars and journalists before they
          leave, pitch when the odds are right — and keep as much of your company as you can.
        </p>
        <div className="mt-7 flex flex-col items-center gap-2.5">
          <button
            onClick={onDaily}
            className="w-72 rounded-2xl bg-amber-400 px-6 py-3.5 text-lg font-black text-[#161003] shadow-lg transition hover:bg-amber-300 active:scale-[0.98]"
          >
            Daily London {boot ? `· ${boot.today}` : ''}
          </button>
          {boot?.todayResult && (
            <p className="text-xs text-slate-500">
              Today&apos;s ranked result:{' '}
              {boot.todayResult.outcome === 'bust'
                ? `bust in week ${boot.todayResult.weeks}`
                : `${formatMoney(boot.todayResult.payout)} in ${boot.todayResult.weeks} weeks`}{' '}
              · replays are unranked
            </p>
          )}
          <button
            onClick={onPractice}
            className="w-72 rounded-2xl border border-slate-300 bg-white px-6 py-3 text-base font-bold transition hover:bg-slate-50"
          >
            Practice run
          </button>
          {boot?.save && (
            <button
              onClick={onContinue}
              className="w-72 rounded-2xl border border-slate-300 bg-white px-6 py-3 text-sm font-bold transition hover:bg-slate-50"
            >
              Continue — week {boot.save.game.week}, {boot.save.game.companyName}
            </button>
          )}
        </div>
        <p className="mt-6 text-xs text-slate-500">
          Space pauses · 1/2/3 sets speed · click places on the map
        </p>
        {boot?.showStats && boot.metrics && (
          <p className="mt-3 rounded-lg bg-slate-100 px-3 py-2 font-mono text-[11px] text-slate-600">
            playtest: starts {boot.metrics.starts} · finishes {boot.metrics.finishes} · wins{' '}
            {boot.metrics.wins} · restarts&lt;60s {boot.metrics.quickRestarts} · shares{' '}
            {boot.metrics.shares}
          </p>
        )}
      </div>
    </div>
  );
}

function WeekClock({
  live,
  span,
  paused,
  speed,
  onPause,
  onSpeed,
}: {
  live: LiveState;
  span: BusySpan | null;
  paused: boolean;
  speed: number;
  onPause: () => void;
  onSpeed: (n: number) => void;
}) {
  // The engine commits a whole action at once; tick the clock through it.
  const [now, setNow] = useState(0);
  const active = !!span && span.week === live.game.week && now < span.end;
  useEffect(() => {
    if (!span) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [span]);
  const shown =
    active && span
      ? Math.min(
          live.slot,
          span.fromSlot +
            Math.floor(
              ((now - span.start) / Math.max(1, span.end - span.start)) *
                (live.slot - span.fromSlot),
            ),
        )
      : live.slot;
  return (
    <div className="absolute top-3 left-3 z-20 flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 rounded-2xl border border-white/60 bg-white/75 px-3 py-2 shadow-lg backdrop-blur-xl sm:gap-2 md:left-[calc((100%-min(24.8rem,38vw))/2)] md:-translate-x-1/2">
      <span className="text-xs font-black text-slate-700">W{live.game.week}</span>
      <div className="flex gap-0.5" aria-label={`${slotName(shown)}, week ${live.game.week}`}>
        {Array.from({ length: SLOTS_PER_WEEK }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 w-2 rounded-sm sm:h-3 sm:w-3 ${i < shown ? 'bg-slate-400' : i === shown ? 'bg-amber-400' : i < live.slot ? 'bg-amber-200' : 'bg-slate-200'} ${i % 2 === 1 ? 'mr-1' : ''}`}
          />
        ))}
      </div>
      <span className="hidden w-14 text-xs font-bold text-slate-600 sm:inline">
        {slotName(shown)}
      </span>
      <button
        onClick={onPause}
        className="rounded-lg bg-slate-800 px-2 py-1 text-xs font-bold text-white"
        aria-label={paused ? 'Resume' : 'Pause'}
      >
        {paused ? '▶' : '❚❚'}
      </button>
      {[1, 2, 3].map((n) => (
        <button
          key={n}
          onClick={() => onSpeed(n)}
          className={`rounded-lg px-1.5 py-1 text-xs font-bold ${speed === n ? 'bg-amber-400 text-slate-900' : 'bg-slate-200 text-slate-600'}`}
        >
          {n}×
        </button>
      ))}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-white/70 px-2 py-1.5">
      <p className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">{label}</p>
      <p className={`text-sm font-black ${warn ? 'text-rose-600' : 'text-slate-800'}`}>{value}</p>
    </div>
  );
}

function Panel({
  live,
  selected,
  busyLabel,
  onAct,
  onLead,
  onEvent,
  onTravel,
  onSelect,
}: {
  live: LiveState;
  selected: HubId | null;
  busyLabel: string | null;
  onAct: (a: PlaceActionId) => void;
  onLead: (id: string) => void;
  onEvent: (id: string) => void;
  onTravel: (hub: HubId, how: TravelMode) => void;
  onSelect: (hub: HubId) => void;
}) {
  const g = live.game;
  const s = g.stats;
  const runway = liveRunwayWeeks(live);
  const readiness = pitchReadiness(g);
  const next = STAGES[g.stageIndex + 1];
  const here = live.founderHub;
  const target = selected && selected !== here ? selected : null;
  const leadsHere = openLeadsAt(live, here);
  const eventsHere = openEventsAt(live, here);

  return (
    <div className="space-y-4 text-sm">
      <header>
        <p className="text-xs font-bold text-slate-500">
          {SECTORS.find((x) => x.id === g.sectorId)?.emoji} {STAGES[g.stageIndex].name} · HQ{' '}
          {hubById(g.hubId).name}
        </p>
        <h2 className="text-xl font-black">{g.companyName}</h2>
      </header>

      <div className="grid grid-cols-3 gap-1.5">
        <Stat label="Cash" value={formatMoney(s.cash)} warn={runway < 4} />
        <Stat
          label="Runway"
          value={runway === Infinity ? '∞' : `${runway.toFixed(1)} wk`}
          warn={runway < 4}
        />
        <Stat label="Burn/wk" value={formatMoney(liveBurn(live))} />
        <Stat label="Users" value={Math.round(s.traction).toLocaleString()} />
        <Stat label="Product" value={`${Math.floor(s.product)}/${productCap(g)}`} />
        <Stat label="Team" value={`${s.team}`} />
        <Stat label="Hype" value={`${Math.round(s.hype)}`} />
        <Stat label="Morale" value={`${Math.round(s.morale)}`} warn={s.morale < 35} />
        <Stat label="You own" value={`${(live.equity * 100).toFixed(0)}%`} />
      </div>

      {next && (
        <section className="rounded-xl border border-amber-300/60 bg-amber-50/80 p-3">
          <p className="text-xs font-black tracking-wider text-amber-800 uppercase">
            Next: {next.name}
          </p>
          <p className="mt-1 text-xs text-slate-700">
            Pitch at <b>{pitchVenue(live)}</b>.{' '}
            {readiness.ready ? (
              <>
                Odds <b>{Math.round(pitchOdds(g) * 100)}%</b> · you&apos;d sell ~
                <b>{Math.round(nextDilution(live) * 100)}%</b>
              </>
            ) : (
              <span className="text-slate-500">Not ready: {readiness.reasons.join(' · ')}</span>
            )}
          </p>
          {here !== pitchHub(live) && (
            <button
              onClick={() => onSelect(pitchHub(live))}
              className="mt-1.5 text-xs font-bold text-amber-800 underline"
            >
              Show me where
            </button>
          )}
        </section>
      )}

      <section>
        <p className="text-xs font-black tracking-wider text-slate-500 uppercase">
          📍 You&apos;re in {hubById(here).name}
        </p>
        {busyLabel && (
          <p
            role="status"
            className="mt-1.5 rounded-xl bg-slate-800 px-3 py-2 text-sm font-bold text-white"
          >
            {busyLabel}
          </p>
        )}
        <div
          className={`mt-1.5 grid grid-cols-2 gap-1.5 ${busyLabel ? 'pointer-events-none opacity-40' : ''}`}
        >
          {optionsHere(live).map((o) => (
            <button
              key={o.action}
              onClick={() => onAct(o.action)}
              disabled={!o.ok}
              title={o.why}
              className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-left transition enabled:hover:border-amber-400 disabled:opacity-45"
            >
              <span className="block text-sm font-bold">
                {PLACE_ACTIONS[o.action].icon} {PLACE_ACTIONS[o.action].name}
              </span>
              <span className="block text-[11px] text-slate-500">
                {o.ok ? `${o.slots} half-days` : o.why}
              </span>
            </button>
          ))}
          {leadsHere.map((l) => (
            <button
              key={l.id}
              onClick={() => onLead(l.id)}
              disabled={live.slot < l.opens}
              className="rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-2 text-left transition enabled:hover:border-amber-500 disabled:opacity-50"
            >
              <span className="block text-sm font-bold">
                {leadMeta(l.kind).icon} {l.title}
              </span>
              <span className="block text-[11px] text-slate-600">
                {live.slot < l.opens
                  ? `Arrives ${slotName(l.opens)}`
                  : `${leadMeta(l.kind).blurb} · 1 half-day`}
              </span>
            </button>
          ))}
          {eventsHere.map(({ ev, win }) => (
            <button
              key={ev.id}
              onClick={() => onEvent(ev.id)}
              disabled={live.slot < win.opens}
              className="rounded-xl border border-sky-300 bg-sky-50 px-2.5 py-2 text-left transition enabled:hover:border-sky-500 disabled:opacity-50"
            >
              <span className="block text-sm font-bold">★ {ev.name}</span>
              <span className="block text-[11px] text-slate-600">
                {live.slot < win.opens ? `On ${eventDay(win)}` : `${ev.venue} · 1 half-day`}
              </span>
            </button>
          ))}
        </div>
      </section>

      {target && (
        <section className="rounded-xl border border-slate-300 bg-white/80 p-3">
          <p className="text-xs font-black tracking-wider text-slate-500 uppercase">
            Go to {hubById(target).name}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            There:{' '}
            {hubOffers(live, target)
              .map((a) => `${PLACE_ACTIONS[a].icon} ${PLACE_ACTIONS[a].name}`)
              .join(' · ')}
          </p>
          <div className="mt-2 flex gap-1.5">
            {(['tube', 'taxi'] as const).map((how) => {
              const q = travelQuote(here, target, how);
              const fits = live.slot + q.slots <= SLOTS_PER_WEEK;
              return (
                <button
                  key={how}
                  onClick={() => onTravel(target, how)}
                  disabled={!fits}
                  className="flex-1 rounded-xl bg-slate-800 px-2 py-2 text-xs font-bold text-white transition enabled:hover:bg-slate-700 disabled:opacity-40"
                >
                  {how === 'tube' ? '🚇 Tube' : '🚕 Taxi'} · {q.slots} half-day
                  {q.slots === 1 ? '' : 's'}
                  {q.cost ? ` · £${q.cost}` : ''}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <p className="text-xs font-black tracking-wider text-slate-500 uppercase">
          This week in London
        </p>
        <ul className="mt-1.5 space-y-1">
          {live.leads.map((l) => (
            <li key={l.id}>
              <button
                onClick={() => onSelect(l.hubId)}
                disabled={l.taken || l.closes < live.slot}
                className="w-full rounded-lg px-2 py-1 text-left text-xs transition enabled:hover:bg-white disabled:line-through disabled:opacity-50"
              >
                {leadMeta(l.kind).icon} <b>{l.title}</b> · {hubById(l.hubId).name} ·{' '}
                {slotName(l.opens)}–{slotName(l.closes)}
              </button>
            </li>
          ))}
          {g.eventsThisWeek.map((e) => {
            const win = live.eventWindows.find((w) => w.eventId === e.id);
            return (
              <li key={e.id}>
                <button
                  onClick={() => onSelect(e.hubId)}
                  disabled={e.attended || !win || win.closes < live.slot}
                  className="w-full rounded-lg px-2 py-1 text-left text-xs transition enabled:hover:bg-white disabled:line-through disabled:opacity-50"
                >
                  ★ <b>{e.name}</b> · {hubById(e.hubId).name} · {win ? eventDay(win) : ''}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <p className="text-xs font-black tracking-wider text-slate-500 uppercase">News</p>
        <ul className="mt-1 space-y-1 text-xs text-slate-600">
          {g.news
            .slice(-4)
            .reverse()
            .map((n, i) => (
              <li key={`${n.week}-${i}`}>
                <span className="font-bold text-slate-400">W{n.week}</span> {n.text}
              </li>
            ))}
        </ul>
      </section>
    </div>
  );
}

function EndCard({
  live,
  copied,
  onShare,
  onAgain,
  onTitle,
}: {
  live: LiveState;
  copied: boolean;
  onShare: () => void;
  onAgain: () => void;
  onTitle: () => void;
}) {
  const r = summarize(live);
  const title =
    r.outcome === 'unicorn'
      ? '🦄 Unicorn'
      : r.outcome === 'acquired'
        ? '🤝 Acquired'
        : '💀 Out of runway';
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#070c1a]/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white px-6 py-7 text-center shadow-2xl">
        <p className="text-xs font-black tracking-[0.3em] text-slate-500">
          {live.config.mode === 'daily' ? `DAILY LONDON · ${live.config.dayKey}` : 'PRACTICE RUN'}
        </p>
        <h2 className="mt-2 text-3xl font-black">{title}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {live.game.companyName} · {hubById(r.hub).name} · week {r.weeks}
        </p>
        {r.outcome !== 'bust' ? (
          <>
            <p className="mt-5 text-xs font-bold tracking-wider text-slate-500 uppercase">
              You walked away with
            </p>
            <p className="text-5xl font-black text-emerald-600">{formatMoney(payout(live))}</p>
            <p className="mt-1 text-sm text-slate-600">
              Kept {(r.equity * 100).toFixed(0)}% of a {formatMoney(r.valuation)} company
            </p>
          </>
        ) : (
          <>
            <p className="mt-5 text-xs font-bold tracking-wider text-slate-500 uppercase">
              Peak valuation
            </p>
            <p className="text-4xl font-black text-slate-700">{formatMoney(r.peakValuation)}</p>
          </>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <button
            onClick={onAgain}
            className="rounded-2xl bg-amber-400 px-6 py-3.5 text-lg font-black text-[#161003] shadow-lg transition hover:bg-amber-300"
          >
            Run it back
          </button>
          <button
            onClick={onShare}
            className="rounded-2xl bg-slate-900 px-6 py-3 text-base font-bold text-white transition hover:bg-slate-800"
          >
            {copied ? 'Copied ✓' : 'Copy result to share'}
          </button>
          <button onClick={onTitle} className="text-sm font-bold text-slate-500 underline">
            Title screen
          </button>
        </div>
      </div>
    </div>
  );
}
