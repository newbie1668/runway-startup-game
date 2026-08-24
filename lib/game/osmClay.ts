/**
 * Scored central-London OSM extract (PR #23 simplified GeoJSON) → clay-board
 * footprints. This is fabric for the miniature, not /sim and not the 50MB dump.
 */

import type { CityBlock, LngLat } from './geo';

export interface OsmBuilding {
  ring: LngLat[];
  h: number;
  tone: CityBlock['tone'];
}

export interface OsmRoad {
  line: LngLat[];
  halfW: number;
  painted: boolean;
}

export interface OsmWater {
  ring: LngLat[];
}

export interface OsmClay {
  buildings: OsmBuilding[];
  roads: OsmRoad[];
  waters: OsmWater[];
}

const M_TO_CLAY = 0.058;
const SKIP_HERO =
  /shard|canada square|gherkin|st mary axe|30 st mary|st paul|st\. paul|walkie|20 fenchurch|cheesegrater|leadenhall building|battersea power/i;

type Props = Record<string, unknown>;

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function asRing(coords: unknown): LngLat[] | null {
  if (!Array.isArray(coords) || coords.length < 4) return null;
  const ring: LngLat[] = [];
  for (const pt of coords) {
    if (!Array.isArray(pt) || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') continue;
    const lng = pt[0];
    const lat = pt[1];
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const prev = ring[ring.length - 1];
    if (prev && prev[0] === lng && prev[1] === lat) continue;
    ring.push([lng, lat]);
  }
  if (ring.length < 3) return null;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return ring.length >= 4 ? ring : null;
}

function asLine(coords: unknown): LngLat[] | null {
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const line: LngLat[] = [];
  for (const pt of coords) {
    if (!Array.isArray(pt) || typeof pt[0] !== 'number' || typeof pt[1] !== 'number') continue;
    line.push([pt[0], pt[1]]);
  }
  return line.length >= 2 ? line : null;
}

function toneFor(building: string, h: number): CityBlock['tone'] {
  if (h >= 6.4) return 'glass';
  if (/(apartments|residential|house|terrace|yes)/.test(building) && h < 2.4) return 'brick';
  if (h >= 2.15) return 'stone';
  return 'fill';
}

export function parseOsmClay(input: unknown, reduced: boolean): OsmClay | null {
  if (!input || typeof input !== 'object') return null;
  const features = (input as { features?: unknown }).features;
  if (!Array.isArray(features) || features.length < 10) return null;

  const buildings: OsmBuilding[] = [];
  const roads: OsmRoad[] = [];
  const waters: OsmWater[] = [];
  const bSkip = reduced ? 2 : 1;
  const rSkip = reduced ? 2 : 1;
  let bi = 0;
  let ri = 0;

  for (const raw of features) {
    if (!raw || typeof raw !== 'object') continue;
    const feat = raw as { geometry?: { type?: string; coordinates?: unknown }; properties?: Props };
    const props = feat.properties ?? {};
    const layer = String(props.layer ?? '');
    const geom = feat.geometry;
    if (!geom) continue;

    if (layer === 'building' && geom.type === 'Polygon') {
      if (bi++ % bSkip !== 0) continue;
      const name = String(props.name ?? '');
      if (name && SKIP_HERO.test(name)) continue;
      const coords = geom.coordinates;
      const outer = Array.isArray(coords) ? coords[0] : null;
      const ring = asRing(outer);
      if (!ring) continue;
      const meters = typeof props.height === 'number' ? props.height : 10;
      const h = clamp(meters * M_TO_CLAY, 0.42, 17.2);
      const building = String(props.building ?? 'yes');
      buildings.push({ ring, h, tone: toneFor(building, h) });
      continue;
    }

    if (layer === 'road' && geom.type === 'LineString') {
      if (ri++ % rSkip !== 0) continue;
      const line = asLine(geom.coordinates);
      if (!line) continue;
      const highway = String(props.highway ?? '');
      const widthM = typeof props.width === 'number' ? props.width : 8;
      // Board-scale ribbons, not OSM metres: halfW 0.95 ≈ 22px at the city eye.
      // Hairlines (≤0.22) read as gaps between blocks and fail the whole-board camera.
      let halfW = clamp(widthM * 0.09, 0.95, 2.35);
      if (highway === 'pedestrian') halfW = Math.min(halfW, 0.82);
      roads.push({
        line,
        halfW,
        painted: highway === 'primary' || highway === 'trunk' || highway === 'secondary',
      });
      continue;
    }

    if (layer === 'water' && geom.type === 'Polygon') {
      const name = String(props.name ?? '');
      if (/thames/i.test(name)) continue;
      const coords = geom.coordinates;
      const outer = Array.isArray(coords) ? coords[0] : null;
      const ring = asRing(outer);
      if (ring) waters.push({ ring });
    }
  }

  if (!buildings.length) return null;
  return { buildings, roads, waters };
}
