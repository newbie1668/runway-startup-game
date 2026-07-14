'use client';

/**
 * Floating map detail and overview cards for the isometric map.
 */

import { STAGES, hubById, sectorById } from '@/lib/game/content';
import type { HitTarget } from '@/lib/game/map-scene';
import type { GameState, HubId } from '@/lib/game/types';

export interface MapCardState {
  target: HitTarget;
  x: number;
  y: number;
}

interface Props {
  card: MapCardState | null;
  game: GameState | null;
  setupMode: boolean;
  hubChoice: HubId | null;
  companyName: string;
  sectorName: string | null;
  onClose: () => void;
  onAttend: (eventId: string) => void;
  onMoveOffice: (hubId: HubId) => void;
  onSelectHub: (hubId: HubId) => void;
  onOpenTarget: (target: HitTarget, x: number, y: number) => void;
}

function cardPosition(x: number, y: number, w: number, h: number) {
  const pad = 12;
  const cardW = 280;
  const cardH = 220;
  const left = Math.min(Math.max(pad, x - cardW / 2), w - cardW - pad);
  let top = Math.min(Math.max(pad, y - cardH - 16), h - cardH - pad);
  if (top < pad) top = Math.min(y + 16, h - cardH - pad);
  return { left, top, width: cardW };
}

export function MapCards({
  card,
  game,
  setupMode,
  hubChoice,
  companyName,
  sectorName,
  onClose,
  onAttend,
  onMoveOffice,
  onSelectHub,
  onOpenTarget,
}: Props) {
  if (!card) return null;

  const container = typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight } : { w: 390, h: 844 };
  const pos = cardPosition(card.x, card.y, container.w * 0.65, container.h * 0.45);

  const panel = (
    <div
      className="pointer-events-auto absolute z-20 rounded-xl border border-white/15 bg-[#0d1029]/95 p-3.5 shadow-2xl backdrop-blur"
      style={{ left: pos.left, top: pos.top, width: pos.width }}
      onClick={(e) => e.stopPropagation()}
    >
      {card.target.type === 'hub' && (
        <HubCard
          hubId={card.target.hubId}
          game={game}
          setupMode={setupMode}
          hubChoice={hubChoice}
          onClose={onClose}
          onMoveOffice={onMoveOffice}
          onSelectHub={onSelectHub}
          onOpenTarget={onOpenTarget}
          anchorX={card.x}
          anchorY={card.y}
        />
      )}
      {card.target.type === 'player' && game && (
        <EntityCard
          title={game.companyName}
          subtitle={`${sectorById(game.sectorId).name} · ${STAGES[game.stageIndex].name}`}
          detail={`HQ ${hubById(game.hubId).name}`}
          onClose={onClose}
        />
      )}
      {card.target.type === 'rival' && game && (
        <RivalCard rivalId={card.target.rivalId} game={game} onClose={onClose} />
      )}
      {card.target.type === 'event' && game && (
        <EventCard
          eventId={card.target.eventId}
          game={game}
          onClose={onClose}
          onConfirm={() => {
            onAttend(card.target.type === 'event' ? card.target.eventId : '');
            onClose();
          }}
        />
      )}
      {card.target.type === 'player' && setupMode && (
        <EntityCard
          title={companyName || 'Your startup'}
          subtitle={sectorName ?? 'Pick a sector'}
          detail="Choose an HQ cluster on the map."
          onClose={onClose}
        />
      )}
    </div>
  );

  return (
    <>
      <button
        type="button"
        className="absolute inset-0 z-10 cursor-default"
        aria-label="Dismiss map card"
        onClick={onClose}
      />
      {panel}
    </>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
    >
      ✕
    </button>
  );
}

function EntityCard({
  title,
  subtitle,
  detail,
  onClose,
}: {
  title: string;
  subtitle: string;
  detail: string;
  onClose: () => void;
}) {
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black text-white">{title}</p>
          <p className="text-xs text-slate-400">{subtitle}</p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-300">{detail}</p>
    </div>
  );
}

function RivalCard({
  rivalId,
  game,
  onClose,
}: {
  rivalId: string;
  game: GameState;
  onClose: () => void;
}) {
  const rival = game.rivals.find((r) => r.id === rivalId);
  if (!rival) return null;
  return (
    <EntityCard
      title={rival.name}
      subtitle={`${sectorById(rival.sectorId).name} rival · ${STAGES[rival.stageIndex].name}`}
      detail={`HQ ${hubById(rival.hubId).name}. Keep shipping.`}
      onClose={onClose}
    />
  );
}

function EventCard({
  eventId,
  game,
  onClose,
  onConfirm,
}: {
  eventId: string;
  game: GameState;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const ev = game.eventsThisWeek.find((e) => e.id === eventId);
  if (!ev || ev.attended) return null;
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-black tracking-wider text-sky-300">EVENT</p>
          <p className="text-sm font-black text-white">{ev.name}</p>
          <p className="text-xs text-slate-400">{hubById(ev.hubId).name}</p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <p className="mt-2 text-xs text-slate-300">Costs 1 focus. Confirm to attend.</p>
      <button
        type="button"
        onClick={onConfirm}
        className="mt-3 w-full rounded-lg border border-sky-300/40 bg-sky-300/10 px-3 py-2 text-sm font-black text-white hover:bg-sky-300/20"
      >
        Attend event
      </button>
    </div>
  );
}

function HubCard({
  hubId,
  game,
  setupMode,
  hubChoice,
  onClose,
  onMoveOffice,
  onSelectHub,
  onOpenTarget,
  anchorX,
  anchorY,
}: {
  hubId: HubId;
  game: GameState | null;
  setupMode: boolean;
  hubChoice: HubId | null;
  onClose: () => void;
  onMoveOffice: (hubId: HubId) => void;
  onSelectHub: (hubId: HubId) => void;
  onOpenTarget: (target: HitTarget, x: number, y: number) => void;
  anchorX: number;
  anchorY: number;
}) {
  const hub = hubById(hubId);
  const rivals = game?.rivals.filter((r) => r.alive && r.hubId === hubId) ?? [];
  const events = game?.eventsThisWeek.filter((e) => !e.attended && e.hubId === hubId) ?? [];
  const synergy = hub.synergySector ? sectorById(hub.synergySector).name : null;

  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black text-white">{hub.name}</p>
          <p className="text-xs text-slate-400">
            £{hub.rent.toLocaleString()}/wk
            {synergy ? ` · ${synergy} synergy` : ''}
          </p>
        </div>
        <CloseButton onClose={onClose} />
      </div>
      <p className="mt-2 text-xs leading-relaxed text-slate-300">{hub.blurb}</p>

      {(rivals.length > 0 || events.length > 0) && (
        <ul className="mt-3 flex flex-col gap-1">
          {rivals.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-white/[0.07]"
                onClick={() =>
                  onOpenTarget({ type: 'rival', rivalId: r.id }, anchorX, anchorY)
                }
              >
                {r.name} · {sectorById(r.sectorId).name}
              </button>
            </li>
          ))}
          {events.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className="w-full rounded-lg border border-sky-300/20 bg-sky-300/5 px-2.5 py-1.5 text-left text-xs text-slate-200 hover:bg-sky-300/10"
                onClick={() =>
                  onOpenTarget({ type: 'event', eventId: e.id }, anchorX, anchorY)
                }
              >
                ★ {e.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      {setupMode ? (
        <button
          type="button"
          onClick={() => {
            onSelectHub(hubId);
            onClose();
          }}
          className={`mt-3 w-full rounded-lg border px-3 py-2 text-sm font-black ${
            hubChoice === hubId
              ? 'border-amber-300/50 bg-amber-300/15 text-amber-100'
              : 'border-white/15 bg-white/[0.05] text-white hover:bg-white/10'
          }`}
        >
          {hubChoice === hubId ? 'Selected HQ' : 'Choose this HQ'}
        </button>
      ) : (
        game &&
        game.hubId !== hubId && (
          <button
            type="button"
            onClick={() => {
              onMoveOffice(hubId);
              onClose();
            }}
            className="mt-3 w-full rounded-lg border border-white/15 bg-white/[0.05] px-3 py-2 text-sm font-black text-white hover:bg-white/10"
          >
            Move office here
          </button>
        )
      )}
    </div>
  );
}

export function hitTooltip(target: HitTarget, game: GameState | null, companyName: string): string {
  if (target.type === 'hub') return hubById(target.hubId).name;
  if (target.type === 'player') return companyName || 'Your startup';
  if (target.type === 'rival' && game) {
    const r = game.rivals.find((x) => x.id === target.rivalId);
    return r?.name ?? 'Rival';
  }
  if (target.type === 'event' && game) {
    const e = game.eventsThisWeek.find((x) => x.id === target.eventId);
    return e?.name ?? 'Event';
  }
  return '';
}
