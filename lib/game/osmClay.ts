/**
 * Scored central-London OSM extract (PR #23 simplified GeoJSON) → clay-board
 * footprints. This is fabric for the miniature, not /sim and not the 50MB dump.
 *
 * Colour follows the real site, not a terracotta wash: brick warehouses brick,
 * glass towers glass, stone landmarks stone. Footprints that hit the Thames
 * are translated onto the bank so the clay-blue ribbon stays clean and OSM
 * rings are not re-boxed. Terraces mix London stock (yellow / grey / dirty).
 * London Bridge hub drops 4–8-gon caps so only irregular OSM rings extrude.
 */

import { clipRingOffThames, degDist, type CityBlock, type LngLat } from './geo';

/** London stock mix — not one brick-red wash. */
export type BrickStock = 'yellow' | 'grey' | 'dirty' | 'red';

export interface OsmBuilding {
  ring: LngLat[];
  h: number;
  tone: CityBlock['tone'];
  brickStock?: BrickStock;
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
  /^(the )?shard$|^hms belfast$|canada square|st mary axe|30 st mary|^gherkin$|walkie|20 fenchurch|cheesegrater|leadenhall building|battersea power|^tower bridge( (north|south) tower)?$|st paul.?s?( cathedral)?$/i;

/** Authored silhouettes that must not sit under a second OSM stack. */
const HERO_PADS: readonly { at: LngLat; r: number }[] = [
  { at: [-0.0194, 51.5049], r: 0.0014 }, // 1 Canada Square
  { at: [-0.0755, 51.5055], r: 0.0007 }, // Tower Bridge towers only, not the wharf
  { at: [-0.0803, 51.5145], r: 0.0007 }, // Gherkin
  { at: [-0.0865, 51.5045], r: 0.00032 }, // The Shard spike only, not Shard Place
];

/** London Bridge / Shard / Tower Bridge still-view. Boxy 4–8-gons read as a prism grid. */
function inLondonBridgeHub(lng: number, lat: number): boolean {
  return lng > -0.098 && lng < -0.068 && lat > 51.499 && lat < 51.512;
}

function ringVertCount(ring: LngLat[]): number {
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  return Math.max(0, ring.length - (closed ? 1 : 0));
}

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

function mix01(lng: number, lat: number) {
  const s = Math.sin(lng * 1741.3 + lat * 931.7) * 43758.5453;
  return s - Math.floor(s);
}

function ringCentroid(ring: LngLat[]): LngLat {
  const n =
    ring.length -
    (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0);
  let lng = 0;
  let lat = 0;
  for (let i = 0; i < n; i++) {
    lng += ring[i][0];
    lat += ring[i][1];
  }
  return [lng / n, lat / n];
}

function nearAuthoredHero(lng: number, lat: number, name: string): boolean {
  if (name && SKIP_HERO.test(name)) return true;
  return HERO_PADS.some((pad) => degDist([lng, lat], pad.at) < pad.r);
}

/**
 * Site-true clay tone from OSM tags + real height. Not a random terracotta wash:
 * warehouses/terraces brick, towers glass-grey, civic/churches stone.
 * `meters` is the OSM height, not the clay extrusion.
 */
export function toneFor(
  building: string,
  meters: number,
  lng: number,
  lat: number,
  name = '',
): CityBlock['tone'] {
  const b = building.toLowerCase();
  const n = name.toLowerCase();
  const civic =
    /cathedral|church|chapel|mosque|synagogue|palace|abbey|castle|monument|museum|civic|public|courthouse|townhall|university|college|hospital|ruins/.test(
      b,
    ) ||
    /cathedral|church|palace|abbey|westminster|tower of london|british museum|national theatre|tate|guildhall|mansion house|bank of england|st paul/.test(
      n,
    );
  if (civic) return 'stone';

  const office = /office|commercial|skyscraper|tower|hotel/.test(b);
  const warehouse = /warehouse|industrial|manufacture|factory|shed/.test(b);
  const house = /house|terrace|semidetached|detached|garage/.test(b);
  const apt = /apartments|residential|dormitory/.test(b);
  const retail = /retail|supermarket/.test(b);
  const station = /train_station|station/.test(b);

  const canary = lng > -0.032 && lng < -0.005 && lat > 51.498 && lat < 51.51;
  const city = lng > -0.102 && lng < -0.07 && lat > 51.509 && lat < 51.521;
  const shoreditch = lng > -0.09 && lng < -0.068 && lat > 51.52 && lat < 51.532;

  if (station) return 'stone';
  if (canary && meters >= 22) return 'glass';
  if (office && meters >= 16) return 'glass';
  if (meters >= 45) return 'glass';
  if ((city || canary) && meters >= 28) return 'glass';

  if (warehouse || house) return 'brick';
  if (retail && meters < 22) return 'brick';
  if (apt) {
    if (meters >= 40) return 'glass';
    const m = mix01(lng, lat);
    return m < 0.3 ? 'brick' : 'fill';
  }
  if (shoreditch && meters < 22) return 'brick';

  const m = mix01(lng, lat);
  if (meters >= 22) return m < 0.12 ? 'brick' : m < 0.4 ? 'stone' : 'glass';
  if (meters >= 12) return m < 0.22 ? 'brick' : m < 0.62 ? 'stone' : 'fill';
  return m < 0.28 ? 'brick' : m < 0.55 ? 'stone' : 'fill';
}

/** Adjacent terraces vary; warehouses bias dirty stock. */
function brickStockFor(lng: number, lat: number, warehouse: boolean): BrickStock {
  const m = mix01(lng + 0.017, lat - 0.009);
  if (warehouse) {
    if (m < 0.52) return 'dirty';
    if (m < 0.78) return 'grey';
    if (m < 0.93) return 'yellow';
    return 'red';
  }
  if (m < 0.4) return 'yellow';
  if (m < 0.66) return 'grey';
  if (m < 0.88) return 'dirty';
  return 'red';
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
      const coords = geom.coordinates;
      const outer = Array.isArray(coords) ? coords[0] : null;
      const ring = asRing(outer);
      if (!ring) continue;
      const [clng, clat] = ringCentroid(ring);
      if (nearAuthoredHero(clng, clat, name)) continue;
      // Keep L-shapes / courtyards / station sheds; drop rectangle caps at this hub.
      if (inLondonBridgeHub(clng, clat) && ringVertCount(ring) <= 8) continue;
      const clipped = clipRingOffThames(ring);
      if (!clipped) continue;
      const meters = typeof props.height === 'number' ? props.height : 10;
      const h = clamp(meters * M_TO_CLAY, 0.42, 17.2);
      const building = String(props.building ?? 'yes');
      const tone = toneFor(building, meters, clng, clat, name);
      const warehouse = /warehouse|industrial|manufacture|factory|shed/.test(building.toLowerCase());
      buildings.push({
        ring: clipped,
        h,
        tone,
        brickStock: tone === 'brick' ? brickStockFor(clng, clat, warehouse) : undefined,
      });
      continue;
    }

    if (layer === 'road' && geom.type === 'LineString') {
      if (ri++ % rSkip !== 0) continue;
      const line = asLine(geom.coordinates);
      if (!line) continue;
      const highway = String(props.highway ?? '');
      const widthM = typeof props.width === 'number' ? props.width : 8;
      // Board-scale ribbons, not OSM metres: halfW 1.05 ≈ 24px at the city eye.
      // Hairlines (≤0.22) read as gaps between blocks and fail the whole-board camera.
      let halfW = clamp(widthM * 0.1, 1.05, 2.4);
      if (highway === 'pedestrian') halfW = Math.min(halfW, 0.88);
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
      if (!ring) continue;
      const clipped = clipRingOffThames(ring);
      if (clipped) waters.push({ ring: clipped });
    }
  }

  if (!buildings.length) return null;
  return { buildings, roads, waters };
}
