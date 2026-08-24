/**
 * Atlas-style stage bands for pins and the HUD legend.
 * Game stages still display in full on cards and in the week chip.
 */

export type StageBand = 'Early' | 'Late' | 'Public';

const BAND_COLOR: Record<StageBand, string> = {
  Early: '#16a34a',
  Late: '#2563eb',
  Public: '#ea580c',
};

export function stageBandFromName(name: string): { label: string; color: string } {
  const n = name.toLowerCase();
  if (!name || n === 'hub' || n === 'hq') return { label: name || 'Hub', color: '#64748b' };
  if (n === 'event') return { label: 'Event', color: '#0ea5e9' };
  if (n === 'done' || n === 'rip') return { label: name, color: '#64748b' };
  if (n.includes('series c') || n.includes('unicorn') || n.includes('public')) {
    return { label: 'Public', color: BAND_COLOR.Public };
  }
  if (n.includes('series')) return { label: 'Late', color: BAND_COLOR.Late };
  return { label: 'Early', color: BAND_COLOR.Early };
}

export const STAGE_LEGEND: readonly { label: StageBand; color: string }[] = [
  { label: 'Early', color: BAND_COLOR.Early },
  { label: 'Late', color: BAND_COLOR.Late },
  { label: 'Public', color: BAND_COLOR.Public },
];
