/**
 * RUNWAY — hand-drawn London geometry.
 *
 * A stylised vector map of central London: the Thames (with its famous
 * S-bend around the Isle of Dogs), simplified tube lines in their real TfL
 * colours, the big parks, and a few landmark glyphs. Coordinates are real
 * lng/lat, projected into a small "world unit" space the 3D board uses.
 *
 * This is deliberately NOT Mapbox: the game map is self-contained, needs no
 * token, and is extruded from these polygons into a miniature diorama.
 */

export type LngLat = readonly [number, number]; // [lng, lat]
export interface WorldPoint {
  x: number;
  y: number;
}

// World bounds (covers all hubs + geometry with breathing room).
const LON_MIN = -0.265;
const LON_MAX = 0.065;
const LAT_MIN = 51.452;
const LAT_MAX = 51.552;
const LAT_COS = Math.cos((51.5 * Math.PI) / 180); // ≈0.6226 — keeps shapes undistorted

export const WORLD = {
  width: (LON_MAX - LON_MIN) * 1000 * LAT_COS,
  height: (LAT_MAX - LAT_MIN) * 1000,
};

export function project([lng, lat]: LngLat): WorldPoint {
  return {
    x: (lng - LON_MIN) * 1000 * LAT_COS,
    y: (LAT_MAX - lat) * 1000,
  };
}

/** Centre the 2D world on the origin so the 3D camera can orbit the board. */
export function centerWorld(p: WorldPoint): { x: number; z: number } {
  return { x: p.x - WORLD.width / 2, z: p.y - WORLD.height / 2 };
}

export function pointInRing(lng: number, lat: number, ring: readonly LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const hit = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export function distToSegment(p: WorldPoint, a: WorldPoint, b: WorldPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const x = a.x + dx * t;
  const y = a.y + dy * t;
  return Math.hypot(p.x - x, p.y - y);
}

export function distToPolyline(p: WorldPoint, line: readonly WorldPoint[]): number {
  let min = Infinity;
  for (let i = 1; i < line.length; i++) {
    min = Math.min(min, distToSegment(p, line[i - 1], line[i]));
  }
  return min;
}

// ---------------------------------------------------------------------------
// The Thames, west to east. The loop around the Isle of Dogs is what makes
// the silhouette read instantly as London.
// ---------------------------------------------------------------------------

export const THAMES: readonly LngLat[] = [
  [-0.26, 51.4715],
  [-0.245, 51.464],
  [-0.229, 51.4625],
  [-0.211, 51.4655],
  [-0.193, 51.4665],
  [-0.178, 51.4705],
  [-0.166, 51.477],
  [-0.154, 51.4825],
  [-0.14, 51.485],
  [-0.128, 51.4865],
  [-0.1225, 51.4935],
  [-0.1215, 51.5015],
  [-0.117, 51.5065],
  [-0.108, 51.509],
  [-0.098, 51.5095],
  [-0.088, 51.5075],
  [-0.0755, 51.5055],
  [-0.065, 51.5035],
  [-0.052, 51.5045],
  [-0.0425, 51.508],
  [-0.034, 51.5095],
  [-0.0295, 51.505],
  [-0.0295, 51.4955],
  [-0.024, 51.4875],
  [-0.0135, 51.4835],
  [-0.0045, 51.487],
  [-0.0005, 51.496],
  [0.0005, 51.5045],
  [0.0065, 51.5075],
  [0.013, 51.503],
  [0.0185, 51.4965],
  [0.03, 51.4945],
  [0.043, 51.4975],
  [0.055, 51.505],
] as const;

// ---------------------------------------------------------------------------
// Parks (simple polygons)
// ---------------------------------------------------------------------------

export interface Park {
  name: string;
  points: readonly LngLat[];
  label?: LngLat;
}

export const PARKS: readonly Park[] = [
  {
    name: 'Hyde Park',
    label: [-0.169, 51.5075],
    points: [
      [-0.1885, 51.5028],
      [-0.1875, 51.5098],
      [-0.175, 51.5122],
      [-0.159, 51.5115],
      [-0.1515, 51.5042],
      [-0.168, 51.5018],
    ],
  },
  {
    name: "Regent's Park",
    label: [-0.1535, 51.5288],
    points: [
      [-0.1635, 51.523],
      [-0.164, 51.5325],
      [-0.155, 51.536],
      [-0.1455, 51.5325],
      [-0.144, 51.5245],
      [-0.153, 51.521],
    ],
  },
  {
    name: 'St James’s',
    points: [
      [-0.15, 51.5025],
      [-0.1435, 51.5068],
      [-0.132, 51.5035],
      [-0.14, 51.4995],
    ],
  },
  {
    name: 'Battersea Park',
    points: [
      [-0.1615, 51.4765],
      [-0.1615, 51.4815],
      [-0.147, 51.4815],
      [-0.147, 51.4765],
    ],
  },
  {
    name: 'Victoria Park',
    points: [
      [-0.048, 51.5325],
      [-0.0435, 51.539],
      [-0.0295, 51.538],
      [-0.033, 51.5315],
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Tube lines (real TfL colours, simplified routes)
// ---------------------------------------------------------------------------

export interface TubeLine {
  name: string;
  color: string;
  points: readonly LngLat[];
}

export const TUBE_LINES: readonly TubeLine[] = [
  {
    name: 'Central',
    color: '#E32017',
    points: [
      [-0.224, 51.5045],
      [-0.196, 51.509],
      [-0.158, 51.5135],
      [-0.141, 51.515],
      [-0.12, 51.5172],
      [-0.097, 51.515],
      [-0.089, 51.5133],
      [-0.083, 51.5178],
      [-0.055, 51.527],
      [-0.033, 51.525],
      [0.0, 51.541],
    ],
  },
  {
    name: 'Victoria',
    color: '#0098D4',
    points: [
      [-0.115, 51.462],
      [-0.124, 51.486],
      [-0.134, 51.489],
      [-0.144, 51.4965],
      [-0.143, 51.507],
      [-0.141, 51.515],
      [-0.138, 51.5245],
      [-0.133, 51.528],
      [-0.124, 51.53],
      [-0.104, 51.546],
    ],
  },
  {
    name: 'Jubilee',
    color: '#A0A5A9',
    points: [
      [-0.157, 51.5225],
      [-0.149, 51.514],
      [-0.143, 51.507],
      [-0.125, 51.501],
      [-0.113, 51.5035],
      [-0.105, 51.504],
      [-0.086, 51.505],
      [-0.064, 51.498],
      [-0.05, 51.498],
      [-0.019, 51.5035],
      [0.004, 51.5],
      [0.008, 51.514],
    ],
  },
  {
    name: 'Northern',
    color: '#3d3d46',
    points: [
      [-0.138, 51.462],
      [-0.123, 51.472],
      [-0.113, 51.482],
      [-0.1, 51.494],
      [-0.094, 51.501],
      [-0.088, 51.505],
      [-0.089, 51.5133],
      [-0.089, 51.518],
      [-0.088, 51.526],
      [-0.106, 51.532],
      [-0.124, 51.53],
      [-0.143, 51.539],
    ],
  },
  {
    name: 'Elizabeth',
    color: '#6950A1',
    points: [
      [-0.176, 51.5163],
      [-0.149, 51.514],
      [-0.13, 51.516],
      [-0.105, 51.52],
      [-0.083, 51.5178],
      [-0.06, 51.5192],
      [-0.015, 51.5055],
    ],
  },
  {
    name: 'Piccadilly',
    color: '#003688',
    points: [
      [-0.174, 51.494],
      [-0.16, 51.5005],
      [-0.153, 51.5028],
      [-0.143, 51.507],
      [-0.134, 51.51],
      [-0.128, 51.5113],
      [-0.124, 51.513],
      [-0.12, 51.5172],
      [-0.1245, 51.523],
      [-0.124, 51.53],
    ],
  },
] as const;

// ---------------------------------------------------------------------------
// Area labels + landmarks
// ---------------------------------------------------------------------------

export interface AreaLabel {
  text: string;
  at: LngLat;
}

export const AREA_LABELS: readonly AreaLabel[] = [
  { text: 'WESTMINSTER', at: [-0.133, 51.4985] },
  { text: 'MAYFAIR', at: [-0.148, 51.5098] },
  { text: 'THE CITY', at: [-0.0925, 51.5158] },
  { text: 'GREENWICH', at: [-0.006, 51.4785] },
  { text: 'BRIXTON', at: [-0.115, 51.4605] },
  { text: 'ISLINGTON', at: [-0.103, 51.5385] },
  { text: 'KENSINGTON', at: [-0.193, 51.4985] },
  { text: 'HACKNEY', at: [-0.058, 51.5435] },
  { text: 'WHITECHAPEL', at: [-0.062, 51.5148] },
  { text: 'STRATFORD', at: [0.0, 51.5435] },
] as const;

export type LandmarkKind =
  | 'eye'
  | 'shard'
  | 'bigben'
  | 'bttower'
  | 'stpauls'
  | 'o2'
  | 'towerbridge'
  | 'powerstation';

export interface Landmark {
  kind: LandmarkKind;
  name: string;
  at: LngLat;
}

export const LANDMARKS: readonly Landmark[] = [
  { kind: 'eye', name: 'London Eye', at: [-0.1196, 51.5033] },
  { kind: 'shard', name: 'The Shard', at: [-0.0865, 51.5045] },
  { kind: 'bigben', name: 'Big Ben', at: [-0.1246, 51.5007] },
  { kind: 'bttower', name: 'BT Tower', at: [-0.1389, 51.5215] },
  { kind: 'stpauls', name: "St Paul's", at: [-0.0984, 51.5138] },
  { kind: 'o2', name: 'The O2', at: [0.0032, 51.5029] },
  { kind: 'towerbridge', name: 'Tower Bridge', at: [-0.0755, 51.5055] },
  { kind: 'powerstation', name: 'Battersea Power Station', at: [-0.1446, 51.4818] },
] as const;

// ---------------------------------------------------------------------------
// Land masses — Thames is the shared shoreline so the S-bend reads as a cut
// ---------------------------------------------------------------------------

const THAMES_LAST = THAMES[THAMES.length - 1];
const THAMES_FIRST = THAMES[0];

export const LAND_NORTH: readonly LngLat[] = [
  ...THAMES,
  [LON_MAX, THAMES_LAST[1]],
  [LON_MAX, LAT_MAX],
  [LON_MIN, LAT_MAX],
  [LON_MIN, THAMES_FIRST[1]],
];

export const LAND_SOUTH: readonly LngLat[] = [
  ...[...THAMES].reverse(),
  [LON_MIN, THAMES_FIRST[1]],
  [LON_MIN, LAT_MIN],
  [LON_MAX, LAT_MIN],
  [LON_MAX, THAMES_LAST[1]],
];

export function isOnLand(lng: number, lat: number): boolean {
  return pointInRing(lng, lat, LAND_NORTH) || pointInRing(lng, lat, LAND_SOUTH);
}

export function isInPark(lng: number, lat: number): boolean {
  return PARKS.some((park) => pointInRing(lng, lat, park.points));
}

export interface District {
  name: string;
  /** [lngMin, lngMax, latMin, latMax] */
  bbox: readonly [number, number, number, number];
  count: number;
  h: readonly [number, number];
  tall: number;
  tone: 'glass' | 'stone' | 'brick' | 'fill';
}

/** Building scatter — denser and taller around the eight startup hubs. */
export const DISTRICTS: readonly District[] = [
  {
    name: 'Canary Wharf',
    bbox: [-0.03, -0.008, 51.5, 51.508],
    count: 90,
    h: [1.6, 6.2],
    tall: 0.42,
    tone: 'glass',
  },
  {
    name: 'The City',
    bbox: [-0.1, -0.075, 51.51, 51.52],
    count: 110,
    h: [0.9, 3.6],
    tall: 0.22,
    tone: 'stone',
  },
  {
    name: 'South Bank',
    bbox: [-0.12, -0.08, 51.5, 51.508],
    count: 55,
    h: [0.6, 2.6],
    tall: 0.12,
    tone: 'stone',
  },
  {
    name: 'West End',
    bbox: [-0.15, -0.125, 51.508, 51.518],
    count: 90,
    h: [0.5, 1.9],
    tall: 0.08,
    tone: 'stone',
  },
  {
    name: 'Shoreditch',
    bbox: [-0.09, -0.065, 51.52, 51.532],
    count: 85,
    h: [0.4, 1.6],
    tall: 0.06,
    tone: 'brick',
  },
  {
    name: "King's Cross",
    bbox: [-0.135, -0.112, 51.528, 51.538],
    count: 55,
    h: [0.5, 1.8],
    tall: 0.08,
    tone: 'stone',
  },
  {
    name: 'Camden',
    bbox: [-0.155, -0.13, 51.535, 51.545],
    count: 45,
    h: [0.35, 1.2],
    tall: 0.04,
    tone: 'brick',
  },
  {
    name: 'Battersea',
    bbox: [-0.155, -0.13, 51.474, 51.486],
    count: 40,
    h: [0.4, 1.7],
    tall: 0.08,
    tone: 'brick',
  },
  {
    name: 'Westminster',
    bbox: [-0.14, -0.118, 51.496, 51.506],
    count: 45,
    h: [0.45, 1.8],
    tall: 0.06,
    tone: 'stone',
  },
  {
    name: 'Fill North',
    bbox: [-0.26, 0.05, 51.49, 51.548],
    count: 420,
    h: [0.22, 0.9],
    tall: 0.02,
    tone: 'fill',
  },
  {
    name: 'Fill South',
    bbox: [-0.26, 0.05, 51.455, 51.505],
    count: 280,
    h: [0.2, 0.75],
    tall: 0.015,
    tone: 'fill',
  },
];
