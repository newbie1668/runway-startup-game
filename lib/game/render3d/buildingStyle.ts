/**
 * Building typology for the 3D city. Shared by the offline Overpass pipeline
 * (which packs style/roof into london-city.bin) and the runtime builder
 * (which can still infer if an older bin has style=0).
 *
 * Kept free of DOM / three.js so the fetch script can import it.
 */

export const STYLE_INFER = 0;
export const STYLE_HOUSE = 1;
export const STYLE_TERRACE = 2;
export const STYLE_APARTMENTS = 3;
export const STYLE_OFFICE = 4;
export const STYLE_INDUSTRIAL = 5;
export const STYLE_RETAIL = 6;
export const STYLE_TOWER = 7;

export const ROOF_FLAT = 0;
export const ROOF_GABLED = 1;
export const ROOF_HIPPED = 2;

export function packFlags(major: boolean, style: number, roof: number): number {
  return (major ? 1 : 0) | ((style & 7) << 1) | ((roof & 3) << 4);
}

export function unpackFlags(flags: number): { major: boolean; style: number; roof: number } {
  return {
    major: (flags & 1) === 1,
    style: (flags >> 1) & 7,
    roof: (flags >> 4) & 3,
  };
}

/** Facade atlas slice (v range in 0..1 on a 4-band texture). */
export function facadeSlice(style: number): { v0: number; vSpan: number; uPeriodM: number; floorM: number } {
  switch (style) {
    case STYLE_OFFICE:
    case STYLE_TOWER:
      return { v0: 0.51, vSpan: 0.23, uPeriodM: 5.2, floorM: 3.8 };
    case STYLE_INDUSTRIAL:
      return { v0: 0.76, vSpan: 0.23, uPeriodM: 9.0, floorM: 5.2 };
    case STYLE_APARTMENTS:
    case STYLE_RETAIL:
      return { v0: 0.26, vSpan: 0.23, uPeriodM: 4.2, floorM: 3.3 };
    default:
      return { v0: 0.01, vSpan: 0.23, uPeriodM: 3.1, floorM: 3.2 };
  }
}

export function inferStyle(heightM: number, areaM2: number): number {
  if (heightM >= 40 || (heightM >= 26 && areaM2 < 900)) return STYLE_TOWER;
  if (areaM2 >= 1800 && heightM <= 16) return STYLE_INDUSTRIAL;
  if (heightM <= 11 && areaM2 <= 220) return STYLE_HOUSE;
  if (heightM <= 16 && areaM2 <= 520) return STYLE_TERRACE;
  if (heightM <= 22) return STYLE_APARTMENTS;
  return STYLE_OFFICE;
}

export function inferRoof(style: number): number {
  if (style === STYLE_HOUSE) return ROOF_HIPPED;
  if (style === STYLE_TERRACE) return ROOF_GABLED;
  return ROOF_FLAT;
}

function roofFromTag(shape: string | undefined): number | null {
  if (!shape) return null;
  const s = shape.toLowerCase();
  if (/gabled|pitched|saltbox|round/.test(s)) return ROOF_GABLED;
  if (/hipped|pyramidal|gambrel|mansard|half/.test(s)) return ROOF_HIPPED;
  if (/flat|skillion|dome/.test(s)) return ROOF_FLAT;
  return null;
}

export function classifyBuilding(
  tags: Record<string, string> | undefined,
  heightM: number,
  areaM2: number,
): { style: number; roof: number } {
  const t = (tags?.building ?? 'yes').toLowerCase();
  let style = STYLE_INFER;
  if (/^(house|detached|bungalow|villa|cabin)$/.test(t)) style = STYLE_HOUSE;
  else if (/^(terrace|semidetached_house|semidetached)$/.test(t)) style = STYLE_TERRACE;
  else if (/^(apartments|residential|dormitory|maisonette)$/.test(t)) {
    style = heightM <= 12 && areaM2 <= 280 ? STYLE_TERRACE : STYLE_APARTMENTS;
  } else if (/^(office|commercial|hotel|civic|public|government|university|school|hospital|college)$/.test(t)) {
    style = heightM >= 40 ? STYLE_TOWER : STYLE_OFFICE;
  } else if (/^(industrial|warehouse|factory|manufacture|shed|garage|garages|hangar|service|train_station)$/.test(t)) {
    style = STYLE_INDUSTRIAL;
  } else if (/^(retail|supermarket|kiosk|mall|shop)$/.test(t)) style = STYLE_RETAIL;
  else if (/^(church|cathedral|chapel|mosque|synagogue|temple)$/.test(t)) style = STYLE_OFFICE;
  else style = inferStyle(heightM, areaM2);

  const taggedRoof = roofFromTag(tags?.['roof:shape']);
  const roof = taggedRoof ?? inferRoof(style);
  return { style, roof };
}

export function resolveStyle(stored: number, heightM: number, areaM2: number): number {
  return stored === STYLE_INFER ? inferStyle(heightM, areaM2) : stored;
}
