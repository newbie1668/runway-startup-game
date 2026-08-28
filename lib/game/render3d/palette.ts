/**
 * SFSIM daytime city palette — muted London stock, stucco, brick, stone.
 *
 * No DOM / three.js. Shared by the runtime builder and offline tests.
 * Adjacent buildings share a family swatch (block-scale hash) with only
 * small per-building lightness jitter — never random confetti hues.
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

/** Pale overcast sky — fog, clear colour, and the 2D canvas CSS gradient all match. */
export const SKY = 0xc5d4e4;
export const GROUND = 0xb7b2a6;
export const PARK = 0x7d966c;
export const PARK_PATH = 0xd5cfc2;
export const WATER = 0x6a86a0;
export const WATER_BANK = 0x8aa0b2;
export const ASPHALT = 0x6e7074;
export const PAVEMENT = 0xc6c2b8;
export const MARKING = 0xf3f3ef;
export const WINDOW = 0x1a2230;
export const SHOPFRONT = 0x3c372f;
export const CORNICE = 0xe4dccb;
export const AO_DARK = 0x6a5e50;
export const HVAC = 0x4a5060;
export const PLANT_ROOM = 0x5a5e66;
export const HATCH = 0x3a3c42;
export const CHIMNEY = 0x4a322c;

export const TREE_CANOPY = [0x5a7a48, 0x6a8a54, 0x4e6e40] as const;
export const TREE_TRUNK = 0x5a4636;

export const ROOF_SLATE = 0x4a5060;
export const ROOF_CHARCOAL = 0x3a3c42;
export const ROOF_BROWN = 0x4a3a32;
export const ROOF_TERRACOTTA = 0x8a5a48;
export const ROOF_METAL = 0x4c5056;

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
const CHARCOAL = [0x3d4654, 0x4a5462, 0x353e4c, 0x5a6470, 0x2e3644];
const NAVY_GLASS = [0x3a4a5c, 0x2e3c4e, 0x46586a, 0x334050, 0x3e4c5c];
const WAREHOUSE = [0x8a7a68, 0x7a6e60, 0x9a8a76, 0x6e6458, 0xa0907c];

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

export function paletteFor(style: number, district: DistrictId): readonly number[] {
  switch (district) {
    case 'canary':
      return style === STYLE_TOWER || style === STYLE_OFFICE || style === STYLE_APARTMENTS
        ? NAVY_GLASS
        : SOFT_GREY;
    case 'city':
      return style === STYLE_TOWER ? CHARCOAL : PORTLAND;
    case 'westminster':
      return style === STYLE_TOWER ? CHARCOAL : PORTLAND;
    case 'westend':
    case 'kensington':
      if (style === STYLE_TOWER) return CHARCOAL;
      if (style === STYLE_HOUSE || style === STYLE_TERRACE) return GEORGIAN_CREAM;
      return GEORGIAN_CREAM;
    case 'islington':
      if (style === STYLE_TOWER) return CHARCOAL;
      if (style === STYLE_TERRACE || style === STYLE_HOUSE) {
        return [...GEORGIAN_CREAM, ...VICTORIAN_RED.slice(0, 3)];
      }
      return GEORGIAN_CREAM;
    case 'camden':
      return style === STYLE_TOWER ? CHARCOAL : STOCK_YELLOW;
    case 'shoreditch':
      if (style === STYLE_TOWER) return CHARCOAL;
      if (style === STYLE_INDUSTRIAL) return WAREHOUSE;
      return [...STOCK_YELLOW, ...VICTORIAN_RED.slice(0, 4)];
    case 'eastend':
      return style === STYLE_TOWER ? CHARCOAL : [...VICTORIAN_RED, ...STOCK_YELLOW.slice(0, 3)];
    case 'southbank':
      return style === STYLE_TOWER ? NAVY_GLASS : PORTLAND;
    case 'battersea':
      return style === STYLE_TOWER ? NAVY_GLASS : VICTORIAN_RED;
    case 'greenwich':
      return style === STYLE_TOWER ? CHARCOAL : GEORGIAN_CREAM;
    case 'south':
      return style === STYLE_TOWER ? CHARCOAL : [...VICTORIAN_RED, ...STOCK_YELLOW];
    case 'stratford':
      return style === STYLE_TOWER || style === STYLE_OFFICE ? SOFT_GREY : GEORGIAN_CREAM;
    default:
      break;
  }
  switch (style) {
    case STYLE_HOUSE:
      return STOCK_YELLOW;
    case STYLE_TERRACE:
      return [...STOCK_YELLOW, ...VICTORIAN_RED.slice(0, 4), ...GEORGIAN_CREAM.slice(0, 3)];
    case STYLE_OFFICE:
      return [...PORTLAND, ...CHARCOAL.slice(0, 3)];
    case STYLE_INDUSTRIAL:
      return WAREHOUSE;
    case STYLE_RETAIL:
      return [...GEORGIAN_CREAM, ...VICTORIAN_RED.slice(0, 3)];
    case STYLE_TOWER:
      return NAVY_GLASS;
    default:
      return [...SOFT_GREY, ...GEORGIAN_CREAM.slice(0, 3), ...VICTORIAN_RED.slice(0, 2)];
  }
}

export function roofHex(style: number, pitched: boolean, seed: number): number {
  if (pitched) {
    if (style === STYLE_HOUSE) return seed % 5 === 0 ? ROOF_TERRACOTTA : ROOF_BROWN;
    return seed % 7 === 0 ? ROOF_BROWN : ROOF_SLATE;
  }
  if (style === STYLE_INDUSTRIAL) return ROOF_METAL;
  if (style === STYLE_OFFICE || style === STYLE_TOWER)
    return seed % 3 === 0 ? ROOF_CHARCOAL : ROOF_SLATE;
  if (style === STYLE_RETAIL && seed % 6 === 0) return ROOF_TERRACOTTA;
  return ROOF_SLATE;
}

/** ~55 m cells: a terrace row shares a family, the next block can shift. */
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
  if (osmRgb !== null && style !== STYLE_HOUSE && style !== STYLE_TERRACE) {
    const clamped = clampWallColour(osmRgb);
    if (clamped !== null) return jitterHex(clamped, seed, { h: 0.008, s: 0.02, l: 0.03 });
  }
  const pal = paletteFor(style, district);
  const fam = familyHash(cx, cz, style);
  const base = pal[fam % pal.length]!;
  return jitterHex(base, seed, { h: 0.01, s: 0.03, l: 0.045 });
}

export function doorHex(seed: number): number {
  return DOORS[seed % DOORS.length]!;
}

export function mixHex(a: number, b: number, t: number): number {
  return lerpRgb(a, b, t);
}
