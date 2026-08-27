'use client';

/**
 * RUNWAY — the game shell.
 *
 * Owns the GameState, routes between screens (title → setup → play), pumps
 * engine fx into the canvas renderer + synth, handles keyboard shortcuts,
 * and persists a save to localStorage.
 *
 * All game transitions happen inside event handlers (never effects): compute
 * the next state with the pure engine, fire visual/audio fx for anything the
 * engine queued, then commit with setGame.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  STAGES,
  UNICORN_TARGET,
  generateCompanyName,
  hubById,
  sectorById,
} from '@/lib/game/content';
import {
  SAVE_VERSION,
  applyDilemmaChoice,
  drainFx,
  endWeek,
  newGame,
  performAction,
} from '@/lib/game/engine';
import { fmtMoney } from '@/lib/game/format';
import { Dice } from '@/lib/game/rng';
import { sfx } from '@/lib/game/audio';
import type { IMapRenderer, Scene } from '@/lib/game/scene';
import type {
  ActionId,
  DilemmaEffectId,
  FxEvent,
  GameState,
  HubId,
  SectorId,
} from '@/lib/game/types';
import { MapCanvas } from './MapCanvas';
import { SetupOverlay, type SetupStep } from './SetupOverlay';
import { Sidebar } from './Sidebar';
import { DilemmaModal, EndOverlay, MoveModal } from './Modals';

const SAVE_KEY = 'runway-save';
const MUTE_KEY = 'runway-muted';

type ScreenId = 'title' | 'setup' | 'play';

// --- localStorage as an external store (SSR-safe, lint-clean) --------------

const storeListeners = new Set<() => void>();
function subscribeStore(cb: () => void): () => void {
  storeListeners.add(cb);
  return () => storeListeners.delete(cb);
}
function emitStore() {
  for (const cb of storeListeners) cb();
}
const getSaveRaw = () => {
  try {
    return localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
};
const getMuted = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
};

function parseSave(raw: string | null): GameState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GameState;
    return parsed.version === SAVE_VERSION ? parsed : null;
  } catch {
    return null;
  }
}

interface Toast {
  text: string;
  tone: 'info' | 'warn';
  key: number;
}

export function GameApp() {
  const [screen, setScreen] = useState<ScreenId>('title');
  const [game, setGame] = useState<GameState | null>(null);

  const saveRaw = useSyncExternalStore(subscribeStore, getSaveRaw, () => null);
  const save = useMemo(() => parseSave(saveRaw), [saveRaw]);
  const muted = useSyncExternalStore(subscribeStore, getMuted, () => false);

  // Setup flow state.
  const [setupStep, setSetupStep] = useState<SetupStep>('identity');
  const [draftName, setDraftName] = useState('');
  const [draftSector, setDraftSector] = useState<SectorId | null>(null);
  const [hubChoice, setHubChoice] = useState<HubId | null>(null);

  const [moveOpen, setMoveOpen] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rendererRef = useRef<IMapRenderer | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const onMapReady = useCallback(() => setMapReady(true), []);

  // Latest game for stable handlers (updated post-commit; handlers only fire
  // on user interaction, long after the effect has run).
  const gameRef = useRef<GameState | null>(null);
  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  // Keep the synth in step with the persisted mute preference.
  useEffect(() => {
    sfx.muted = muted;
  }, [muted]);

  // Persist the run after every committed change (external-system sync only).
  useEffect(() => {
    if (!game) return;
    if (game.phase === 'playing' || game.phase === 'dilemma') {
      localStorage.setItem(SAVE_KEY, JSON.stringify(game));
    } else {
      localStorage.removeItem(SAVE_KEY);
    }
    emitStore();
  }, [game]);

  const toggleMute = useCallback(() => {
    const next = !getMuted();
    localStorage.setItem(MUTE_KEY, next ? '1' : '0');
    sfx.muted = next;
    emitStore();
  }, []);

  const showToast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ text, tone, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  // --- fx: engine events → canvas particles + sounds -----------------------
  const runFx = useCallback((fx: FxEvent[], fallbackHub: HubId) => {
    const r = rendererRef.current;
    for (const f of fx) {
      const hub = f.hubId ?? fallbackHub;
      switch (f.kind) {
        case 'confetti':
          r?.burstConfetti(hub);
          sfx.play('raise');
          break;
        case 'cash':
          r?.floatText(hub, f.note ?? '+£££', '#4ade80');
          sfx.play('cash');
          break;
        case 'bad':
          r?.puffSmoke(hub);
          sfx.play('fail');
          break;
        case 'unicorn':
          r?.burstConfetti(hub);
          r?.burstConfetti(null);
          r?.sparkle(hub);
          sfx.play('unicorn');
          break;
        case 'stamp':
          r?.sparkle(hub);
          sfx.play('confirm');
          break;
      }
    }
  }, []);

  /** Commit an engine transition: drain queued fx, play them, set state. */
  const commit = useCallback(
    (next: GameState) => {
      const { state, fx } = drainFx(next);
      if (fx.length) runFx(fx, state.hubId);
      setGame(state);
    },
    [runFx],
  );

  // --- game verbs -----------------------------------------------------------
  const act = useCallback(
    (id: ActionId, payload?: { eventId?: string; hubId?: HubId }) => {
      const g = gameRef.current;
      if (!g) return;
      const res = performAction(g, id, payload);
      if (!res.ok) {
        showToast(res.message, 'warn');
        sfx.play('click');
        return;
      }
      showToast(res.message, 'info');
      if (id !== 'pitch') sfx.play('confirm');
      commit(res.state);
    },
    [commit, showToast],
  );

  const advance = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.phase !== 'playing') return;
    const next = endWeek(g);
    sfx.play('week');
    if (next.phase === 'dilemma') sfx.play('event');
    if (next.phase === 'bankrupt') sfx.play('gameover');
    commit(next);
  }, [commit]);

  const choose = useCallback(
    (effectId: DilemmaEffectId) => {
      const g = gameRef.current;
      if (!g) return;
      sfx.play('click');
      const next = applyDilemmaChoice(g, effectId);
      if (next.phase === 'bankrupt' || next.phase === 'acquired') sfx.play('gameover');
      commit(next);
    },
    [commit],
  );

  const startSetup = useCallback((prefill?: GameState | null) => {
    sfx.play('confirm');
    if (prefill) {
      setDraftName(prefill.companyName);
      setDraftSector(prefill.sectorId);
    }
    setHubChoice(null);
    setSetupStep('identity');
    setScreen('setup');
    rendererRef.current?.fitAll();
  }, []);

  const foundCompany = useCallback(() => {
    if (!draftSector || !hubChoice) return;
    const g = newGame({ companyName: draftName.trim(), sectorId: draftSector, hubId: hubChoice });
    setGame(g);
    setScreen('play');
    sfx.play('raise');
    rendererRef.current?.burstConfetti(hubChoice);
  }, [draftName, draftSector, hubChoice]);

  const continueSave = useCallback(() => {
    const g = parseSave(getSaveRaw());
    if (!g) return;
    setGame(g);
    setScreen('play');
    sfx.play('confirm');
  }, []);

  const rollName = useCallback(() => {
    const dice = new Dice((Math.random() * 0xffffffff) >>> 0);
    setDraftName(generateCompanyName(dice));
    sfx.play('click');
  }, []);

  // --- map scene ------------------------------------------------------------
  const scene: Scene = useMemo(() => {
    if (screen === 'play' && game) {
      return {
        mode: 'play',
        playerHubId: game.hubId,
        playerSectorId: game.sectorId,
        companyName: game.companyName,
        stageName: STAGES[game.stageIndex].name,
        rivals: game.rivals.map((r) => ({
          id: r.id,
          name: r.name,
          hubId: r.hubId,
          sectorId: r.sectorId,
          stageName: r.alive ? STAGES[r.stageIndex].name : 'RIP',
          alive: r.alive,
        })),
        events: game.eventsThisWeek.map((e) => ({
          id: e.id,
          name: `★ ${e.name}`,
          hubId: e.hubId,
          attended: e.attended,
        })),
      };
    }
    return {
      mode: 'setup',
      playerHubId: screen === 'setup' && setupStep === 'hq' ? hubChoice : null,
      playerSectorId: draftSector,
      companyName: draftName,
      stageName: '',
      rivals: [],
      events: [],
    };
  }, [screen, game, setupStep, hubChoice, draftSector, draftName]);

  const onHit = useCallback(
    (target: { type: string; hubId?: HubId; eventId?: string; rivalId?: string }) => {
      const g = gameRef.current;
      if (screen === 'setup' && setupStep === 'hq' && target.type === 'hub' && target.hubId) {
        setHubChoice(target.hubId);
        sfx.play('click');
        return;
      }
      if (screen !== 'play' || !g) return;
      if (target.type === 'event' && target.eventId) {
        act('attend', { eventId: target.eventId });
      } else if (target.type === 'rival' && target.rivalId) {
        const rival = g.rivals.find((r) => r.id === target.rivalId);
        if (rival) {
          showToast(
            `${rival.name} — ${sectorById(rival.sectorId).name} rival at ${STAGES[rival.stageIndex].name}, HQ ${hubById(rival.hubId).name}. Keep shipping.`,
            'info',
          );
        }
      } else if (target.type === 'hub' && target.hubId && target.hubId !== g.hubId) {
        showToast(`That's ${hubById(target.hubId).name}. Use "Move office…" to relocate.`, 'info');
      }
    },
    [screen, setupStep, act, showToast],
  );

  // --- keyboard ---------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]')) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key.toLowerCase() === 'm') {
        toggleMute();
        return;
      }
      const g = gameRef.current;
      if (screen !== 'play' || !g || g.phase !== 'playing' || moveOpen) return;
      const k = e.key.toLowerCase();
      const map: Record<string, ActionId> = {
        b: 'build',
        g: 'growth',
        h: 'hire',
        p: 'press',
        t: 'retreat',
        i: 'pitch',
      };
      if (map[k]) {
        e.preventDefault();
        act(map[k]);
      } else if (k === ' ' || k === 'n') {
        e.preventDefault();
        advance();
      } else if (k === '1' || k === '2' || k === '3') {
        const ev = g.eventsThisWeek[Number(k) - 1];
        if (ev && !ev.attended) act('attend', { eventId: ev.id });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, moveOpen, act, advance, toggleMute]);

  // ----------------------------------------------------------------------------

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[#070c1a] text-slate-200 md:flex-row">
      {/* Map side */}
      <div
        className={`relative ${
          screen === 'play'
            ? 'h-[44dvh] min-h-64 flex-none md:h-full md:flex-1'
            : 'min-h-0 flex-1 md:h-full'
        }`}
      >
        <MapCanvas
          scene={scene}
          rendererRef={rendererRef}
          onHit={onHit}
          onReady={onMapReady}
        />

        {!mapReady && (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-[#070c1a]/92 backdrop-blur-sm"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="px-6 text-center">
              <p className="text-xs font-black tracking-[0.5em] text-sky-300">RUNWAY</p>
              <p className="mt-3 text-lg font-bold text-slate-200">Laying out London…</p>
              <p className="mt-1 text-sm text-slate-500">Buildings, streets, landmarks</p>
            </div>
          </div>
        )}

        {/* Map chrome */}
        {screen === 'play' && game && (
          <div className="pointer-events-none absolute top-3 left-3 rounded-xl border border-white/10 bg-[#0b1226]/85 px-3.5 py-2 backdrop-blur">
            <p className="text-[10px] font-black tracking-[0.3em] text-amber-300">RUNWAY</p>
            <p className="text-sm font-black text-white">
              Week {game.week}
              <span className="mx-1.5 text-slate-600">·</span>
              {STAGES[game.stageIndex].name}
              {game.valuation > 0 && (
                <>
                  <span className="mx-1.5 text-slate-600">·</span>
                  <span className="text-amber-200">{fmtMoney(game.valuation)}</span>
                </>
              )}
            </p>
          </div>
        )}

        <button
          onClick={toggleMute}
          title="Toggle sound (M)"
          aria-label={muted ? 'Turn sound on' : 'Mute sound'}
          className="absolute top-3 right-3 z-30 rounded-full border border-white/15 bg-[#0b1226]/85 px-3 py-2 text-base backdrop-blur transition hover:bg-white/10"
        >
          {muted ? '🔇' : '🔊'}
        </button>

        {screen === 'play' && (
          <div className="pointer-events-none absolute bottom-2 left-3 hidden rounded-lg bg-[#0b1226]/70 px-2.5 py-1 text-[10.5px] font-semibold text-slate-400 md:block">
            🟡 your HQ · shields: rivals · ★ events (click to attend) · drag to pan, scroll to zoom
          </div>
        )}

        {/* Title screen */}
        {screen === 'title' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-gradient-to-b from-[#070c1a]/78 via-[#070c1a]/55 to-[#070c1a]/85 p-6">
            <div className="w-full max-w-xl text-center">
              <p className="text-xs font-black tracking-[0.5em] text-sky-300">
                LONDON STARTUP MAP PRESENTS
              </p>
              <h1 className="mt-3 bg-gradient-to-br from-amber-200 via-amber-400 to-orange-500 bg-clip-text text-7xl font-black tracking-tight text-transparent drop-shadow-sm md:text-8xl">
                RUNWAY
              </h1>
              <p className="mx-auto mt-4 max-w-md rounded-xl bg-[#070c1a]/80 px-3 py-2 text-base leading-relaxed text-slate-300 md:bg-transparent md:p-0">
                Found a startup on a living map of London. Spend your focus, work the events scene,
                out-raise your rivals — and reach a{' '}
                <span className="font-bold text-amber-300">
                  {UNICORN_TARGET.compactLabel} valuation
                </span>{' '}
                before the money runs out.
              </p>
              <div className="mt-8 flex flex-col items-center gap-2.5">
                <button
                  onClick={() => startSetup()}
                  className="w-64 rounded-2xl bg-amber-400 px-6 py-3.5 text-lg font-black text-[#161003] shadow-lg shadow-amber-500/20 transition hover:bg-amber-300 hover:shadow-amber-400/30 active:scale-[0.98]"
                >
                  New game
                </button>
                {save && (
                  <button
                    onClick={continueSave}
                    className="w-64 rounded-2xl border border-white/20 px-6 py-3 text-base font-bold text-slate-200 transition hover:bg-white/5 active:scale-[0.98]"
                  >
                    Continue — week {save.week}, {save.companyName}
                  </button>
                )}
              </div>
              <p className="mt-8 text-xs text-slate-500">
                Best with sound on 🔊 · built end-to-end by{' '}
                <span className="font-bold text-slate-400">Fable</span>
                {' as a what-if: the startup map, but you\u2019re on it.'}
              </p>
            </div>
          </div>
        )}

        {/* Setup overlay */}
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
            onHub={(hubId) => {
              setHubChoice(hubId);
              sfx.play('click');
              rendererRef.current?.focusHub(hubId);
            }}
            onRollName={rollName}
            onToHq={() => {
              setSetupStep('hq');
              sfx.play('confirm');
              rendererRef.current?.fitOverview();
            }}
            onBack={() => {
              if (setupStep === 'hq') setSetupStep('identity');
              else setScreen('title');
            }}
            onConfirm={foundCompany}
          />
        )}

        {/* Toast */}
        {toast && screen === 'play' && (
          <div
            key={toast.key}
            className={`pointer-events-none absolute bottom-8 left-1/2 z-30 w-max max-w-[85%] -translate-x-1/2 rounded-xl border px-4 py-2.5 text-sm font-semibold shadow-xl backdrop-blur md:bottom-10 ${
              toast.tone === 'warn'
                ? 'border-rose-300/40 bg-rose-950/85 text-rose-100'
                : 'border-sky-300/30 bg-[#0b1226]/92 text-slate-100'
            }`}
          >
            {toast.text}
          </div>
        )}
      </div>

      {/* Control panel */}
      {screen === 'play' && game && (
        <aside className="min-h-0 flex-1 overflow-y-auto border-t border-white/10 bg-[#0a0f22] md:h-full md:w-[398px] md:flex-none md:border-t-0 md:border-l">
          <Sidebar
            game={game}
            onAction={act}
            onAdvance={advance}
            onOpenMove={() => setMoveOpen(true)}
          />
        </aside>
      )}

      {/* Modal layer */}
      {screen === 'play' && game?.pendingDilemma && (
        <DilemmaModal dilemma={game.pendingDilemma} week={game.week} onChoose={choose} />
      )}
      {screen === 'play' && game && moveOpen && (
        <MoveModal
          game={game}
          onClose={() => setMoveOpen(false)}
          onMove={(hubId) => {
            setMoveOpen(false);
            act('move', { hubId });
          }}
        />
      )}
      {screen === 'play' && game && (
        <EndOverlay
          game={game}
          onRestart={() => startSetup(game)}
          onTitle={() => {
            setGame(null);
            setScreen('title');
          }}
        />
      )}
    </div>
  );
}
