/**
 * SFSIM daytime city palette — muted London stock, stucco, brick, stone.
 *
 * No DOM / three.js. Shared by the runtime builder and offline tests.
 * Each footprint picks a district swatch from a stable hash so neighbouring
 * plots differ (cream next to brick next to grey), without confetti hues.
 */

import {
  STYLE_APARTMENTS,
  STYLE_HOUSE,
  STYLE_INDUSTRIAL,
  STYLE_OFFICE,
  STYLE_RETAIL,
  STYLE_TERRACE,
  STYLE_TOWER,
  type DistrictId,
} from './buildingStyle';
import { isGenericWallPaint } from './osmColour';

/** Pale overcast sky — fog, clear colour, and the 2D canvas CSS gradient all match. */
export const SKY = 0xc5d4e4;
export const GROUND = 0x739456;
export const PARK = 0x6ea84c;
export const PARK_PATH = 0xddd6c6;
export const WATER = 0x6b8498;
export const WATER_BANK = 0x8fa4b4;
export const ASPHALT = 0x3c3e42;
export const PAVEMENT = 0xd6d2c8;
export const MARKING = 0xf3f3ef;
/** Blue-tinted glass rectangles — Kansas civic/street read, not black holes. */
export const WINDOW = 0x3a5470;
export const BAY_GLASS = 0x1c2c40;
/** Roof paint leftovers — not used as coloured HVAC studs on stock. */
export const HVAC_BLUE = 0x3a5080;
export const HVAC_RED = 0x8a3834;
export const HVAC_BLACK = 0x2a3038;
export const SHOPFRONT = 0x3c372f;
export const AWNING = 0xc45c4a;
export const SIGN_BOARD = 0x2a3340;
export const CORNICE = 0xe4dccb;
export const AO_DARK = 0x6a5e50;
export const HVAC = 0x4a5060;
export const PLANT_ROOM = 0x5a5e66;
export const HATCH = 0x3a3c42;
export const CHIMNEY = 0x4a322c;

export const TREE_CANOPY = [0x6f9a4e, 0x81ac5c, 0x5e8a42] as const;
export const TREE_TRUNK = 0x5a4636;

export const ROOF_SLATE = 0x5a6270;
export const ROOF_CHARCOAL = 0x42464e;
export const ROOF_BROWN = 0x5c4538;
export const ROOF_TERRACOTTA = 0x9a6450;
export const ROOF_METAL = 0x5a5e64;

const STOCK_YELLOW = [
  0xc9ae86, 0xc2a478, 0xd4be98, 0xb8966a, 0xc8b090, 0xa88860, 0xd0b890, 0xb8a078,
];
const GEORGIAN_CREAM = [
  0xefe6d4, 0xe8dcc4, 0xf3eadc, 0xe4d8c0, 0xddd0b8, 0xf0e6d0, 0xe6dcc8, 0xd8cdb8,
];
const VICTORIAN_RED = [
  0x8a564c, 0x7e4c44, 0x966258, 0x704840, 0xa07066, 0x825850, 0x8e6058, 0x6c4c44,
];
const PORTLAND = [0xdcd6c8, 0xd0c8b8, 0xe4ddd0, 0xc4bdb0, 0xd8d0c4, 0xb8b09e];
const SOFT_GREY = [0xa8a49c, 0x9c9890, 0xb4b0a8, 0x8e8a84, 0xaca8a0, 0x96928c];
const CHARCOAL = [0x7a8794, 0x6e7b88, 0x8894a0, 0x667480, 0x80909c];
const NAVY_GLASS = [0x7a92a4, 0x6e8698, 0x8aa4b4, 0x668090, 0x7698aa];
const WAREHOUSE = [0x8a7a68, 0x7a6e60, 0x9a8a76, 0x6e6458, 0xa0907c];

export type FacadeFamily =
  'cream' | 'yellow' | 'brick' | 'portland' | 'grey' | 'charcoal' | 'navy' | 'warehouse';

const FAMILY_SWATCH: Record<FacadeFamily, readonly number[]> = {
  cream: GEORGIAN_CREAM,
  yellow: STOCK_YELLOW,
  brick: VICTORIAN_RED,
  portland: PORTLAND,
  grey: SOFT_GREY,
  charcoal: CHARCOAL,
  navy: NAVY_GLASS,
  warehouse: WAREHOUSE,
};

const WINDOW_GLASS = [WINDOW, BAY_GLASS, 0x4a6880, 0x2a4058, 0x5c7890, 0x3e5a72] as const;
const AWNING_PAINTS = [AWNING, 0xa8483c, 0x3d4a58, 0xc4a060, 0x2a3340] as const;

/** Every legal wall swatch — OSM paints snap into this gamut. */
export const WALL_GAMUT: readonly number[] = [
  ...STOCK_YELLOW,
  ...GEORGIAN_CREAM,
  ...VICTORIAN_RED,
  ...PORTLAND,
  ...SOFT_GREY,
  ...CHARCOAL,
  ...NAVY_GLASS,
  ...WAREHOUSE,
];

const ROOF_GAMUT = [ROOF_SLATE, ROOF_CHARCOAL, ROOF_BROWN, ROOF_TERRACOTTA, ROOF_METAL, 0x5a5048];

const DOORS = [0x3a2420, 0x1e2a3c, 0x2a2a2c, 0x2d3d30, 0xe8e0d2, 0x4a3028];

export const DISTRICT_LABEL: Record<DistrictId, string> = {
  canary: 'Canary Wharf',
  city: 'The City',
  westminster: 'Westminster',
  westend: 'West End',
  kensington: 'Kensington',
  camden: 'Camden',
  islington: 'Islington',
  shoreditch: 'Shoreditch',
  eastend: 'East End',
  southbank: 'South Bank',
  battersea: 'Battersea',
  greenwich: 'Greenwich',
  south: 'South London',
  stratford: 'Stratford',
  inner: 'Inner London',
};

export const STYLE_LABEL: Record<number, string> = {
  [STYLE_HOUSE]: 'House',
  [STYLE_TERRACE]: 'Terrace',
  [STYLE_APARTMENTS]: 'Apartments',
  [STYLE_OFFICE]: 'Office',
  [STYLE_INDUSTRIAL]: 'Warehouse',
  [STYLE_RETAIL]: 'Shop',
  [STYLE_TOWER]: 'Tower',
};

/** Kansas use-type labels (residence / business / shop) from OSM style. */
export const USE_LABEL: Record<number, string> = {
  [STYLE_HOUSE]: 'Residence',
  [STYLE_TERRACE]: 'Residence',
  [STYLE_APARTMENTS]: 'Residence',
  [STYLE_OFFICE]: 'Business',
  [STYLE_INDUSTRIAL]: 'Warehouse',
  [STYLE_RETAIL]: 'Shop',
  [STYLE_TOWER]: 'Business',
};

export function rgbToHsl(rgb: number): { h: number; s: number; l: number } {
  const r = ((rgb >> 16) & 255) / 255;
  const g = ((rgb >> 8) & 255) / 255;
  const b = (rgb & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t;
  if (tt < 0) tt += 1;
  if (tt > 1) tt -= 1;
  if (tt < 1 / 6) return p + (q - p) * 6 * tt;
  if (tt < 1 / 2) return q;
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
  return p;
}

export function hslToRgb(h: number, s: number, l: number): number {
  let r: number;
  let g: number;
  let b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
}

function distRgb(a: number, b: number): number {
  const dr = ((a >> 16) & 255) - ((b >> 16) & 255);
  const dg = ((a >> 8) & 255) - ((b >> 8) & 255);
  const db = (a & 255) - (b & 255);
  return dr * dr + dg * dg + db * db;
}

export function nearestSwatch(rgb: number, gamut: readonly number[] = WALL_GAMUT): number {
  let best = gamut[0]!;
  let bestD = Infinity;
  for (const s of gamut) {
    const d = distRgb(rgb, s);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function lerpRgb(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Magenta / lime / cyan / hot orange — the confetti hues we never keep. */
export function isConfettiHue(rgb: number): boolean {
  const { h, s, l } = rgbToHsl(rgb);
  if (s < 0.42 || l < 0.18 || l > 0.88) return false;
  const deg = h * 360;
  if (deg >= 70 && deg <= 160) return true; // lime / teal
  if (deg >= 160 && deg <= 200) return true; // cyan
  if (deg >= 280 && deg <= 340) return true; // magenta
  if (deg >= 20 && deg <= 48 && s > 0.55) return true; // hot orange
  if ((deg <= 15 || deg >= 350) && s > 0.72) return true; // neon red
  return false;
}

/**
 * Keep a real OSM façade only when it can sit in the muted city gamut.
 * Confetti hues are dropped (caller falls back to the neighbourhood family).
 * Everything else is desaturated and pulled toward the nearest swatch.
 */
export function clampWallColour(rgb: number): number | null {
  if (isConfettiHue(rgb)) return null;
  const { h, s, l } = rgbToHsl(rgb);
  const clamped = hslToRgb(h, Math.min(s, 0.34), Math.min(0.74, Math.max(0.28, l)));
  return lerpRgb(clamped, nearestSwatch(clamped), 0.45);
}

export function clampRoofColour(rgb: number): number {
  const { h, s, l } = rgbToHsl(rgb);
  const clamped = hslToRgb(h, Math.min(s, 0.28), Math.min(0.48, Math.max(0.18, l)));
  return lerpRgb(clamped, nearestSwatch(clamped, ROOF_GAMUT), 0.55);
}

/**
 * District still biases the mix (Canary glass, East End brick) but never
 * monopolises it — a terrace street must be able to land cream, brick, and
 * grey on neighbouring plots.
 */
export function familiesFor(style: number, district: DistrictId): readonly FacadeFamily[] {
  if (style === STYLE_TOWER) {
    if (district === 'canary' || district === 'city' || district === 'southbank') {
      return ['navy', 'charcoal'];
    }
    return ['charcoal', 'navy', 'grey'];
  }
  if (style === STYLE_INDUSTRIAL) return ['warehouse', 'brick', 'grey'];
  if (style === STYLE_OFFICE) {
    if (district === 'canary') return ['navy', 'grey', 'portland'];
    return ['portland', 'brick', 'grey', 'cream', 'charcoal'];
  }
  if (style === STYLE_RETAIL) return ['cream', 'brick', 'yellow', 'grey'];
  switch (district) {
    case 'canary':
      return ['grey', 'navy', 'portland'];
    case 'city':
    case 'westminster':
      return ['portland', 'cream', 'brick', 'grey'];
    case 'westend':
    case 'kensington':
      return ['cream', 'brick', 'yellow', 'grey', 'portland'];
    case 'eastend':
    case 'battersea':
    case 'south':
      return ['brick', 'yellow', 'cream', 'grey'];
    case 'shoreditch':
      return ['yellow', 'brick', 'warehouse', 'grey'];
    case 'camden':
      return ['yellow', 'brick', 'cream', 'grey'];
    case 'islington':
      return ['cream', 'brick', 'yellow', 'grey'];
    case 'greenwich':
      return ['cream', 'brick', 'portland', 'grey'];
    case 'southbank':
      return ['portland', 'brick', 'grey', 'cream'];
    case 'stratford':
      return ['grey', 'cream', 'brick', 'portland'];
    default:
      return ['cream', 'brick', 'yellow', 'grey', 'portland'];
  }
}

export function facadeFamily(
  style: number,
  district: DistrictId,
  cx: number,
  cz: number,
  seed: number,
): FacadeFamily {
  const fams = familiesFor(style, district);
  return fams[familyHash(cx, cz, seed) % fams.length]!;
}

export function paletteFor(style: number, district: DistrictId): readonly number[] {
  const out: number[] = [];
  for (const fam of familiesFor(style, district)) {
    out.push(...FAMILY_SWATCH[fam]);
  }
  return out;
}

export function windowHex(seed: number): number {
  return WINDOW_GLASS[seed % WINDOW_GLASS.length]!;
}

export function awningHex(seed: number): number {
  return AWNING_PAINTS[seed % AWNING_PAINTS.length]!;
}

function familyFromOsmRgb(rgb: number): FacadeFamily {
  let best: FacadeFamily = 'cream';
  let bestD = Infinity;
  (Object.keys(FAMILY_SWATCH) as FacadeFamily[]).forEach((fam) => {
    for (const swatch of FAMILY_SWATCH[fam]) {
      const d = distRgb(rgb, swatch);
      if (d < bestD) {
        bestD = d;
        best = fam;
      }
    }
  });
  return best;
}

function pickSwatch(family: FacadeFamily, cx: number, cz: number, seed: number): number {
  const pal = FAMILY_SWATCH[family];
  return pal[familyHash(cx, cz, seed ^ 0x9e3779b9) % pal.length]!;
}

export function roofHex(style: number, pitched: boolean, seed: number): number {
  if (pitched || style === STYLE_HOUSE || style === STYLE_TERRACE) {
    if (seed % 5 === 0) return ROOF_TERRACOTTA;
    if (seed % 4 === 0) return ROOF_SLATE;
    return ROOF_BROWN;
  }
  if (style === STYLE_INDUSTRIAL) return ROOF_METAL;
  if (style === STYLE_OFFICE || style === STYLE_TOWER)
    return seed % 3 === 0 ? ROOF_CHARCOAL : ROOF_SLATE;
  if (style === STYLE_RETAIL && seed % 4 === 0) return ROOF_TERRACOTTA;
  if (style === STYLE_APARTMENTS) {
    if (seed % 3 === 0) return ROOF_BROWN;
    if (seed % 5 === 0) return ROOF_TERRACOTTA;
    return ROOF_SLATE;
  }
  return seed % 4 === 0 ? ROOF_BROWN : ROOF_SLATE;
}

/** Per-building salt (cell is only a weak spatial mix). Neighbouring plots differ. */
const FAMILY_CELL = 0.5;

export function familyHash(cx: number, cz: number, salt = 0): number {
  const fx = Math.round(cx / FAMILY_CELL);
  const fz = Math.round(cz / FAMILY_CELL);
  let h = Math.imul(fx, 374761393) ^ Math.imul(fz, 668265263) ^ Math.imul(salt, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return h >>> 0;
}

export function jitterHex(
  hex: number,
  seed: number,
  spread: { h?: number; s?: number; l?: number } = {},
): number {
  const { h, s, l } = rgbToHsl(hex);
  const u = ((seed >>> 8) & 255) / 255;
  const v = ((seed >>> 16) & 255) / 255;
  const w = ((seed >>> 24) & 255) / 255;
  const nh = (h + (u - 0.5) * (spread.h ?? 0.012) + 1) % 1;
  const ns = Math.min(0.4, Math.max(0.04, s + (v - 0.5) * (spread.s ?? 0.04)));
  const nl = Math.min(0.78, Math.max(0.22, l + (w - 0.5) * (spread.l ?? 0.05)));
  return hslToRgb(nh, ns, nl);
}

export function wallHex(
  style: number,
  district: DistrictId,
  cx: number,
  cz: number,
  seed: number,
  osmRgb: number | null,
): number {
  // Glass towers tagged black/grey in OSM crush to a silhouette. Neighbourhood
  // palettes stay in the readable navy-glass range.
  const allowOsm =
    osmRgb !== null && style !== STYLE_TOWER && !(district === 'canary' && style === STYLE_OFFICE);
  if (allowOsm && osmRgb !== null) {
    if (!isGenericWallPaint(osmRgb)) {
      const clamped = clampWallColour(osmRgb);
      if (clamped !== null) {
        const { l } = rgbToHsl(clamped);
        if (l >= 0.36) return jitterHex(clamped, seed, { h: 0.008, s: 0.02, l: 0.03 });
      }
    } else {
      // OSM brick / plaster / stone is a family hint, not one cloned hex.
      const hinted = familyFromOsmRgb(osmRgb);
      return jitterHex(pickSwatch(hinted, cx, cz, seed), seed, { h: 0.016, s: 0.045, l: 0.07 });
    }
  }
  const fam = facadeFamily(style, district, cx, cz, seed);
  return jitterHex(pickSwatch(fam, cx, cz, seed), seed, { h: 0.016, s: 0.045, l: 0.07 });
}

export function doorHex(seed: number): number {
  return DOORS[seed % DOORS.length]!;
}

const STREETS: Record<DistrictId, readonly string[]> = {
  canary: ['Bank St', 'Canada Sq', 'Churchill Pl'],
  city: ['Bishopsgate', 'Moorgate', 'Cheapside', 'Lombard St'],
  westminster: ['Victoria St', 'Horseferry Rd', 'Marsham St'],
  westend: ['Charlotte St', 'Fitzroy St', 'Goodge St', 'Rathbone Pl'],
  kensington: ['Kensington High St', 'Holland Park Ave', "Earl's Court Rd"],
  camden: ['Camden High St', 'Parkway', 'Delancey St'],
  islington: ['Upper St', 'Essex Rd', 'Liverpool Rd'],
  shoreditch: ['Curtain Rd', 'Old St', 'Great Eastern St'],
  eastend: ['Brick Ln', 'Whitechapel Rd', 'Commercial St'],
  southbank: ['The Cut', 'Stamford St', 'Belvedere Rd'],
  battersea: ['Queenstown Rd', 'Battersea Park Rd', 'Falcon Rd'],
  greenwich: ['Greenwich High Rd', 'Creek Rd', 'Trafalgar Rd'],
  south: ['Brixton Rd', 'Coldharbour Ln', 'Acre Ln'],
  stratford: ['Stratford High St', 'Westfield Ave', 'Montfichet Rd'],
  inner: ['City Rd', 'Goswell Rd', 'Pentonville Rd'],
};

const SIGN_NAMES = [
  'CHARLOTTE',
  'FITZROY',
  'SOHO',
  'OXFORD',
  'BOROUGH',
  'HATTON',
  'CURTAIN',
  'CANAL',
] as const;

export function streetAddress(district: DistrictId, seed: number): string {
  const streets = STREETS[district];
  const n = 2 + (seed % 178);
  return `${n} ${streets[seed % streets.length]!}`;
}

export function facadeSignName(seed: number): string {
  return SIGN_NAMES[seed % SIGN_NAMES.length]!;
}

export function mixHex(a: number, b: number, t: number): number {
  return lerpRgb(a, b, t);
}
