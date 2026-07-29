'use client';

/**
 * RUNWAY — new-game setup flow.
 * Step 1: name the company + pick a sector.
 * Step 2: click a neighbourhood on the live map to plant the HQ.
 */

import { HUBS, SECTORS, hubById } from '@/lib/game/content';
import type { Hub, HubId, SectorId } from '@/lib/game/types';
import { ModalDialog } from './ModalDialog';

export type SetupStep = 'identity' | 'hq';

interface Props {
  step: SetupStep;
  name: string;
  sectorId: SectorId | null;
  hubChoice: HubId | null;
  onName: (v: string) => void;
  onSector: (v: SectorId) => void;
  onHub: (v: HubId) => void;
  onRollName: () => void;
  onToHq: () => void;
  onBack: () => void;
  onConfirm: () => void;
}

function hubPerks(hub: Hub): string[] {
  const perks: string[] = [];
  if (hub.eventFrequencyMult >= 1.2) perks.push('Buzzing event scene');
  if (hub.hireQualityMult >= 1.2) perks.push('Brilliant hiring pool');
  if (hub.hypeMult >= 1.2) perks.push('The press drinks here');
  if (hub.rent <= 2300) perks.push('Gentle rent');
  if (hub.rent >= 3000) perks.push('Painful rent');
  if (hub.synergySector) {
    const s = SECTORS.find((x) => x.id === hub.synergySector)!;
    perks.push(`${s.emoji} ${s.name} scene: +10% build & growth`);
  }
  return perks;
}

export function SetupOverlay(props: Props) {
  if (props.step === 'identity') {
    return (
      <ModalDialog
        labelledBy="setup-title"
        dismissible
        onDismiss={props.onBack}
        panelClassName="w-full max-w-2xl p-4 sm:p-6"
      >
        <p className="text-xs font-bold tracking-[0.25em] text-[#166178]">STEP 1 OF 2</p>
        <h2 id="setup-title" className="mt-1 text-2xl font-black text-white">
          Incorporate your startup
        </h2>

        <label htmlFor="company-name" className="mt-5 block text-sm font-semibold text-slate-300">
          Company name
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="company-name"
            data-dialog-autofocus
            value={props.name}
            onChange={(e) => props.onName(e.target.value)}
            maxLength={24}
            placeholder="e.g. Magpieflow"
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-base font-semibold text-white placeholder-slate-500 outline-none focus:border-amber-300/70"
          />
          <button
            onClick={props.onRollName}
            title="Roll a random name"
            aria-label="Roll a random company name"
            className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-3.5 text-xl transition hover:bg-white/10 active:scale-95"
          >
            🎲
          </button>
        </div>

        <p className="mt-5 text-sm font-semibold text-slate-300">Pick your sector</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SECTORS.map((s) => {
            const active = props.sectorId === s.id;
            return (
              <button
                key={s.id}
                onClick={() => props.onSector(s.id)}
                aria-pressed={active}
                className={`rounded-xl border p-3 text-left transition active:scale-[0.99] ${
                  active
                    ? 'border-amber-300/80 bg-amber-300/10'
                    : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]'
                }`}
              >
                <p className="text-sm font-bold text-white">
                  {s.emoji} {s.name}
                </p>
                <p className="mt-0.5 text-xs leading-snug text-slate-400">{s.tagline}</p>
                <p className="mt-1.5 text-xs leading-snug text-[#236f47]">+ {s.perk}</p>
                <p className="text-xs leading-snug text-[#9b3545]">− {s.drawback}</p>
              </button>
            );
          })}
        </div>

        <button
          disabled={!props.name.trim() || !props.sectorId}
          onClick={props.onToHq}
          className="mt-5 w-full rounded-xl bg-amber-400 px-4 py-3 text-base font-black text-[#161003] transition enabled:hover:bg-amber-300 enabled:active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next — choose your neighbourhood →
        </button>
      </ModalDialog>
    );
  }

  // Step 2: HQ pick. The map underneath is interactive; we only overlay chrome.
  const hub = props.hubChoice ? hubById(props.hubChoice) : null;
  return (
    <div className="setup-hq-overlay pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-4">
      <div className="setup-hq-banner pointer-events-auto mx-auto mt-2 w-full max-w-md p-3">
        <p className="text-center text-sm font-bold">
          Step 2 — choose from the list or click a glowing neighbourhood
        </p>
        <label htmlFor="hq-select" className="sr-only">
          Neighbourhood for your headquarters
        </label>
        <select
          id="hq-select"
          value={props.hubChoice ?? ''}
          onChange={(event) => {
            if (event.target.value) props.onHub(event.target.value as HubId);
          }}
          className="mt-2 w-full rounded-lg border border-white/15 bg-[#111a34] px-3 py-2 text-sm font-semibold text-white outline-none focus:border-amber-300"
        >
          <option value="">Select a neighbourhood</option>
          {HUBS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} — £{option.rent.toLocaleString('en-GB')}/week
            </option>
          ))}
        </select>
      </div>

      <div className="mx-auto w-full max-w-xl">
        {hub ? (
          <div className="setup-hq-card pointer-events-auto p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-xl font-black text-white">{hub.name}</h3>
              <p className="text-sm font-bold text-amber-300">
                £{hub.rent.toLocaleString()}/wk rent
              </p>
            </div>
            <p className="mt-1 text-sm text-slate-300">{hub.blurb}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {hubPerks(hub).map((perk) => (
                <span
                  key={perk}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-xs font-semibold text-slate-200"
                >
                  {perk}
                </span>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={props.onBack}
                className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-slate-300 transition hover:bg-white/5"
              >
                ← Back
              </button>
              <button
                onClick={props.onConfirm}
                className="flex-1 rounded-xl bg-amber-400 px-4 py-2.5 text-base font-black text-[#161003] transition hover:bg-amber-300 active:scale-[0.99]"
              >
                Found {props.name.trim() || 'the company'} in {hub.name} 🚀
              </button>
            </div>
          </div>
        ) : (
          <div className="setup-hq-back pointer-events-auto mx-auto flex w-fit gap-2 px-4 py-2">
            <button
              onClick={props.onBack}
              className="text-sm font-bold text-slate-300 transition hover:text-white"
            >
              ← Back to company details
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
