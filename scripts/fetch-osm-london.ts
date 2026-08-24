/**
 * Build the cached central-London OSM extract.
 *
 * Overpass is too flaky for this bbox (504s on even tiny tiles). The extract
 * is clipped from Geofabrik's Greater London PBF — the same OSM tags
 * (height, building:levels, highway, leisure, water) Overpass would have
 * returned. Runtime /sim never hits the network for geometry.
 *
 *   data/osm-central-london.geojson           (local / pack:sim only, gitignored)
 *   data/osm-central-london-roads.geojson     (local / pack:sim only, gitignored)
 *   data/osm-central-london-landcover.geojson (local / pack:sim only, gitignored)
 *   data/osm-central-london-simplified.geojson (clay board for PR #22; committed)
 *
 * Usage: pnpm osm:fetch
 */
import { createReadStream } from 'node:fs';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { finished } from 'node:stream/promises';
import path from 'node:path';
import {
  BUILDING_DATA_FILE,
  LANDCOVER_DATA_FILE,
  OSM_BBOX,
  ROADS_DATA_FILE,
} from '../lib/sim/constants';
import {
  buildingFeature,
  collection,
  landcoverFeature,
  roadFeature,
  type OverpassElement,
  type OverpassNode,
} from '../lib/sim/osm-parse';

const require = createRequire(import.meta.url);
const parseOSM = require('osm-pbf-parser') as () => NodeJS.ReadWriteStream;

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data');
const CACHE_DIR = path.join(DATA_DIR, '.cache');
const PBF_PATH = path.join(CACHE_DIR, 'greater-london-latest.osm.pbf');
const PBF_URL =
  'https://download.geofabrik.de/europe/united-kingdom/england/greater-london-latest.osm.pbf';

const MARGIN = 0.003;

interface PbfNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}
interface PbfWay {
  type: 'way';
  id: number;
  refs: number[];
  tags?: Record<string, string>;
}
interface PbfRelation {
  type: 'relation';
  id: number;
  tags?: Record<string, string>;
  members: { type: string; id?: number; ref?: number; role: string }[];
}

function inBox(lon: number, lat: number, margin = 0): boolean {
  return (
    lon >= OSM_BBOX.west - margin &&
    lon <= OSM_BBOX.east + margin &&
    lat >= OSM_BBOX.south - margin &&
    lat <= OSM_BBOX.north + margin
  );
}

async function ensurePbf(): Promise<void> {
  try {
    await access(PBF_PATH);
    return;
  } catch {
    // download below
  }
  console.log(`Downloading ${PBF_URL}`);
  const response = await fetch(PBF_URL, {
    headers: { 'User-Agent': 'runway-startup-game/0.1 (central London OSM mesh cache)' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download PBF: ${response.status}`);
  }
  const buf = Buffer.from(await response.arrayBuffer());
  await writeFile(PBF_PATH, buf);
  console.log(`Wrote ${PBF_PATH} (${(buf.length / 1e6).toFixed(1)} MB)`);
}

function coordsFromRefs(refs: number[], nodes: Map<number, OverpassNode>): OverpassNode[] | null {
  const geometry: OverpassNode[] = [];
  for (const ref of refs) {
    const node = nodes.get(ref);
    if (node) geometry.push(node);
  }
  return geometry.length >= 2 ? geometry : null;
}

function intersectsStrict(geometry: OverpassNode[]): boolean {
  return geometry.some((n) => inBox(n.lon, n.lat, 0));
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  await ensurePbf();

  const nodes = new Map<number, OverpassNode>();
  const wayGeom = new Map<number, OverpassNode[]>();
  const relations: PbfRelation[] = [];
  const buildingEls: OverpassElement[] = [];
  const roadEls: OverpassElement[] = [];
  const landEls: OverpassElement[] = [];

  let nodeCount = 0;
  let wayCount = 0;

  console.log('Parsing Greater London PBF (clipping to Hyde Park–Docklands)…');
  const parser = parseOSM();
  const stream = createReadStream(PBF_PATH).pipe(parser);

  stream.on('data', (items: Array<PbfNode | PbfWay | PbfRelation>) => {
    for (const item of items) {
      if (item.type === 'node') {
        nodeCount += 1;
        if (inBox(item.lon, item.lat, MARGIN)) {
          nodes.set(item.id, { lon: item.lon, lat: item.lat });
        }
        continue;
      }
      if (item.type === 'way') {
        wayCount += 1;
        const geometry = coordsFromRefs(item.refs, nodes);
        if (!geometry) continue;
        wayGeom.set(item.id, geometry);
        if (!intersectsStrict(geometry)) continue;
        const el: OverpassElement = { type: 'way', id: item.id, tags: item.tags, geometry };
        const b = buildingFeature(el);
        if (b) buildingEls.push(el);
        else {
          const r = roadFeature(el);
          if (r) roadEls.push(el);
          const l = landcoverFeature(el);
          if (l) landEls.push(el);
        }
        continue;
      }
      if (item.type === 'relation') {
        relations.push(item);
      }
    }
    if (nodeCount > 0 && nodeCount % 1_000_000 < 8000) {
      console.log(
        `  … ${nodeCount.toLocaleString('en-GB')} nodes, ${nodes.size.toLocaleString('en-GB')} in bbox`,
      );
    }
  });

  await finished(stream);
  console.log(
    `PBF done: ${nodeCount.toLocaleString('en-GB')} nodes scanned, ${nodes.size.toLocaleString('en-GB')} kept, ${wayCount.toLocaleString('en-GB')} ways scanned`,
  );

  let relBuildings = 0;
  let relLand = 0;
  for (const rel of relations) {
    const tags = rel.tags ?? {};
    const interesting = Boolean(
      tags.building ||
      tags.leisure ||
      tags.landuse ||
      tags.natural === 'water' ||
      tags.waterway ||
      tags.water,
    );
    if (!interesting) continue;
    const members = rel.members
      .filter((m) => m.type === 'way')
      .map((m) => {
        const id = m.id ?? m.ref ?? 0;
        const geometry = wayGeom.get(id);
        return geometry ? { type: 'way', ref: id, role: m.role || 'outer', geometry } : null;
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
    if (members.length === 0) continue;
    const el: OverpassElement = { type: 'relation', id: rel.id, tags, members };
    if (tags.building && tags.building !== 'no') {
      buildingEls.push(el);
      relBuildings += 1;
    } else {
      landEls.push(el);
      relLand += 1;
    }
  }
  console.log(`Relations kept: ${relBuildings} buildings, ${relLand} parks/water`);

  const buildings = buildingEls.map(buildingFeature).filter((f) => f !== null);
  const roads = roadEls.map(roadFeature).filter((f) => f !== null);
  const landcover = landEls.map(landcoverFeature).filter((f) => f !== null);
  for (const feature of landcover) {
    if (feature.properties.kind !== 'water' || feature.properties.name) continue;
    const rings =
      feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates as number[][][]]
        : (feature.geometry.coordinates as number[][][][]);
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    const walk = (c: unknown) => {
      if (Array.isArray(c) && typeof c[0] === 'number') {
        minLng = Math.min(minLng, c[0] as number);
        maxLng = Math.max(maxLng, c[0] as number);
        minLat = Math.min(minLat, c[1] as number);
        maxLat = Math.max(maxLat, c[1] as number);
        return;
      }
      if (Array.isArray(c)) for (const x of c) walk(x);
    };
    walk(rings);
    if (maxLng - minLng > 0.03 && minLat > 51.46 && maxLat < 51.52) {
      feature.properties.name = 'River Thames';
    }
  }

  const buildingFc = collection('central-london-buildings', buildings);
  const roadFc = collection('central-london-roads', roads);
  const landFc = collection('central-london-landcover', landcover);

  await mkdir(DATA_DIR, { recursive: true });
  const buildingPath = path.join(DATA_DIR, BUILDING_DATA_FILE);
  const roadPath = path.join(DATA_DIR, ROADS_DATA_FILE);
  const landPath = path.join(DATA_DIR, LANDCOVER_DATA_FILE);
  await writeFile(buildingPath, JSON.stringify(buildingFc));
  await writeFile(roadPath, JSON.stringify(roadFc));
  await writeFile(landPath, JSON.stringify(landFc));

  const named = buildings.filter((f) => f.properties.name).length;
  const measured = buildings.filter(
    (f) => f.properties.heightSource === 'height' || f.properties.heightSource === 'levels',
  ).length;
  console.log(
    `Wrote ${buildings.length} buildings (${named} named, ${measured} with OSM height/levels)`,
  );
  console.log(`Wrote ${roads.length} roads`);
  console.log(`Wrote ${landcover.length} parks/water`);
  console.log(buildingPath);
  console.log(roadPath);
  console.log(landPath);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
