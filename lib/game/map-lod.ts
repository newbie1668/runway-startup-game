/**
 * Map level-of-detail — inspired by Google/Apple Maps zoom tiers.
 * City = flat footprints on continuous ground; zoom in for detail/sprites.
 */

export type MapLodLevel = 'city' | 'district' | 'neighbourhood' | 'street';

export interface HubLod {
  level: MapLodLevel;
  /** Scale for hub ground shape (1 = full cluster pad). */
  footprintScale: number;
  /** Use flat pin (true) vs isometric plaza diamond (false). */
  flatFootprint: boolean;
  showHubSign: boolean;
  showIllustratedSprite: boolean;
  spriteAlpha: number;
  showProceduralBuildings: boolean;
  proceduralAlpha: number;
  showEventTents: boolean;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Relative zoom = current / fit-all zoom for this viewport. */
export function hubLod(zoom: number, fitZoom: number): HubLod {
  const r = zoom / Math.max(0.35, fitZoom);

  // City — Google Maps "footprints" / Apple Maps district view
  if (r < 1.1) {
    return {
      level: 'city',
      footprintScale: 0.2,
      flatFootprint: true,
      showHubSign: false,
      showIllustratedSprite: false,
      spriteAlpha: 0,
      showProceduralBuildings: false,
      proceduralAlpha: 0,
      showEventTents: false,
    };
  }

  // District — small pads, event dots
  if (r < 1.35) {
    return {
      level: 'district',
      footprintScale: 0.42,
      flatFootprint: true,
      showHubSign: r > 1.22,
      showIllustratedSprite: false,
      spriteAlpha: 0,
      showProceduralBuildings: false,
      proceduralAlpha: 0,
      showEventTents: true,
    };
  }

  // Neighbourhood — procedural blocks grow in (Apple 3D blocks)
  if (r < 1.65) {
    const t = clamp01((r - 1.35) / 0.3);
    return {
      level: 'neighbourhood',
      footprintScale: 0.55 + t * 0.25,
      flatFootprint: false,
      showHubSign: true,
      showIllustratedSprite: false,
      spriteAlpha: 0,
      showProceduralBuildings: true,
      proceduralAlpha: t,
      showEventTents: true,
    };
  }

  // Street — illustrated sprites (Google zoom 17+ equivalent)
  const t = clamp01((r - 1.65) / 0.35);
  return {
    level: 'street',
    footprintScale: 1,
    flatFootprint: false,
    showHubSign: true,
    showIllustratedSprite: true,
    spriteAlpha: t,
    showProceduralBuildings: false,
    proceduralAlpha: clamp01(1 - t * 1.4),
    showEventTents: true,
  };
}
