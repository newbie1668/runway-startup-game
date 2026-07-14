/**
 * RUNWAY — canvas renderer barrel.
 * Legacy top-down MapRenderer removed; isometric renderer is the default.
 */

export * from './map-scene';
export { IsoMapRenderer, IsoMapRenderer as MapRenderer } from './iso-render';
