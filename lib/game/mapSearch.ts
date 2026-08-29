/**
 * Offline place catalog + baked London climate for the SFSIM glass HUD.
 * Same-origin data only — no weather APIs, no Exa, no Wikipedia at play time.
 */

import {
  AREA_LABELS,
  LANDMARKS,
  PARKS,
  THAMES_CROSSINGS,
  project,
  thamesCrossingLookKey,
} from './geo';
import { HUBS } from './content';

export type PlaceKind = 'landmark' | 'neighbourhood' | 'hub' | 'park';

export interface PlaceHit {
  id: string;
  label: string;
  kind: PlaceKind;
  x: number;
  y: number;
  /** World-unit vertical framing (cssH / viewH → zoom), matching ?look= cameras. */
  viewH: number;
}

const LANDMARK_VIEW_H: Record<string, number> = {
  towerbridge: 2.15,
  eye: 3.15,
  hungerford: 2.6,
  buckingham: 2.4,
  canadasq: 4.4,
  gherkin: 2.65,
  shard: 2.65,
  walkie: 2.8,
  grater: 2.8,
  bishop: 2.8,
  heron: 2.8,
  tower42: 2.8,
  stpauls: 2.35,
  bigben: 2.8,
  abbey: 2.8,
  towerlondon: 1.55,
  battersea: 2.8,
  o2: 2.8,
  britishmuseum: 2.35,
  allsouls: 2.2,
  goodgest: 1.55,
  stcharles: 1.55,
  nationaltheatre: 2.5,
  tatemodern: 2.6,
  stpancras: 2.7,
  alberthall: 2.5,
};

function landmarkViewH(kind: string): number {
  if (LANDMARK_VIEW_H[kind] !== undefined) return LANDMARK_VIEW_H[kind]!;
  if (kind.endsWith('br') || kind === 'millennium') return 2.8;
  return 1.55;
}

let catalog: PlaceHit[] | null = null;

export function placeCatalog(): readonly PlaceHit[] {
  if (catalog) return catalog;
  const hits: PlaceHit[] = [];
  for (const hub of HUBS) {
    const p = project([hub.lng, hub.lat]);
    hits.push({
      id: `hub:${hub.id}`,
      label: hub.name,
      kind: 'hub',
      x: p.x,
      y: p.y,
      viewH: 8.5,
    });
  }
  for (const area of AREA_LABELS) {
    const p = project(area.at);
    hits.push({
      id: `area:${area.text}`,
      label: titleCase(area.text),
      kind: 'neighbourhood',
      x: p.x,
      y: p.y,
      viewH: 12,
    });
  }
  for (const park of PARKS) {
    const at = park.label ?? park.points[0]!;
    const p = project(at);
    hits.push({
      id: `park:${park.name}`,
      label: park.name,
      kind: 'park',
      x: p.x,
      y: p.y,
      viewH: 6.5,
    });
  }
  for (const landmark of LANDMARKS) {
    const p = project(landmark.at);
    hits.push({
      id: `lm:${landmark.kind}`,
      label: landmark.name,
      kind: 'landmark',
      x: p.x,
      y: p.y,
      viewH: landmarkViewH(landmark.kind),
    });
  }
  for (const crossing of THAMES_CROSSINGS) {
    const p = project(crossing.at);
    hits.push({
      id: `lm:${thamesCrossingLookKey(crossing.name)}`,
      label: crossing.name,
      kind: 'landmark',
      x: p.x,
      y: p.y,
      viewH: 1.35,
    });
  }
  catalog = hits;
  return catalog;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function searchPlaces(query: string, limit = 8): PlaceHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const ranked: { hit: PlaceHit; score: number }[] = [];
  for (const hit of placeCatalog()) {
    const name = hit.label.toLowerCase();
    let score = 0;
    if (name === q) score = 100;
    else if (name.startsWith(q)) score = 80;
    else if (name.includes(q)) score = 50;
    else if (hit.kind.startsWith(q)) score = 20;
    if (score > 0) ranked.push({ hit, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.hit.label.localeCompare(b.hit.label));
  return ranked.slice(0, limit).map((r) => r.hit);
}

export interface LondonClimate {
  sunset: string;
  tempC: number;
  cond: string;
  wind: string;
  aqi: number;
}

/** Typical central-London month, not a live feed. */
const MONTH_CLIMATE: readonly LondonClimate[] = [
  { sunset: '16:18', tempC: 7, cond: 'Overcast', wind: '10 mph SW', aqi: 38 },
  { sunset: '17:08', tempC: 7, cond: 'Overcast', wind: '9 mph W', aqi: 36 },
  { sunset: '18:02', tempC: 9, cond: 'Showers', wind: '11 mph W', aqi: 34 },
  { sunset: '19:52', tempC: 12, cond: 'Showers', wind: '9 mph SW', aqi: 32 },
  { sunset: '20:42', tempC: 15, cond: 'Clear', wind: '8 mph SW', aqi: 35 },
  { sunset: '21:18', tempC: 18, cond: 'Clear', wind: '8 mph W', aqi: 40 },
  { sunset: '21:08', tempC: 20, cond: 'Clear', wind: '7 mph SW', aqi: 44 },
  { sunset: '20:14', tempC: 19, cond: 'Overcast', wind: '8 mph W', aqi: 41 },
  { sunset: '18:58', tempC: 16, cond: 'Overcast', wind: '9 mph SW', aqi: 37 },
  { sunset: '17:46', tempC: 13, cond: 'Showers', wind: '10 mph SW', aqi: 36 },
  { sunset: '16:22', tempC: 9, cond: 'Overcast', wind: '10 mph W', aqi: 39 },
  { sunset: '15:54', tempC: 7, cond: 'Overcast', wind: '11 mph SW', aqi: 42 },
];

export function londonClimate(at: Date = new Date()): LondonClimate {
  const month = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', month: 'numeric' }).format(at),
  );
  return MONTH_CLIMATE[(month - 1 + 12) % 12]!;
}

export interface LondonClock {
  time: string;
  weekday: string;
  month: string;
  day: string;
}

export function londonClock(at: Date = new Date()): LondonClock {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const grab = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    time: grab('hour') + ':' + grab('minute'),
    weekday: grab('weekday').toUpperCase(),
    month: grab('month').toUpperCase(),
    day: grab('day'),
  };
}
