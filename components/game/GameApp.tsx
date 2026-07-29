'use client';

/**
 * RUNWAY — the game shell.
 *
 * Owns the GameState, routes between screens (title → setup → play), pumps
 * engine fx into the diorama presentation + synth, handles keyboard shortcuts,
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
import type { DioramaController, HitTarget, Scene } from '@/lib/game/map-scene';
import type {
  ActionId,
  DilemmaEffectId,
  FxEvent,
  GameState,
  HubId,
  SectorId,
} from '@/lib/game/types';
import { DioramaMap } from './DioramaMap';
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
  const [foundingFxHub, setFoundingFxHub] = useState<HubId | null>(null);
  const rendererRef = useRef<DioramaController | null>(null);

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
    setFoundingFxHub(hubChoice);
    setGame(g);
    setScreen('play');
    sfx.play('raise');
  }, [draftName, draftSector, hubChoice]);

  const clearFoundingFx = useCallback(() => setFoundingFxHub(null), []);

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
        rivals: game.rivals.map((r) => ({
          id: r.id,
          name: r.name,
          hubId: r.hubId,
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
      rivals: [],
      events: [],
    };
  }, [screen, game, setupStep, hubChoice, draftSector, draftName]);

  const onHit = useCallback(
    (target: HitTarget) => {
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
    <div className="runway-shell flex h-dvh w-full flex-col overflow-hidden text-slate-200 md:flex-row">
      {/* Map side */}
      <div
        className={`relative ${
          screen === 'play'
            ? 'h-[52dvh] min-h-72 flex-none md:h-full md:flex-1'
            : 'min-h-0 flex-1 md:h-full'
        }`}
      >
        <DioramaMap
          key={screen === 'play' ? 'play' : 'intro'}
          scene={scene}
          controllerRef={rendererRef}
          onHit={onHit}
          celebrateHubId={foundingFxHub}
          onCelebrationShown={clearFoundingFx}
          showHubChips={screen !== 'title'}
        />

        {/* Map chrome */}
        {screen === 'play' && game && (
          <div className="week-billboard pointer-events-none absolute top-3 left-3">
            <p>RUNWAY</p>
            <strong>
              Week {game.week}
              <span>·</span>
              {STAGES[game.stageIndex].name}
              {game.valuation > 0 && (
                <>
                  <span>·</span>
                  <em>{fmtMoney(game.valuation)}</em>
                </>
              )}
            </strong>
          </div>
        )}

        <button
          onClick={toggleMute}
          title="Toggle sound (M)"
          aria-label={muted ? 'Turn sound on' : 'Mute sound'}
          className="sound-billboard absolute top-3 right-3 z-30"
        >
          {muted ? '🔇' : '🔊'}
        </button>

        {screen === 'play' && (
          <div className="map-key pointer-events-none absolute bottom-3 left-3 hidden md:block">
            Clay house: your HQ · violet cubes: rivals · orange tents: events
          </div>
        )}

        {/* Title screen */}
        {screen === 'title' && (
          <div className="title-layer absolute inset-0 z-20">
            <div className="title-lockup">
              <p className="title-kicker">LONDON STARTUP MAP PRESENTS</p>
              <h1>RUNWAY</h1>
              <p className="title-copy">
                Found a startup on a living map of London. Spend your focus, work the events scene,
                out-raise your rivals — and reach a{' '}
                <strong>{UNICORN_TARGET.compactLabel} valuation</strong> before the money runs out.
              </p>
              <div className="title-actions">
                <button onClick={() => startSetup()} className="title-primary">
                  New game
                </button>
                {save && (
                  <button onClick={continueSave} className="title-secondary">
                    Continue — week {save.week}, {save.companyName}
                  </button>
                )}
              </div>
              <p className="title-credit">
                Best with sound on 🔊 · built end-to-end by <strong>Fable</strong>
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
            }}
            onRollName={rollName}
            onToHq={() => {
              setSetupStep('hq');
              sfx.play('confirm');
              rendererRef.current?.fitAll();
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
            className={`runway-toast pointer-events-none absolute bottom-8 left-1/2 z-30 w-max max-w-[85%] -translate-x-1/2 px-4 py-2.5 text-sm font-semibold md:bottom-10 ${
              toast.tone === 'warn' ? 'is-warn' : ''
            }`}
          >
            {toast.text}
          </div>
        )}
      </div>

      {/* Control panel */}
      {screen === 'play' && game && (
        <aside
          data-billboard-rail
          className="billboard-rail min-h-0 flex-1 overflow-y-auto md:h-full md:w-[398px] md:flex-none"
        >
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
