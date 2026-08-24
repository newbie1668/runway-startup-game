/**
 * Central London extract for the /sim mesh.
 *
 * Hyde Park (west) to Docklands (east), Battersea (south) to Camden (north).
 * Covers the eight RUNWAY hubs plus the City and Westminster. Independent of
 * the game content module so /game mechanics stay untouched.
 */

export const OSM_BBOX = {
  west: -0.192,
  south: 51.47,
  east: 0.02,
  north: 51.546,
} as const;

export type SimHubId =
  | 'shoreditch'
  | 'kingscross'
  | 'soho'
  | 'farringdon'
  | 'canarywharf'
  | 'londonbridge'
  | 'camden'
  | 'battersea'
  | 'city'
  | 'westminster';

export interface SimHub {
  id: SimHubId;
  name: string;
  lng: number;
  lat: number;
}

export const SIM_HUBS: readonly SimHub[] = [
  { id: 'shoreditch', name: 'Shoreditch', lng: -0.081, lat: 51.526 },
  { id: 'kingscross', name: "King's Cross", lng: -0.124, lat: 51.533 },
  { id: 'soho', name: 'Soho', lng: -0.135, lat: 51.513 },
  { id: 'farringdon', name: 'Farringdon', lng: -0.105, lat: 51.52 },
  { id: 'canarywharf', name: 'Canary Wharf', lng: -0.019, lat: 51.505 },
  { id: 'londonbridge', name: 'London Bridge', lng: -0.086, lat: 51.503 },
  { id: 'camden', name: 'Camden', lng: -0.142, lat: 51.539 },
  { id: 'battersea', name: 'Battersea', lng: -0.144, lat: 51.48 },
  { id: 'city', name: 'City', lng: -0.089, lat: 51.514 },
  { id: 'westminster', name: 'Westminster', lng: -0.1276, lat: 51.4995 },
] as const;

export const OSM_ORIGIN = {
  lng: (OSM_BBOX.west + OSM_BBOX.east) / 2,
  lat: (OSM_BBOX.south + OSM_BBOX.north) / 2,
} as const;

export const METERS_PER_DEGREE_LAT = 111_320;

export const METERS_PER_DEGREE_LNG =
  METERS_PER_DEGREE_LAT * Math.cos((OSM_ORIGIN.lat * Math.PI) / 180);

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

export const BUILDING_DATA_FILE = 'osm-central-london.geojson';
export const ROADS_DATA_FILE = 'osm-central-london-roads.geojson';
export const LANDCOVER_DATA_FILE = 'osm-central-london-landcover.geojson';
/** Clay-board subset for PR #22. Not the /sim runtime mesh. */
export const SIMPLIFIED_DATA_FILE = 'osm-central-london-simplified.geojson';
export const SIMPLIFIED_MAX_BYTES = 5 * 1024 * 1024;

/** Storey height used when OSM only has building:levels (typical UK). */
export const METERS_PER_LEVEL = 3.1;

export const MIN_BUILDING_AREA_M2 = 20;

export const ROAD_WIDTH_M: Record<string, number> = {
  motorway: 18,
  motorway_link: 10,
  trunk: 14,
  trunk_link: 9,
  primary: 12,
  primary_link: 8,
  secondary: 10,
  secondary_link: 7,
  tertiary: 8,
  tertiary_link: 6.5,
  unclassified: 7,
  residential: 6.5,
  living_street: 6,
  pedestrian: 9,
  service: 4.5,
  cycleway: 3,
};

export const KEEP_HIGHWAYS = [
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
  'tertiary_link',
  'unclassified',
  'residential',
  'living_street',
  'pedestrian',
  'service',
] as const;
