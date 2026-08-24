import { KEEP_HIGHWAYS, MIN_BUILDING_AREA_M2, OSM_ATTRIBUTION, OSM_BBOX, ROAD_WIDTH_M } from './constants';
import { resolveHeight } from './height';
import { ringAreaM2, roundCoord } from './projection';
import { closeRing, samePoint, simplifyLine, simplifyRing, uniqueRing } from './simplify';
import type {
  BuildingProperties,
  LandcoverProperties,
  LngLat,
  RoadProperties,
  SimFeature,
  SimFeatureCollection,
} from './types';

export interface OverpassNode {
  lat: number;
  lon: number;
}

export interface OverpassMember {
  type: string;
  ref: number;
  role: string;
  geometry?: OverpassNode[];
}

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: OverpassNode[];
  members?: OverpassMember[];
}

export interface OverpassResponse {
  elements?: OverpassElement[];
}

const BUILDING_SIMPLIFY = 0.000006;
const ROAD_SIMPLIFY = 0.000012;
const LAND_SIMPLIFY = 0.000008;

function geomToRing(geometry: OverpassNode[] | undefined): LngLat[] | null {
  if (!geometry || geometry.length < 2) return null;
  const ring: LngLat[] = geometry.map((n) => [roundCoord(n.lon), roundCoord(n.lat)]);
  return uniqueRing(ring);
}

function geomToLine(geometry: OverpassNode[] | undefined): LngLat[] | null {
  if (!geometry || geometry.length < 2) return null;
  const line: LngLat[] = [];
  for (const n of geometry) {
    const p: LngLat = [roundCoord(n.lon), roundCoord(n.lat)];
    const prev = line[line.length - 1];
    if (!prev || !samePoint(prev, p)) line.push(p);
  }
  return line.length >= 2 ? line : null;
}

function assembleRings(ways: LngLat[][]): LngLat[][] {
  const remaining = ways
    .map((w) => w.slice())
    .filter((w) => w.length >= 2);
  const rings: LngLat[][] = [];

  while (remaining.length > 0) {
    let ring = remaining.pop()!;
    let guard = remaining.length + 2;
    while (guard-- > 0) {
      const start = ring[0];
      const end = ring[ring.length - 1];
      if (samePoint(start, end) && ring.length >= 4) break;
      let matched = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const w = remaining[i];
        const w0 = w[0];
        const w1 = w[w.length - 1];
        if (samePoint(end, w0)) {
          ring = ring.concat(w.slice(1));
          remaining.splice(i, 1);
          matched = true;
          break;
        }
        if (samePoint(end, w1)) {
          ring = ring.concat(w.slice(0, -1).reverse());
          remaining.splice(i, 1);
          matched = true;
          break;
        }
        if (samePoint(start, w1)) {
          ring = w.concat(ring.slice(1));
          remaining.splice(i, 1);
          matched = true;
          break;
        }
        if (samePoint(start, w0)) {
          ring = w.slice().reverse().concat(ring.slice(1));
          remaining.splice(i, 1);
          matched = true;
          break;
        }
      }
      if (!matched) break;
    }
    const closed = uniqueRing(closeRing(ring));
    if (closed.length >= 4) rings.push(closed);
  }
  return rings;
}

function pointInRing(point: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 1e-18) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function ringsToPolygon(outers: LngLat[][], inners: LngLat[][]): LngLat[][][] {
  const polygons: LngLat[][][] = [];
  for (const outer of outers) {
    const holes = inners.filter((hole) => pointInRing(hole[0], outer));
    polygons.push([simplifyRing(outer, BUILDING_SIMPLIFY), ...holes.map((h) => simplifyRing(h, BUILDING_SIMPLIFY))]);
  }
  return polygons;
}

function relationPolygons(element: OverpassElement, simplify = BUILDING_SIMPLIFY): LngLat[][][] | null {
  if (!element.members?.length) return null;
  const outers: LngLat[][] = [];
  const inners: LngLat[][] = [];
  for (const member of element.members) {
    if (member.type !== 'way') continue;
    const line = geomToLine(member.geometry);
    if (!line) continue;
    const role = member.role || 'outer';
    if (role === 'inner') inners.push(line);
    else outers.push(line);
  }
  const outerRings = assembleRings(outers).map((r) => simplifyRing(r, simplify));
  const innerRings = assembleRings(inners).map((r) => simplifyRing(r, simplify));
  if (outerRings.length === 0) return null;
  return ringsToPolygon(outerRings, innerRings);
}

function wayPolygon(element: OverpassElement, simplify = BUILDING_SIMPLIFY): LngLat[][][] | null {
  const ring = geomToRing(element.geometry);
  if (!ring || ring.length < 4) return null;
  return [[simplifyRing(ring, simplify)]];
}

function polygonsFromElement(element: OverpassElement, simplify = BUILDING_SIMPLIFY): LngLat[][][] | null {
  if (element.type === 'way') return wayPolygon(element, simplify);
  if (element.type === 'relation') return relationPolygons(element, simplify);
  return null;
}

function lineFromElement(element: OverpassElement): LngLat[] | null {
  if (element.type === 'way') {
    const line = geomToLine(element.geometry);
    return line ? simplifyLine(line, ROAD_SIMPLIFY) : null;
  }
  return null;
}

export function isDroppedService(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  if (tags.highway !== 'service') return false;
  const service = tags.service ?? '';
  return service === 'parking_aisle' || service === 'driveway' || service === 'parking';
}

export function buildingFeature(element: OverpassElement): SimFeature<BuildingProperties> | null {
  const tags = { ...(element.tags ?? {}) };
  if (!tags.building || tags.building === 'no') {
    if (tags.man_made === 'chimney' || tags.man_made === 'tower') {
      tags.building = tags.man_made;
    } else {
      return null;
    }
  }
  const polygons = polygonsFromElement(element, BUILDING_SIMPLIFY);
  if (!polygons || polygons.length === 0) return null;
  const area = polygons.reduce((sum, poly) => sum + ringAreaM2(poly[0] ?? []), 0);
  if (area < MIN_BUILDING_AREA_M2) return null;
  const resolved = resolveHeight({
    height: tags.height ?? tags['building:height'],
    levels: tags['building:levels'],
    minHeight: tags.min_height ?? tags['building:min_height'],
    minLevel: tags['building:min_level'],
    building: tags.building,
    name: tags.name ?? tags['name:en'],
  });
  const geometry =
    polygons.length === 1
      ? { type: 'Polygon' as const, coordinates: polygons[0] }
      : { type: 'MultiPolygon' as const, coordinates: polygons };
  const name = tags.name ?? tags['name:en'];
  const properties: BuildingProperties = {
    osmId: `${element.type}/${element.id}`,
    layer: 'building',
    building: tags.building,
    height: roundCoord(resolved.height, 2),
    heightSource: resolved.source,
  };
  if (name) properties.name = name;
  if (resolved.minHeight > 0) properties.minHeight = roundCoord(resolved.minHeight, 2);
  if (resolved.levels !== null) properties.levels = resolved.levels;
  return {
    type: 'Feature',
    properties,
    geometry,
  };
}

export function roadFeature(element: OverpassElement): SimFeature<RoadProperties> | null {
  const tags = element.tags ?? {};
  const highway = tags.highway;
  if (!highway || !(KEEP_HIGHWAYS as readonly string[]).includes(highway)) return null;
  if (isDroppedService(tags)) return null;
  const line = lineFromElement(element);
  if (!line) return null;
  const properties: RoadProperties = {
    osmId: `${element.type}/${element.id}`,
    layer: 'road',
    highway,
    width: ROAD_WIDTH_M[highway] ?? 6,
  };
  if (tags.name) properties.name = tags.name;
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'LineString', coordinates: line },
  };
}

function landcoverKind(tags: Record<string, string>): 'park' | 'water' | null {
  if (
    tags.natural === 'water' ||
    tags.waterway === 'riverbank' ||
    tags.waterway === 'tidal_channel' ||
    tags.water === 'river' ||
    tags.water === 'lake' ||
    tags.water === 'pond' ||
    tags.landuse === 'reservoir' ||
    tags.landuse === 'basin'
  ) {
    return 'water';
  }
  if (
    tags.leisure === 'park' ||
    tags.leisure === 'garden' ||
    tags.leisure === 'common' ||
    tags.leisure === 'nature_reserve' ||
    tags.landuse === 'grass' ||
    tags.landuse === 'recreation_ground' ||
    tags.landuse === 'forest' ||
    tags.landuse === 'meadow' ||
    tags.landuse === 'village_green' ||
    tags.landuse === 'cemetery' ||
    tags.landuse === 'allotments'
  ) {
    return 'park';
  }
  return null;
}

export function landcoverFeature(element: OverpassElement): SimFeature<LandcoverProperties> | null {
  const tags = element.tags ?? {};
  const kind = landcoverKind(tags);
  if (!kind) return null;
  if (tags.building) return null;
  const polygons = polygonsFromElement(element, LAND_SIMPLIFY);
  if (!polygons || polygons.length === 0) return null;
  const area = polygons.reduce((sum, poly) => sum + ringAreaM2(poly[0] ?? []), 0);
  if (area < 80) return null;
  const geometry =
    polygons.length === 1
      ? { type: 'Polygon' as const, coordinates: polygons[0] }
      : { type: 'MultiPolygon' as const, coordinates: polygons };
  const properties: LandcoverProperties = {
    osmId: `${element.type}/${element.id}`,
    layer: kind,
    kind,
  };
  if (tags.name) properties.name = tags.name;
  return {
    type: 'Feature',
    properties,
    geometry,
  };
}

export function collection<P extends BuildingProperties | RoadProperties | LandcoverProperties>(
  name: string,
  features: SimFeature<P>[],
): SimFeatureCollection<P> {
  return {
    type: 'FeatureCollection',
    name,
    attribution: OSM_ATTRIBUTION,
    bbox: [OSM_BBOX.west, OSM_BBOX.south, OSM_BBOX.east, OSM_BBOX.north],
    generated: new Date().toISOString(),
    meta: {
      featureCount: features.length,
      source: 'OpenStreetMap Overpass extract',
    },
    features,
  };
}

export const OVERPASS_QUERY = `
[out:json][timeout:90][maxsize:1073741824][bbox:{{bbox}}];
(
  way["building"];
  relation["building"]["type"="multipolygon"];
);
out tags geom;
`.trim();
