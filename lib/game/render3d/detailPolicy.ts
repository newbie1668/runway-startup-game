export type StockDetail = 'overview' | 'neighbourhood' | 'street';

/** Select a runtime stock representation from the camera ground width. */
export function stockDetailForGroundWidth(widthM: number): StockDetail {
  if (!Number.isFinite(widthM) || widthM <= 0) throw new RangeError('ground width must be finite and positive');
  if (widthM > 2400) return 'overview';
  if (widthM > 600) return 'neighbourhood';
  return 'street';
}
