import { METERS_TO_WORLD } from '../geo';
import type { BoundsXZ, CellId, CityIndex } from './cityIndex';

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validateBounds(bounds: BoundsXZ): void {
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minZ) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxZ) ||
    bounds.minX > bounds.maxX ||
    bounds.minZ > bounds.maxZ
  ) {
    throw new RangeError('bounds must be finite and ordered');
  }
}

function intersects(a: BoundsXZ, b: BoundsXZ): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
}

export function cellsForBounds(index: CityIndex, bounds: BoundsXZ, padM: number): CellId[] {
  validateBounds(bounds);
  if (!Number.isFinite(padM) || padM < 0)
    throw new RangeError('padM must be finite and nonnegative');
  const pad = padM * METERS_TO_WORLD;
  const wanted = {
    minX: bounds.minX - pad,
    minZ: bounds.minZ - pad,
    maxX: bounds.maxX + pad,
    maxZ: bounds.maxZ + pad,
  };
  const ids: CellId[] = [];
  for (const [id, cell] of index.cells) if (intersects(cell.bounds, wanted)) ids.push(id);
  return ids.sort(compareIds) as CellId[];
}

export function coverageDelta(
  resident: ReadonlySet<CellId>,
  wanted: readonly CellId[],
): { add: CellId[]; keep: CellId[]; remove: CellId[] } {
  const desired = [...new Set(wanted)].sort(compareIds) as CellId[];
  const current = [...new Set(resident)].sort(compareIds) as CellId[];
  const desiredSet = new Set(desired);
  const currentSet = new Set(current);
  return {
    add: desired.filter((id) => !currentSet.has(id)),
    keep: desired.filter((id) => currentSet.has(id)),
    remove: current.filter((id) => !desiredSet.has(id)),
  };
}
