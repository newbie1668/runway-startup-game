/**
 * Refresh the frozen OpenStreetMap geometry used by the RUNWAY diorama.
 *
 * The runtime never calls OpenStreetMap. This authoring-only script fetches a
 * compact snapshot of the River Thames and London's primary-road alignments,
 * simplifies the geometry, and writes the deterministic JSON consumed by
 * Blender. The generated file retains the OSM attribution and source date.
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { format } from 'prettier';

const output = join(resolve(import.meta.dirname), 'london-geography.json');
const endpoint = process.env.OVERPASS_ENDPOINT ?? 'https://overpass-api.de/api/interpreter';
const bounds = {
  south: 51.46,
  west: -0.2,
  north: 51.56,
  east: 0.04,
};

const hubs = {
  camden: { name: 'CAMDEN', lat: 51.539, lon: -0.142, accent: 'violet' },
  kingscross: { name: "KING'S CROSS", lat: 51.533, lon: -0.124, accent: 'steel' },
  soho: { name: 'SOHO', lat: 51.513, lon: -0.135, accent: 'magenta' },
  farringdon: { name: 'FARRINGDON', lat: 51.52, lon: -0.105, accent: 'deep_green' },
  shoreditch: { name: 'SHOREDITCH', lat: 51.526, lon: -0.081, accent: 'orange' },
  londonbridge: {
    name: 'LONDON BRIDGE',
    lat: 51.503,
    lon: -0.086,
    accent: 'market_red',
  },
  canarywharf: { name: 'CANARY WHARF', lat: 51.505, lon: -0.019, accent: 'steel' },
  battersea: { name: 'BATTERSEA', lat: 51.48, lon: -0.144, accent: 'brick' },
};
const roadRefs = new Set([
  'A1',
  'A2',
  'A3',
  'A4',
  'A10',
  'A11',
  'A13',
  'A40',
  'A100',
  'A200',
  'A201',
  'A202',
  'A302',
  'A400',
  'A501',
  'A1203',
  'A1206',
  'A1261',
  'A3205',
  'A3212',
  'A4200',
]);

function query() {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const refs = [...roadRefs].join('|');
  return `[out:json][timeout:90];
(
  way["waterway"="river"]["name"="River Thames"](${bbox});
  way["highway"~"^(motorway|trunk|primary)$"]["ref"~"^(${refs})$"](${bbox});
);
out geom;`;
}

function pointKey(point) {
  return `${point.lon.toFixed(7)},${point.lat.toFixed(7)}`;
}

function projected(point) {
  return {
    x: point.lon * Math.cos((51.51 * Math.PI) / 180),
    y: point.lat,
  };
}

function distanceToLine(point, start, end) {
  const p = projected(point);
  const a = projected(start);
  const b = projected(end);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function simplify(points, tolerance) {
  if (points.length <= 2) return points;
  let maxDistance = 0;
  let splitAt = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = distanceToLine(points[index], points[0], points.at(-1));
    if (distance > maxDistance) {
      maxDistance = distance;
      splitAt = index;
    }
  }
  if (maxDistance <= tolerance) return [points[0], points.at(-1)];
  const left = simplify(points.slice(0, splitAt + 1), tolerance);
  const right = simplify(points.slice(splitAt), tolerance);
  return [...left.slice(0, -1), ...right];
}

function inside(point) {
  return (
    point.lat >= bounds.south &&
    point.lat <= bounds.north &&
    point.lon >= bounds.west &&
    point.lon <= bounds.east
  );
}

function chainRiver(ways) {
  const segments = ways
    .filter((way) => way.geometry?.length > 1)
    .map((way) => way.geometry.filter(inside));
  const candidates = segments.flatMap((points, index) => [
    { index, end: 'start', point: points[0] },
    { index, end: 'end', point: points.at(-1) },
  ]);
  const western = candidates.reduce((best, item) =>
    item.point.lon < best.point.lon ? item : best,
  );
  const first = segments[western.index];
  const result = western.end === 'start' ? [...first] : [...first].reverse();
  const unused = new Set(segments.map((_, index) => index));
  unused.delete(western.index);

  while (unused.size) {
    const tail = pointKey(result.at(-1));
    let match = null;
    for (const index of unused) {
      const points = segments[index];
      if (pointKey(points[0]) === tail) match = { index, reverse: false };
      if (pointKey(points.at(-1)) === tail) match = { index, reverse: true };
      if (match) break;
    }
    if (!match) break;
    const next = match.reverse ? [...segments[match.index]].reverse() : segments[match.index];
    result.push(...next.slice(1));
    unused.delete(match.index);
  }

  return simplify(result, 0.00016).map(({ lat, lon }) => [lon, lat]);
}

function pathLength(points) {
  return points.slice(1).reduce((total, point, index) => {
    const a = projected(points[index]);
    const b = projected(point);
    return total + Math.hypot(b.x - a.x, b.y - a.y);
  }, 0);
}

function turnAngle(a, b, c) {
  const pa = projected(a);
  const pb = projected(b);
  const pc = projected(c);
  const incoming = { x: pb.x - pa.x, y: pb.y - pa.y };
  const outgoing = { x: pc.x - pb.x, y: pc.y - pb.y };
  const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
  if (!denominator) return 0;
  const cosine = Math.max(
    -1,
    Math.min(1, (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator),
  );
  return (Math.acos(cosine) * 180) / Math.PI;
}

function canAppend(points, candidate) {
  return (
    points.length < 2 ||
    candidate.length < 2 ||
    turnAngle(points.at(-2), points.at(-1), candidate[1]) < 115
  );
}

function canPrepend(candidate, points) {
  return (
    candidate.length < 2 ||
    points.length < 2 ||
    turnAngle(candidate.at(-2), candidate.at(-1), points[1]) < 115
  );
}

function roadGeometry(ways) {
  const groups = new Map();
  for (const way of ways) {
    if (!way.geometry?.length || !roadRefs.has(way.tags?.ref)) continue;
    const points = way.geometry.filter(inside);
    if (points.length < 2) continue;
    const group = groups.get(way.tags.ref) ?? [];
    group.push({
      id: way.id,
      class: way.tags.highway,
      ref: way.tags.ref,
      name: way.tags.name ?? null,
      points,
    });
    groups.set(way.tags.ref, group);
  }

  const merged = [];
  for (const group of groups.values()) {
    const unused = new Map(group.map((segment) => [segment.id, segment]));
    while (unused.size) {
      const seed = [...unused.values()].reduce((longest, segment) =>
        pathLength(segment.points) > pathLength(longest.points) ? segment : longest,
      );
      unused.delete(seed.id);
      const points = [...seed.points];
      let extended = true;
      while (extended) {
        extended = false;
        const head = pointKey(points[0]);
        const tail = pointKey(points.at(-1));
        for (const segment of unused.values()) {
          const start = pointKey(segment.points[0]);
          const end = pointKey(segment.points.at(-1));
          let joined = false;
          if (start === tail && canAppend(points, segment.points)) {
            points.push(...segment.points.slice(1));
            joined = true;
          } else if (end === tail) {
            const reversed = [...segment.points].reverse();
            if (canAppend(points, reversed)) {
              points.push(...reversed.slice(1));
              joined = true;
            }
          } else if (end === head && canPrepend(segment.points, points)) {
            points.unshift(...segment.points.slice(0, -1));
            joined = true;
          } else if (start === head) {
            const reversed = [...segment.points].reverse();
            if (canPrepend(reversed, points)) {
              points.unshift(...reversed.slice(0, -1));
              joined = true;
            }
          }
          if (!joined) continue;
          unused.delete(segment.id);
          extended = true;
          break;
        }
      }
      if (pathLength(points) < 0.0022) continue;
      merged.push({
        class: seed.class,
        ref: seed.ref,
        name: seed.name,
        points: simplify(points, 0.0002).map(({ lat, lon }) => [lon, lat]),
        length: pathLength(points),
      });
    }
  }

  return merged
    .sort((a, b) => b.length - a.length)
    .slice(0, 260)
    .map((road) => ({
      class: road.class,
      ref: road.ref,
      name: road.name,
      points: road.points,
    }));
}

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
    'user-agent': 'RUNWAY-startup-game geography authoring',
  },
  body: new URLSearchParams({ data: query() }),
});
if (!response.ok) {
  throw new Error(`Overpass returned ${response.status}: ${await response.text()}`);
}

const source = await response.json();
const riverWays = source.elements.filter((element) => element.tags?.waterway === 'river');
const roadWays = source.elements.filter((element) => element.tags?.highway);
const snapshot = {
  version: 1,
  source: {
    provider: 'OpenStreetMap contributors',
    license: 'ODbL 1.0',
    url: 'https://www.openstreetmap.org/copyright',
    overpassEndpoint: endpoint,
    osmBaseTimestamp: source.osm3s?.timestamp_osm_base ?? null,
  },
  bounds,
  projection: {
    centreLon: -0.08,
    centreLat: 51.51,
    xUnitsPerDegree: 1600,
    yUnitsPerDegree: 2570,
  },
  hubs,
  river: {
    name: 'River Thames',
    points: chainRiver(riverWays),
  },
  roads: roadGeometry(roadWays),
};

writeFileSync(
  output,
  await format(`${JSON.stringify(snapshot, null, 2)}\n`, {
    filepath: output,
  }),
);
console.log(
  `Wrote ${output} with ${snapshot.river.points.length} Thames points and ${snapshot.roads.length} road segments.`,
);
