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

/** Civic / house exaggeration. Towers use TOWER_HEIGHT_SCALE so the skyline punches. */
export const HEIGHT_SCALE = 1.55;
/** SFSIM-style vertical pop for ≥50 m towers and named skyscraper landmarks. */
export const TOWER_HEIGHT_SCALE = 2.25;
/** bake-noticed.ts wrote GLBs at 1.5× — instance them with TOWER / this. */
export const NOTICED_BAKE_HEIGHT_SCALE = 1.5;

export type DistrictId =
  | 'canary'
  | 'city'
  | 'westminster'
  | 'westend'
  | 'kensington'
  | 'camden'
  | 'islington'
  | 'shoreditch'
  | 'eastend'
  | 'southbank'
  | 'battersea'
  | 'greenwich'
  | 'south'
  | 'stratford'
  | 'inner';

/** First-match boxes. Specific neighbourhoods before the inner-London default. */
const DISTRICT_BOXES: ReadonlyArray<{
  id: DistrictId;
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}> = [
  { id: 'canary', minLng: -0.032, maxLng: 0.018, minLat: 51.494, maxLat: 51.511 },
  { id: 'city', minLng: -0.112, maxLng: -0.074, minLat: 51.509, maxLat: 51.522 },
  { id: 'southbank', minLng: -0.121, maxLng: -0.075, minLat: 51.499, maxLat: 51.51 },
  { id: 'westminster', minLng: -0.15, maxLng: -0.121, minLat: 51.494, maxLat: 51.508 },
  { id: 'westend', minLng: -0.165, maxLng: -0.135, minLat: 51.496, maxLat: 51.52 },
  { id: 'kensington', minLng: -0.23, maxLng: -0.165, minLat: 51.482, maxLat: 51.512 },
  { id: 'battersea', minLng: -0.165, maxLng: -0.115, minLat: 51.468, maxLat: 51.488 },
  { id: 'shoreditch', minLng: -0.088, maxLng: -0.045, minLat: 51.518, maxLat: 51.548 },
  { id: 'islington', minLng: -0.118, maxLng: -0.088, minLat: 51.528, maxLat: 51.55 },
  { id: 'camden', minLng: -0.16, maxLng: -0.118, minLat: 51.528, maxLat: 51.55 },
  { id: 'eastend', minLng: -0.075, maxLng: -0.04, minLat: 51.508, maxLat: 51.525 },
  { id: 'greenwich', minLng: -0.02, maxLng: 0.04, minLat: 51.468, maxLat: 51.494 },
  { id: 'stratford', minLng: -0.02, maxLng: 0.05, minLat: 51.528, maxLat: 51.552 },
  { id: 'south', minLng: -0.15, maxLng: -0.07, minLat: 51.452, maxLat: 51.478 },
];

export function districtAt(lng: number, lat: number): DistrictId {
  for (const box of DISTRICT_BOXES) {
    if (lng >= box.minLng && lng < box.maxLng && lat >= box.minLat && lat < box.maxLat)
      return box.id;
  }
  return 'inner';
}

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
export function facadeSlice(
  style: number,
  district: DistrictId = 'inner',
): {
  v0: number;
  vSpan: number;
  uPeriodM: number;
  floorM: number;
  rows: number;
} {
  let slice: { v0: number; vSpan: number; uPeriodM: number; floorM: number; rows: number };
  switch (style) {
    case STYLE_OFFICE:
    case STYLE_TOWER:
      slice = { v0: 0.51, vSpan: 0.23, uPeriodM: 7.8, floorM: 3.8, rows: 8 };
      break;
    case STYLE_INDUSTRIAL:
      slice = { v0: 0.76, vSpan: 0.23, uPeriodM: 12.0, floorM: 5.2, rows: 2 };
      break;
    case STYLE_APARTMENTS:
    case STYLE_RETAIL:
      slice = { v0: 0.26, vSpan: 0.23, uPeriodM: 6.4, floorM: 3.3, rows: 4 };
      break;
    default:
      slice = { v0: 0.01, vSpan: 0.23, uPeriodM: 5.4, floorM: 3.2, rows: 4 };
  }
  if (district === 'canary' && (style === STYLE_TOWER || style === STYLE_OFFICE)) {
    return { ...slice, uPeriodM: 9.4, floorM: 4.0 };
  }
  if (
    (district === 'islington' ||
      district === 'kensington' ||
      district === 'westend' ||
      district === 'westminster') &&
    (style === STYLE_HOUSE || style === STYLE_TERRACE)
  ) {
    return { ...slice, uPeriodM: 4.6, floorM: 3.15 };
  }
  if ((district === 'shoreditch' || district === 'eastend') && style === STYLE_INDUSTRIAL) {
    return { ...slice, uPeriodM: 14.0, floorM: 5.5 };
  }
  return slice;
}

/**
 * V range for a wall strip covering `floors` storeys. One floor = one atlas
 * row; never squash 16 floors into a sliver (that stretched into cardboard).
 */
export function facadeVForFloors(
  style: number,
  floors: number,
  district: DistrictId = 'inner',
): { v0: number; v1: number } {
  const slice = facadeSlice(style, district);
  const take = Math.min(slice.rows, Math.max(0.4, floors));
  const rowV = slice.vSpan / slice.rows;
  return { v0: slice.v0 + 0.006, v1: slice.v0 + take * rowV - 0.004 };
}

export function inferStyle(heightM: number, areaM2: number): number {
  if (heightM >= 40 || (heightM >= 26 && areaM2 < 900)) return STYLE_TOWER;
  if (areaM2 >= 1800 && heightM <= 16) return STYLE_INDUSTRIAL;
  if (heightM <= 11 && areaM2 <= 220) return STYLE_HOUSE;
  if (heightM <= 18 && areaM2 <= 900) return STYLE_TERRACE;
  if (heightM <= 24) return STYLE_APARTMENTS;
  return STYLE_OFFICE;
}

export function inferRoof(style: number): number {
  if (style === STYLE_HOUSE) return ROOF_HIPPED;
  if (style === STYLE_TERRACE) return ROOF_GABLED;
  return ROOF_FLAT;
}

/**
 * Street-front window grids. Skip tiny edges and the long party walls of
 * terraces (those are the *longest* sides — putting windows there hid every
 * sash from the street).
 */
export function wantFacadeWindows(edgeM: number, heightM: number, style: number): boolean {
  if (style === STYLE_TOWER) return false;
  if (heightM < 5.2 || edgeM < 3.5) return false;
  if ((style === STYLE_HOUSE || style === STYLE_TERRACE) && edgeM > 15.5) return false;
  return true;
}

/**
 * Kansas street-camera bays: rectangular protrusions on residential fronts.
 * Short edges (6–13.5 m) are a house street face; long edges (≥20 m) are a
 * whole terrace row. The 13.5–20 m band is usually depth / party wall.
 */
export function wantBayWindows(edgeM: number, heightM: number, style: number): boolean {
  if (style !== STYLE_HOUSE && style !== STYLE_TERRACE && style !== STYLE_APARTMENTS) {
    return false;
  }
  if (heightM < 7 || heightM > 22) return false;
  if (edgeM >= 6.2 && edgeM <= 13.5) return true;
  if ((style === STYLE_TERRACE || style === STYLE_APARTMENTS) && edgeM >= 20 && edgeM <= 55) {
    return true;
  }
  return false;
}

export function bayCountForEdge(edgeM: number): number {
  if (edgeM >= 20) return Math.min(5, Math.max(3, Math.round(edgeM / 8)));
  if (edgeM >= 10) return 2;
  return 1;
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
    if (heightM >= 48) style = STYLE_TOWER;
    else style = heightM <= 12 && areaM2 <= 280 ? STYLE_TERRACE : STYLE_APARTMENTS;
  } else if (
    /^(office|commercial|hotel|civic|public|government|university|school|hospital|college)$/.test(t)
  ) {
    style = heightM >= 40 ? STYLE_TOWER : STYLE_OFFICE;
  } else if (
    /^(industrial|warehouse|factory|manufacture|shed|garage|garages|hangar|service|train_station)$/.test(
      t,
    )
  ) {
    style = STYLE_INDUSTRIAL;
  } else if (/^(retail|supermarket|kiosk|mall|shop)$/.test(t)) style = STYLE_RETAIL;
  else if (/^(church|cathedral|chapel|mosque|synagogue|temple)$/.test(t)) style = STYLE_OFFICE;
  else style = inferStyle(heightM, areaM2);

  const taggedRoof = roofFromTag(tags?.['roof:shape']);
  const roof = taggedRoof ?? inferRoof(style);
  return { style, roof };
}

export function resolveStyle(stored: number, heightM: number, areaM2: number): number {
  const style = stored === STYLE_INFER ? inferStyle(heightM, areaM2) : stored;
  if (
    heightM >= 48 &&
    (style === STYLE_APARTMENTS || style === STYLE_HOUSE || style === STYLE_TERRACE)
  ) {
    return STYLE_TOWER;
  }
  return style;
}

/** Neighbourhood massing on top of OSM tags — Canary glass, Kensington stucco rows, etc. */
export function restyleForDistrict(
  style: number,
  heightM: number,
  areaM2: number,
  district: DistrictId,
): number {
  switch (district) {
    case 'canary':
      if (heightM >= 36 && style !== STYLE_INDUSTRIAL) return STYLE_TOWER;
      if (heightM >= 18 && style !== STYLE_INDUSTRIAL && style !== STYLE_TOWER) return STYLE_OFFICE;
      return style;
    case 'city':
      if (heightM >= 40) return STYLE_TOWER;
      if (
        heightM >= 16 &&
        (style === STYLE_HOUSE || style === STYLE_TERRACE || style === STYLE_APARTMENTS)
      ) {
        return STYLE_OFFICE;
      }
      return style;
    case 'westminster':
    case 'westend':
      if (heightM >= 48) return STYLE_TOWER;
      if (heightM >= 14 && style === STYLE_HOUSE) return STYLE_TERRACE;
      if (
        heightM >= 18 &&
        heightM < 48 &&
        (style === STYLE_APARTMENTS || style === STYLE_TERRACE)
      ) {
        return STYLE_OFFICE;
      }
      return style;
    case 'kensington':
      if (style === STYLE_HOUSE && areaM2 >= 100) return STYLE_TERRACE;
      if (heightM >= 40) return STYLE_TOWER;
      return style;
    case 'shoreditch':
    case 'eastend':
      if (heightM >= 48) return STYLE_TOWER;
      if (
        heightM <= 22 &&
        areaM2 >= 220 &&
        (style === STYLE_APARTMENTS || style === STYLE_TERRACE)
      ) {
        return STYLE_INDUSTRIAL;
      }
      return style;
    case 'southbank':
    case 'stratford':
      if (heightM >= 32 && (style === STYLE_APARTMENTS || style === STYLE_OFFICE))
        return STYLE_TOWER;
      return style;
    case 'battersea':
      if (heightM >= 40) return STYLE_TOWER;
      if (heightM <= 22 && areaM2 >= 350 && style !== STYLE_TOWER) return STYLE_INDUSTRIAL;
      return style;
    case 'islington':
    case 'camden':
    case 'south':
      if (heightM <= 14 && style === STYLE_APARTMENTS && areaM2 <= 400) return STYLE_TERRACE;
      if (heightM >= 48) return STYLE_TOWER;
      return style;
    case 'greenwich':
      if (heightM >= 55) return STYLE_TOWER;
      return style;
    default:
      return style;
  }
}

export function extrusionScale(
  style: number,
  heightM: number,
  district: DistrictId = 'inner',
): number {
  if (district === 'canary' && heightM >= 40) return TOWER_HEIGHT_SCALE;
  if (heightM >= 80 || style === STYLE_TOWER) return TOWER_HEIGHT_SCALE;
  if (style === STYLE_OFFICE || heightM >= 28) return 1.85;
  return HEIGHT_SCALE;
}

export function wantPodium(
  style: number,
  heightM: number,
  areaM2: number,
  district: DistrictId,
): boolean {
  if (style !== STYLE_TOWER && style !== STYLE_OFFICE) return false;
  if (district === 'canary') return heightM >= 40 && areaM2 > 700;
  if (district === 'city' || district === 'southbank' || district === 'stratford') {
    return heightM >= 50 && areaM2 > 900;
  }
  return heightM >= 55 && areaM2 > 1100;
}
