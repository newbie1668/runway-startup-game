'use client';

/**
 * RUNWAY — the control panel next to the map: stats, weekly actions,
 * events, fundraising and the news ticker.
 */

import { ACTIONS, STAGES, hubById, sectorById } from '@/lib/game/content';
import {
  FOCUS_PER_WEEK,
  nextStage,
  pitchReadiness,
  productCap,
  runwayWeeks,
  weeklyBurn,
  weeklyRevenue,
} from '@/lib/game/engine';
import { fmtMoney, fmtUsers } from '@/lib/game/format';
import type { ActionId, GameState, NewsTone } from '@/lib/game/types';

interface Props {
  game: GameState;
  onAction: (id: ActionId, payload?: { eventId?: string }) => void;
  onAdvance: () => void;
  onOpenMove: () => void;
}

const CARD = 'rounded-xl border border-white/40 bg-white/35';

const TONE_DOT: Record<NewsTone, string> = {
  good: 'bg-emerald-500',
  bad: 'bg-rose-500',
  neutral: 'bg-slate-400',
  money: 'bg-amber-500',
  rival: 'bg-violet-500',
};

function Bar({
  label,
  value,
  max,
  color,
  hint,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  hint?: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-medium text-slate-600">{label}</span>
        <span className="text-[11px] font-semibold text-slate-800">
          {Math.floor(value)}
          {hint ? <span className="font-medium text-slate-500"> {hint}</span> : null}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-800/10">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[12px]">
      <span className="text-slate-600">{label}</span>
      <span className={`font-medium ${warn ? 'text-rose-600' : 'text-slate-800'}`}>{value}</span>
    </div>
  );
}

export function Sidebar({ game, onAction, onAdvance, onOpenMove }: Props) {
  const s = game.stats;
  const sector = sectorById(game.sectorId);
  const hub = hubById(game.hubId);
  const stage = STAGES[game.stageIndex];
  const next = nextStage(game);
  const burn = weeklyBurn(game);
  const revenue = weeklyRevenue(game);
  const runway = runwayWeeks(game);
  const readiness = pitchReadiness(game);
  const cap = productCap(game);
  const playing = game.phase === 'playing';
  const focusDots = Array.from({ length: FOCUS_PER_WEEK });

  return (
    <div className="flex h-full flex-col gap-3 p-3.5">
      <div className={`${CARD} p-3`}>
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-base font-semibold text-slate-800">
            {sector.emoji} {game.companyName}
          </p>
          <span className="shrink-0 rounded-full bg-emerald-400/90 px-2.5 py-0.5 text-[10px] font-bold text-emerald-950">
            {stage.name}
          </span>
        </div>
        <dl className="mt-2 space-y-0.5">
          <Row label="Sector" value={sector.name} />
          <Row label="HQ" value={hub.name} />
          <Row label="Valuation" value={game.valuation > 0 ? fmtMoney(game.valuation) : '—'} />
        </dl>
      </div>

      <div className={`${CARD} p-3`}>
        <dl className="space-y-0.5">
          <Row label="Cash" value={fmtMoney(s.cash)} warn={s.cash < burn * 4} />
          <Row
            label="Runway"
            value={Number.isFinite(runway) ? `${Math.floor(runway)}wk` : '∞'}
            warn={runway < 5}
          />
          <Row label="Users" value={fmtUsers(s.traction)} />
          <Row label="Burn" value={`${fmtMoney(burn)}/wk`} />
          <Row label="Revenue" value={`${fmtMoney(revenue)}/wk`} />
          <Row label="Team" value={`${s.team}`} />
          <Row
            label="Intros"
            value={`${s.connections} investor intro${s.connections === 1 ? '' : 's'}`}
          />
        </dl>
        <div className="mt-2.5 grid grid-cols-3 gap-2.5">
          <Bar
            label="Product"
            value={s.product}
            max={100}
            color="bg-sky-400"
            hint={`/cap ${cap}`}
          />
          <Bar label="Hype" value={s.hype} max={100} color="bg-fuchsia-400" />
          <Bar label="Morale" value={s.morale} max={100} color="bg-emerald-400" />
        </div>
      </div>

      <div className={`${CARD} p-3`}>
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-medium tracking-wide text-slate-600">
            Week {game.week} — your focus
          </p>
          <div className="flex gap-1.5" title="Founder focus left this week">
            {focusDots.map((_, i) => (
              <span
                key={i}
                className={`h-2.5 w-2.5 rounded-full ${
                  i < game.focusLeft ? 'bg-emerald-400' : 'bg-slate-800/15'
                }`}
              />
            ))}
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {ACTIONS.filter((a) => a.id !== 'pitch').map((a) => {
            const disabled = !playing || game.focusLeft < a.focusCost;
            return (
              <button
                key={a.id}
                onClick={() => onAction(a.id)}
                disabled={disabled}
                title={`${a.blurb} (key: ${a.hotkey})`}
                className="group rounded-lg border border-white/45 bg-white/40 px-2.5 py-2 text-left transition enabled:hover:bg-white/70 enabled:active:scale-[0.98] disabled:opacity-35"
              >
                <p className="text-[13px] font-semibold text-slate-800">
                  {a.name}
                  <span className="ml-1 rounded border border-slate-400/40 px-1 text-[9px] font-bold text-slate-500 group-hover:text-slate-700">
                    {a.hotkey}
                  </span>
                </p>
                <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-tight text-slate-500">
                  {a.blurb}
                </p>
              </button>
            );
          })}
          <button
            onClick={onOpenMove}
            disabled={!playing || game.focusLeft < 1}
            title="Relocate the office to another neighbourhood"
            className="rounded-lg border border-white/45 bg-white/40 px-2.5 py-2 text-left transition enabled:hover:bg-white/70 enabled:active:scale-[0.98] disabled:opacity-35"
          >
            <p className="text-[13px] font-semibold text-slate-800">Move office…</p>
            <p className="mt-0.5 text-[10.5px] leading-tight text-slate-500">
              New neighbourhood, new perks. £3k + a grumpy team.
            </p>
          </button>
        </div>
      </div>

      <div className={`${CARD} p-3`}>
        <p className="text-[11px] font-medium tracking-wide text-slate-600">
          ★ On this week <span className="text-slate-500">(1 focus each)</span>
        </p>
        <div className="mt-2 flex flex-col gap-1.5">
          {game.eventsThisWeek.length === 0 && (
            <p className="text-xs text-slate-500">A rare quiet week. Even Shoreditch sleeps.</p>
          )}
          {game.eventsThisWeek.map((ev) => {
            const evHub = hubById(ev.hubId);
            const synergy = ev.sectorId === game.sectorId;
            return (
              <div
                key={ev.id}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                  ev.attended
                    ? 'border-white/30 bg-white/20 opacity-55'
                    : 'border-white/45 bg-white/50'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold text-slate-800">
                    {ev.name}
                    {synergy && (
                      <span className="ml-1.5 rounded bg-white/70 px-1 text-[9px] font-bold text-slate-600">
                        YOUR SCENE
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[10.5px] text-slate-500">
                    {evHub.name} · {ev.venue}
                  </p>
                </div>
                <button
                  onClick={() => onAction('attend', { eventId: ev.id })}
                  disabled={!playing || ev.attended || game.focusLeft < 1}
                  className="shrink-0 rounded-md bg-sky-400/90 px-2.5 py-1 text-[11px] font-bold text-sky-950 transition enabled:hover:bg-sky-300 enabled:active:scale-95 disabled:bg-slate-800/10 disabled:text-slate-500"
                >
                  {ev.attended ? 'WENT ✓' : 'GO'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {next && (
        <div className={`${CARD} p-3`}>
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] font-medium tracking-wide text-slate-600">
              Next round — {next.name}
            </p>
            <p className="text-[11px] font-medium text-slate-800">raises {fmtMoney(next.raise)}</p>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2.5">
            <Bar
              label="Product needed"
              value={Math.min(s.product, next.minProduct)}
              max={next.minProduct}
              color={s.product >= next.minProduct ? 'bg-emerald-400' : 'bg-amber-300'}
              hint={`/${next.minProduct}`}
            />
            <Bar
              label="Users needed"
              value={Math.min(s.traction, next.minTraction)}
              max={next.minTraction}
              color={s.traction >= next.minTraction ? 'bg-emerald-400' : 'bg-amber-300'}
              hint={`/${fmtUsers(next.minTraction)}`}
            />
          </div>
          <button
            onClick={() => onAction('pitch')}
            disabled={!playing || !readiness.ready || game.focusLeft < 2}
            title={readiness.ready ? 'Costs 2 focus (key: I)' : readiness.reasons.join(' · ')}
            className="mt-2.5 w-full rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-[#161003] transition enabled:hover:bg-amber-300 enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-800/10 disabled:text-slate-500"
          >
            {readiness.ready
              ? `Pitch investors — ${Math.round(readiness.odds * 100)}% odds (2 focus)`
              : `Not ready: ${readiness.reasons[0]}`}
          </button>
        </div>
      )}

      <button
        onClick={onAdvance}
        disabled={!playing}
        className="w-full rounded-xl bg-emerald-400/90 px-3 py-2.5 text-base font-semibold text-emerald-950 transition enabled:hover:bg-emerald-300 enabled:active:scale-[0.99] disabled:opacity-40"
        title="Key: Space or N"
      >
        {game.focusLeft > 0 ? `Advance week (${game.focusLeft} focus unspent) ▸` : 'Advance week ▸'}
      </button>

      <div className={`${CARD} min-h-32 flex-1 p-3`}>
        <p className="text-[11px] font-medium tracking-wide text-slate-600">The scene</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {[...game.news]
            .reverse()
            .slice(0, 40)
            .map((n, i) => (
              <li key={`${n.week}-${i}`} className="flex gap-2 text-[12px] leading-snug">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[n.tone]}`} />
                <span className="text-slate-600">
                  <span className="mr-1 font-semibold text-slate-800">W{n.week}</span>
                  {n.text}
                </span>
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}
