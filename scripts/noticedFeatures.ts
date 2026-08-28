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
        { t0: 0, t1: 0.08, scale: 1.04, yawDeg: 0 },
        { t0: 0.08, t1: 0.34, scale: 0.96, yawDeg: 0 },
        { t0: 0.34, t1: 0.62, scale: 0.9, yawDeg: 0 },
        { t0: 0.62, t1: 0.86, scale: 0.84, yawDeg: 0 },
        { t0: 0.86, t1: 1, scale: 0.7, yawDeg: 0 },
      ];
    case 'twist':
      return [
        { t0: 0, t1: 0.12, scale: 1, yawDeg: 0 },
        { t0: 0.12, t1: 0.34, scale: 0.94, yawDeg: 8 },
        { t0: 0.34, t1: 0.56, scale: 0.88, yawDeg: 16 },
        { t0: 0.56, t1: 0.78, scale: 0.82, yawDeg: 24 },
        { t0: 0.78, t1: 1, scale: 0.72, yawDeg: 34 },
      ];
    case 'taper':
      return [
        { t0: 0, t1: 0.12, scale: 1, yawDeg: 0 },
        { t0: 0.12, t1: 0.4, scale: 0.88, yawDeg: 0 },
        { t0: 0.4, t1: 0.72, scale: 0.72, yawDeg: 0 },
        { t0: 0.72, t1: 1, scale: 0.54, yawDeg: 0 },
      ];
    case 'stepped':
      return [
        { t0: 0, t1: 0.16, scale: 1, yawDeg: 0 },
        { t0: 0.16, t1: 0.4, scale: 0.86, yawDeg: 0 },
        { t0: 0.4, t1: 0.66, scale: 0.7, yawDeg: 0 },
        { t0: 0.66, t1: 0.86, scale: 0.54, yawDeg: 0 },
        { t0: 0.86, t1: 1, scale: 0.38, yawDeg: 0 },
      ];
    case 'brutalist':
      return [
        { t0: 0, t1: 0.1, scale: 1.06, yawDeg: 0 },
        { t0: 0.1, t1: 0.92, scale: 1, yawDeg: 0 },
        { t0: 0.92, t1: 1, scale: 0.68, yawDeg: 0 },
      ];
    default:
      return [
        { t0: 0, t1: 0.14, scale: 1, yawDeg: 0 },
        { t0: 0.14, t1: 0.88, scale: 0.88, yawDeg: 0 },
        { t0: 0.88, t1: 1, scale: 0.62, yawDeg: 0 },
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
