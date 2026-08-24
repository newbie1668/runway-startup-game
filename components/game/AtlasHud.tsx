'use client';

/**
 * Atlas-style glass HUD over the 3D London board.
 * Numbered cluster rail, search, minimap, and a selected-pin card.
 * Camera flight and pin picking stay in GameApp; this is chrome only.
 */

import { useEffect, useMemo, useRef } from 'react';
import { HUBS, hubById, sectorById } from '@/lib/game/content';
import { LAND_NORTH, LAND_SOUTH, PARKS, THAMES, WORLD, centerWorld, project } from '@/lib/game/geo';
import { STAGE_LEGEND, stageBandFromName } from '@/lib/game/stageBand';
import type { HitTarget, Scene } from '@/lib/game/render';
import type { GameState, HubId } from '@/lib/game/types';

export type ClusterId = HubId | 'all';

const CLUSTERS: readonly { id: ClusterId; name: string; blurb: string }[] = [
  {
    id: 'all',
    name: 'The Whole Board',
    blurb: 'Central London, Thames S-bend, eight startup hubs.',
  },
  ...HUBS.map((hub) => ({
    id: hub.id as ClusterId,
    name: hub.name,
    blurb: hub.blurb,
  })),
];

export const CLUSTER_ORDER: readonly ClusterId[] = CLUSTERS.map((c) => c.id);

interface Props {
  screen: 'title' | 'setup' | 'play';
  scene: Scene;
  game: GameState | null;
  cluster: ClusterId;
  selected: HitTarget | null;
  searchOpen: boolean;
  onCluster: (id: ClusterId) => void;
  onSearchOpen: (open: boolean) => void;
  onPick: (hit: HitTarget) => void;
  onClear: () => void;
}

const glass =
  'rounded-2xl border border-white/70 bg-white/78 text-slate-800 shadow-[0_8px_28px_rgba(15,23,42,0.12)] backdrop-blur-xl';

export function AtlasHud({
  screen,
  scene,
  game,
  cluster,
  selected,
  searchOpen,
  onCluster,
  onSearchOpen,
  onPick,
  onClear,
}: Props) {
  const play = screen === 'play';
  const active = CLUSTERS.find((c) => c.id === cluster) ?? CLUSTERS[0];
  const card = describePin(selected, scene, game);
  const pinCount = 8 + scene.rivals.filter((r) => r.alive).length + scene.events.length;

  if (!play) return null;

  return (
    <>
      <div
        className={`pointer-events-none absolute left-3 z-10 hidden w-[17.5rem] flex-col gap-2 md:flex ${
          play ? 'top-16 bottom-3' : 'top-3 bottom-28'
        }`}
      >
        <aside className={`${glass} pointer-events-auto flex min-h-0 flex-col overflow-hidden p-3`}>
          <div className="border-b border-slate-200/80 pb-3">
            <p className="text-[11px] font-bold tracking-[0.18em] text-sky-700">LONDON</p>
            <h2 className="text-lg font-black tracking-tight text-slate-900">RUNWAY Atlas</h2>
            <p className="text-[11px] font-medium text-slate-500">
              {pinCount} pins · 8 hubs · Thames
            </p>
          </div>
          <nav className="mt-2 min-h-0 flex-1 overflow-y-auto" aria-label="Neighbourhoods">
            {CLUSTERS.map((item, i) => {
              const on = item.id === cluster;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onCluster(item.id)}
                  className={`grid w-full grid-cols-[1.6rem_1fr] items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[13px] transition ${
                    on ? 'bg-sky-100 text-slate-900' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span
                    className={`font-mono text-[11px] ${on ? 'text-sky-700' : 'text-slate-400'}`}
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="truncate font-semibold">{item.name}</span>
                </button>
              );
            })}
          </nav>
          <p className="mt-1 px-2 pb-2 text-[11px] leading-snug text-slate-500">{active.blurb}</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-200/80 pt-2 text-[11px] font-medium text-slate-600">
            {STAGE_LEGEND.map((item) => (
              <span key={item.label} className="inline-flex items-center gap-1.5">
                <i
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: item.color }}
                />
                {item.label}
              </span>
            ))}
          </div>
        </aside>

        {card && (
          <article className={`${glass} pointer-events-auto p-3`}>
            <div className="flex items-start gap-2.5">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-black text-white"
                style={{ background: card.accent }}
              >
                {card.mark}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="truncate text-[15px] font-black text-slate-900">{card.title}</h3>
                  <button
                    type="button"
                    onClick={onClear}
                    className="text-[11px] font-semibold text-slate-400 hover:text-slate-700"
                    aria-label="Close pin card"
                  >
                    esc
                  </button>
                </div>
                <p className="text-[11px] font-semibold text-sky-700">{card.kicker}</p>
              </div>
            </div>
            <p className="mt-2 text-[12.5px] leading-snug text-slate-600">{card.body}</p>
            <p className="mt-2 text-[11px] font-medium text-slate-500">{card.meta}</p>
          </article>
        )}

        <p className={`${glass} px-3 py-2 text-[11px] leading-snug font-medium text-slate-600`}>
          <span className="font-bold text-slate-800">How to explore</span>
          <br />
          ↑↓ neighbourhoods · ⌘K search · click a pin
          <br />
          drag to orbit · scroll to zoom
          <br />B G H P T I · N next week · 1–3 events
        </p>
      </div>

      <div className="pointer-events-none absolute top-3 right-14 z-30 hidden md:block">
        <button
          type="button"
          onClick={() => onSearchOpen(!searchOpen)}
          className={`${glass} pointer-events-auto flex items-center gap-8 px-3 py-2 text-[13px] font-semibold text-slate-500`}
        >
          Search
          <kbd className="rounded-md border border-slate-200 bg-white/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
            ⌘K
          </kbd>
        </button>
      </div>

      {searchOpen && (
        <SearchPanel
          scene={scene}
          game={game}
          onPick={onPick}
          onClose={() => onSearchOpen(false)}
        />
      )}

      <MiniMap cluster={cluster} selected={selected} onCluster={onCluster} />
    </>
  );
}

interface CardCopy {
  title: string;
  kicker: string;
  body: string;
  meta: string;
  accent: string;
  mark: string;
}

function describePin(hit: HitTarget | null, scene: Scene, game: GameState | null): CardCopy | null {
  if (!hit) return null;
  if (hit.type === 'hub') {
    const hub = hubById(hit.hubId);
    const isHq = scene.playerHubId === hub.id && Boolean(scene.companyName);
    if (isHq) {
      const sector = scene.playerSectorId ? sectorById(scene.playerSectorId) : null;
      const band = stageBandFromName(scene.stageName);
      return {
        title: scene.companyName,
        kicker: sector ? `${sector.emoji} ${sector.name}` : 'Your company',
        body: `HQ in ${hub.name}. ${hub.blurb}`,
        meta: `${scene.stageName || band.label} · ${hub.areaLabel} · £${hub.rent.toLocaleString('en-GB')}/wk`,
        accent: band.color,
        mark: scene.companyName.slice(0, 1).toUpperCase(),
      };
    }
    return {
      title: hub.name,
      kicker: hub.areaLabel,
      body: hub.blurb,
      meta: `Neighbourhood · £${hub.rent.toLocaleString('en-GB')}/wk rent`,
      accent: '#0ea5e9',
      mark: hub.name.slice(0, 1),
    };
  }
  if (hit.type === 'rival') {
    const rival = scene.rivals.find((r) => r.id === hit.rivalId);
    if (!rival) return null;
    const sector = sectorById(rival.sectorId);
    const hub = hubById(rival.hubId);
    const band = stageBandFromName(rival.stageName);
    return {
      title: rival.name,
      kicker: `${sector.emoji} ${sector.name} rival`,
      body: rival.alive
        ? `Headquartered in ${hub.name}. Keep shipping — they are climbing the same ladder.`
        : `${rival.name} already folded.`,
      meta: `${rival.stageName} · HQ ${hub.name}`,
      accent: band.color,
      mark: rival.name.slice(0, 1).toUpperCase(),
    };
  }
  const ev = scene.events.find((e) => e.id === hit.eventId);
  const live = game?.eventsThisWeek.find((e) => e.id === hit.eventId);
  if (!ev) return null;
  const hub = hubById(ev.hubId);
  return {
    title: ev.name.replace(/^★ /, ''),
    kicker: live?.venue ?? 'This week',
    body: ev.attended
      ? 'You already worked this room.'
      : `Happening in ${hub.name}. Click the pin to attend.`,
    meta: `${ev.attended ? 'Done' : 'Event'} · ${hub.name}`,
    accent: ev.attended ? '#64748b' : '#0ea5e9',
    mark: '★',
  };
}

function SearchPanel({
  scene,
  game,
  onPick,
  onClose,
}: {
  scene: Scene;
  game: GameState | null;
  onPick: (hit: HitTarget) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const items = useMemo(() => buildSearchIndex(scene, game), [scene, game]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-start justify-center p-16">
      <div
        className={`${glass} pointer-events-auto w-full max-w-md overflow-hidden`}
        role="dialog"
        aria-label="Search the board"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3">
          <input
            ref={inputRef}
            placeholder="Search hubs, companies, events…"
            className="w-full bg-transparent py-3 text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
            onChange={(e) => {
              const q = e.target.value.trim().toLowerCase();
              const ul = listRef.current;
              if (!ul) return;
              for (const li of Array.from(ul.children)) {
                const el = li as HTMLElement;
                el.hidden = q.length > 0 && !el.dataset.haystack?.includes(q);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
          />
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] font-semibold text-slate-400 hover:text-slate-700"
          >
            esc
          </button>
        </div>
        <ul ref={listRef} className="max-h-72 overflow-y-auto p-1.5">
          {items.map((item) => (
            <li key={item.key} data-haystack={item.haystack}>
              <button
                type="button"
                onClick={() => onPick(item.hit)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-sky-50"
              >
                <span className="font-semibold text-slate-800">{item.title}</span>
                <span className="text-[11px] font-medium text-slate-500">{item.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function buildSearchIndex(scene: Scene, game: GameState | null) {
  const items: { key: string; title: string; hint: string; haystack: string; hit: HitTarget }[] =
    [];
  if (scene.companyName && scene.playerHubId) {
    items.push({
      key: 'player',
      title: scene.companyName,
      hint: scene.stageName || 'HQ',
      haystack: `${scene.companyName} ${scene.stageName} hq`.toLowerCase(),
      hit: { type: 'hub', hubId: scene.playerHubId },
    });
  }
  for (const hub of HUBS) {
    items.push({
      key: hub.id,
      title: hub.name,
      hint: 'Hub',
      haystack: `${hub.name} ${hub.areaLabel} ${hub.blurb}`.toLowerCase(),
      hit: { type: 'hub', hubId: hub.id },
    });
  }
  for (const rival of scene.rivals) {
    if (!rival.alive) continue;
    items.push({
      key: rival.id,
      title: rival.name,
      hint: rival.stageName,
      haystack: `${rival.name} ${rival.stageName}`.toLowerCase(),
      hit: { type: 'rival', rivalId: rival.id },
    });
  }
  for (const ev of scene.events) {
    const live = game?.eventsThisWeek.find((e) => e.id === ev.id);
    items.push({
      key: ev.id,
      title: ev.name.replace(/^★ /, ''),
      hint: live?.venue ?? 'Event',
      haystack: `${ev.name} ${live?.venue ?? ''}`.toLowerCase(),
      hit: { type: 'event', eventId: ev.id },
    });
  }
  return items;
}

function MiniMap({
  cluster,
  selected,
  onCluster,
}: {
  cluster: ClusterId;
  selected: HitTarget | null;
  onCluster: (id: ClusterId) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedHub =
    selected?.type === 'hub' ? selected.hubId : cluster === 'all' ? null : cluster;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = 148;
    const h = 148;
    canvas.width = w * 2;
    canvas.height = h * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#e8e2d4';
    ctx.fillRect(0, 0, w, h);

    const s = Math.min((w - 18) / WORLD.width, (h - 18) / WORLD.height);
    const to = (lng: number, lat: number) => {
      const c = centerWorld(project([lng, lat]));
      return [w / 2 + c.x * s, h / 2 + c.z * s] as const;
    };

    const ring = (pts: readonly (readonly [number, number])[]) => {
      ctx.beginPath();
      pts.forEach((ll, i) => {
        const [x, y] = to(ll[0], ll[1]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    };

    ctx.fillStyle = '#efeae0';
    ring(LAND_NORTH);
    ctx.fill();
    ring(LAND_SOUTH);
    ctx.fill();

    ctx.fillStyle = '#6ea35a';
    for (const park of PARKS) {
      ring(park.points);
      ctx.fill();
    }

    ctx.strokeStyle = '#4a9ec8';
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    THAMES.forEach((ll, i) => {
      const [x, y] = to(ll[0], ll[1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    for (const hub of HUBS) {
      const [x, y] = to(hub.lng, hub.lat);
      const on = selectedHub === hub.id;
      ctx.fillStyle = on ? '#1d4ed8' : '#e11d48';
      ctx.beginPath();
      ctx.arc(x, y, on ? 3.4 : 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [selectedHub]);

  return (
    <div className="pointer-events-none absolute right-3 bottom-3 z-10 hidden md:block">
      <canvas
        ref={canvasRef}
        width={148}
        height={148}
        aria-label="London minimap"
        className={`${glass} pointer-events-auto h-[148px] w-[148px] cursor-pointer p-1`}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * 148;
          const py = ((e.clientY - rect.top) / rect.height) * 148;
          const s = Math.min((148 - 18) / WORLD.width, (148 - 18) / WORLD.height);
          let best: { id: HubId; d: number } | null = null;
          for (const hub of HUBS) {
            const c = centerWorld(project([hub.lng, hub.lat]));
            const x = 74 + c.x * s;
            const y = 74 + c.z * s;
            const d = (x - px) ** 2 + (y - py) ** 2;
            if (!best || d < best.d) best = { id: hub.id, d };
          }
          if (best && best.d < 140) onCluster(best.id);
          else onCluster('all');
        }}
      />
    </div>
  );
}
