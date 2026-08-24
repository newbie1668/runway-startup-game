'use client';

import { useCallback, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { OSM_ATTRIBUTION, SIM_HUBS } from '@/lib/sim/constants';
import type { Pickable } from '@/lib/sim/build-city';
import type { FlyRequest, SimHudState } from './SimCanvas';

const SimCanvas = dynamic(() => import('./SimCanvas').then((m) => m.SimCanvas), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#b4bcc4]" />,
});

export function SimApp() {
  const [query, setQuery] = useState('');
  const [flyTo, setFlyTo] = useState<FlyRequest>({ kind: 'overview' });
  const [flyGeneration, setFlyGeneration] = useState(0);
  const [hud, setHud] = useState<SimHudState>({
    loading: true,
    phase: 'Starting',
    ratio: 0,
    error: null,
    stats: null,
    pickables: [],
    selected: null,
    activeHub: 'overview',
  });
  const [selected, setSelected] = useState<Pickable | null>(null);

  const go = useCallback((next: FlyRequest) => {
    setFlyTo(next);
    setFlyGeneration((n) => n + 1);
    setHud((prev) => ({
      ...prev,
      activeHub: next.kind === 'hub' ? next.id : next.kind === 'overview' ? 'overview' : prev.activeHub,
    }));
  }, []);

  const onSearch = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const q = query.trim().toLowerCase();
      if (!q || q === 'london' || q === 'overview' || q === 'central london') {
        go({ kind: 'overview' });
        return;
      }
      const hub = SIM_HUBS.find((h) => h.name.toLowerCase().includes(q) || h.id.includes(q));
      if (hub) {
        go({ kind: 'hub', id: hub.id });
        return;
      }
      const named = hud.pickables.find((p) => p.name.toLowerCase().includes(q));
      if (named) {
        setSelected(named);
        go({ kind: 'point', x: named.x, z: named.z, height: named.height });
      }
    },
    [go, hud.pickables, query],
  );

  const status = useMemo(() => {
    if (hud.error) return hud.error;
    if (hud.loading) return hud.phase;
    if (!hud.stats) return 'Central London';
    return `${hud.stats.buildings.toLocaleString('en-GB')} buildings · ${hud.stats.roads.toLocaleString('en-GB')} streets`;
  }, [hud]);

  return (
    <div className="relative h-full min-h-dvh w-full overflow-hidden bg-[#b4bcc4] text-zinc-100">
      <SimCanvas flyTo={flyTo} flyGeneration={flyGeneration} onHud={setHud} onInspect={setSelected} />

      <div className="pointer-events-none absolute inset-0">
        <header className="flex justify-center px-4 pt-5">
          <form
            onSubmit={onSearch}
            className="pointer-events-auto flex w-full max-w-xl items-center gap-2 rounded-full border border-white/35 bg-white/18 px-4 py-2 shadow-[0_8px_40px_rgba(20,24,32,0.18)] backdrop-blur-md"
          >
            <span className="text-sm text-zinc-700" aria-hidden>
              ⌕
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search buildings, streets, parks, neighbourhoods"
              className="w-full bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-600"
              aria-label="Search central London"
            />
          </form>
        </header>

        <nav
          className="pointer-events-auto absolute top-20 left-4 flex max-w-[min(100%-2rem,46rem)] flex-wrap gap-1.5"
          aria-label="Neighbourhoods"
        >
          <HubChip
            label="London"
            active={hud.activeHub === 'overview'}
            onClick={() => go({ kind: 'overview' })}
          />
          {SIM_HUBS.map((hub) => (
            <HubChip
              key={hub.id}
              label={hub.name}
              active={hud.activeHub === hub.id}
              onClick={() => go({ kind: 'hub', id: hub.id })}
            />
          ))}
        </nav>

        <div className="pointer-events-none absolute right-4 bottom-4 left-4 flex items-end justify-between gap-4">
          <div className="max-w-md rounded-2xl border border-white/25 bg-black/25 px-3 py-2 text-xs text-white/90 backdrop-blur-md">
            <p className="text-[10px] tracking-[0.18em] text-white/60 uppercase">Map</p>
            <p>{status}</p>
            <p className="mt-1 text-white/70">Drag to orbit · scroll to zoom · {OSM_ATTRIBUTION}</p>
          </div>
          {selected ? (
            <div className="pointer-events-auto rounded-2xl border border-white/30 bg-white/18 px-3 py-2 text-sm text-zinc-900 backdrop-blur-md">
              <p className="text-[10px] tracking-[0.18em] text-zinc-600 uppercase">Footprint</p>
              <p className="font-medium">{selected.name}</p>
              <p className="text-xs text-zinc-700">
                {Math.round(selected.height)}m · {selected.building}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {hud.loading ? (
        <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center">
          <div className="w-[min(28rem,90vw)] rounded-full border border-white/40 bg-white/25 px-2 py-2 backdrop-blur-md">
            <div
              className="h-1.5 rounded-full bg-gradient-to-r from-violet-400 to-sky-400"
              style={{ width: `${Math.max(8, Math.round(hud.ratio * 100))}%` }}
              aria-hidden
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function HubChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] backdrop-blur-md ${
        active
          ? 'border-white/70 bg-white/80 text-zinc-900'
          : 'border-white/30 bg-white/16 text-zinc-800 hover:bg-white/30'
      }`}
    >
      {label}
    </button>
  );
}
