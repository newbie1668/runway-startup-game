'use client';

/**
 * RUNWAY — modal layer: dilemma decisions, office moves, and the end screen.
 */

import { HUBS, STAGES, hubById, sectorById } from '@/lib/game/content';
import { score } from '@/lib/game/engine';
import { fmtMoney, fmtUsers } from '@/lib/game/format';
import type { Dilemma, GameState, HubId } from '@/lib/game/types';

// ---------------------------------------------------------------------------

export function DilemmaModal({
  dilemma,
  week,
  onChoose,
}: {
  dilemma: Dilemma;
  week: number;
  onChoose: (effectId: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]">
      <div className="w-full max-w-lg rounded-2xl border border-violet-300/30 bg-[#0d1029] p-6 shadow-2xl">
        <p className="text-xs font-black tracking-[0.25em] text-violet-300">
          WEEK {week} · DECISION TIME
        </p>
        <h3 className="mt-2 text-xl font-black text-white">{dilemma.title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">{dilemma.body}</p>
        <div className="mt-5 flex flex-col gap-2">
          {dilemma.options.map((opt) => (
            <button
              key={opt.effectId}
              onClick={() => onChoose(opt.effectId)}
              className="rounded-xl border border-white/12 bg-white/[0.04] p-3.5 text-left transition hover:border-violet-300/60 hover:bg-violet-300/10 active:scale-[0.99]"
            >
              <p className="text-sm font-black text-white">{opt.label}</p>
              <p className="mt-0.5 text-xs text-slate-400">{opt.detail}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MoveModal({
  game,
  onMove,
  onClose,
}: {
  game: GameState;
  onMove: (hubId: HubId) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4 backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/15 bg-[#0d1029] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black text-white">Move office</h3>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm font-bold text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          £3,000 in movers and deposits, 1 focus, and the team grumbles about commutes.
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          {HUBS.map((hub) => {
            const current = hub.id === game.hubId;
            return (
              <button
                key={hub.id}
                disabled={current}
                onClick={() => onMove(hub.id)}
                className={`rounded-xl border p-3 text-left transition ${
                  current
                    ? 'cursor-default border-amber-300/40 bg-amber-300/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.07] active:scale-[0.99]'
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <p className="text-sm font-black text-white">
                    {hub.name}
                    {current && (
                      <span className="ml-2 text-[10px] font-black text-amber-300">CURRENT HQ</span>
                    )}
                  </p>
                  <p className="text-xs font-bold text-slate-400">
                    £{hub.rent.toLocaleString()}/wk
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{hub.blurb}</p>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const END_META = {
  won: {
    emoji: '🦄',
    headline: 'UNICORN',
    sub: 'One billion dollars. In this economy.',
    tint: 'text-amber-300',
    border: 'border-amber-300/50',
  },
  acquired: {
    emoji: '🤝',
    headline: 'ACQUIRED',
    sub: 'The logo survives as a line in a press release.',
    tint: 'text-sky-300',
    border: 'border-sky-300/50',
  },
  bankrupt: {
    emoji: '🕯️',
    headline: 'OUT OF RUNWAY',
    sub: 'Every great founder has one of these stories.',
    tint: 'text-rose-300',
    border: 'border-rose-300/50',
  },
} as const;

export function EndOverlay({
  game,
  onRestart,
  onTitle,
}: {
  game: GameState;
  onRestart: () => void;
  onTitle: () => void;
}) {
  if (game.phase !== 'won' && game.phase !== 'acquired' && game.phase !== 'bankrupt') return null;
  const meta = END_META[game.phase];
  const finalScore = score(game);
  const roundsClosed = game.stageIndex;
  const board = [
    {
      name: `${game.companyName} (you)`,
      stage: STAGES[game.stageIndex].name,
      sector: sectorById(game.sectorId).emoji,
      you: true,
      alive: game.phase !== 'bankrupt',
    },
    ...game.rivals.map((r) => ({
      name: r.name,
      stage: r.alive ? STAGES[r.stageIndex].name : 'Shut down',
      sector: sectorById(r.sectorId).emoji,
      you: false,
      alive: r.alive,
    })),
  ];

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm">
      <div
        className={`w-full max-w-lg rounded-3xl border-2 ${meta.border} bg-[#0b0e24]/97 p-7 text-center shadow-2xl`}
      >
        <p className="text-6xl">{meta.emoji}</p>
        <h2 className={`mt-2 text-4xl font-black tracking-tight ${meta.tint}`}>{meta.headline}</h2>
        <p className="mt-1 text-sm font-semibold text-slate-400">{meta.sub}</p>
        {game.endSummary && (
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-slate-200">
            {game.endSummary}
          </p>
        )}

        <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
          <div>
            <p className="text-xl font-black text-white">{fmtMoney(finalScore)}</p>
            <p className="text-[10px] font-bold tracking-wider text-slate-500">FINAL SCORE</p>
          </div>
          <div>
            <p className="text-xl font-black text-white">{game.week}</p>
            <p className="text-[10px] font-bold tracking-wider text-slate-500">WEEKS</p>
          </div>
          <div>
            <p className="text-xl font-black text-white">{roundsClosed}</p>
            <p className="text-[10px] font-bold tracking-wider text-slate-500">ROUNDS CLOSED</p>
          </div>
          <div>
            <p className="text-xl font-black text-white">{fmtUsers(game.stats.traction)}</p>
            <p className="text-[10px] font-bold tracking-wider text-slate-500">USERS</p>
          </div>
          <div>
            <p className="text-xl font-black text-white">{game.stats.team}</p>
            <p className="text-[10px] font-bold tracking-wider text-slate-500">TEAM</p>
          </div>
          <div>
            <p className="text-xl font-black text-white">{hubById(game.hubId).name}</p>
            <p className="text-[10px] font-bold tracking-wider text-slate-500">LAST HQ</p>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-left">
          <p className="text-center text-[10px] font-black tracking-[0.2em] text-slate-500">
            THE COHORT
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {board.map((b) => (
              <li
                key={b.name}
                className={`flex items-center justify-between rounded-lg px-2.5 py-1 text-sm ${
                  b.you ? 'bg-amber-300/10 font-black text-amber-200' : 'text-slate-300'
                }`}
              >
                <span className={b.alive ? '' : 'line-through opacity-50'}>
                  {b.sector} {b.name}
                </span>
                <span className="text-xs font-bold text-slate-400">{b.stage}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex gap-2">
          <button
            onClick={onTitle}
            className="rounded-xl border border-white/15 px-4 py-3 text-sm font-bold text-slate-300 transition hover:bg-white/5"
          >
            Title screen
          </button>
          <button
            onClick={onRestart}
            className="flex-1 rounded-xl bg-amber-400 px-4 py-3 text-base font-black text-[#161003] transition hover:bg-amber-300 active:scale-[0.99]"
          >
            Run it back ↻
          </button>
        </div>
      </div>
    </div>
  );
}
