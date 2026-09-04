/**
 * Bake-time "what stands out" for noticed towers — Kansas's feature step,
 * without Exa/Devin at play time.
 *
 * Named London silhouettes win; Wikipedia intro text is the fallback.
 */

export type NoticedShape =
  | 'slab'
  | 'taper'
  | 'cylinder'
  | 'twist'
  | 'stepped'
  | 'brutalist';

export interface NoticedBand {
  t0: number;
  t1: number;
  scale: number;
  yawDeg: number;
}

/** Crowdsourced / known-skyline silhouettes for the committed noticed set. */
export const SHAPE_FROM_ID: Readonly<Record<string, NoticedShape>> = {
  'one-park-drive': 'cylinder',
  'south-bank-tower': 'cylinder',
  halo: 'cylinder',
  'newfoundland-quay': 'twist',
  'bagshaw-building-wardian-east': 'taper',
  'hobart-building-wardian-west': 'taper',
  'one-thames-quay': 'taper',
  'uncle-elephant-and-castle': 'taper',
  'one-the-elephant': 'taper',
  'stratosphere-tower': 'taper',
  'chelsea-waterfront-tower-west': 'taper',
  '8-bishopsgate': 'stepped',
  'atlas-building': 'stepped',
  'the-stratford': 'stepped',
  'willis-towers-watson': 'stepped',
  'charrington-tower': 'stepped',
  'cromwell-tower': 'brutalist',
  'lauderdale-tower': 'brutalist',
  'hampton-tower': 'slab',
  'harcourt-tower': 'slab',
  citi: 'slab',
  'hsbc-uk': 'slab',
  barclays: 'slab',
  'jp-morgan': 'slab',
  '40-bank-street': 'slab',
  'maine-tower': 'slab',
  'novotel-london-canary-wharf': 'slab',
  'vertus-10-george-street': 'slab',
  '40-charter-street': 'slab',
  'carrara-tower': 'slab',
  'valencia-tower': 'slab',
  'gladwin-tower': 'slab',
};

export function featuresFromText(text: string): NoticedShape | null {
  const t = text.toLowerCase();
  if (/twist|twisted|helical|spiral/.test(t)) return 'twist';
  if (/brutalist|barbican/.test(t)) return 'brutalist';
  if (
    /cylind(?:er|rical)|circular plan|circular tower|round tower|drum-shaped/.test(t)
  ) {
    return 'cylinder';
  }
  if (/setback|stepped profile|stepped tower|terraced crown/.test(t)) return 'stepped';
  if (/taper(?:ing|ed)?|pyramidal|blade-like|slender blade/.test(t)) return 'taper';
  return null;
}

export function resolveShape(id: string, name: string, extract: string): NoticedShape {
  const named = SHAPE_FROM_ID[id];
  if (named) return named;
  return featuresFromText(`${name}\n${extract}`) ?? 'slab';
}

export function isCircularShape(shape: NoticedShape): boolean {
  return shape === 'cylinder';
}

export function bandsForShape(shape: NoticedShape): NoticedBand[] {
  switch (shape) {
    case 'cylinder':
      return [
        { t0: 0, t1: 0.07, scale: 1.08, yawDeg: 0 },
        { t0: 0.07, t1: 0.3, scale: 0.94, yawDeg: 0 },
        { t0: 0.3, t1: 0.54, scale: 0.82, yawDeg: 0 },
        { t0: 0.54, t1: 0.78, scale: 0.7, yawDeg: 0 },
        { t0: 0.78, t1: 1, scale: 0.52, yawDeg: 0 },
      ];
    case 'twist':
      return [
        { t0: 0, t1: 0.1, scale: 1, yawDeg: 0 },
        { t0: 0.1, t1: 0.32, scale: 0.92, yawDeg: 14 },
        { t0: 0.32, t1: 0.54, scale: 0.84, yawDeg: 28 },
        { t0: 0.54, t1: 0.76, scale: 0.74, yawDeg: 44 },
        { t0: 0.76, t1: 1, scale: 0.62, yawDeg: 62 },
      ];
    case 'taper':
      return [
        { t0: 0, t1: 0.1, scale: 1, yawDeg: 0 },
        { t0: 0.1, t1: 0.38, scale: 0.8, yawDeg: 0 },
        { t0: 0.38, t1: 0.7, scale: 0.58, yawDeg: 0 },
        { t0: 0.7, t1: 1, scale: 0.36, yawDeg: 0 },
      ];
    case 'stepped':
      return [
        { t0: 0, t1: 0.14, scale: 1, yawDeg: 0 },
        { t0: 0.14, t1: 0.36, scale: 0.8, yawDeg: 0 },
        { t0: 0.36, t1: 0.6, scale: 0.62, yawDeg: 0 },
        { t0: 0.6, t1: 0.82, scale: 0.44, yawDeg: 0 },
        { t0: 0.82, t1: 1, scale: 0.28, yawDeg: 0 },
      ];
    case 'brutalist':
      return [
        { t0: 0, t1: 0.12, scale: 1.1, yawDeg: 0 },
        { t0: 0.12, t1: 0.9, scale: 1, yawDeg: 0 },
        { t0: 0.9, t1: 1, scale: 0.62, yawDeg: 0 },
      ];
    default:
      return [
        { t0: 0, t1: 0.12, scale: 1.04, yawDeg: 0 },
        { t0: 0.12, t1: 0.86, scale: 0.86, yawDeg: 0 },
        { t0: 0.86, t1: 1, scale: 0.56, yawDeg: 0 },
      ];
  }
}

/** Lift crushed photo samples so ACES does not crush the façade to black. */
export function liftRgb(
  rgb: [number, number, number],
  minL = 0.32,
): [number, number, number] {
  const max = Math.max(rgb[0], rgb[1], rgb[2]);
  const min = Math.min(rgb[0], rgb[1], rgb[2]);
  const l = (max + min) / 2;
  if (l >= minL) return rgb;
  const scale = minL / Math.max(l, 0.04);
  return [
    Math.min(1, rgb[0] * scale),
    Math.min(1, rgb[1] * scale),
    Math.min(1, rgb[2] * scale),
  ];
}

function mix(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] * (1 - t) + b[0] * t,
    a[1] * (1 - t) + b[1] * t,
    a[2] * (1 - t) + b[2] * t,
  ];
}

/** Shape tints so glass towers don't all collapse to the same navy. */
export function tintForShape(
  shape: NoticedShape,
  wall: [number, number, number],
): [number, number, number] {
  switch (shape) {
    case 'brutalist':
      return mix(wall, [0.66, 0.64, 0.6], 0.62);
    case 'twist':
      return mix(wall, [0.32, 0.62, 0.64], 0.48);
    case 'cylinder':
      return mix(wall, [0.78, 0.84, 0.88], 0.42);
    case 'taper':
      return mix(wall, [0.82, 0.86, 0.9], 0.45);
    case 'stepped':
      return mix(wall, [0.52, 0.68, 0.78], 0.35);
    default:
      return wall;
  }
}

/** Setbacks only read if the ledge is darker than the wall. */
export function roofFromWall(wall: [number, number, number]): [number, number, number] {
  return liftRgb([wall[0] * 0.42, wall[1] * 0.42, wall[2] * 0.48], 0.14);
}
