/**
 * RUNWAY — hand-drawn London geometry.
 *
 * A stylised vector map of central London: the Thames (with its famous
 * S-bend around the Isle of Dogs), simplified tube lines in their real TfL
 * colours, the big parks, and a few landmark glyphs. Coordinates are real
 * lng/lat, projected into a small "world unit" space the renderer draws in.
 *
 * This is deliberately NOT Mapbox: the game map is self-contained, needs no
 * token, and is drawn from scratch on a <canvas>.
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

// 1 world unit ≈ 111.32 m (see WORLD comment above); world units per metre.
export const METERS_TO_WORLD = 1000 / 111320;

export function project([lng, lat]: LngLat): WorldPoint {
  return {
    x: (lng - LON_MIN) * 1000 * LAT_COS,
    y: (LAT_MAX - lat) * 1000,
  };
}

export function unproject(x: number, y: number): LngLat {
  return [LON_MIN + x / (1000 * LAT_COS), LAT_MAX - y / 1000];
}

/** Thames direction in world XY (east, south-positive as used by the 3D Z axis). */
export function thamesTangent(at: LngLat): { x: number; y: number } {
  const p = project(at);
  const pts = THAMES.map((ll) => project(ll));
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i]!.x - p.x, pts[i]!.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  const a = pts[Math.max(0, best - 1)]!;
  const b = pts[Math.min(pts.length - 1, best + 1)]!;
  const x = b.x - a.x;
  const y = b.y - a.y;
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/**
 * Y rotation for a mesh modelled along local +X so that +X crosses the Thames.
 * Three.js Y-rotation maps +X to (cos θ, 0, −sin θ).
 */
export function bridgeSpanYawX(at: LngLat): number {
  const t = thamesTangent(at);
  const dirX = -t.y;
  const dirZ = t.x;
  return Math.atan2(-dirZ, dirX);
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
  | 'gherkin'
  | 'towerbridge'
  | 'walkie'
  | 'grater'
  | 'canadasq'
  | 'battersea'
  | 'bishop'
  | 'heron'
  | 'tower42'
  | 'abbey'
  | 'oldstreet'
  | 'westminsterbr'
  | 'lambethbr'
  | 'waterloobr'
  | 'blackfriarsbr'
  | 'londonbr'
  | 'millennium'
  | 'albertbr'
  | 'hungerford'
  | 'towerlondon'
  | 'buckingham'
  | 'monument'
  | 'britishmuseum'
  | 'allsouls'
  | 'goodgest'
  | 'stcharles'
  | 'nationaltheatre'
  | 'tatemodern'
  | 'stpancras'
  | 'alberthall';

export interface Landmark {
  kind: LandmarkKind;
  name: string;
  at: LngLat;
  /** Skip generic OSM extrusions within this radius so the silhouette isn't doubled. */
  exclusionM?: number;
  /**
   * Extra Y rotation (radians) applied when instancing the baked mesh.
   * Bridge decks are modelled along local +X; set this so +X crosses the Thames.
   */
  yaw?: number;
}

/** Named civic decks (bridges + Old Street). River spans also get OSM asphalt, except Tower Bridge which carries its own designed deck. */
export function isDeckLandmark(kind: LandmarkKind): boolean {
  return (
    kind === 'towerbridge' ||
    kind === 'millennium' ||
    kind === 'hungerford' ||
    kind === 'oldstreet' ||
    kind.endsWith('br')
  );
}

/** Mid-river points for every Thames crossing in the bake — prefab or not. */
export const THAMES_CROSSINGS: readonly { name: string; at: LngLat }[] = [
  { name: 'Putney Bridge', at: [-0.213, 51.4668] },
  { name: 'Hammersmith Bridge', at: [-0.2304, 51.4882] },
  { name: 'Wandsworth Bridge', at: [-0.1875, 51.4655] },
  { name: 'Battersea Bridge', at: [-0.1726, 51.4811] },
  { name: 'Chelsea Bridge', at: [-0.15, 51.4845] },
  { name: 'Vauxhall Bridge', at: [-0.1267, 51.4875] },
  { name: 'Southwark Bridge', at: [-0.0942, 51.5086] },
] as const;

/** `?look=chelseabr` for unnamed road crossings that still get an asphalt stitch. */
export function thamesCrossingLookKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+bridge$/, 'br')
    .replace(/\s+/g, '');
}

export const LANDMARKS: readonly Landmark[] = [
  { kind: 'eye', name: 'London Eye', at: [-0.1196, 51.5033], exclusionM: 90, yaw: 0.12 },
  { kind: 'shard', name: 'The Shard', at: [-0.0865, 51.5045], exclusionM: 90 },
  { kind: 'bigben', name: 'Palace of Westminster', at: [-0.1246, 51.5007], exclusionM: 160 },
  { kind: 'bttower', name: 'BT Tower', at: [-0.1389, 51.5215], exclusionM: 70 },
  { kind: 'stpauls', name: "St Paul's", at: [-0.0984, 51.5138], exclusionM: 110 },
  { kind: 'o2', name: 'The O2', at: [0.0032, 51.5029], exclusionM: 220 },
  { kind: 'gherkin', name: 'The Gherkin', at: [-0.0803, 51.5145], exclusionM: 80 },
  { kind: 'towerbridge', name: 'Tower Bridge', at: [-0.0754, 51.5055], exclusionM: 160 },
  { kind: 'walkie', name: 'Walkie Talkie', at: [-0.0837, 51.5114], exclusionM: 80 },
  { kind: 'grater', name: 'The Cheesegrater', at: [-0.0825, 51.5139], exclusionM: 90 },
  { kind: 'canadasq', name: 'One Canada Square', at: [-0.0196, 51.505], exclusionM: 110 },
  { kind: 'battersea', name: 'Battersea Power Station', at: [-0.1446, 51.4819], exclusionM: 180 },
  { kind: 'bishop', name: '22 Bishopsgate', at: [-0.083, 51.5144], exclusionM: 90 },
  { kind: 'heron', name: 'Heron Tower', at: [-0.081, 51.5162], exclusionM: 80 },
  { kind: 'tower42', name: 'Tower 42', at: [-0.0838, 51.5152], exclusionM: 70 },
  { kind: 'abbey', name: 'Westminster Abbey', at: [-0.1273, 51.4994], exclusionM: 90 },
  { kind: 'oldstreet', name: 'Old Street Roundabout', at: [-0.0877, 51.5256], exclusionM: 90 },
  {
    kind: 'westminsterbr',
    name: 'Westminster Bridge',
    at: [-0.1218, 51.5008],
    exclusionM: 90,
    yaw: bridgeSpanYawX([-0.1218, 51.5008]),
  },
  {
    kind: 'lambethbr',
    name: 'Lambeth Bridge',
    at: [-0.123, 51.4945],
    exclusionM: 90,
    yaw: bridgeSpanYawX([-0.123, 51.4945]),
  },
  {
    kind: 'waterloobr',
    name: 'Waterloo Bridge',
    at: [-0.1172, 51.5084],
    exclusionM: 90,
    yaw: bridgeSpanYawX([-0.1172, 51.5084]),
  },
  {
    kind: 'blackfriarsbr',
    name: 'Blackfriars Bridge',
    at: [-0.1044, 51.5096],
    exclusionM: 90,
    yaw: bridgeSpanYawX([-0.1044, 51.5096]),
  },
  {
    kind: 'londonbr',
    name: 'London Bridge',
    at: [-0.0877, 51.5079],
    exclusionM: 90,
    yaw: bridgeSpanYawX([-0.0877, 51.5079]),
  },
  {
    kind: 'millennium',
    name: 'Millennium Bridge',
    at: [-0.0985, 51.5104],
    exclusionM: 80,
    yaw: bridgeSpanYawX([-0.0985, 51.5104]),
  },
  {
    kind: 'albertbr',
    name: 'Albert Bridge',
    at: [-0.1668, 51.4824],
    exclusionM: 90,
    yaw: bridgeSpanYawX([-0.1668, 51.4824]),
  },
  {
    kind: 'hungerford',
    name: 'Hungerford Bridge',
    at: [-0.1201, 51.5062],
    exclusionM: 80,
    yaw: bridgeSpanYawX([-0.1201, 51.5062]),
  },
  { kind: 'towerlondon', name: 'Tower of London', at: [-0.0759, 51.5081], exclusionM: 110 },
  { kind: 'buckingham', name: 'Buckingham Palace', at: [-0.1419, 51.5014], exclusionM: 160 },
  { kind: 'monument', name: 'The Monument', at: [-0.0861, 51.5102], exclusionM: 40 },
  { kind: 'britishmuseum', name: 'British Museum', at: [-0.1269, 51.5194], exclusionM: 140 },
  { kind: 'allsouls', name: 'All Souls Langham Place', at: [-0.14315, 51.51775], exclusionM: 55 },
  { kind: 'goodgest', name: 'Goodge Street station', at: [-0.1347, 51.5205], exclusionM: 45 },
  { kind: 'stcharles', name: 'St Charles Borromeo', at: [-0.1374, 51.5203], exclusionM: 40 },
  { kind: 'nationaltheatre', name: 'National Theatre', at: [-0.1144, 51.5072], exclusionM: 90 },
  { kind: 'tatemodern', name: 'Tate Modern', at: [-0.0993, 51.5077], exclusionM: 110 },
  { kind: 'stpancras', name: 'St Pancras', at: [-0.1254, 51.5304], exclusionM: 140 },
  { kind: 'alberthall', name: 'Royal Albert Hall', at: [-0.1774, 51.5009], exclusionM: 90 },
] as const;
