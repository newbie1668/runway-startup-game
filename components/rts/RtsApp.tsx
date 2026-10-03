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
import { Dice, seedFromString } from '@/lib/game/rng';
import type { HubId, SectorId } from '@/lib/game/types';
import {
  ENGINEER_HIRE_FEE,
  ENGINEER_WEEKLY_SALARY,
  FEATURES,
  GROWTH_HIRE_FEE,
  GROWTH_WEEKLY_SALARY,
  OFFICE_LEVELS,
  OFFICE_OPEN_COST,
  SEGMENT_INFO,
} from '@/lib/rts/content';
import {
  HUB_WORLD,
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
  canResearch,
  hire,
  movePeople,
  newRtsGame,
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
  RtsResult,
  RtsState,
} from '@/lib/rts/types';

/** In-game days per real second at 1×. */
const DAYS_PER_SECOND = 0.35;
const SPEEDS = [0, 1, 2, 4] as const;
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const COMPANY_ORDER: CompanyId[] = ['player', 'rival1', 'rival2', 'rival3'];

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<RtsRenderer | null>(null);
  const [initial] = useState(() =>
    newRtsGame({ seed: cfg.seed, companyName: cfg.name, sectorId: cfg.sectorId, hqHub: cfg.hqHub }),
  );
  const stateRef = useRef<RtsState>(initial);
  const speedRef = useRef(0);
  const [ui, setUi] = useState<RtsState>(initial);
  const [speed, setSpeedState] = useState(0);
  const [selection, setSelection] = useState<string[]>([]);
  const [focus, setFocus] = useState<RtsHit | null>(() => {
    const hq = initial.offices.find((o) => o.company === 'player');
    return hq ? { type: 'office', id: hq.id } : null;
  });
  const [toast, setToast] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(true);
  const [showRoadmap, setShowRoadmap] = useState(false);

  const setSpeed = useCallback((v: number) => {
    speedRef.current = v;
    setSpeedState(v);
  }, []);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2800);
  }, []);

  const handleFx = useCallback((res: RtsResult) => {
    const r = rendererRef.current;
    if (!r) return;
    r.applyFx(res.fx);
    for (const f of res.fx) if (f.kind === 'focus') r.centerOn(f);
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
    const r = rendererRef.current;
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
    const canvas = canvasRef.current!;
    const r = new RtsRenderer(canvas);
    rendererRef.current = r;
    r.state = stateRef.current;
    r.base.resize();
    r.base.fitAll();
    r.base.zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.6);
    r.centerOn(HUB_WORLD[cfg.hqHub]);

    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const keys = new Set<string>();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const before = stateRef.current;
      if (speedRef.current > 0 && before.phase === 'playing') {
        const res = tick(before, dt * speedRef.current * DAYS_PER_SECOND);
        stateRef.current = res.state;
        handleFx(res);
      }
      const pan = 520 * dt;
      if (keys.has('w') || keys.has('arrowup')) r.base.pan(0, pan);
      if (keys.has('s') || keys.has('arrowdown')) r.base.pan(0, -pan);
      if (keys.has('a') || keys.has('arrowleft')) r.base.pan(pan, 0);
      if (keys.has('d') || keys.has('arrowright')) r.base.pan(-pan, 0);
      r.state = stateRef.current;
      r.frame(t, dt);
      if (miniRef.current) r.drawMinimap(miniRef.current);
      if (t - lastUi > 120 || stateRef.current.phase !== before.phase) {
        lastUi = t;
        setUi(stateRef.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const ro = new ResizeObserver(() => r.base.resize());
    ro.observe(canvas);

    const pos = (e: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    let drag: { x: number; y: number; moved: number; box: boolean; button: number } | null = null;

    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = pos(e);
      drag = { ...p, moved: 0, box: e.shiftKey && e.button === 0, button: e.button };
    };
    const onMove = (e: PointerEvent) => {
      const p = pos(e);
      if (drag) {
        drag.moved += Math.abs(e.movementX) + Math.abs(e.movementY);
        if (drag.box) r.box = { x0: drag.x, y0: drag.y, x1: p.x, y1: p.y };
        else if (drag.button === 0 || drag.button === 1) r.base.pan(e.movementX, e.movementY);
      } else {
        r.hover = r.hitTest(p.x, p.y);
        canvas.style.cursor = r.hover ? 'pointer' : 'default';
      }
    };
    const onUp = (e: PointerEvent) => {
      const p = pos(e);
      const d = drag;
      drag = null;
      if (!d) return;
      if (d.box) {
        setSelection(r.peopleInBox(d.x, d.y, p.x, p.y));
        r.box = null;
        return;
      }
      if (d.button !== 0 || d.moved > 5) return;
      const hit = r.hitTest(p.x, p.y);
      if (!hit) {
        setSelection([]);
        return;
      }
      if (hit.type === 'person') {
        const person = stateRef.current.people.find((x) => x.id === hit.id)!;
        if (person.company !== 'player') {
          const c = stateRef.current.companies[person.company];
          flash(`${person.name} (${c.name}) · ${personActivity(stateRef.current, person).text}`);
          return;
        }
        setSelection((sel) =>
          e.shiftKey ? (sel.includes(person.id) ? sel.filter((x) => x !== person.id) : [...sel, person.id]) : [person.id],
        );
        return;
      }
      setSelection([]);
      setFocus(hit);
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      const ids = [...r.selected];
      if (ids.length === 0) {
        flash('Select someone first (click a person, or Shift-drag a box)');
        return;
      }
      const p = pos(e);
      sendTo(r.hitTest(p.x, p.y), ids);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = pos(e);
      r.base.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0016));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      if (k === ' ') {
        e.preventDefault();
        setSpeed(speedRef.current === 0 ? 1 : 0);
      } else if (k === '1' || k === '2' || k === '3') setSpeed(SPEEDS[Number(k)]);
      else if (k === 'f') {
        const f = stateRef.current.people.find((p) => p.company === 'player' && p.role === 'founder');
        if (f) {
          setSelection([f.id]);
          r.centerOn(f);
        }
      } else if (k === 'q') setSelection(stateRef.current.people.filter((p) => p.company === 'player').map((p) => p.id));
      else if (k === 'r') setShowRoadmap((v) => !v);
      else if (k === 'escape') {
        setSelection([]);
        setShowRoadmap(false);
      } else keys.add(k);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      rendererRef.current = null;
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
  const week = Math.floor(s.day / 7) + 1;
  const dayName = DAY_NAMES[Math.floor(s.day) % 7];
  const nextStage = STAGES[Math.min(STAGES.length - 1, me.stageIndex + 1)];
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
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" aria-label="London map" />

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
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-slate-300">
            Week {week} · {dayName}
          </span>
          <div className="flex overflow-hidden rounded-lg border border-slate-700">
            {SPEEDS.map((v, i) => (
              <button
                key={v}
                onClick={() => setSpeed(v)}
                className={`px-2.5 py-1 text-xs font-bold ${speed === v ? 'bg-amber-400 text-slate-900' : 'bg-slate-900 text-slate-300 hover:bg-slate-800'}`}
                title={i === 0 ? 'Pause (Space)' : `Speed ${v}× (${i})`}
              >
                {i === 0 ? '❚❚' : `${v}×`}
              </button>
            ))}
          </div>
          <button onClick={() => setShowHelp((v) => !v)} className="rounded-lg border border-slate-700 px-2 py-1 text-xs">
            ?
          </button>
        </div>
      </header>

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
        <Panel title="NEXT ROUND">
          <Progress label="Users" value={me.users} target={nextStage.minTraction} fmt={fmtUsers} />
          <Progress label="Product" value={me.product} target={nextStage.minProduct} fmt={(v) => `${Math.round(v)}`} />
          <p className="mt-1.5 text-slate-400">
            Hit both, then walk your founder to a 💷 investor for {nextStage.name} ({fmtMoney(nextStage.raise)}).
          </p>
          <div className="mt-2 flex gap-0.5">
            {STAGES.slice(1).map((st, i) => (
              <div key={st.id} title={st.name} className={`h-1.5 flex-1 rounded ${i < me.stageIndex ? 'bg-amber-400' : 'bg-slate-700'}`} />
            ))}
          </div>
          <p className="mt-1 text-[10px] text-slate-500">Bootstrapped → 🦄 Unicorn</p>
        </Panel>
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
            <PeoplePanel people={selectedPeople} state={s} />
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
              onSelectHere={(ids) => setSelection(ids)}
            />
          ) : focusedOffice ? (
            <OfficePanel
              office={focusedOffice}
              state={s}
              onUpgrade={() => run((st) => upgradeOffice(st, focusedOffice.id))}
              onRoadmap={() => setShowRoadmap(true)}
              onSelectHere={(ids) => setSelection(ids)}
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
              setSpeed(1);
            }}
            className="mt-4 w-full rounded-lg bg-amber-400 py-2 font-black text-slate-900"
          >
            Start the clock
          </button>
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
        <div className="absolute inset-0 flex items-center justify-center bg-black/55">
          <div className="w-[460px] rounded-2xl border border-amber-400/40 bg-[#0d1530] p-6 text-center shadow-2xl">
            <p className="text-5xl">{s.phase === 'won' ? '🦄' : '💸'}</p>
            <h3 className="mt-2 text-2xl font-black text-amber-300">{s.phase === 'won' ? 'Unicorn!' : 'Out of runway'}</h3>
            <p className="mt-2 text-slate-300">
              {me.name} · week {week} · {STAGES[me.stageIndex].name} · {fmtUsers(me.users)} users · you own {pct(me.equity)}
            </p>
            <p className="mt-1 text-slate-400">
              Founder payout: <b className="text-amber-300">{fmtMoney(s.phase === 'won' ? me.equity * me.valuation : 0)}</b>
            </p>
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

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700/70 bg-[#0b1226]/92 p-2.5 shadow-lg">
      <div className="mb-1.5 text-[10px] font-bold tracking-[0.2em] text-amber-300/80">{title}</div>
      {children}
    </div>
  );
}

function Progress({ label, value, target, fmt }: { label: string; value: number; target: number; fmt: (v: number) => string }) {
  const k = target > 0 ? Math.min(1, value / target) : 1;
  return (
    <div className="mb-1">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className={k >= 1 ? 'text-emerald-400' : 'text-slate-400'}>
          {fmt(value)} / {fmt(target)}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 rounded bg-slate-800">
        <div className={`h-1.5 rounded ${k >= 1 ? 'bg-emerald-400' : 'bg-sky-400'}`} style={{ width: pct(k) }} />
      </div>
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

function PeoplePanel({ people, state }: { people: Person[]; state: RtsState }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="font-black text-amber-300">
          {people.length === 1 ? `${ROLE_ICON[people[0].role]} ${people[0].name} · ${ROLE_LABEL[people[0].role]}` : `${people.length} people selected`}
        </h3>
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
        <h3 className="text-lg font-black">🏠 {level.name}</h3>
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
