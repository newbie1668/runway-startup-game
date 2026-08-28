/**
 * OSM façade / roof colour helpers for the offline geodata bake.
 * No DOM, no three.js — fetch-geodata and tests import this.
 */

const CSS_NAMED: Record<string, number> = {
  white: 0xf4f1ea,
  black: 0x2a2a2c,
  grey: 0x8a8880,
  gray: 0x8a8880,
  silver: 0xc4c0b8,
  beige: 0xe0d4b8,
  cream: 0xe8dcc8,
  brown: 0x6a4030,
  tan: 0xc4a070,
  red: 0xb03830,
  maroon: 0x6a2020,
  orange: 0xc46838,
  yellow: 0xd8c45c,
  green: 0x4a6848,
  blue: 0x3a5080,
  navy: 0x1a2438,
  pink: 0xc48888,
  purple: 0x5a4068,
  gold: 0xc4a060,
  ivory: 0xf0ead8,
  khaki: 0xc4b888,
  salmon: 0xd08070,
};

const WALL_MATERIAL: Record<string, number> = {
  brick: 0xb85c3a,
  bricks: 0xb85c3a,
  plaster: 0xe8dcc8,
  render: 0xe4d8c4,
  painted: 0xe8dcc8,
    glass: 0x7a92a8,
    mirror: 0x8aa0b4,
  concrete: 0x9a9890,
  cement: 0x9a9890,
  stone: 0xc8c0b0,
  sandstone: 0xd4c4a0,
  limestone: 0xe6dfc8,
  marble: 0xe8e4dc,
  wood: 0x8a6040,
  timber: 0x8a6040,
  metal: 0x6a7888,
  steel: 0x6a7888,
  metal_sheet: 0x6a7888,
  copper: 0x4a7a58,
};

const ROOF_MATERIAL: Record<string, number> = {
  slate: 0x6a7080,
  tile: 0xc46848,
  tiles: 0xc46848,
  roof_tiles: 0xc46848,
  thatch: 0xb89448,
  metal: 0x8a8878,
  metal_sheet: 0x8a8878,
  glass: 0x5a7088,
  asphalt: 0x4a4a4c,
  concrete: 0x8a8880,
  copper: 0x3a6a48,
};

function firstToken(raw: string): string {
  return raw.split(/[;/]/)[0]!.trim().toLowerCase().replace(/\s+/g, '_');
}

export function parseCssColour(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return (
        (parseInt(h[0] + h[0], 16) << 16) | (parseInt(h[1] + h[1], 16) << 8) | parseInt(h[2] + h[2], 16)
      );
    }
    return parseInt(h, 16);
  }
  if (CSS_NAMED[s] !== undefined) return CSS_NAMED[s];
  if (CSS_NAMED[firstToken(s)] !== undefined) return CSS_NAMED[firstToken(s)];
  return null;
}

export function colourFromMaterial(raw: string | undefined, table: Record<string, number>): number | null {
  if (!raw) return null;
  const token = firstToken(raw);
  return table[token] ?? null;
}

export function resolveWallColour(tags: Record<string, string> | undefined): number | null {
  if (!tags) return null;
  return parseCssColour(tags['building:colour']) ?? colourFromMaterial(tags['building:material'], WALL_MATERIAL);
}

export function resolveRoofColour(tags: Record<string, string> | undefined): number | null {
  if (!tags) return null;
  return (
    parseCssColour(tags['roof:colour']) ?? colourFromMaterial(tags['roof:material'], ROOF_MATERIAL)
  );
}

/** 0 means "unset — use the style palette". True black stores as 0x0001. */
export function toRgb565(rgb: number | null): number {
  if (rgb === null) return 0;
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;
  const packed = ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
  return packed === 0 ? 1 : packed;
}

export function fromRgb565(packed: number): number | null {
  if (!packed) return null;
  const r = Math.round(((packed >> 11) & 31) * (255 / 31));
  const g = Math.round(((packed >> 5) & 63) * (255 / 63));
  const b = Math.round((packed & 31) * (255 / 31));
  return (r << 16) | (g << 8) | b;
}

/**
 * True when the packed façade is a typology hint, not a unique paint —
 * pale OSM greys, or a `building:material` table colour (brick, plaster, …)
 * that would otherwise stamp thousands of terraces the same hex.
 */
export function isGenericWallPaint(rgb: number): boolean {
  const r = (rgb >> 16) & 255;
  const g = (rgb >> 8) & 255;
  const b = rgb & 255;
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  if (max - min < 0.08 && max > 0.42) return true;
  for (const hex of Object.values(WALL_MATERIAL)) {
    const dr = Math.abs(((hex >> 16) & 255) - r);
    const dg = Math.abs(((hex >> 8) & 255) - g);
    const db = Math.abs((hex & 255) - b);
    if (dr <= 10 && dg <= 10 && db <= 10) return true;
  }
  return false;
}
