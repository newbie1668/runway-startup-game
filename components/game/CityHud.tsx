'use client';

/**
 * SFSIM-style glass HUD on the 3D city: clock, baked London climate,
 * and an offline search of landmarks / neighbourhoods / hubs / parks.
 * Does not call weather APIs. Game picks and info cards stay on the overlay canvas.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtMoney } from '@/lib/game/format';
import { londonClimate, londonClock, searchPlaces, type PlaceHit } from '@/lib/game/mapSearch';
import { STAGES } from '@/lib/game/content';
import type { GameState } from '@/lib/game/types';

const GLASS =
  'border border-white/55 bg-white/45 text-slate-800 shadow-lg shadow-slate-900/10 backdrop-blur-xl';

const KIND_LABEL: Record<PlaceHit['kind'], string> = {
  landmark: 'Landmark',
  neighbourhood: 'Neighbourhood',
  hub: 'Neighbourhood',
  park: 'Park',
};

interface Props {
  hide: boolean;
  screen: 'title' | 'setup' | 'play';
  game: GameState | null;
  onFlyTo: (x: number, y: number, viewH: number) => void;
}

export function CityHud({ hide, screen, game, onFlyTo }: Props) {
  const [now, setNow] = useState(() => new Date());
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || !boxRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const clock = useMemo(() => londonClock(now), [now]);
  const climate = useMemo(() => londonClimate(now), [now]);
  const hits = useMemo(() => searchPlaces(query, 8), [query]);

  const fly = useCallback(
    (hit: PlaceHit) => {
      onFlyTo(hit.x, hit.y, hit.viewH);
      setQuery(hit.label);
      setOpen(false);
    },
    [onFlyTo],
  );

  if (hide) return null;

  const aqiTone =
    climate.aqi <= 50 ? 'bg-emerald-400/90 text-emerald-950' : 'bg-amber-300/90 text-amber-950';

  return (
    <>
      <aside
        className={`pointer-events-none absolute top-3 left-3 z-30 hidden w-52 rounded-2xl px-3.5 py-3 md:block ${GLASS}`}
        data-city-hud="pane"
      >
        <p className="text-[13px] font-semibold tracking-wide text-slate-800">
          {clock.time}{' '}
          <span className="font-medium text-slate-600">
            {clock.weekday} · {clock.month} {clock.day}
          </span>
        </p>
        <dl className="mt-2 space-y-0.5 text-[11px] text-slate-600">
          <div className="flex justify-between gap-2">
            <dt>Sunset</dt>
            <dd className="font-medium text-slate-800">{climate.sunset}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Air</dt>
            <dd className="font-medium text-slate-800">
              {climate.tempC}° {climate.cond}
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Wind</dt>
            <dd className="font-medium text-slate-800">{climate.wind}</dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt>AQI</dt>
            <dd>
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${aqiTone}`}>
                {climate.aqi}
              </span>
            </dd>
          </div>
        </dl>
        {screen === 'play' && game && (
          <p className="mt-2.5 border-t border-slate-400/25 pt-2 text-[11px] font-semibold text-slate-700">
            Week {game.week}
            <span className="mx-1 text-slate-400">·</span>
            {STAGES[game.stageIndex].name}
            {game.valuation > 0 && (
              <>
                <span className="mx-1 text-slate-400">·</span>
                {fmtMoney(game.valuation)}
              </>
            )}
          </p>
        )}
        <p className="mt-2 text-[9px] font-black tracking-[0.28em] text-slate-500">RUNWAY</p>
      </aside>

      <div
        ref={boxRef}
        className={`pointer-events-none absolute top-3 right-14 left-14 z-30 mx-auto max-w-xl md:right-auto md:left-1/2 md:-translate-x-1/2 ${
          screen === 'play'
            ? 'md:w-[min(36rem,calc(100%-52rem))]'
            : 'md:w-[min(42rem,calc(100%-22rem))]'
        }`}
        data-city-hud="search"
      >
        <label className="sr-only" htmlFor="city-search">
          Search buildings, streets, parks, neighbourhoods
        </label>
        <input
          id="city-search"
          type="search"
          autoComplete="off"
          placeholder="Search buildings, streets, parks, neighbourhoods"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false);
              if (e.target instanceof HTMLInputElement) e.target.blur();
            }
            if (e.key === 'Enter' && hits[0]) {
              e.preventDefault();
              fly(hits[0]);
            }
          }}
          className={`pointer-events-auto h-10 w-full rounded-full px-4 text-[13px] font-medium text-slate-800 outline-none placeholder:text-slate-500 ${GLASS}`}
        />
        {open && query.trim() && (
          <ul
            className={`pointer-events-auto mt-1.5 max-h-64 overflow-auto rounded-2xl py-1 ${GLASS}`}
            role="listbox"
            aria-label="Search results"
          >
            {hits.length === 0 && (
              <li className="px-3.5 py-2 text-[12px] text-slate-500">No places in this map</li>
            )}
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between gap-3 px-3.5 py-1.5 text-left text-[13px] hover:bg-white/50"
                  onClick={() => fly(hit)}
                >
                  <span className="font-semibold text-slate-800">{hit.label}</span>
                  <span className="text-[10px] font-medium tracking-wide text-slate-500 uppercase">
                    {KIND_LABEL[hit.kind]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
