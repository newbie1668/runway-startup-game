import earcutImport from 'earcut';
import { BUILDING_KIND_NAMES, type PackedCity } from './compact';
import { OSM_BBOX, ROAD_WIDTH_M } from './constants';
import { projectLngLat, signedAreaXZ, type Vec2 } from './projection';
import type {
  BuildingProperties,
  LandcoverProperties,
  LngLat,
  RoadProperties,
  SimFeature,
  SimFeatureCollection,
} from './types';

const earcut: typeof earcutImport =
  typeof earcutImport === 'function'
    ? earcutImport
    : (earcutImport as unknown as { default: typeof earcutImport }).default;

const CHUNK_M = 650;

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface CityChunk {
  key: string;
  kind: 'building' | 'road' | 'park' | 'water';
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

export interface Pickable {
  name: string;
  height: number;
  x: number;
  z: number;
  building: string;
}

export interface CityMesh {
  chunks: CityChunk[];
  pickables: Pickable[];
  stats: {
    buildings: number;
    roads: number;
    parks: number;
    water: number;
    triangles: number;
  };
}

interface Writer {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

function makeWriter(): Writer {
  return { positions: [], normals: [], colors: [], indices: [] };
}

function chunkKey(x: number, z: number, kind: CityChunk['kind']): string {
  const cx = Math.floor(x / CHUNK_M);
  const cz = Math.floor(z / CHUNK_M);
  return `${kind}:${cx}:${cz}`;
}

function addVertex(
  w: Writer,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  r: number,
  g: number,
  b: number,
): number {
  const i = w.positions.length / 3;
  w.positions.push(x, y, z);
  w.normals.push(nx, ny, nz);
  w.colors.push(r, g, b);
  return i;
}

function addTri(w: Writer, a: number, b: number, c: number) {
  w.indices.push(a, b, c);
}

function close2d(ring: Vec2[]): Vec2[] {
  if (ring.length === 0) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.z - b.z) < 1e-6) return ring.slice(0, -1);
  return ring;
}

function projectRing(ring: LngLat[]): Vec2[] {
  return close2d(ring.map(([lng, lat]) => projectLngLat(lng, lat)));
}

function ensureWinding(ring: Vec2[], ccw: boolean): Vec2[] {
  const area = signedAreaXZ(ring);
  const isCcw = area > 0;
  if (isCcw === ccw) return ring;
  return ring.slice().reverse();
}

function centroid(ring: Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of ring) {
    x += p.x;
    z += p.z;
  }
  const n = ring.length || 1;
  return { x: x / n, z: z / n };
}

function hashHue(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1000;
}

export interface BuildingPalette {
  wall: [number, number, number];
  roof: [number, number, number];
  glass: number;
}

export function buildingPalette(
  building: string,
  height: number,
  name: string | null,
  osmId: string,
): BuildingPalette {
  const n = (name ?? '').toLowerCase();
  const jitter = (hashHue(osmId) - 500) / 500;
  const j = (channel: number, amt = 0.04) => clamp01(channel + jitter * amt);

  if (n.includes('shard')) {
    return { wall: [0.18, 0.22, 0.26], roof: [0.28, 0.32, 0.36], glass: 0.92 };
  }
  if (n.includes('st paul') || n.includes('st. paul')) {
    return { wall: [0.78, 0.74, 0.66], roof: [0.55, 0.42, 0.32], glass: 0.08 };
  }
  if (n.includes('westminster') || n.includes('parliament') || n.includes('elizabeth tower')) {
    return { wall: [0.72, 0.7, 0.64], roof: [0.42, 0.28, 0.22], glass: 0.12 };
  }
  if (n.includes('battersea power')) {
    return { wall: [0.55, 0.32, 0.26], roof: [0.38, 0.22, 0.18], glass: 0.05 };
  }
  if (n.includes('gherkin') || n.includes('st mary axe')) {
    return { wall: [0.42, 0.52, 0.48], roof: [0.3, 0.38, 0.36], glass: 0.85 };
  }
  if (n.includes('canada square') || n.includes('canary') || n.includes('one canada')) {
    return { wall: [0.32, 0.4, 0.46], roof: [0.22, 0.28, 0.32], glass: 0.8 };
  }

  const tall = height > 55;
  const glassTower = tall || building === 'office' || height > 40;
  if (glassTower) {
    const cool = 0.06 * jitter;
    return {
      wall: [j(0.42 + cool), j(0.46 + cool), j(0.5 + cool)],
      roof: [j(0.3), j(0.32), j(0.34)],
      glass: 0.72,
    };
  }
  if (building === 'church' || building === 'cathedral' || building === 'chapel') {
    return { wall: [0.74, 0.7, 0.62], roof: [0.4, 0.3, 0.24], glass: 0.1 };
  }
  if (building === 'industrial' || building === 'warehouse') {
    return { wall: [j(0.45), j(0.44), j(0.42)], roof: [j(0.35), j(0.34), j(0.33)], glass: 0.12 };
  }
  if (building === 'retail' || building === 'commercial') {
    return { wall: [j(0.58), j(0.54), j(0.5)], roof: [j(0.4), j(0.38), j(0.36)], glass: 0.28 };
  }
  if (
    building === 'house' ||
    building === 'terrace' ||
    building === 'detached' ||
    building === 'semidetached' ||
    building === 'residential'
  ) {
    return {
      wall: [j(0.55, 0.07), j(0.42, 0.05), j(0.35, 0.04)],
      roof: [j(0.38), j(0.28), j(0.24)],
      glass: 0.18,
    };
  }
  if (building === 'apartments' || building === 'flats') {
    return {
      wall: [j(0.52), j(0.48), j(0.45)],
      roof: [j(0.36), j(0.34), j(0.32)],
      glass: 0.35,
    };
  }
  return {
    wall: [j(0.5), j(0.47), j(0.44)],
    roof: [j(0.36), j(0.34), j(0.32)],
    glass: height > 18 ? 0.4 : 0.16,
  };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function triangulate(outer: Vec2[], holes: Vec2[][]): number[] {
  if (holes.length === 0 && outer.length === 4) {
    return [
      outer[0].x,
      outer[0].z,
      outer[1].x,
      outer[1].z,
      outer[2].x,
      outer[2].z,
      outer[0].x,
      outer[0].z,
      outer[2].x,
      outer[2].z,
      outer[3].x,
      outer[3].z,
    ];
  }
  if (holes.length === 0 && outer.length === 3) {
    return [outer[0].x, outer[0].z, outer[1].x, outer[1].z, outer[2].x, outer[2].z];
  }
  const data: number[] = [];
  const holeIndices: number[] = [];
  for (const p of outer) data.push(p.x, p.z);
  for (const hole of holes) {
    holeIndices.push(data.length / 2);
    for (const p of hole) data.push(p.x, p.z);
  }
  const idx = earcut(data, holeIndices.length ? holeIndices : undefined, 2);
  const verts: Vec2[] = [];
  for (let i = 0; i < data.length; i += 2) verts.push({ x: data[i], z: data[i + 1] });
  const mapped: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = verts[idx[i]];
    const b = verts[idx[i + 1]];
    const c = verts[idx[i + 2]];
    mapped.push(a.x, a.z, b.x, b.z, c.x, c.z);
  }
  return mapped;
}

function extrudePolygon(
  w: Writer,
  outer: Vec2[],
  holes: Vec2[][],
  minH: number,
  height: number,
  palette: BuildingPalette,
) {
  const outerCcw = ensureWinding(outer, true);
  const holeCw = holes.map((h) => ensureWinding(h, false));
  if (outerCcw.length < 3) return;

  const roofY = height;
  const tris = triangulate(outerCcw, holeCw);
  for (let i = 0; i < tris.length; i += 6) {
    const a = addVertex(
      w,
      tris[i],
      roofY,
      tris[i + 1],
      0,
      1,
      0,
      palette.roof[0],
      palette.roof[1],
      palette.roof[2],
    );
    const b = addVertex(
      w,
      tris[i + 2],
      roofY,
      tris[i + 3],
      0,
      1,
      0,
      palette.roof[0],
      palette.roof[1],
      palette.roof[2],
    );
    const c = addVertex(
      w,
      tris[i + 4],
      roofY,
      tris[i + 5],
      0,
      1,
      0,
      palette.roof[0],
      palette.roof[1],
      palette.roof[2],
    );
    addTri(w, a, b, c);
  }

  const glassMix = palette.glass;
  const wr: [number, number, number] = [
    mix(palette.wall[0], palette.wall[0] * 0.35, glassMix * 0.35),
    mix(palette.wall[1], palette.wall[1] * 0.4, glassMix * 0.35),
    mix(palette.wall[2], palette.wall[2] * 0.55, glassMix * 0.35),
  ];

  const rings = [outerCcw, ...holeCw];
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const p0 = ring[i];
      const p1 = ring[(i + 1) % n];
      const dx = p1.x - p0.x;
      const dz = p1.z - p0.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.25) continue;
      let nx = dz / len;
      let nz = -dx / len;
      const toC = centroid(outerCcw);
      const midX = (p0.x + p1.x) / 2;
      const midZ = (p0.z + p1.z) / 2;
      if ((toC.x - midX) * nx + (toC.z - midZ) * nz > 0) {
        nx = -nx;
        nz = -nz;
      }
      const a = addVertex(w, p0.x, minH, p0.z, nx, 0, nz, wr[0], wr[1], wr[2]);
      const b = addVertex(w, p1.x, minH, p1.z, nx, 0, nz, wr[0], wr[1], wr[2]);
      const c = addVertex(w, p1.x, roofY, p1.z, nx, 0, nz, wr[0], wr[1], wr[2]);
      const d = addVertex(w, p0.x, roofY, p0.z, nx, 0, nz, wr[0], wr[1], wr[2]);
      addTri(w, a, b, c);
      addTri(w, a, c, d);
    }
  }
}

function eachPolygon(
  geometry: SimFeature['geometry'],
  visit: (outer: LngLat[], holes: LngLat[][]) => void,
) {
  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates as LngLat[][];
    if (!rings[0]) return;
    visit(rings[0], rings.slice(1));
    return;
  }
  if (geometry.type === 'MultiPolygon') {
    const polys = geometry.coordinates as LngLat[][][];
    for (const rings of polys) {
      if (!rings[0]) continue;
      visit(rings[0], rings.slice(1));
    }
  }
}

function eachLine(geometry: SimFeature['geometry'], visit: (line: LngLat[]) => void) {
  if (geometry.type === 'LineString') {
    visit(geometry.coordinates as LngLat[]);
    return;
  }
  if (geometry.type === 'MultiLineString') {
    for (const line of geometry.coordinates as LngLat[][]) visit(line);
  }
}

function addRibbon(
  w: Writer,
  points: Vec2[],
  width: number,
  y: number,
  color: [number, number, number],
) {
  if (points.length < 2) return;
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)];
    const next = points[Math.min(points.length - 1, i + 1)];
    let dx = next.x - prev.x;
    let dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const px = (-dz * width) / 2;
    const pz = (dx * width) / 2;
    left.push({ x: points[i].x + px, z: points[i].z + pz });
    right.push({ x: points[i].x - px, z: points[i].z - pz });
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = addVertex(w, left[i].x, y, left[i].z, 0, 1, 0, color[0], color[1], color[2]);
    const b = addVertex(w, right[i].x, y, right[i].z, 0, 1, 0, color[0], color[1], color[2]);
    const c = addVertex(
      w,
      right[i + 1].x,
      y,
      right[i + 1].z,
      0,
      1,
      0,
      color[0],
      color[1],
      color[2],
    );
    const d = addVertex(w, left[i + 1].x, y, left[i + 1].z, 0, 1, 0, color[0], color[1], color[2]);
    addTri(w, a, b, c);
    addTri(w, a, c, d);
  }
}

function addFlat(
  w: Writer,
  outer: Vec2[],
  holes: Vec2[][],
  y: number,
  color: [number, number, number],
) {
  const outerCcw = ensureWinding(outer, true);
  const holeCw = holes.map((h) => ensureWinding(h, false));
  if (outerCcw.length < 3) return;
  const tris = triangulate(outerCcw, holeCw);
  for (let i = 0; i < tris.length; i += 6) {
    const a = addVertex(w, tris[i], y, tris[i + 1], 0, 1, 0, color[0], color[1], color[2]);
    const b = addVertex(w, tris[i + 2], y, tris[i + 3], 0, 1, 0, color[0], color[1], color[2]);
    const c = addVertex(w, tris[i + 4], y, tris[i + 5], 0, 1, 0, color[0], color[1], color[2]);
    addTri(w, a, b, c);
  }
}

function finish(kind: CityChunk['kind'], key: string, w: Writer): CityChunk | null {
  if (w.indices.length === 0) return null;
  return {
    key,
    kind,
    positions: Float32Array.from(w.positions),
    normals: Float32Array.from(w.normals),
    colors: Float32Array.from(w.colors),
    indices: Uint32Array.from(w.indices),
  };
}

function roadColor(highway: string): [number, number, number] {
  if (highway === 'pedestrian') return [0.28, 0.27, 0.25];
  if (highway.includes('motorway') || highway === 'trunk') return [0.2, 0.2, 0.22];
  return [0.16, 0.16, 0.17];
}

/** Throwaway extract stills only. /sim keeps the default dark asphalt. */
export interface CityPreviewOptions {
  roadColor?: [number, number, number];
  waterColor?: [number, number, number];
  parkColor?: [number, number, number];
  roadY?: number;
  waterY?: number;
  parkY?: number;
  roadWidthScale?: number;
}

export function worldExtentMeters(): { width: number; depth: number } {
  const sw = projectLngLat(OSM_BBOX.west, OSM_BBOX.south);
  const ne = projectLngLat(OSM_BBOX.east, OSM_BBOX.north);
  return { width: Math.abs(ne.x - sw.x), depth: Math.abs(ne.z - sw.z) };
}

export async function buildCity(input: {
  buildings: SimFeatureCollection<BuildingProperties>;
  roads: SimFeatureCollection<RoadProperties>;
  landcover: SimFeatureCollection<LandcoverProperties>;
  onProgress?: (phase: string, ratio: number) => void;
  preview?: CityPreviewOptions;
}): Promise<CityMesh> {
  const writers = new Map<string, Writer>();
  const getWriter = (key: string) => {
    let w = writers.get(key);
    if (!w) {
      w = makeWriter();
      writers.set(key, w);
    }
    return w;
  };

  const pickables: Pickable[] = [];
  let buildingCount = 0;
  const buildingFeatures = input.buildings.features;
  for (let i = 0; i < buildingFeatures.length; i++) {
    const feature = buildingFeatures[i];
    const props = feature.properties;
    let any = false;
    eachPolygon(feature.geometry, (outerLng, holesLng) => {
      const outer = projectRing(outerLng);
      const holes = holesLng.map(projectRing);
      if (outer.length < 3) return;
      const c = centroid(outer);
      const palette = buildingPalette(
        props.building,
        props.height,
        props.name ?? null,
        props.osmId,
      );
      extrudePolygon(
        getWriter(chunkKey(c.x, c.z, 'building')),
        outer,
        holes,
        props.minHeight ?? 0,
        props.height,
        palette,
      );
      any = true;
      if (props.name || props.height >= 70) {
        pickables.push({
          name: props.name ?? `${Math.round(props.height)}m ${props.building}`,
          height: props.height,
          x: c.x,
          z: c.z,
          building: props.building,
        });
      }
    });
    if (any) buildingCount += 1;
    if (i % 500 === 0) {
      input.onProgress?.('buildings', i / Math.max(1, buildingFeatures.length));
      await yieldFrame();
    }
  }

  const roadFeatures = input.roads.features;
  for (let i = 0; i < roadFeatures.length; i++) {
    const feature = roadFeatures[i];
    const props = feature.properties;
    eachLine(feature.geometry, (line) => {
      const pts = line.map(([lng, lat]) => projectLngLat(lng, lat));
      if (pts.length < 2) return;
      const c = pts[Math.floor(pts.length / 2)];
      const width =
        (props.width || ROAD_WIDTH_M[props.highway] || 6) * (input.preview?.roadWidthScale ?? 1);
      const y = input.preview?.roadY ?? 0.35;
      const color = input.preview?.roadColor ?? roadColor(props.highway);
      addRibbon(getWriter(chunkKey(c.x, c.z, 'road')), pts, width, y, color);
    });
    if (i % 300 === 0) {
      input.onProgress?.('roads', i / Math.max(1, roadFeatures.length));
      await yieldFrame();
    }
  }

  let parks = 0;
  let water = 0;
  for (const feature of input.landcover.features) {
    const kind = feature.properties.kind;
    const color: [number, number, number] =
      kind === 'water'
        ? (input.preview?.waterColor ?? [0.12, 0.2, 0.26])
        : (input.preview?.parkColor ?? [0.27, 0.34, 0.24]);
    const y = kind === 'water' ? (input.preview?.waterY ?? 0.05) : (input.preview?.parkY ?? 0.22);
    eachPolygon(feature.geometry, (outerLng, holesLng) => {
      const outer = projectRing(outerLng);
      const holes = holesLng.map(projectRing);
      if (outer.length < 3) return;
      const c = centroid(outer);
      addFlat(getWriter(chunkKey(c.x, c.z, kind)), outer, holes, y, color);
    });
    if (kind === 'water') water += 1;
    else parks += 1;
  }

  const chunks: CityChunk[] = [];
  let triangles = 0;
  for (const [key, writer] of writers) {
    const kind = key.split(':')[0] as CityChunk['kind'];
    const chunk = finish(kind, key, writer);
    if (!chunk) continue;
    chunks.push(chunk);
    triangles += chunk.indices.length / 3;
  }

  input.onProgress?.('mesh', 1);
  return {
    chunks,
    pickables,
    stats: {
      buildings: buildingCount,
      roads: roadFeatures.length,
      parks,
      water,
      triangles,
    },
  };
}

export async function buildPackedCity(
  packed: PackedCity,
  onProgress?: (phase: string, ratio: number) => void,
): Promise<CityMesh> {
  const writers = new Map<string, Writer>();
  const getWriter = (key: string) => {
    let w = writers.get(key);
    if (!w) {
      w = makeWriter();
      writers.set(key, w);
    }
    return w;
  };

  const pickables: Pickable[] = [];
  for (let i = 0; i < packed.buildings.length; i++) {
    const b = packed.buildings[i];
    if (b.outer.length < 3) continue;
    const building = BUILDING_KIND_NAMES[b.kind] ?? 'yes';
    const c = centroid(b.outer);
    const palette = buildingPalette(building, b.height, b.name ?? null, String(i));
    extrudePolygon(
      getWriter(chunkKey(c.x, c.z, 'building')),
      b.outer,
      [],
      b.minHeight,
      b.height,
      palette,
    );
    if (b.name || b.height >= 70) {
      pickables.push({
        name: b.name ?? `${Math.round(b.height)}m ${building}`,
        height: b.height,
        x: c.x,
        z: c.z,
        building,
      });
    }
    if (i % 500 === 0) {
      onProgress?.('buildings', i / Math.max(1, packed.buildings.length));
      await yieldFrame();
    }
  }

  for (let i = 0; i < packed.roads.length; i++) {
    const road = packed.roads[i];
    if (road.points.length < 2) continue;
    const c = road.points[Math.floor(road.points.length / 2)];
    const highway = road.kind === 1 ? 'pedestrian' : road.kind === 2 ? 'motorway' : 'residential';
    addRibbon(
      getWriter(chunkKey(c.x, c.z, 'road')),
      road.points,
      road.width,
      0.35,
      roadColor(highway),
    );
    if (i % 300 === 0) {
      onProgress?.('roads', i / Math.max(1, packed.roads.length));
      await yieldFrame();
    }
  }

  let parks = 0;
  let water = 0;
  for (const cover of packed.cover) {
    if (cover.outer.length < 3) continue;
    const c = centroid(cover.outer);
    const color: [number, number, number] =
      cover.kind === 'water' ? [0.12, 0.2, 0.26] : [0.27, 0.34, 0.24];
    const y = cover.kind === 'water' ? 0.05 : 0.22;
    addFlat(getWriter(chunkKey(c.x, c.z, cover.kind)), cover.outer, [], y, color);
    if (cover.kind === 'water') water += 1;
    else parks += 1;
  }

  const chunks: CityChunk[] = [];
  let triangles = 0;
  for (const [key, writer] of writers) {
    const kind = key.split(':')[0] as CityChunk['kind'];
    const chunk = finish(kind, key, writer);
    if (!chunk) continue;
    chunks.push(chunk);
    triangles += chunk.indices.length / 3;
  }

  onProgress?.('mesh', 1);
  return {
    chunks,
    pickables,
    stats: {
      buildings: packed.buildings.length,
      roads: packed.roads.length,
      parks,
      water,
      triangles,
    },
  };
}
