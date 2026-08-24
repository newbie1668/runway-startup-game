/**
 * RUNWAY — hand-drawn London geometry.
 *
 * A stylised vector map of central London: the Thames (the S-bend around the
 * Isle of Dogs is the spine), parks, landmarks, and OSM-style city-block
 * footprints. Coordinates are real lng/lat, projected into world units the
 * 3D board extrudes. Tube lines are intentionally absent — this is a
 * tabletop city, not a TfL diagram.
 *
 * This is deliberately NOT Mapbox / Google Earth / a store mesh: the game
 * map is self-contained and extruded from these polygons.
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
// Regent's Canal — Camden Lock to the King's Cross basin, then east.
// A second water spine so north-of-the-river hubs are not a beige smear.
// ---------------------------------------------------------------------------

export const CANAL: readonly LngLat[] = [
  [-0.158, 51.5418],
  [-0.1495, 51.5412],
  [-0.1462, 51.5408],
  [-0.142, 51.5402],
  [-0.1355, 51.538],
  [-0.1295, 51.5358],
  [-0.125, 51.5352],
  [-0.1195, 51.5346],
  [-0.108, 51.5334],
  [-0.096, 51.5324],
  [-0.082, 51.5316],
  [-0.068, 51.531],
  [-0.052, 51.5304],
  [-0.038, 51.5296],
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
  {
    name: 'Soho Square',
    points: [
      [-0.1336, 51.5148],
      [-0.1318, 51.5148],
      [-0.1318, 51.5158],
      [-0.1336, 51.5158],
    ],
  },
  {
    name: 'Golden Square',
    points: [
      [-0.1378, 51.5112],
      [-0.1364, 51.5112],
      [-0.1364, 51.5122],
      [-0.1378, 51.5122],
    ],
  },
  {
    name: 'Hoxton Square',
    points: [
      [-0.0832, 51.5272],
      [-0.0816, 51.5272],
      [-0.0816, 51.5284],
      [-0.0832, 51.5284],
    ],
  },
];

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
  'eye' | 'shard' | 'bigben' | 'bttower' | 'stpauls' | 'o2' | 'towerbridge' | 'powerstation';

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
    name: 'Clerkenwell',
    bbox: [-0.112, -0.096, 51.518, 51.526],
    count: 55,
    h: [0.45, 1.7],
    tall: 0.05,
    tone: 'brick',
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

export const LAND_SLAB: readonly LngLat[] = [
  [LON_MIN, LAT_MIN],
  [LON_MAX, LAT_MIN],
  [LON_MAX, LAT_MAX],
  [LON_MIN, LAT_MAX],
];

export interface CityBlock {
  ring: LngLat[];
  h: number;
  tone: District['tone'];
}

function rectRing(lng: number, lat: number, wLng: number, hLat: number): LngLat[] {
  const hw = wLng / 2;
  const hd = hLat / 2;
  return [
    [lng - hw, lat - hd],
    [lng + hw, lat - hd],
    [lng + hw, lat + hd],
    [lng - hw, lat + hd],
  ];
}

function lRing(
  lng: number,
  lat: number,
  w: number,
  d: number,
  cutW: number,
  cutD: number,
): LngLat[] {
  const x0 = lng - w / 2;
  const x1 = lng + w / 2;
  const y0 = lat - d / 2;
  const y1 = lat + d / 2;
  const cx = x1 - cutW;
  const cy = y1 - cutD;
  return [
    [x0, y0],
    [x1, y0],
    [x1, cy],
    [cx, cy],
    [cx, y1],
    [x0, y1],
  ];
}

function rotRing(lng: number, lat: number, w: number, d: number, rad: number): LngLat[] {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const pts: LngLat[] = [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ];
  return pts.map(([dx, dy]) => [lng + dx * c - dy * s, lat + dx * s + dy * c]);
}

function hash01(i: number, j: number, salt = 1): number {
  let n = (i * 374761393 + j * 668265263 + salt * 1274126177) >>> 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n >>> 0) % 10000) / 10000;
}

function degDist(a: LngLat, b: LngLat): number {
  const dx = (a[0] - b[0]) * LAT_COS;
  const dy = a[1] - b[1];
  return Math.hypot(dx, dy);
}

const THAMES_PROJECTED: readonly WorldPoint[] = THAMES.map(project);

function nearLandmark(lng: number, lat: number): boolean {
  for (const lm of LANDMARKS) {
    const clear =
      lm.kind === 'shard' ||
      lm.kind === 'eye' ||
      lm.kind === 'bigben' ||
      lm.kind === 'stpauls' ||
      lm.kind === 'towerbridge'
        ? 0.0042
        : 0.0026;
    if (degDist([lng, lat], lm.at) < clear) return true;
  }
  return false;
}

function grainFor(name: string) {
  switch (name) {
    case 'Canary Wharf':
      return { stepLng: 0.00155, stepLat: 0.001, streetCol: 3, streetRow: 3, inset: 0.2 };
    case 'The City':
      return { stepLng: 0.00142, stepLat: 0.00095, streetCol: 4, streetRow: 3, inset: 0.16 };
    case 'South Bank':
      return { stepLng: 0.0017, stepLat: 0.0011, streetCol: 4, streetRow: 3, inset: 0.2 };
    case 'West End':
      return { stepLng: 0.00112, stepLat: 0.0008, streetCol: 3, streetRow: 3, inset: 0.14 };
    case 'Shoreditch':
      return { stepLng: 0.0019, stepLat: 0.00122, streetCol: 4, streetRow: 3, inset: 0.12 };
    case "King's Cross":
      return { stepLng: 0.00215, stepLat: 0.00112, streetCol: 3, streetRow: 4, inset: 0.15 };
    case 'Camden':
      return { stepLng: 0.0017, stepLat: 0.00115, streetCol: 4, streetRow: 3, inset: 0.18 };
    case 'Battersea':
      return { stepLng: 0.002, stepLat: 0.0013, streetCol: 3, streetRow: 3, inset: 0.16 };
    case 'Westminster':
      return { stepLng: 0.0015, stepLat: 0.001, streetCol: 4, streetRow: 3, inset: 0.18 };
    case 'Clerkenwell':
      return { stepLng: 0.00138, stepLat: 0.00095, streetCol: 4, streetRow: 3, inset: 0.15 };
    default:
      return { stepLng: 0.0054, stepLat: 0.0036, streetCol: 4, streetRow: 3, inset: 0.24 };
  }
}

export const DOCKS: readonly { name: string; ring: LngLat[] }[] = [
  { name: 'North Dock', ring: rectRing(-0.0198, 51.5072, 0.0145, 0.0012) },
  { name: 'Middle Dock', ring: rectRing(-0.0188, 51.5047, 0.0135, 0.0011) },
  { name: 'South Dock', ring: rectRing(-0.0178, 51.5024, 0.012, 0.001) },
];

const CLEARINGS: readonly { at: LngLat; r: number }[] = [
  { at: [-0.0876, 51.5256], r: 0.0023 }, // Old Street roundabout
  { at: [-0.1494, 51.5431], r: 0.0017 }, // Roundhouse
  { at: [-0.1258, 51.5316], r: 0.0034 }, // King's Cross sheds
  { at: [-0.1018, 51.5185], r: 0.0022 }, // Smithfield
  { at: [-0.0906, 51.5055], r: 0.0016 }, // Borough Market
  { at: [-0.1462, 51.5408], r: 0.0015 }, // Camden Lock
  { at: [-0.0194, 51.5049], r: 0.0014 }, // 1 Canada Square pad
];

const CANAL_PROJECTED: readonly WorldPoint[] = CANAL.map(project);

export function isInDock(lng: number, lat: number): boolean {
  return DOCKS.some((d) => pointInRing(lng, lat, d.ring));
}

function inClearing(lng: number, lat: number): boolean {
  return CLEARINGS.some((c) => degDist([lng, lat], c.at) < c.r);
}

const AUTHORED: CityBlock[] = [
  // Canary Wharf cluster — 1 Canada Square and neighbours, real-ish pads.
  { ring: rectRing(-0.0194, 51.5049, 0.00155, 0.00115), h: 9.6, tone: 'glass' },
  { ring: rectRing(-0.0174, 51.5055, 0.00135, 0.00105), h: 8.4, tone: 'glass' },
  { ring: rectRing(-0.0216, 51.5045, 0.0017, 0.00095), h: 7.2, tone: 'glass' },
  { ring: rectRing(-0.0144, 51.5052, 0.0021, 0.001), h: 6.6, tone: 'glass' },
  { ring: rectRing(-0.0238, 51.5061, 0.00115, 0.0019), h: 8.8, tone: 'glass' },
  { ring: rectRing(-0.0262, 51.5035, 0.001, 0.00155), h: 7.5, tone: 'glass' },
  { ring: rectRing(-0.0182, 51.5033, 0.00145, 0.0009), h: 5.4, tone: 'glass' },
  { ring: rectRing(-0.0126, 51.5038, 0.0017, 0.00115), h: 5.0, tone: 'glass' },
  { ring: rectRing(-0.0208, 51.5068, 0.0012, 0.001), h: 6.1, tone: 'glass' },
  // City — Bank / Gherkin pad / Barbican grain.
  { ring: rectRing(-0.0807, 51.5145, 0.0011, 0.0011), h: 6.4, tone: 'glass' },
  { ring: rectRing(-0.088, 51.5155, 0.0023, 0.00135), h: 4.1, tone: 'stone' },
  { ring: rectRing(-0.0832, 51.5136, 0.0016, 0.0017), h: 5.2, tone: 'glass' },
  { ring: rectRing(-0.0935, 51.517, 0.0026, 0.0015), h: 2.7, tone: 'stone' },
  { ring: rectRing(-0.0962, 51.5142, 0.0017, 0.0021), h: 3.3, tone: 'stone' },
  { ring: lRing(-0.0864, 51.5178, 0.0024, 0.0018, 0.0011, 0.0008), h: 2.9, tone: 'stone' },
  // King's Cross — train-shed bars.
  { ring: rectRing(-0.1255, 51.5318, 0.0048, 0.00095), h: 1.45, tone: 'stone' },
  { ring: rectRing(-0.123, 51.5304, 0.0042, 0.00085), h: 1.25, tone: 'stone' },
  { ring: rectRing(-0.1276, 51.5342, 0.0025, 0.00135), h: 1.7, tone: 'brick' },
  { ring: rectRing(-0.1212, 51.5336, 0.0022, 0.0016), h: 2.1, tone: 'glass' },
  // Shoreditch warehouses.
  { ring: rectRing(-0.0775, 51.5258, 0.0028, 0.0014), h: 1.15, tone: 'brick' },
  { ring: rectRing(-0.0812, 51.5244, 0.0022, 0.0018), h: 1.05, tone: 'brick' },
  { ring: lRing(-0.084, 51.5272, 0.0026, 0.0019, 0.0011, 0.0009), h: 0.95, tone: 'brick' },
  { ring: rectRing(-0.0738, 51.5266, 0.0031, 0.0012), h: 1.35, tone: 'brick' },
  // Soho terrace strips.
  { ring: rectRing(-0.1342, 51.5132, 0.0007, 0.0024), h: 0.95, tone: 'stone' },
  { ring: rectRing(-0.1356, 51.5134, 0.00065, 0.0022), h: 0.88, tone: 'brick' },
  { ring: rectRing(-0.1328, 51.5126, 0.0007, 0.0026), h: 1.02, tone: 'stone' },
  { ring: rectRing(-0.1368, 51.5118, 0.0018, 0.0007), h: 0.82, tone: 'brick' },
  // Battersea industrial.
  { ring: rectRing(-0.1478, 51.4794, 0.0034, 0.0016), h: 1.55, tone: 'brick' },
  { ring: rectRing(-0.1412, 51.4788, 0.0026, 0.0018), h: 1.25, tone: 'brick' },
  { ring: rectRing(-0.139, 51.4826, 0.0022, 0.0012), h: 2.4, tone: 'glass' },
  // Camden market sheds.
  { ring: rectRing(-0.1428, 51.5406, 0.0024, 0.0011), h: 0.72, tone: 'brick' },
  { ring: rectRing(-0.1455, 51.5392, 0.0018, 0.0015), h: 0.85, tone: 'brick' },

  // Shoreditch — Brick Lane bar, Great Eastern St warehouses, Boxpark pad.
  { ring: rectRing(-0.0718, 51.5224, 0.00055, 0.0048), h: 0.95, tone: 'brick' },
  { ring: rotRing(-0.0765, 51.5248, 0.0032, 0.00115, 0.7), h: 1.2, tone: 'brick' },
  { ring: rotRing(-0.0795, 51.5236, 0.0026, 0.00105, 0.7), h: 1.05, tone: 'brick' },
  { ring: rectRing(-0.0778, 51.522, 0.0016, 0.0011), h: 0.7, tone: 'brick' },
  { ring: rectRing(-0.0855, 51.5268, 0.0024, 0.0016), h: 1.35, tone: 'brick' },
  // Farringdon — Smithfield long halls + Exmouth warehouse.
  { ring: rectRing(-0.1016, 51.5186, 0.0038, 0.00115), h: 1.05, tone: 'brick' },
  { ring: rectRing(-0.1016, 51.5175, 0.0036, 0.00085), h: 0.9, tone: 'brick' },
  { ring: rectRing(-0.1088, 51.5228, 0.0028, 0.0007), h: 0.85, tone: 'brick' },
  { ring: rectRing(-0.1042, 51.5212, 0.0018, 0.0014), h: 1.15, tone: 'brick' },
  // London Bridge — Borough Market vaults + station shed.
  { ring: rectRing(-0.0907, 51.5055, 0.0018, 0.0012), h: 0.7, tone: 'brick' },
  { ring: rectRing(-0.0888, 51.5048, 0.0014, 0.0009), h: 0.62, tone: 'brick' },
  { ring: rectRing(-0.0862, 51.5042, 0.0026, 0.00095), h: 1.15, tone: 'stone' },
  { ring: rectRing(-0.0834, 51.5028, 0.0016, 0.0018), h: 2.4, tone: 'glass' },
  // Canary — more tower pads around the docks.
  { ring: rectRing(-0.0224, 51.5058, 0.0011, 0.0011), h: 8.1, tone: 'glass' },
  { ring: rectRing(-0.0162, 51.5066, 0.00125, 0.0009), h: 7.0, tone: 'glass' },
  { ring: rectRing(-0.015, 51.5036, 0.0018, 0.00085), h: 6.2, tone: 'glass' },
  { ring: rectRing(-0.021, 51.5028, 0.0014, 0.001), h: 5.5, tone: 'glass' },
  // King's Cross extra: Coal Drops + Google bar.
  { ring: rectRing(-0.1268, 51.5348, 0.0022, 0.0008), h: 1.15, tone: 'brick' },
  { ring: rectRing(-0.1252, 51.5356, 0.002, 0.00075), h: 1.05, tone: 'brick' },
  { ring: rectRing(-0.1204, 51.5332, 0.0036, 0.0007), h: 1.85, tone: 'glass' },
  // Soho — more tight terraces around the squares.
  { ring: rectRing(-0.1332, 51.5138, 0.00055, 0.0018), h: 0.92, tone: 'brick' },
  { ring: rectRing(-0.1344, 51.5142, 0.0005, 0.0016), h: 0.86, tone: 'stone' },
  { ring: rectRing(-0.1362, 51.5124, 0.0005, 0.0019), h: 0.9, tone: 'brick' },
  { ring: rectRing(-0.1316, 51.5122, 0.0014, 0.00055), h: 0.78, tone: 'stone' },
  // Camden — lock-side sheds.
  { ring: rectRing(-0.1474, 51.5404, 0.0015, 0.0008), h: 0.65, tone: 'brick' },
  { ring: rectRing(-0.1448, 51.5412, 0.0012, 0.0007), h: 0.58, tone: 'brick' },
  // Battersea riverside glass + park-edge brick.
  { ring: rectRing(-0.1385, 51.4842, 0.0032, 0.0009), h: 2.1, tone: 'glass' },
  { ring: rectRing(-0.1495, 51.4834, 0.0024, 0.00085), h: 1.8, tone: 'glass' },
];

function namedBboxContains(lng: number, lat: number): boolean {
  for (const d of DISTRICTS) {
    if (d.tone === 'fill') continue;
    const [lng0, lng1, lat0, lat1] = d.bbox;
    if (lng >= lng0 && lng <= lng1 && lat >= lat0 && lat <= lat1) return true;
  }
  return false;
}

function pushGrid(out: CityBlock[], district: District) {
  const [lng0, lng1, lat0, lat1] = district.bbox;
  const g = grainFor(district.name);
  const fill = district.tone === 'fill';
  let col = 0;
  for (let lng = lng0; lng < lng1 - g.stepLng * 0.35; lng += g.stepLng) {
    col += 1;
    let row = 0;
    for (let lat = lat0; lat < lat1 - g.stepLat * 0.35; lat += g.stepLat) {
      row += 1;
      if (col % g.streetCol === 0 || row % g.streetRow === 0) continue;
      const lngC = lng + g.stepLng * 0.5;
      const latC = lat + g.stepLat * 0.5;
      if (fill && namedBboxContains(lngC, latC)) continue;
      if (!isOnLand(lngC, latC) || isInPark(lngC, latC)) continue;
      if (isInDock(lngC, latC) || inClearing(lngC, latC)) continue;
      if (nearLandmark(lngC, latC)) continue;
      if (distToPolyline(project([lngC, latC]), THAMES_PROJECTED) < 2.5) continue;
      if (distToPolyline(project([lngC, latC]), CANAL_PROJECTED) < 1.05) continue;
      const n = hash01(col, row, district.name.length);
      if (fill && n > 0.58) continue;
      const inset = g.inset + n * 0.08;
      const w = g.stepLng * (1 - inset);
      const d = g.stepLat * (1 - inset * 0.9);
      const h0 = district.h[0];
      const span = district.h[1] - district.h[0];
      const tall = n < district.tall;
      const h = tall ? h0 + (0.55 + n * 0.45) * span : h0 + Math.pow(n, 1.45) * span * 0.72;
      const ring =
        n > 0.72 && n < 0.86
          ? lRing(lngC, latC, w * 1.15, d * 1.1, w * 0.45, d * 0.42)
          : n > 0.86
            ? rectRing(lngC, latC, w * 1.55, d * 0.72)
            : rectRing(lngC, latC, w, d);
      out.push({ ring, h, tone: district.tone });
    }
  }
}

function buildCityBlocks(): CityBlock[] {
  const out: CityBlock[] = [...AUTHORED];
  for (const d of DISTRICTS) {
    if (d.tone === 'fill') continue;
    pushGrid(out, d);
  }
  for (const d of DISTRICTS) {
    if (d.tone !== 'fill') continue;
    pushGrid(out, d);
  }
  return out;
}

export const CITY_BLOCKS: readonly CityBlock[] = buildCityBlocks();
