export type SimLayer = 'building' | 'road' | 'park' | 'water';

export interface BuildingProperties {
  osmId: string;
  layer: 'building';
  building: string;
  name?: string;
  height: number;
  minHeight?: number;
  levels?: number;
  heightSource: 'height' | 'levels' | 'estimate' | 'landmark';
}

export interface RoadProperties {
  osmId: string;
  layer: 'road';
  highway: string;
  name?: string;
  width: number;
}

export interface LandcoverProperties {
  osmId: string;
  layer: 'park' | 'water';
  kind: 'park' | 'water';
  name?: string;
}

export type SimProperties = BuildingProperties | RoadProperties | LandcoverProperties;

export interface SimFeature<P extends SimProperties = SimProperties> {
  type: 'Feature';
  properties: P;
  geometry: {
    type: 'Polygon' | 'MultiPolygon' | 'LineString' | 'MultiLineString';
    coordinates: unknown;
  };
}

export interface SimFeatureCollection<P extends SimProperties = SimProperties> {
  type: 'FeatureCollection';
  name: string;
  attribution: string;
  bbox: [number, number, number, number];
  generated: string;
  meta: {
    featureCount: number;
    source: string;
  };
  features: SimFeature<P>[];
}

export type LngLat = [number, number];
