import { METERS_PER_LEVEL } from './constants';

const DEFAULT_HEIGHTS: Record<string, number> = {
  house: 7.4,
  detached: 7.6,
  semidetached: 7.4,
  terrace: 8.2,
  bungalow: 4.2,
  residential: 11,
  apartments: 16,
  flats: 16,
  dormitory: 14,
  commercial: 12,
  office: 28,
  retail: 8.5,
  supermarket: 8,
  industrial: 10,
  warehouse: 11,
  church: 16,
  cathedral: 42,
  chapel: 10,
  civic: 14,
  public: 13,
  government: 16,
  hospital: 18,
  school: 10,
  university: 14,
  college: 12,
  garage: 3.4,
  garages: 3.4,
  shed: 2.6,
  roof: 3.2,
  carport: 3,
  kiosk: 3,
  hut: 3,
  cabin: 3.5,
  greenhouse: 4,
  construction: 8,
  service: 5,
  hotel: 22,
  train_station: 16,
  transportation: 12,
  stadium: 18,
  sports_hall: 10,
  yes: 10,
};

const LANDMARK_OVERRIDES: { match: string; height: number }[] = [
  { match: 'the shard', height: 309.6 },
  { match: 'shard london', height: 309.6 },
  { match: '22 bishopsgate', height: 278 },
  { match: 'one canada square', height: 235 },
  { match: '1 canada square', height: 235 },
  { match: 'landmark pinnacle', height: 233 },
  { match: 'heron tower', height: 230 },
  { match: 'salesforce tower', height: 230 },
  { match: '110 bishopsgate', height: 230 },
  { match: 'leadenhall building', height: 225 },
  { match: 'the cheesegrater', height: 225 },
  { match: '122 leadenhall', height: 225 },
  { match: 'newfoundland', height: 220 },
  { match: 'one park drive', height: 204.8 },
  { match: '8 canada square', height: 200 },
  { match: '25 canada square', height: 200 },
  { match: 'citigroup centre', height: 200 },
  { match: 'hsbc tower', height: 200 },
  { match: 'one canada', height: 235 },
  { match: '30 st mary axe', height: 180 },
  { match: 'the gherkin', height: 180 },
  { match: 'tower 42', height: 183 },
  { match: 'natwest tower', height: 183 },
  { match: '20 fenchurch street', height: 160 },
  { match: 'walkie talkie', height: 160 },
  { match: 'bt tower', height: 177 },
  { match: "st paul's cathedral", height: 111 },
  { match: 'st pauls cathedral', height: 111 },
  { match: "st. paul's cathedral", height: 111 },
  { match: 'palace of westminster', height: 96 },
  { match: 'houses of parliament', height: 96 },
  { match: 'elizabeth tower', height: 96 },
  { match: 'victoria tower', height: 98.5 },
  { match: 'tate modern', height: 66 },
  { match: 'battersea power station', height: 50 },
];

export interface HeightInput {
  height?: string | number | null;
  levels?: string | number | null;
  minHeight?: string | number | null;
  minLevel?: string | number | null;
  building?: string | null;
  name?: string | null;
}

export interface ResolvedHeight {
  height: number;
  minHeight: number;
  levels: number | null;
  source: 'height' | 'levels' | 'estimate' | 'landmark';
}

export function parseMeters(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : null;
  const cleaned = raw.trim().toLowerCase().replace(/,/g, '');
  const match = cleaned.match(/^(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  if (cleaned.includes('ft') || cleaned.includes('feet')) return value * 0.3048;
  return value;
}

export function parseLevels(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = typeof raw === 'number' ? raw : Number.parseFloat(String(raw));
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function landmarkOverride(name: string | null | undefined): number | null {
  if (!name) return null;
  const key = name.trim().toLowerCase();
  for (const row of LANDMARK_OVERRIDES) {
    if (key === row.match) return row.height;
    const idx = key.indexOf(row.match);
    if (idx === -1) continue;
    const rest = (key.slice(0, idx) + key.slice(idx + row.match.length)).trim();
    if (rest === '' || rest === 'tower' || rest === 'building' || rest === 'the') return row.height;
  }
  return null;
}

export function resolveHeight(input: HeightInput): ResolvedHeight {
  const levels = parseLevels(input.levels);
  const minLevel = parseLevels(input.minLevel) ?? 0;
  const tagged = parseMeters(input.height);
  const minTagged = parseMeters(input.minHeight) ?? (minLevel > 0 ? minLevel * METERS_PER_LEVEL : 0);
  const landmark = landmarkOverride(input.name);
  const building = (input.building ?? 'yes').toLowerCase();
  const estimated = DEFAULT_HEIGHTS[building] ?? DEFAULT_HEIGHTS.yes;

  if (landmark !== null && (tagged === null || tagged + 1 < landmark * 0.7)) {
    return { height: landmark, minHeight: minTagged, levels, source: 'landmark' };
  }
  if (tagged !== null) {
    return { height: Math.max(tagged, minTagged + 3), minHeight: minTagged, levels, source: 'height' };
  }
  if (levels !== null) {
    const height = Math.max(levels * METERS_PER_LEVEL, minTagged + 3);
    return { height, minHeight: minTagged, levels, source: 'levels' };
  }
  return {
    height: Math.max(estimated, minTagged + 3),
    minHeight: minTagged,
    levels,
    source: 'estimate',
  };
}
