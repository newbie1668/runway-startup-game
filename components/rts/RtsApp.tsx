'use client';

/**
 * RUNWAY: London Live — map-based startup sim prototype shell.
 *
 * Owns the real-time loop (in-game days per real second × speed), input
 * (select / box-select / right-click to send people / pan / zoom / hotkeys)
 * and the HUD around the map canvas. All rules live in lib/rts/sim.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { HUBS, SECTORS, STAGES, generateCompanyName } from '@/lib/game/content';
import { fmtMoney, fmtUsers } from '@/lib/game/format';
import { LANDMARKS, project, type LandmarkKind } from '@/lib/game/geo';
import { Dice, seedFromString } from '@/lib/game/rng';
import { MapRenderer } from '@/lib/game/render';
import { createMapDiagnostics } from '@/lib/game/mapDiagnostics';
import { hasProjection, type ProjectedMapRenderer } from '@/lib/game/mapProjection';
import { createMapRenderer } from '@/lib/game/render3d/factory';
import type { Scene } from '@/lib/game/scene';
import type { HubId, SectorId } from '@/lib/game/types';
import { advanceAmbient, createAmbient } from '@/lib/rts/ambient';
import {
  ENGINEER_HIRE_FEE,
  ENGINEER_WEEKLY_SALARY,
  CHAPTERS,
  FEATURES,
  GROWTH_HIRE_FEE,
  GROWTH_WEEKLY_SALARY,
  LANDMARK_FACTS,
  OFFICE_LEVELS,
  OFFICE_OPEN_COST,
  SEGMENT_INFO,
} from '@/lib/rts/content';
import {
  LEAD_STYLE,
  ROLE_ICON,
  ROLE_LABEL,
  RtsRenderer,
  SEGMENT_ICON,
  featureForSegment,
  placeIcon,
  type RtsHit,
} from '@/lib/rts/render';
import {
  autoCommands,
  canResearch,
  campaignStatus,
  hire,
  movePeople,
  newRtsGame,
  objectiveProgress,
  journalProgress,
  openOffice,
  personActivity,
  pitch,
  pitchPreview,
  resolveDilemma,
  runwayWeeks,
  setResearch,
  teamCap,
  tick,
  unlockedSegments,
  upgradeOffice,
  weeklyBurn,
  weeklyRevenue,
} from '@/lib/rts/sim';
import type {
  CompanyId,
  Feature,
  FeatureId,
  Lead,
  MoveTarget,
  Office,
  Person,
  Place,
  RtsFx,
  RtsResult,
  RtsState,
} from '@/lib/rts/types';

/** In-game days per real second at 1×. */
const DAYS_PER_SECOND = 0.35;
const SPEEDS = [0, 1, 2, 4] as const;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const COMPANY_ORDER: CompanyId[] = ['player', 'rival1', 'rival2', 'rival3'];
const MOMENT_DURATION_MS = 3700;
const MOMENT_HOLD_MS = 3200;
const MOMENT_MAX_AGE_DAYS = 20;
type MomentFx = Extract<RtsFx, { kind: 'moment' }>;
interface QueuedMoment {
  id: number;
  day: number;
  fx: MomentFx;
}

const LEAD_REWARD: Record<Lead['kind'], string> = {
  meetup: 'Hype and a few hundred users',
  candidate: 'A free hire joins on the spot (salary applies)',
  journalist: 'A big hype boost',
  angel: '£60k for 2% of the company',
};

const hubName = (id: HubId) => HUBS.find((h) => h.id === id)!.name;
const pct = (v: number) => `${Math.round(v * 100)}%`;
const featureById = (id: FeatureId) => FEATURES.find((f) => f.id === id)!;

interface SetupChoice {
  name: string;
  sectorId: SectorId;
  hqHub: HubId;
  seed: string;
}

export function RtsApp() {
  const [setup, setSetup] = useState<SetupChoice | null>(null);
  const [game, setGame] = useState<{ cfg: SetupChoice; key: number } | null>(null);

  if (!game) {
    return (
      <SetupScreen
        initial={setup}
        onStart={(cfg) => {
          setSetup(cfg);
          setGame({ cfg, key: Date.now() });
        }}
      />
    );
  }
  return (
    <Live
      key={game.key}
      cfg={game.cfg}
      onRestart={() => setGame({ cfg: game.cfg, key: Date.now() })}
      onNewSetup={() => setGame(null)}
    />
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function SetupScreen({ initial, onStart }: { initial: SetupChoice | null; onStart: (c: SetupChoice) => void }) {
  const [name, setName] = useState(
    () => initial?.name ?? generateCompanyName(new Dice(seedFromString('runway-live'))),
  );
  const [sectorId, setSectorId] = useState<SectorId>(initial?.sectorId ?? 'ai');
  const [hqHub, setHqHub] = useState<HubId>(initial?.hqHub ?? 'shoreditch');
  const [seed, setSeed] = useState(initial?.seed ?? 'london-1');

  return (
    <main className="min-h-screen bg-[#070c1a] px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-bold tracking-[0.35em] text-sky-300">RUNWAY · PROTOTYPE</p>
        <h1 className="mt-2 bg-gradient-to-r from-amber-200 to-amber-400 bg-clip-text text-4xl font-black text-transparent">
          London Live
        </h1>
        <p className="mt-3 max-w-2xl text-slate-300">
          Run your startup on the map. Send your founder, engineers and growth people around London — ship
          the roadmap at your office, sign customers across town, recruit at meetups and pitch investors in
          person. Rivals are doing the same. Reach unicorn before the cash runs out.
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <section>
            <h2 className="text-sm font-bold tracking-widest text-slate-400">COMPANY</h2>
            <div className="mt-2 flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-lg font-bold"
                aria-label="Company name"
              />
              <button
                onClick={() => setName(generateCompanyName(new Dice(seedFromString(`${name}-${Date.now()}`))))}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 hover:border-slate-500"
                title="Random name"
              >
                🎲
              </button>
            </div>
            <h2 className="mt-6 text-sm font-bold tracking-widest text-slate-400">SECTOR</h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {SECTORS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSectorId(s.id)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${
                    sectorId === s.id ? 'border-amber-400 bg-amber-400/10' : 'border-slate-700 bg-slate-900 hover:border-slate-500'
                  }`}
                >
                  <div className="font-bold">
                    {s.emoji} {s.name}
                  </div>
                  <div className="text-xs text-slate-400">
                    Best customers:{' '}
                    {(Object.keys(SEGMENT_INFO) as (keyof typeof SEGMENT_INFO)[])
                      .filter((seg) => SEGMENT_INFO[seg].fit.includes(s.id))
                      .map((seg) => SEGMENT_INFO[seg].name)
                      .join(', ') || 'anyone'}
                  </div>
                </button>
              ))}
            </div>
            <h2 className="mt-6 text-sm font-bold tracking-widest text-slate-400">SEED</h2>
            <input
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm"
              aria-label="Seed"
            />
            <p className="mt-1 text-xs text-slate-500">Same seed = same pins, dilemmas and rivals.</p>
          </section>
          <section>
            <h2 className="text-sm font-bold tracking-widest text-slate-400">WHERE&rsquo;S YOUR KITCHEN TABLE?</h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {HUBS.map((h) => (
                <button
                  key={h.id}
                  onClick={() => setHqHub(h.id)}
                  className={`rounded-lg border px-3 py-2 text-left text-sm ${
                    hqHub === h.id ? 'border-amber-400 bg-amber-400/10' : 'border-slate-700 bg-slate-900 hover:border-slate-500'
                  }`}
                >
                  <div className="font-bold">{h.name}</div>
                  <div className="text-xs text-slate-400">{h.blurb}</div>
                </button>
              ))}
            </div>
          </section>
        </div>
        <button
          onClick={() => onStart({ name: name.trim() || 'Startup', sectorId, hqHub, seed: seed.trim() || 'london-1' })}
          className="mt-8 rounded-xl bg-amber-400 px-8 py-3 text-lg font-black text-slate-900 hover:bg-amber-300"
        >
          Start the company →
        </button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Live game
// ---------------------------------------------------------------------------

function Live({ cfg, onRestart, onNewSetup }: { cfg: SetupChoice; onRestart: () => void; onNewSetup: () => void }) {
  const autoplay =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('autoplay') === '1';
  const cityCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RtsRenderer | null>(null);
  const ambientRef = useRef<ReturnType<typeof createAmbient> | null>(null);
  const mapRef = useRef<ProjectedMapRenderer | null>(null);
  const mapReadyRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [initial] = useState(() =>
    newRtsGame({ seed: cfg.seed, companyName: cfg.name, sectorId: cfg.sectorId, hqHub: cfg.hqHub }),
  );
  const stateRef = useRef<RtsState>(initial);
  const speedRef = useRef(0);
  const [ui, setUi] = useState<RtsState>(initial);
  const [speed, setSpeedState] = useState(0);
  const [selection, setSelection] = useState<string[]>([]);
  const selectionRef = useRef<string[]>([]);
  const [ridingId, setRidingIdState] = useState<string | null>(null);
  const ridingIdRef = useRef<string | null>(null);
  const [postcards, setPostcards] = useState<{ id: number; landmark: LandmarkKind }[]>([]);
  const postcardIdRef = useRef(0);
  const [focus, setFocus] = useState<RtsHit | null>(() => {
    const hq = initial.offices.find((o) => o.company === 'player');
    return hq ? { type: 'office', id: hq.id } : null;
  });
  const [toast, setToast] = useState<string | null>(null);
  const [bonusToast, setBonusToast] = useState<{ id: number; label: string } | null>(null);
  const bonusToastIdRef = useRef(0);
  const [activeMoment, setActiveMoment] = useState<QueuedMoment | null>(null);
  const activeMomentRef = useRef<QueuedMoment | null>(null);
  const momentQueueRef = useRef<QueuedMoment[]>([]);
  const momentIdRef = useRef(0);
  const momentElapsedMsRef = useRef(0);
  const [momentPhase, setMomentPhase] = useState<'enter' | 'hold' | 'exit'>('enter');
  const [showHelp, setShowHelp] = useState(true);
  const [showRoadmap, setShowRoadmap] = useState(false);
  const [showJournal, setShowJournal] = useState(false);
  const [briefingIndex, setBriefingIndex] = useState<number | null>(null);
  const [completedChapter, setCompletedChapter] = useState<{ index: number; stars: number } | null>(null);
  const briefingSeenRef = useRef(false);
  const campaignModalOpenRef = useRef(false);
  const modalOpenRef = useRef(true);
  const momentQueuePaused =
    briefingIndex !== null ||
    completedChapter !== null ||
    ['dilemma', 'won', 'bankrupt'].includes(ui.phase);
  const momentQueuePausedRef = useRef(momentQueuePaused);
  const briefingResumeSpeedRef = useRef(1);
  const completedResumeSpeedRef = useRef(1);

  const dequeueFreshMoment = useCallback(() => {
    const queue = momentQueueRef.current;
    const day = stateRef.current.day;
    while (queue.length > 0 && day - queue[0]!.day > MOMENT_MAX_AGE_DAYS)
      queue.shift();
    return queue.shift() ?? null;
  }, []);

  const enqueueMoment = useCallback((fx: MomentFx, day: number) => {
    const moment = { id: ++momentIdRef.current, day, fx };
    if (!activeMomentRef.current && !momentQueuePausedRef.current) {
      momentElapsedMsRef.current = 0;
      activeMomentRef.current = moment;
      setMomentPhase('enter');
      setActiveMoment(moment);
      return;
    }
    const queue = momentQueueRef.current;
    while (queue.length > 0 && day - queue[0]!.day > MOMENT_MAX_AGE_DAYS)
      queue.shift();
    queue.push(moment);
    if (queue.length > 3) queue.splice(0, queue.length - 3);
  }, []);

  useEffect(() => {
    modalOpenRef.current =
      showHelp ||
      showRoadmap ||
      showJournal ||
      briefingIndex !== null ||
      completedChapter !== null ||
      ['dilemma', 'won', 'bankrupt'].includes(stateRef.current.phase);
  }, [showHelp, showRoadmap, showJournal, briefingIndex, completedChapter, ui.phase]);

  useEffect(() => {
    momentQueuePausedRef.current = momentQueuePaused;
  }, [momentQueuePaused]);

  useEffect(() => {
    if (momentQueuePaused) return;
    const expired =
      activeMoment !== null &&
      stateRef.current.day - activeMoment.day > MOMENT_MAX_AGE_DAYS;
    if (expired || (!activeMoment && momentQueueRef.current.length > 0)) {
      const frame = window.requestAnimationFrame(() => {
        if (momentQueuePausedRef.current) return;
        const current = activeMomentRef.current;
        if (
          current &&
          stateRef.current.day - current.day <= MOMENT_MAX_AGE_DAYS
        )
          return;
        const next = dequeueFreshMoment();
        activeMomentRef.current = next;
        momentElapsedMsRef.current = 0;
        setMomentPhase('enter');
        setActiveMoment(next);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (!activeMoment) {
      activeMomentRef.current = null;
      momentElapsedMsRef.current = 0;
      return;
    }
    const elapsedAtStart = momentElapsedMsRef.current;
    const remainingMs = Math.max(0, MOMENT_DURATION_MS - elapsedAtStart);
    const startedAt = performance.now();
    let finished = false;
    const entrance = window.requestAnimationFrame(() => setMomentPhase('hold'));
    const exitDelay = MOMENT_HOLD_MS - elapsedAtStart;
    const exit =
      exitDelay > 0 ? window.setTimeout(() => setMomentPhase('exit'), exitDelay) : null;
    const dismiss = window.setTimeout(() => {
      if (momentQueuePausedRef.current) return;
      finished = true;
      const next = dequeueFreshMoment();
      activeMomentRef.current = next;
      momentElapsedMsRef.current = 0;
      setMomentPhase('enter');
      setActiveMoment(next);
    }, remainingMs);
    return () => {
      window.cancelAnimationFrame(entrance);
      if (exit !== null) window.clearTimeout(exit);
      window.clearTimeout(dismiss);
      if (!finished)
        momentElapsedMsRef.current = Math.min(
          MOMENT_DURATION_MS,
          elapsedAtStart + performance.now() - startedAt,
        );
    };
  }, [activeMoment, dequeueFreshMoment, momentQueuePaused]);

  const setRideAlong = useCallback((id: string | null) => {
    ridingIdRef.current = id;
    setRidingIdState(id);
  }, []);
  const toggleRideAlong = useCallback(
    (id: string) => setRideAlong(ridingIdRef.current === id ? null : id),
    [setRideAlong],
  );
  const selectPeople = useCallback(
    (next: string[] | ((previous: string[]) => string[])) => {
      const selected = typeof next === 'function' ? next(selectionRef.current) : next;
      selectionRef.current = selected;
      setSelection(selected);
      if (
        ridingIdRef.current &&
        (selected.length !== 1 || selected[0] !== ridingIdRef.current)
      )
        setRideAlong(null);
    },
    [setRideAlong],
  );
  const setSpeed = useCallback((v: number) => {
    if (v > 0 && !mapReadyRef.current) return;
    speedRef.current = v;
    setSpeedState(v);
  }, []);

  const openBriefing = useCallback(
    (pause = true, resumeSpeed?: number) => {
      const index = stateRef.current.campaign.chapter;
      const chapter = CHAPTERS[index];
      if (!chapter) return;
      briefingSeenRef.current = true;
      campaignModalOpenRef.current = true;
      momentQueuePausedRef.current = true;
      briefingResumeSpeedRef.current = resumeSpeed ?? (speedRef.current || 1);
      setBriefingIndex(index);
      setShowHelp(false);
      if (pause) setSpeed(0);
      if (chapter.focus.kind === 'hq') {
        const hq = stateRef.current.offices.find(
          (office) =>
            office.company === 'player' &&
            office.hubId === stateRef.current.companies.player.hqHub,
        );
        if (hq) mapRef.current?.lookAt(hq.x, hq.y, 25);
      } else {
        const landmarkKind = chapter.focus.landmark;
        const landmark = LANDMARKS.find((item) => item.kind === landmarkKind);
        if (landmark) {
          const point = project(landmark.at);
          mapRef.current?.lookAt(point.x, point.y, 12);
        }
      }
    },
    [setSpeed],
  );

  const startAtSpeed = useCallback(
    (value: number) => {
      if (value > 0 && !mapReadyRef.current) return;
      if (value > 0 && !briefingSeenRef.current) {
        briefingSeenRef.current = true;
        setShowHelp(false);
        openBriefing(true, value);
      } else {
        setSpeed(value);
      }
    },
    [openBriefing, setSpeed],
  );

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2800);
  }, []);

  const handleFx = useCallback(
    (res: RtsResult) => {
      const r = rendererRef.current;
      const chapterWillOpen = res.fx.some(
        (effect) => effect.kind === 'chapter' && effect.index < CHAPTERS.length - 1,
      );
      const phaseWillOpenModal = ['dilemma', 'won', 'bankrupt'].includes(res.state.phase);
      if (chapterWillOpen || phaseWillOpenModal) momentQueuePausedRef.current = true;
      r?.applyFx(res.fx);
      for (const f of res.fx) {
        if (f.kind === 'focus') {
          const pairedWithMoment = res.fx.some(
            (effect) => effect.kind === 'moment' && effect.x === f.x && effect.y === f.y,
          );
          if (
            !pairedWithMoment ||
            (!ridingIdRef.current &&
              !modalOpenRef.current &&
              !campaignModalOpenRef.current &&
              !chapterWillOpen &&
              !phaseWillOpenModal)
          )
            r?.centerOn(f);
        } else if (f.kind === 'bonus')
          setBonusToast({ id: ++bonusToastIdRef.current, label: f.label });
        else if (f.kind === 'moment') {
          if (f.tone === 'good') {
            const hasConfetti = res.fx.some(
              (effect) =>
                effect.kind === 'confetti' && effect.x === f.x && effect.y === f.y,
            );
            if (!hasConfetti) r?.applyFx([{ kind: 'confetti', x: f.x, y: f.y }]);
          } else r?.applyMomentPulse(f.x, f.y);
          if (
            !ridingIdRef.current &&
            !modalOpenRef.current &&
            !campaignModalOpenRef.current &&
            !chapterWillOpen &&
            !phaseWillOpenModal
          )
            mapRef.current?.lookAt(f.x, f.y, 10);
          enqueueMoment(f, res.state.day);
        } else if (f.kind === 'chapter') {
          const hq =
            res.state.offices.find(
              (office) =>
                office.company === 'player' &&
                office.hubId === res.state.companies.player.hqHub,
            ) ?? res.state.offices.find((office) => office.company === 'player');
          if (hq) r?.applyFx([{ kind: 'confetti', x: hq.x, y: hq.y }]);
          if (f.index < CHAPTERS.length - 1) {
            completedResumeSpeedRef.current = speedRef.current || 1;
            campaignModalOpenRef.current = true;
            setSpeed(0);
            setCompletedChapter({ index: f.index, stars: f.stars });
          }
        }
      }
      const found = res.fx.flatMap((f) =>
        f.kind === 'postcard' ? [{ id: ++postcardIdRef.current, landmark: f.landmark }] : [],
      );
      if (found.length > 0) setPostcards((queue) => [...queue, ...found]);
    },
    [enqueueMoment, setSpeed],
  );

  const currentPostcardId = postcards[0]?.id ?? null;
  useEffect(() => {
    if (currentPostcardId === null) return;
    const timer = window.setTimeout(() => {
      setPostcards((queue) => (queue[0]?.id === currentPostcardId ? queue.slice(1) : queue));
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [currentPostcardId]);

  useEffect(() => {
    if (!bonusToast) return;
    const id = bonusToast.id;
    const timer = window.setTimeout(() => {
      setBonusToast((current) => (current?.id === id ? null : current));
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [bonusToast]);

  const flyToLandmark = useCallback((kind: LandmarkKind) => {
    const landmark = LANDMARKS.find((item) => item.kind === kind);
    if (!landmark) return;
    const point = project(landmark.at);
    mapRef.current?.lookAt(point.x, point.y, 6);
    setShowJournal(false);
  }, []);

  const run = useCallback(
    (fn: (s: RtsState) => RtsResult) => {
      const res = fn(stateRef.current);
      if (res.error) {
        flash(res.error);
        return false;
      }
      stateRef.current = res.state;
      handleFx(res);
      setUi(res.state);
      return true;
    },
    [flash, handleFx],
  );

  useEffect(() => {
    if (!autoplay || !showHelp || !mapReady) return;
    const timer = window.setTimeout(() => startAtSpeed(4), 2500);
    return () => window.clearTimeout(timer);
  }, [autoplay, mapReady, showHelp, startAtSpeed]);

  useEffect(() => {
    if (!autoplay || briefingIndex === null) return;
    const timer = window.setTimeout(() => {
      campaignModalOpenRef.current = false;
      setBriefingIndex(null);
      setSpeed(briefingResumeSpeedRef.current || 4);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [autoplay, briefingIndex, setSpeed]);

  useEffect(() => {
    if (!autoplay || !completedChapter) return;
    const timer = window.setTimeout(() => {
      setCompletedChapter(null);
      openBriefing(true, completedResumeSpeedRef.current || 4);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [autoplay, completedChapter, openBriefing]);

  useEffect(() => {
    if (!autoplay || ui.phase !== 'dilemma') return;
    const timer = window.setTimeout(() => run((state) => resolveDilemma(state, 0)), 2500);
    return () => window.clearTimeout(timer);
  }, [autoplay, run, ui.phase]);

  useEffect(() => {
    const r = rendererRef.current;
    selectionRef.current = selection;
    if (!r) return;
    r.selected = new Set(selection);
    r.focus = focus;
  }, [selection, focus]);

  /** Send people to whatever was clicked. Founder heading to an investor pitches on arrival. */
  const sendTo = useCallback(
    (hit: RtsHit | null, ids: string[]) => {
      if (!hit || ids.length === 0) return;
      const s = stateRef.current;
      const mine = s.people.filter((p) => ids.includes(p.id) && p.company === 'player');
      if (mine.length === 0) return;
      let target: MoveTarget | null = null;
      if (hit.type === 'place') target = { kind: 'place', id: hit.id };
      else if (hit.type === 'office') target = { kind: 'office', id: hit.id };
      else if (hit.type === 'lead') {
        const lead = s.leads.find((l) => l.id === hit.id)!;
        const able = mine.filter((p) => lead.takenBy.includes(p.role));
        if (able.length === 0) {
          flash(`Only ${lead.takenBy.map((k) => ROLE_LABEL[k].toLowerCase()).join(' / ')} can take this one`);
          return;
        }
        run((st) => movePeople(st, [able[0].id], { kind: 'lead', id: lead.id }));
        return;
      } else if (hit.type === 'person') {
        const other = s.people.find((p) => p.id === hit.id);
        if (other?.at) target = s.offices.some((o) => o.id === other.at) ? { kind: 'office', id: other.at } : { kind: 'place', id: other.at };
      }
      if (!target) return;
      const place = target.kind === 'place' ? s.places.find((p) => p.id === target!.id) : undefined;
      const founder = mine.find((p) => p.role === 'founder');
      if (place?.kind === 'investor' && founder) {
        run((st) => movePeople(st, [founder.id], target!, { pitchOnArrival: true }));
        const rest = mine.filter((p) => p !== founder).map((p) => p.id);
        if (rest.length) run((st) => movePeople(st, rest, target!));
      } else {
        run((st) => movePeople(st, mine.map((p) => p.id), target!));
      }
    },
    [flash, run],
  );

  // Renderer + loop + input
  useEffect(() => {
    const cityCanvas = cityCanvasRef.current!;
    const overlayCanvas = overlayCanvasRef.current!;
    const canvas = canvasRef.current!;
    const profileAmbient = new URLSearchParams(window.location.search).get('ambientPerf') === '1';
    let r: RtsRenderer | null = null;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    let activeMode: '2d' | '3d' | 'pending' = 'pending';
    let cancelled = false;
    let ambientFrames = 0;
    let ambientUpdateTotalMs = 0;
    let ambientDrawTotalMs = 0;
    let nextAutoplayDay = stateRef.current.day + 0.5;
    const keys = new Set<string>();
    const mapScene: Scene = {
      mode: 'play',
      playerHubId: null,
      playerSectorId: cfg.sectorId,
      companyName: cfg.name,
      stageName: '',
      rivals: [],
      events: [],
    };
    const fireReady = () => {
      if (cancelled || mapReadyRef.current) return;
      mapReadyRef.current = true;
      setMapReady(true);
    };
    const onFatal = (reason = '3D renderer failed') => {
      if (cancelled || activeMode === '2d') return;
      const old = mapRef.current;
      const camera = old?.getCamera();
      try {
        old?.dispose();
      } catch (error) {
        console.error('Failed to dispose the 3D map before fallback', error);
      }
      const fallback = new MapRenderer(overlayCanvas);
      fallback.resize();
      fallback.scene = mapScene;
      if (camera) fallback.setCamera(camera);
      if (!hasProjection(fallback))
        throw new Error('The 2D map renderer is missing ground projection support.');
      mapRef.current = fallback;
      activeMode = '2d';
      if (r) {
        r.map = fallback;
        r.atmosphere = 'night';
      }
      console.warn(`Falling back to the 2D London map: ${reason}`);
    };

    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(canvas);

    let drag: { x: number; y: number; moved: number; box: boolean; button: number } | null = null;

    const pos = (e: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    let detachInput: (() => void) | null = null;
    const loop = (t: number) => {
      if (!r) return;
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const before = stateRef.current;
      const gameDays =
        speedRef.current > 0 && before.phase === 'playing'
          ? dt * speedRef.current * DAYS_PER_SECOND
          : 0;
      if (gameDays > 0) {
        let res = tick(before, gameDays);
        if (
          autoplay &&
          res.state.phase === 'playing' &&
          res.state.day + 1e-8 >= nextAutoplayDay
        ) {
          while (nextAutoplayDay <= res.state.day + 1e-8) nextAutoplayDay += 0.5;
          const commands = autoCommands(res.state, 'player');
          res = {
            ...res,
            state: commands.state,
            fx: [...res.fx, ...commands.fx],
          };
        }
        stateRef.current = res.state;
        handleFx(res);
      }
      const measureAmbient = profileAmbient && gameDays > 0 && ambientFrames < 300;
      const ambientStarted = measureAmbient ? performance.now() : 0;
      if (gameDays > 0 && ambientRef.current) advanceAmbient(ambientRef.current, gameDays);
      const ambientUpdateMs = measureAmbient ? performance.now() - ambientStarted : 0;
      const map = mapRef.current;
      if (map) {
        const pan = 520 * dt;
        if (keys.has('w') || keys.has('arrowup')) map.pan(0, pan);
        if (keys.has('s') || keys.has('arrowdown')) map.pan(0, -pan);
        if (keys.has('a') || keys.has('arrowleft')) map.pan(pan, 0);
        if (keys.has('d') || keys.has('arrowright')) map.pan(-pan, 0);
        const followId = ridingIdRef.current;
        if (followId) {
          const person = stateRef.current.people.find((item) => item.id === followId);
          if (!person) {
            setRideAlong(null);
          } else {
            const camera = map.getCamera();
            const easing = Math.min(1, dt * 4);
            const targetZoom = canvas.getBoundingClientRect().height / 6;
            map.setCamera({
              ...camera,
              x: camera.x + (person.x - camera.x) * easing,
              y: camera.y + (person.y - camera.y) * easing,
              zoom: camera.zoom + (targetZoom - camera.zoom) * easing,
            });
          }
        }
        try {
          map.frame(t, dt);
        } catch (error) {
          if (activeMode === '3d') onFatal(error instanceof Error ? error.message : String(error));
          else throw error;
        }
        if (activeMode === '2d') fireReady();
      }
      r.state = stateRef.current;
      r.frame(t, dt);
      if (measureAmbient) {
        ambientFrames += 1;
        ambientUpdateTotalMs += ambientUpdateMs;
        ambientDrawTotalMs += r.ambientDrawMs;
        if (ambientFrames === 300) {
          console.info('Ambient update + draw over 300 active frames', {
            averageMs: Number(((ambientUpdateTotalMs + ambientDrawTotalMs) / ambientFrames).toFixed(4)),
            updateAverageMs: Number((ambientUpdateTotalMs / ambientFrames).toFixed(4)),
            drawAverageMs: Number((ambientDrawTotalMs / ambientFrames).toFixed(4)),
          });
        }
      }
      if (miniRef.current) r.drawMinimap(miniRef.current);
      if (t - lastUi > 120 || stateRef.current.phase !== before.phase) {
        lastUi = t;
        setUi(stateRef.current);
      }
      raf = requestAnimationFrame(loop);
    };

    void createMapRenderer(cityCanvas, overlayCanvas, {
      onFatal,
      onReady: fireReady,
      diagnostics: createMapDiagnostics(1, () => performance.now()),
      hudInsetBottom: 150,
    }).then(({ renderer, mode }) => {
      if (cancelled) {
        renderer.dispose();
        return;
      }
      if (mode === '3d' && activeMode === '2d') {
        renderer.dispose();
        return;
      }
      if (!hasProjection(renderer))
        throw new Error('The map renderer is missing ground projection support required by London Live.');
      renderer.scene = mapScene;
      renderer.resize();
      const hqOffice = stateRef.current.offices.find((office) => office.company === 'player');
      if (hqOffice) renderer.lookAt(hqOffice.x, hqOffice.y, 25);
      mapRef.current = renderer;
      activeMode = mode;
      ambientRef.current = createAmbient();
      r = new RtsRenderer(canvas, renderer);
      r.atmosphere = mode === '3d' ? 'day' : 'night';
      r.ambient = ambientRef.current;
      r.profileAmbient = profileAmbient;
      rendererRef.current = r;
      r.state = stateRef.current;
      raf = requestAnimationFrame(loop);

      const onDown = (e: PointerEvent) => {
        canvas.setPointerCapture(e.pointerId);
        const p = pos(e);
        drag = { ...p, moved: 0, box: e.shiftKey && e.button === 0, button: e.button };
      };
      const onMove = (e: PointerEvent) => {
        const p = pos(e);
        if (drag) {
          drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
          if (drag.moved > 0) setRideAlong(null);
          if (drag.box) r!.box = { x0: drag.x, y0: drag.y, x1: p.x, y1: p.y };
          else if (drag.button === 0 || drag.button === 1) {
            mapRef.current?.pan(e.movementX, e.movementY);
          }
        } else {
          r!.hover = r!.hitTest(p.x, p.y);
          canvas.style.cursor = r!.hover ? 'pointer' : 'default';
        }
      };
      const onUp = (e: PointerEvent) => {
        const p = pos(e);
        const d = drag;
        drag = null;
        if (!d) return;
        if (d.box) {
          selectPeople(r!.peopleInBox(d.x, d.y, p.x, p.y));
          r!.box = null;
          return;
        }
        if (d.button !== 0 || d.moved > 5) return;
        const hit = r!.hitTest(p.x, p.y);
        if (!hit) {
          selectPeople([]);
          mapRef.current?.notifyPointer?.(p.x, p.y, 'click');
          return;
        }
        if (hit.type === 'person') {
          const person = stateRef.current.people.find((x) => x.id === hit.id)!;
          if (person.company !== 'player') {
            const c = stateRef.current.companies[person.company];
            flash(`${person.name} (${c.name}) · ${personActivity(stateRef.current, person).text}`);
            return;
          }
          selectPeople((sel) =>
            e.shiftKey ? (sel.includes(person.id) ? sel.filter((x) => x !== person.id) : [...sel, person.id]) : [person.id],
          );
          return;
        }
        selectPeople([]);
        setFocus(hit);
      };
      const onContext = (e: MouseEvent) => {
        e.preventDefault();
        const ids = [...r!.selected];
        if (ids.length === 0) {
          flash('Select someone first (click a person, or Shift-drag a box)');
          return;
        }
        const p = pos(e);
        sendTo(r!.hitTest(p.x, p.y), ids);
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        setRideAlong(null);
        const p = pos(e);
        mapRef.current?.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0016));
      };
      const onKeyDown = (e: KeyboardEvent) => {
        if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
        if (campaignModalOpenRef.current) return;
        const k = e.key.toLowerCase();
        if (k === ' ') {
          e.preventDefault();
          startAtSpeed(speedRef.current === 0 ? 1 : 0);
        } else if (k === '1' || k === '2' || k === '3') startAtSpeed(SPEEDS[Number(k)]);
        else if (k === 'j') setShowJournal((value) => !value);
        else if (k === 'v') {
          const ids = selectionRef.current;
          if (ids.length === 1) setRideAlong(ridingIdRef.current === ids[0] ? null : ids[0]!);
        }
        else if (k === 'f') {
          const f = stateRef.current.people.find((p) => p.company === 'player' && p.role === 'founder');
          if (f) {
            selectPeople([f.id]);
            r!.centerOn(f);
          }
        } else if (k === 'q') selectPeople(stateRef.current.people.filter((p) => p.company === 'player').map((p) => p.id));
        else if (k === 'r') setShowRoadmap((v) => !v);
        else if (k === 'escape') {
          setRideAlong(null);
          selectPeople([]);
          setShowJournal(false);
          setShowRoadmap(false);
        } else {
          if (['w', 'a', 's', 'd'].includes(k)) setRideAlong(null);
          keys.add(k);
        }
      };
      const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());

      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointermove', onMove);
      canvas.addEventListener('pointerup', onUp);
      canvas.addEventListener('contextmenu', onContext);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      detachInput = () => {
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('contextmenu', onContext);
        canvas.removeEventListener('wheel', onWheel);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
      };
    }).catch((error: unknown) => {
      if (!cancelled)
        setMapError(error instanceof Error ? error.message : 'Unable to load the London map.');
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      detachInput?.();
      mapRef.current?.dispose();
      mapRef.current = null;
      rendererRef.current = null;
      ambientRef.current = null;
      mapReadyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = ui;
  const me = s.companies.player;
  const burn = weeklyBurn(s, 'player');
  const revenue = weeklyRevenue(s, 'player');
  const runway = runwayWeeks(s, 'player');
  const myPeople = s.people.filter((p) => p.company === 'player');
  const selectedPeople = myPeople.filter((p) => selection.includes(p.id));
  const journal = journalProgress(s);
  const ridingPerson = myPeople.find((person) => person.id === ridingId);
  const visiblePostcard = postcards[0];
  const postcardLandmark = visiblePostcard
    ? LANDMARKS.find((landmark) => landmark.kind === visiblePostcard.landmark)
    : undefined;
  const week = Math.floor(s.day / 7) + 1;
  const dayName = DAY_NAMES[Math.floor(s.day) % 7];
  const campaign = campaignStatus(s);
  const firstUnmetObjective = campaign.objectives.find((objective) => !objective.done);
  const investorStage =
    firstUnmetObjective?.spec.kind === 'stage' ? STAGES[firstUnmetObjective.spec.atLeast] : undefined;
  const briefingSpec = briefingIndex === null ? undefined : CHAPTERS[briefingIndex];
  const completedChapterSpec =
    completedChapter === null ? undefined : CHAPTERS[completedChapter.index];
  const completedResult = completedChapterSpec
    ? s.campaign.results.find((result) => result.chapterId === completedChapterSpec.id)
    : undefined;
  const completedBonus =
    completedChapterSpec !== undefined &&
    completedResult !== undefined &&
    completedResult.stars > 1 + Number(completedResult.days <= completedChapterSpec.parDays);
  const totalStars = s.campaign.results.reduce((total, result) => total + result.stars, 0);
  const researching = me.researching ? featureById(me.researching) : null;

  const onMini = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = rendererRef.current;
    if (!r || !miniRef.current) return;
    const rect = miniRef.current.getBoundingClientRect();
    r.centerOn(r.minimapToWorld(miniRef.current, e.clientX - rect.left, e.clientY - rect.top));
  };

  const focusedPlace = focus?.type === 'place' ? s.places.find((p) => p.id === focus.id) : undefined;
  const focusedOffice = focus?.type === 'office' ? s.offices.find((o) => o.id === focus.id) : undefined;
  const focusedLead = focus?.type === 'lead' ? s.leads.find((l) => l.id === focus.id) : undefined;

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#070c1a] text-slate-100 select-none">
      <div className="absolute inset-0">
        <canvas ref={cityCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
        <canvas ref={overlayCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" aria-label="London map" />
      </div>
      {!mapReady && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[#070c1a]/65">
          <p className="rounded-xl border border-slate-600/60 bg-[#0b1226]/95 px-5 py-3 text-lg font-bold shadow-xl">
            {mapError ?? 'Loading London…'}
          </p>
        </div>
      )}
      {activeMoment && !momentQueuePaused && (
        <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden" aria-live="polite">
          <div
            className="absolute inset-x-0 top-[60px] h-9 bg-black/70 transition-transform duration-500 ease-in-out"
            style={{ transform: momentPhase === 'hold' ? 'translateY(0)' : 'translateY(-100%)' }}
          />
          <div
            className="absolute top-[110px] w-[min(700px,calc(100vw-2rem))] rounded-xl border bg-[#0b1226]/95 px-6 py-4 text-center shadow-2xl transition-all duration-500 ease-out"
            style={{
              left: '50%',
              transform:
                momentPhase === 'hold'
                  ? 'translate(-50%, 0)'
                  : 'translate(-50%, -8px)',
              opacity: momentPhase === 'hold' ? 1 : 0,
              borderColor: activeMoment.fx.tone === 'bad' ? 'rgba(248,113,113,.5)' : 'rgba(251,191,36,.45)',
            }}
          >
            <div
              className={`text-[10px] font-extrabold tracking-[0.35em] ${
                activeMoment.fx.tone === 'bad' ? 'text-rose-300' : 'text-amber-300'
              }`}
            >
              {activeMoment.fx.tone === 'bad' ? 'RIVAL MOVE' : 'FOUNDER MOMENT'}
            </div>
            <h2
              className={`mt-1 text-2xl font-black ${
                activeMoment.fx.tone === 'bad' ? 'text-rose-100' : 'text-white'
              }`}
            >
              {activeMoment.fx.title}
            </h2>
            <p className="mt-1 truncate text-sm text-slate-300">{activeMoment.fx.text}</p>
          </div>
        </div>
      )}

      {/* Top bar */}
      <header className="absolute inset-x-0 top-0 flex items-center gap-4 border-b border-slate-700/60 bg-[#0b1226]/95 px-4 py-2 text-sm shadow-lg">
        <div className="flex items-center gap-2">
          <span className="font-black tracking-wide text-amber-300">{me.name}</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">{STAGES[me.stageIndex].name}</span>
        </div>
        <Stat label="Cash" value={fmtMoney(me.cash)} tone={runway < 6 ? 'bad' : undefined} />
        <Stat label="Net /wk" value={fmtMoney(revenue - burn)} tone={revenue - burn < 0 ? 'bad' : 'good'} />
        <Stat
          label="Runway"
          value={Number.isFinite(runway) ? `${Math.max(0, runway).toFixed(0)} wk` : '∞'}
          tone={runway < 6 ? 'bad' : undefined}
        />
        <Stat label="Users" value={fmtUsers(me.users)} />
        <Stat label="Product" value={`${Math.round(me.product)}`} />
        <Stat label="Hype" value={`${Math.round(me.hype)}`} />
        <Stat label="Team" value={`${myPeople.length}/${teamCap(s, 'player')}`} />
        <Stat label="You own" value={pct(me.equity)} />
        <button
          onClick={() => setShowRoadmap(true)}
          className="rounded-lg border border-sky-400/40 bg-sky-400/10 px-3 py-1 text-left text-xs hover:bg-sky-400/20"
          title="Roadmap (R)"
        >
          <div className="text-[10px] font-bold tracking-wider text-sky-300 uppercase">Roadmap</div>
          <div className="font-bold">
            {researching
              ? `${researching.name} · ${pct(Math.min(1, me.researchProgress / researching.cost))}`
              : 'Pick next feature →'}
          </div>
        </button>
        <button
          onClick={() => setShowJournal(true)}
          className="rounded-lg border border-violet-400/40 bg-violet-400/10 px-3 py-2 text-xs font-bold text-violet-200 hover:bg-violet-400/20"
          title="London journal (J)"
        >
          📮 Journal {journal.found}/{journal.total}
        </button>
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-slate-300">
            Week {week} · {dayName}
          </span>
          <div className="flex overflow-hidden rounded-lg border border-slate-700">
            {SPEEDS.map((v, i) => (
              <button
                key={v}
          onClick={() => startAtSpeed(v)}
                disabled={!mapReady || briefingIndex !== null || completedChapter !== null}
                className={`px-2.5 py-1 text-xs font-bold ${speed === v ? 'bg-amber-400 text-slate-900' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
                title={i === 0 ? 'Pause (Space)' : `Speed ${v}× (${i})`}
              >
                {i === 0 ? '❚❚' : `${v}×`}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              if (!campaignModalOpenRef.current) setShowHelp((value) => !value);
            }}
            className="rounded-lg border border-slate-700 px-2 py-1 text-xs"
          >
            ?
          </button>
        </div>
      </header>

      {ridingPerson && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 rounded-full border border-sky-400/40 bg-[#0b1226]/95 px-3 py-1 text-xs font-bold text-sky-200 shadow-lg">
          🎥 Riding along with {ridingPerson.name}
        </div>
      )}

      {/* News */}
      <aside className="pointer-events-none absolute top-16 left-3 w-80 space-y-1.5">
        {s.news
          .slice(0, 4)
          .map((n, i) => (
            <div
              key={`${n.day}-${i}-${n.text}`}
              className={`rounded-md border-l-4 bg-[#0b1226]/90 px-3 py-1.5 text-xs shadow ${
                n.tone === 'good' || n.tone === 'money'
                  ? 'border-emerald-400'
                  : n.tone === 'bad'
                    ? 'border-rose-400'
                    : n.tone === 'rival'
                      ? 'border-violet-400'
                      : 'border-slate-500'
              }`}
              style={{ opacity: 1 - i * 0.18 }}
            >
              <span className="mr-1 font-mono text-slate-500">W{Math.floor(n.day / 7) + 1}</span>
              {n.text}
            </div>
          ))}
      </aside>

      {/* Goal + rivals */}
      <aside className="absolute top-16 right-3 w-72 space-y-2 text-xs">
        {campaign.chapter && (
          <Panel title="CHAPTER" onClick={() => openBriefing(false)}>
            <div className="mb-2 font-black text-slate-100">{campaign.chapter.title}</div>
            <ul className="space-y-1">
              {campaign.objectives.map((objective) => {
                const value =
                  objective.spec.kind === 'users'
                    ? fmtUsers(objective.value)
                    : Math.floor(objective.value).toLocaleString();
                const target =
                  objective.spec.kind === 'users'
                    ? fmtUsers(objective.target)
                    : Math.floor(objective.target).toLocaleString();
                const percent = Math.min(100, (objective.value / Math.max(1, objective.target)) * 100);
                const nextRound =
                  !objective.done &&
                  objective.spec.kind === 'stage' &&
                  objective.spec.atLeast === me.stageIndex + 1
                    ? STAGES[objective.spec.atLeast]
                    : undefined;
                const usersMet = nextRound !== undefined && me.users >= nextRound.minTraction;
                const productMet = nextRound !== undefined && me.product >= nextRound.minProduct;
                return (
                  <li key={objective.spec.label} className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className={objective.done ? 'text-emerald-400' : 'text-slate-500'}>
                        {objective.done ? '✓' : '○'}
                      </span>
                      <span className="min-w-0 flex-1">{objective.spec.label}</span>
                      {objective.target > 1 && (
                        <span className="text-[10px] text-slate-400">
                          {value}/{target}
                        </span>
                      )}
                      {objective.target > 1 && (
                        <span className="h-1 w-10 shrink-0 rounded bg-slate-800">
                          <span
                            className={`block h-1 rounded ${objective.done ? 'bg-emerald-400' : 'bg-sky-400'}`}
                            style={{ width: `${percent}%` }}
                          />
                        </span>
                      )}
                    </div>
                    {nextRound && (
                      <ul className="ml-4 space-y-0.5 text-[10px] text-slate-500">
                        <li className="flex items-center gap-1.5">
                          <span className={usersMet ? 'text-emerald-400' : 'text-slate-600'}>
                            {usersMet ? '✓' : '○'}
                          </span>
                          <span className="min-w-0 flex-1">
                            Users {fmtUsers(me.users)} / {fmtUsers(nextRound.minTraction)}
                          </span>
                          <span className="h-1 w-10 shrink-0 rounded bg-slate-800">
                            <span
                              className={`block h-1 rounded ${usersMet ? 'bg-emerald-400' : 'bg-sky-400'}`}
                              style={{
                                width: `${Math.min(
                                  100,
                                  (me.users / Math.max(1, nextRound.minTraction)) * 100,
                                )}%`,
                              }}
                            />
                          </span>
                        </li>
                        <li className="flex items-center gap-1.5">
                          <span className={productMet ? 'text-emerald-400' : 'text-slate-600'}>
                            {productMet ? '✓' : '○'}
                          </span>
                          <span>
                            Product {Math.floor(me.product).toLocaleString()} /{' '}
                            {nextRound.minProduct.toLocaleString()}
                          </span>
                        </li>
                        {usersMet && productMet && (
                          <li className="ml-4 text-[10px] font-medium text-amber-300">
                            Walk your founder to an investor to pitch
                          </li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
            {campaign.bonus && (
              <div className="mt-2 flex items-center gap-1.5">
                <span className={campaign.bonus.done ? 'text-amber-300' : 'text-slate-500'}>
                  {campaign.bonus.done ? '✓' : '◇'}
                </span>
                <span className="min-w-0 flex-1 text-amber-300">Bonus: {campaign.bonus.spec.label}</span>
                {campaign.bonus.target > 1 && (
                  <>
                    <span className="text-[10px] text-amber-200/80">
                      {Math.floor(campaign.bonus.value).toLocaleString()}/
                      {Math.floor(campaign.bonus.target).toLocaleString()}
                    </span>
                    <span className="h-1 w-10 shrink-0 rounded bg-slate-800">
                      <span
                        className="block h-1 rounded bg-amber-300"
                        style={{
                          width: `${Math.min(
                            100,
                            (campaign.bonus.value / campaign.bonus.target) * 100,
                          )}%`,
                        }}
                      />
                    </span>
                  </>
                )}
              </div>
            )}
            <p className="mt-1 text-[10px] text-slate-400">
              Day {Math.floor(campaign.daysElapsed)} / par {campaign.chapter.parDays}
            </p>
            {investorStage && (
              <p className="mt-2 text-slate-400">
                The other goals are met; walk your founder to a 💷 investor for {investorStage.name} ({fmtMoney(investorStage.raise)}).
              </p>
            )}
          </Panel>
        )}
        <Panel title="LEADERBOARD">
          {COMPANY_ORDER.map((id) => s.companies[id])
            .sort((a, b) => b.users - a.users)
            .map((c) => (
              <div key={c.id} className={`flex items-center justify-between py-0.5 ${c.alive ? '' : 'line-through opacity-40'}`}>
                <span className={`flex items-center gap-1.5 ${c.id === 'player' ? 'font-bold text-amber-200' : ''}`}>
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                  {c.name}
                </span>
                <span className="text-slate-400">
                  {c.alive ? `${STAGES[c.stageIndex].name} · ${fmtUsers(c.users)} · ${c.shipped.length}🧩` : 'shut down'}
                </span>
              </div>
            ))}
        </Panel>
      </aside>

      {/* Bottom panel + minimap */}
      <footer className="absolute inset-x-3 bottom-3 flex items-end gap-3">
        <div className="min-h-[156px] flex-1 rounded-xl border border-slate-700/70 bg-[#0b1226]/95 p-3 text-sm shadow-2xl">
          {selectedPeople.length > 0 ? (
            <PeoplePanel
              people={selectedPeople}
              state={s}
              onRide={() => toggleRideAlong(selectedPeople[0]!.id)}
              riding={selectedPeople.length === 1 && ridingId === selectedPeople[0]!.id}
            />
          ) : focusedPlace ? (
            <PlacePanel
              place={focusedPlace}
              state={s}
              onHire={(role) => run((st) => hire(st, role, focusedPlace.id))}
              onOpenOffice={() => run((st) => openOffice(st, focusedPlace.hubId))}
              onPitch={() => run((st) => pitch(st, focusedPlace.id))}
              onSendFounder={() => {
                const f = myPeople.find((p) => p.role === 'founder');
                if (f) sendTo({ type: 'place', id: focusedPlace.id }, [f.id]);
              }}
              onSelectHere={selectPeople}
            />
          ) : focusedOffice ? (
            <OfficePanel
              office={focusedOffice}
              state={s}
              onUpgrade={() => run((st) => upgradeOffice(st, focusedOffice.id))}
              onRoadmap={() => setShowRoadmap(true)}
              onSelectHere={selectPeople}
            />
          ) : focusedLead ? (
            <LeadPanel lead={focusedLead} state={s} onSend={(p) => sendTo({ type: 'lead', id: focusedLead.id }, [p.id])} />
          ) : (
            <p className="text-slate-400">Click a person to select them, or a place to see what you can do there.</p>
          )}
        </div>
        <div className="rounded-xl border border-slate-700/70 bg-[#0b1226]/95 p-1.5 shadow-2xl">
          <canvas ref={miniRef} onClick={onMini} className="block h-[150px] w-[260px] cursor-crosshair rounded-lg" aria-label="Minimap" />
        </div>
      </footer>

      {toast && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 rounded-lg border border-amber-400/40 bg-[#0b1226] px-4 py-2 text-sm shadow-xl">
          {toast}
        </div>
      )}

      {bonusToast && (
        <div className="pointer-events-none absolute bottom-[180px] left-3 z-20 w-80 rounded-xl border border-amber-400/40 bg-[#0b1226]/95 p-3 shadow-2xl">
          <div className="text-[10px] font-bold tracking-widest text-amber-300">✨ Chapter bonus</div>
          <p className="mt-1 font-black">{bonusToast.label}</p>
        </div>
      )}

      {visiblePostcard && postcardLandmark && (
        <div className={`absolute bottom-[180px] ${bonusToast ? 'left-[340px]' : 'left-3'} z-20 w-80 rounded-xl border border-violet-400/40 bg-[#0b1226]/95 p-3 shadow-2xl`}>
          <div className="text-[10px] font-bold tracking-widest text-violet-300">📮 New in your London journal</div>
          <h3 className="mt-1 font-black">{postcardLandmark.name}</h3>
          <p className="mt-1 text-xs text-slate-300">{LANDMARK_FACTS[postcardLandmark.kind]}</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                flyToLandmark(visiblePostcard.landmark);
                setPostcards((queue) => queue.slice(1));
              }}
              className="rounded-md bg-violet-400 px-2.5 py-1 text-xs font-bold text-slate-950"
            >
              Fly there
            </button>
            <button onClick={() => setPostcards((queue) => queue.slice(1))} className="rounded-md border border-slate-600 px-2.5 py-1 text-xs">
              Dismiss
            </button>
          </div>
        </div>
      )}

      {showJournal && s.phase === 'playing' && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/65 p-4">
          <div className="flex max-h-[88vh] w-[min(1050px,95vw)] flex-col rounded-2xl border border-violet-400/30 bg-[#0b1226] p-5 shadow-2xl">
            <header className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black text-violet-200">📮 London journal</h2>
                <p className="text-xs text-slate-400">{journal.found} of {journal.total} landmarks discovered</p>
              </div>
              <button onClick={() => setShowJournal(false)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm">
                Close
              </button>
            </header>
            <div className="grid grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
              {LANDMARKS.map((landmark) => {
                const day = s.journal[landmark.kind];
                return (
                  <article
                    key={landmark.kind}
                    className={`rounded-lg border p-3 ${day === undefined ? 'border-slate-700 bg-slate-900/60 text-slate-500' : 'border-violet-400/30 bg-violet-400/5'}`}
                  >
                    <h3 className={`font-bold ${day === undefined ? 'text-slate-500' : 'text-slate-100'}`}>{landmark.name}</h3>
                    {day === undefined ? (
                      <p className="mt-1 text-xs italic">Not visited yet</p>
                    ) : (
                      <>
                        <p className="mt-1 text-xs text-slate-300">{LANDMARK_FACTS[landmark.kind]}</p>
                        <p className="mt-1 text-[10px] font-bold text-violet-300">Week {Math.floor(day / 7) + 1}</p>
                      </>
                    )}
                    <button
                      onClick={() => flyToLandmark(landmark.kind)}
                      className="mt-2 rounded-md border border-sky-400/30 px-2.5 py-1 text-xs font-bold text-sky-200 hover:bg-sky-400/10"
                    >
                      Fly there
                    </button>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showRoadmap && s.phase === 'playing' && (
        <Roadmap
          state={s}
          onPick={(id) => {
            if (run((st) => setResearch(st, id))) setShowRoadmap(false);
          }}
          onClose={() => setShowRoadmap(false)}
        />
      )}

      {showHelp && s.phase === 'playing' && (
        <div className="absolute top-1/2 left-1/2 w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-amber-400/30 bg-[#0b1226]/97 p-5 text-sm shadow-2xl">
          <h3 className="text-lg font-black text-amber-300">How it works</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-300">
            <li>
              <b>Click</b> a person to select (Shift-click to add, Shift-drag to box-select, <b>F</b> founder, <b>Q</b> everyone).
              <b> Right-click</b> (two-finger click) a place to send them.
            </li>
            <li>Work only happens at places:</li>
            <li className="ml-4 list-none">🧑‍💻 Engineers at your 🏠 office build the roadmap (<b>R</b>).</li>
            <li className="ml-4 list-none">📣 Growth people at ✨🛍️🏪⌨️🏦 customer spots sign users. Spots run dry — rivals share them.</li>
            <li className="ml-4 list-none">🎓 Anyone at a talent spot can recruit. 🧑‍💼 Founder pitches at 💷 investors.</li>
            <li>Pop-up pins expire. First person there wins.</li>
            <li>
              Drag / WASD to pan, scroll to zoom. <b>Space</b> pause, <b>1–3</b> speed.
            </li>
          </ul>
          <button
            onClick={() => {
              setShowHelp(false);
              startAtSpeed(autoplay ? 4 : 1);
            }}
            disabled={!mapReady}
            className="mt-4 w-full rounded-lg bg-amber-400 py-2 font-black text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {mapReady ? 'Start the clock' : 'Loading London…'}
          </button>
        </div>
      )}

      {briefingSpec && s.phase === 'playing' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-[min(620px,95vw)] rounded-2xl border border-amber-400/40 bg-[#0b1226] p-6 shadow-2xl">
            <p className="text-[10px] font-bold tracking-[0.25em] text-amber-300">
              CHAPTER {briefingIndex! + 1}
            </p>
            <h2 className="mt-1 text-2xl font-black">{briefingSpec.title}</h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-300">{briefingSpec.briefing}</p>
            <h3 className="mt-5 text-[10px] font-bold tracking-widest text-slate-500">OBJECTIVES</h3>
            <ul className="mt-2 space-y-1.5 text-sm">
              {briefingSpec.objectives.map((objective) => {
                const progress = objectiveProgress(s, objective);
                return (
                  <li key={objective.label} className="flex gap-2">
                    <span className={progress.done ? 'text-emerald-400' : 'text-slate-500'}>
                      {progress.done ? '✓' : '○'}
                    </span>
                    {objective.label}
                  </li>
                );
              })}
            </ul>
            <p className="mt-4 rounded-lg bg-amber-400/10 p-3 text-sm text-amber-200">
              Bonus: {briefingSpec.bonus.label} · {fmtMoney(briefingSpec.bonusReward.cash)} + {briefingSpec.bonusReward.hype} hype
            </p>
            <p className="mt-3 text-xs text-slate-400">Par: {briefingSpec.parDays} days</p>
            <button
              onClick={() => {
                campaignModalOpenRef.current = false;
                momentQueuePausedRef.current = false;
                setBriefingIndex(null);
                setSpeed(briefingResumeSpeedRef.current || 1);
              }}
              className="mt-5 w-full rounded-lg bg-amber-400 py-2.5 font-black text-slate-950"
            >
              Begin
            </button>
          </div>
        </div>
      )}

      {completedChapterSpec && completedResult && s.phase === 'playing' && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-[min(560px,95vw)] rounded-2xl border border-amber-400/40 bg-[#0b1226] p-6 shadow-2xl">
            <p className="text-[10px] font-bold tracking-[0.25em] text-amber-300">CHAPTER COMPLETE</p>
            <h2 className="mt-1 text-2xl font-black">{completedChapterSpec.title}</h2>
            <div className="mt-3 text-center text-4xl tracking-widest">
              {Array.from({ length: 3 }, (_, index) => (
                <span key={index} className={index < completedResult.stars ? 'text-amber-300' : 'text-slate-600'}>
                  {index < completedResult.stars ? '★' : '☆'}
                </span>
              ))}
            </div>
            <p className="mt-2 text-center text-sm text-slate-300">
              Finished in {completedResult.days.toFixed(1)} days (par {completedChapterSpec.parDays})
            </p>
            <ul className="mt-5 space-y-1.5 text-sm">
              {completedChapterSpec.objectives.map((objective) => (
                <li key={objective.label} className="text-emerald-300">✓ {objective.label}</li>
              ))}
              <li className={completedBonus ? 'text-amber-300' : 'text-slate-500'}>
                {completedBonus ? '✓' : '○'} Bonus: {completedChapterSpec.bonus.label}
              </li>
            </ul>
            <button
              onClick={() => {
                setCompletedChapter(null);
                openBriefing(true, completedResumeSpeedRef.current);
              }}
              className="mt-5 w-full rounded-lg bg-amber-400 py-2.5 font-black text-slate-950"
            >
              Next chapter →
            </button>
          </div>
        </div>
      )}

      {s.phase === 'dilemma' && s.dilemma && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40">
          <div className="w-[440px] rounded-2xl border border-amber-400/40 bg-[#0d1530] p-5 shadow-2xl">
            <p className="text-[11px] font-bold tracking-widest text-rose-300">DECISION · {hubName(s.dilemma.hubId).toUpperCase()}</p>
            <h3 className="mt-1 text-xl font-black">{s.dilemma.title}</h3>
            <p className="mt-2 text-slate-300">{s.dilemma.body}</p>
            <div className="mt-4 space-y-2">
              {s.dilemma.options.map((o, i) => (
                <button
                  key={o.label}
                  onClick={() => run((st) => resolveDilemma(st, i))}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-left hover:border-amber-400"
                >
                  <div className="font-bold">{o.label}</div>
                  <div className="text-xs text-slate-400">{o.hint}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {(s.phase === 'won' || s.phase === 'bankrupt') && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55 p-4">
          <div className="max-h-[90vh] w-[min(560px,95vw)] overflow-y-auto rounded-2xl border border-amber-400/40 bg-[#0d1530] p-6 text-center shadow-2xl">
            <p className="text-5xl">{s.phase === 'won' ? '🦄' : '💸'}</p>
            <h3 className="mt-2 text-2xl font-black text-amber-300">{s.phase === 'won' ? 'Unicorn!' : 'Out of runway'}</h3>
            <p className="mt-2 text-slate-300">
              {me.name} · week {week} · {STAGES[me.stageIndex].name} · {fmtUsers(me.users)} users · you own {pct(me.equity)}
            </p>
            <p className="mt-1 text-slate-400">
              Founder payout: <b className="text-amber-300">{fmtMoney(s.phase === 'won' ? me.equity * me.valuation : 0)}</b>
            </p>
            <div className="mt-5 rounded-lg border border-slate-700/70 bg-slate-900/50 p-3 text-left">
              <h4 className="text-[10px] font-bold tracking-widest text-amber-300">CHAPTER RESULTS</h4>
              {s.campaign.results.length > 0 ? (
                <table className="mt-2 w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="text-left font-normal">Chapter</th>
                      <th className="text-right font-normal">Days</th>
                      <th className="text-right font-normal">Stars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.campaign.results.map((result) => {
                      const chapter = CHAPTERS.find((item) => item.id === result.chapterId);
                      return (
                        <tr key={result.chapterId} className="border-t border-slate-800">
                          <td className="py-1.5 pr-2">{chapter?.title ?? result.chapterId}</td>
                          <td className="py-1.5 text-right text-slate-300">{result.days.toFixed(1)}</td>
                          <td className="py-1.5 text-right text-amber-300">{'★'.repeat(result.stars)}{'☆'.repeat(3 - result.stars)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="mt-2 text-xs text-slate-500">No chapters completed.</p>
              )}
              <p className="mt-2 text-right text-xs font-bold text-amber-300">Total ★ {totalStars}/15</p>
            </div>
            <div className="mt-5 flex gap-2">
              <button onClick={onRestart} className="flex-1 rounded-lg bg-amber-400 py-2 font-black text-slate-900">
                Play again (same seed)
              </button>
              <button onClick={onNewSetup} className="flex-1 rounded-lg border border-slate-600 py-2 font-bold">
                New setup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="leading-tight">
      <div className="text-[10px] font-bold tracking-wider text-slate-500 uppercase">{label}</div>
      <div className={`font-bold ${tone === 'bad' ? 'text-rose-400' : tone === 'good' ? 'text-emerald-400' : 'text-slate-100'}`}>{value}</div>
    </div>
  );
}

function Panel({
  title,
  children,
  onClick,
}: {
  title: string;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={`rounded-xl border border-slate-700/70 bg-[#0b1226]/92 p-2.5 shadow-lg ${onClick ? 'cursor-pointer hover:border-amber-400/40' : ''}`}
    >
      <div className="mb-1.5 text-[10px] font-bold tracking-[0.2em] text-amber-300/80">{title}</div>
      {children}
    </div>
  );
}

function PeopleHere({ state, at, onSelect }: { state: RtsState; at: string; onSelect: (ids: string[]) => void }) {
  const here = state.people.filter((p) => p.at === at && !p.order);
  const mine = here.filter((p) => p.company === 'player');
  return (
    <div className="text-xs">
      <div className="text-[10px] font-bold tracking-widest text-slate-500">HERE NOW</div>
      {here.length === 0 && <p className="text-slate-500">Nobody.</p>}
      <div className="mt-1 flex flex-wrap gap-1">
        {here.map((p) => (
          <span
            key={p.id}
            className="rounded-full border px-1.5 py-0.5"
            style={{ borderColor: state.companies[p.company].color }}
            title={`${p.name} · ${state.companies[p.company].name}`}
          >
            {ROLE_ICON[p.role]} {p.company === 'player' ? p.name : state.companies[p.company].name}
          </span>
        ))}
      </div>
      {mine.length > 0 && (
        <button onClick={() => onSelect(mine.map((p) => p.id))} className="mt-1.5 text-sky-300 hover:underline">
          Select my {mine.length} here
        </button>
      )}
    </div>
  );
}

function PeoplePanel({
  people,
  state,
  onRide,
  riding,
}: {
  people: Person[];
  state: RtsState;
  onRide: () => void;
  riding: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-black text-amber-300">
            {people.length === 1 ? `${ROLE_ICON[people[0].role]} ${people[0].name} · ${ROLE_LABEL[people[0].role]}` : `${people.length} people selected`}
          </h3>
          {people.length === 1 && (
            <button
              onClick={onRide}
              className={`rounded-md border px-2 py-1 text-xs font-bold ${riding ? 'border-sky-400/60 bg-sky-400/15 text-sky-200' : 'border-slate-600 text-slate-300 hover:border-sky-400/50'}`}
            >
              {riding ? '⏹ Stop ride along' : '🎥 Ride along (V)'}
            </button>
          )}
        </div>
        <span className="text-xs text-slate-400">Right-click a place, pin or investor to send them</span>
      </div>
      <div className="mt-2 grid max-h-[110px] grid-cols-2 gap-x-6 gap-y-1 overflow-y-auto text-xs lg:grid-cols-3">
        {people.map((p) => {
          const act = personActivity(state, p);
          return (
            <div key={p.id} className="flex justify-between gap-2">
              <span className="font-bold whitespace-nowrap">
                {ROLE_ICON[p.role]} {p.name}
                {p.role !== 'founder' && <span className="ml-1 font-normal text-slate-500">skill {p.skill.toFixed(2)}</span>}
              </span>
              <span className={`truncate ${act.working ? 'text-emerald-300' : 'text-slate-400'}`}>{act.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlacePanel({
  place,
  state,
  onHire,
  onOpenOffice,
  onPitch,
  onSendFounder,
  onSelectHere,
}: {
  place: Place;
  state: RtsState;
  onHire: (role: 'engineer' | 'growth') => void;
  onOpenOffice: () => void;
  onPitch: () => void;
  onSendFounder: () => void;
  onSelectHere: (ids: string[]) => void;
}) {
  const mineHere = state.people.filter((p) => p.company === 'player' && p.at === place.id && !p.order);
  const hasOfficeInHub = state.offices.some((o) => o.company === 'player' && o.hubId === place.hubId);
  const atCap = state.people.filter((p) => p.company === 'player').length >= teamCap(state, 'player');
  return (
    <div className="flex gap-5">
      <div className="w-60 shrink-0">
        <p className="text-[10px] font-bold tracking-widest text-sky-300">
          {place.kind === 'talent' ? 'TALENT' : place.kind === 'investor' ? 'INVESTOR' : 'CUSTOMERS'} · {hubName(place.hubId).toUpperCase()}
        </p>
        <h3 className="text-lg font-black">
          {placeIcon(place)} {place.name}
        </h3>
        {place.kind === 'customers' && <CustomerInfo place={place} state={state} />}
        {place.kind === 'talent' && (
          <p className="text-xs text-slate-400">
            Send anyone here to recruit. Talent quality ×{(place.quality * HUBS.find((h) => h.id === place.hubId)!.hireQualityMult).toFixed(2)}.
          </p>
        )}
        {place.kind === 'investor' && <p className="text-xs text-slate-400">Your founder must be here in person to pitch.</p>}
      </div>
      <div className="w-56 shrink-0">
        <PeopleHere state={state} at={place.id} onSelect={onSelectHere} />
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <div className="text-[10px] font-bold tracking-widest text-slate-500">ACTIONS</div>
        {place.kind === 'talent' && (
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => onHire('engineer')} disabled={mineHere.length === 0 || atCap}>
              Hire 🧑‍💻 engineer · {fmtMoney(ENGINEER_HIRE_FEE)} + {fmtMoney(ENGINEER_WEEKLY_SALARY)}/wk
            </ActionButton>
            <ActionButton onClick={() => onHire('growth')} disabled={mineHere.length === 0 || atCap}>
              Hire 📣 growth · {fmtMoney(GROWTH_HIRE_FEE)} + {fmtMoney(GROWTH_WEEKLY_SALARY)}/wk
            </ActionButton>
          </div>
        )}
        {place.kind === 'talent' && mineHere.length === 0 && <p className="text-xs text-slate-500">Send someone here first.</p>}
        {place.kind === 'talent' && atCap && <p className="text-xs text-rose-300">Team is full — upgrade or open an office.</p>}
        {place.kind === 'investor' && <InvestorActions state={state} place={place} onPitch={onPitch} onSendFounder={onSendFounder} />}
        {!hasOfficeInHub && (
          <ActionButton onClick={onOpenOffice} disabled={mineHere.length === 0}>
            Open an office in {hubName(place.hubId)} · {fmtMoney(OFFICE_OPEN_COST)}
          </ActionButton>
        )}
      </div>
    </div>
  );
}

function CustomerInfo({ place, state }: { place: Extract<Place, { kind: 'customers' }>; state: RtsState }) {
  const me = state.companies.player;
  const open = unlockedSegments(me).includes(place.segment);
  const f = featureForSegment(place.segment);
  const fit = SEGMENT_INFO[place.segment].fit.includes(me.sectorId);
  return (
    <div className="text-xs">
      <p className="text-slate-400">
        {SEGMENT_ICON[place.segment]} {SEGMENT_INFO[place.segment].name}
        {fit && <span className="ml-1 text-emerald-300">· great fit for you</span>}
      </p>
      <p className="mt-1">
        {fmtUsers(place.pool)} potential users left of {fmtUsers(place.poolMax)}
      </p>
      <div className="mt-0.5 h-1.5 rounded bg-slate-800">
        <div className="h-1.5 rounded bg-sky-400" style={{ width: pct(place.pool / Math.max(1, place.poolMax)) }} />
      </div>
      {!open && f && <p className="mt-1 text-rose-300">🔒 Ship “{f.name}” to sell here.</p>}
    </div>
  );
}

function InvestorActions({
  state,
  place,
  onPitch,
  onSendFounder,
}: {
  state: RtsState;
  place: Extract<Place, { kind: 'investor' }>;
  onPitch: () => void;
  onSendFounder: () => void;
}) {
  const pv = pitchPreview(state, 'player');
  const founder = state.people.find((p) => p.company === 'player' && p.role === 'founder');
  const here = founder && founder.at === place.id && !founder.order;
  const cooldown = (place.cooldownUntil.player ?? 0) - state.day;
  return (
    <div className="text-xs">
      <div className="flex gap-6">
        <Stat label={`${pv.nextStageName} raise`} value={fmtMoney(pv.raise)} />
        <Stat label="Odds" value={pv.eligible ? pct(pv.odds) : '—'} tone={pv.eligible ? (pv.odds >= 0.5 ? 'good' : undefined) : 'bad'} />
        <Stat label="You sell" value={pv.eligible ? pct(pv.dilution) : '—'} />
      </div>
      {pv.blockers.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-rose-300">
          {pv.blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      {cooldown > 0 && <p className="mt-1 text-rose-300">Passed on you recently — back in {cooldown.toFixed(1)} days.</p>}
      <div className="mt-2">
        {here ? (
          <ActionButton onClick={onPitch} disabled={!pv.eligible || cooldown > 0}>
            Pitch now ({pv.eligible ? pct(pv.odds) : 'not ready'})
          </ActionButton>
        ) : (
          <ActionButton onClick={onSendFounder} disabled={!founder}>
            Send 🧑‍💼 founder to pitch
          </ActionButton>
        )}
      </div>
    </div>
  );
}

function OfficePanel({
  office,
  state,
  onUpgrade,
  onRoadmap,
  onSelectHere,
}: {
  office: Office;
  state: RtsState;
  onUpgrade: () => void;
  onRoadmap: () => void;
  onSelectHere: (ids: string[]) => void;
}) {
  const c = state.companies[office.company];
  const mine = office.company === 'player';
  const level = OFFICE_LEVELS[office.level];
  const next = OFFICE_LEVELS[office.level + 1];
  const hub = HUBS.find((h) => h.id === office.hubId)!;
  const researching = c.researching ? featureById(c.researching) : null;
  return (
    <div className="flex gap-5">
      <div className="w-60 shrink-0">
        <p className="text-[10px] font-bold tracking-widest" style={{ color: c.color }}>
          {mine ? 'YOUR OFFICE' : `${c.name.toUpperCase()} OFFICE`} · {hub.name.toUpperCase()}
        </p>
        <h3 className="text-lg font-black">🏠 {office.siteName ?? level.name}</h3>
        <p className="text-xs text-slate-400">
          Room for {level.capacity} · rent {fmtMoney(hub.rent * level.rentMult)}/wk
        </p>
        {mine && (
          <p className="mt-1 text-xs text-slate-400">
            Engineers here build: <b className="text-sky-300">{researching ? researching.name : 'nothing queued — polishing'}</b>
          </p>
        )}
      </div>
      <div className="w-56 shrink-0">
        <PeopleHere state={state} at={office.id} onSelect={onSelectHere} />
      </div>
      {mine && (
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="text-[10px] font-bold tracking-widest text-slate-500">ACTIONS</div>
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={onRoadmap}>🧩 Open roadmap (R)</ActionButton>
            {next && (
              <ActionButton onClick={onUpgrade} disabled={c.cash < next.cost}>
                Move up to {next.name} · {fmtMoney(next.cost)} · room for {next.capacity}
              </ActionButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LeadPanel({ lead, state, onSend }: { lead: Lead; state: RtsState; onSend: (p: Person) => void }) {
  const st = LEAD_STYLE[lead.kind];
  const nearest = state.people
    .filter((p) => p.company === 'player' && lead.takenBy.includes(p.role))
    .map((p) => ({ p, d: Math.hypot(p.x - lead.x, p.y - lead.y) }))
    .sort((a, b) => a.d - b.d)[0];
  return (
    <div>
      <p className="text-[10px] font-bold tracking-widest" style={{ color: st.color }}>
        {st.icon} {st.label.toUpperCase()} · {hubName(lead.hubId).toUpperCase()}
      </p>
      <h3 className="text-lg font-black">{lead.name}</h3>
      <p className="text-xs text-slate-400">
        {lead.venue} · gone in {Math.max(0, lead.expiresDay - state.day).toFixed(1)} days · {LEAD_REWARD[lead.kind]}
      </p>
      <p className="text-xs text-slate-500">
        Who can take it: {lead.takenBy.map((k) => ROLE_LABEL[k]).join(', ')}. First one there wins — rivals are racing too.
      </p>
      {nearest && (
        <ActionButton className="mt-2" onClick={() => onSend(nearest.p)}>
          Send {nearest.p.name} ({ROLE_LABEL[nearest.p.role].toLowerCase()})
        </ActionButton>
      )}
    </div>
  );
}

function Roadmap({ state, onPick, onClose }: { state: RtsState; onPick: (id: FeatureId) => void; onClose: () => void }) {
  const me = state.companies.player;
  const depth = new Map<FeatureId, number>();
  const depthOf = (f: Feature): number => {
    if (depth.has(f.id)) return depth.get(f.id)!;
    const d = f.requires.length ? 1 + Math.max(...f.requires.map((r) => depthOf(featureById(r)))) : 0;
    depth.set(f.id, d);
    return d;
  };
  FEATURES.forEach(depthOf);
  const cols = Math.max(...depth.values()) + 1;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="max-w-[92vw] rounded-2xl border border-sky-400/30 bg-[#0d1530] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-6">
          <h3 className="text-xl font-black text-sky-300">🧩 Product roadmap</h3>
          <span className="text-xs text-slate-400">Engineers at your offices build the feature you pick. Shipping opens new customers.</span>
        </div>
        <div className="mt-4 flex gap-4">
          {Array.from({ length: cols }, (_, col) => (
            <div key={col} className="flex w-52 flex-col gap-2">
              {FEATURES.filter((f) => depth.get(f.id) === col).map((f) => {
                const shipped = me.shipped.includes(f.id);
                const active = me.researching === f.id;
                const available = canResearch(me, f.id);
                return (
                  <button
                    key={f.id}
                    disabled={!available || active}
                    onClick={() => onPick(f.id)}
                    className={`rounded-lg border p-2 text-left text-xs ${
                      shipped
                        ? 'border-emerald-500/60 bg-emerald-500/10'
                        : active
                          ? 'border-sky-400 bg-sky-400/15'
                          : available
                            ? 'border-slate-600 bg-slate-900 hover:border-sky-400'
                            : 'border-slate-800 bg-slate-950 opacity-50'
                    }`}
                  >
                    <div className="flex justify-between font-bold">
                      <span>{f.name}</span>
                      <span>{shipped ? '✓' : active ? pct(Math.min(1, me.researchProgress / f.cost)) : `${f.cost} pts`}</span>
                    </div>
                    <div className="mt-0.5 text-slate-400">{f.blurb}</div>
                    <div className="mt-1 text-[11px] text-sky-200">
                      {[
                        f.unlocks && `Unlocks ${SEGMENT_ICON[f.unlocks]} ${SEGMENT_INFO[f.unlocks].name}`,
                        f.arpuMult && `Revenue/user ×${f.arpuMult}`,
                        f.signupMult && `Signups ×${f.signupMult}`,
                        f.hype && `+${f.hype} hype`,
                        `+${f.quality} product`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {!shipped && f.requires.length > 0 && !available && (
                      <div className="mt-1 text-[11px] text-slate-500">Needs {f.requires.map((r) => featureById(r).name).join(' + ')}</div>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  disabled,
  title,
  className = '',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
        disabled
          ? 'cursor-not-allowed border-slate-800 bg-slate-900 text-slate-600'
          : 'border-amber-400/50 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20'
      } ${className}`}
    >
      {children}
    </button>
  );
}
