import { METERS_TO_WORLD } from '../geo';
import type { CoverIndex } from './coverIndex';
import { cellsForBounds } from './coverage';
import type { BoundsXZ, CellId, CityIndex } from './cityIndex';
import { stockDetailForGroundWidth, type StockDetail } from './detailPolicy';

export interface StreamCoveragePlan {
  readonly bounds: BoundsXZ;
  readonly detail: StockDetail;
  readonly visibleStock: readonly CellId[];
  readonly prefetchStock: readonly CellId[];
  readonly retainStock: readonly CellId[];
  readonly visibleCover: readonly CellId[];
  readonly prefetchCover: readonly CellId[];
  readonly retainCover: readonly CellId[];
}

interface GroundCamera {
  groundUnproject(x: number, y: number): { x: number; y: number };
}

const SILHOUETTE_MARGIN_M = 400;
const PREFETCH_RING_M = 400;
const HYSTERESIS_RING_M = 800;

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validateViewport(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('viewport dimensions must be finite and positive');
  }
}

export function cameraGroundBounds(camera: GroundCamera, width: number, height: number): BoundsXZ {
  validateViewport(width, height);
  const corners = [
    camera.groundUnproject(0, 0),
    camera.groundUnproject(width, 0),
    camera.groundUnproject(width, height),
    camera.groundUnproject(0, height),
  ];
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minZ: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxZ: Math.max(...corners.map((point) => point.y)),
  };
}

function coverCellsForBounds(index: CoverIndex, bounds: BoundsXZ, padM: number): CellId[] {
  const pad = padM * METERS_TO_WORLD;
  const query = {
    minX: bounds.minX - pad,
    minZ: bounds.minZ - pad,
    maxX: bounds.maxX + pad,
    maxZ: bounds.maxZ + pad,
  };
  const ids: CellId[] = [];
  for (const id of index.cells.keys()) {
    const comma = id.indexOf(',');
    const ix = Number(id.slice(0, comma));
    const iz = Number(id.slice(comma + 1));
    const cellWorld = index.cellSizeM * METERS_TO_WORLD;
    const minX = ix * cellWorld;
    const minZ = iz * cellWorld;
    if (
      minX <= query.maxX &&
      minX + cellWorld >= query.minX &&
      minZ <= query.maxZ &&
      minZ + cellWorld >= query.minZ
    ) {
      ids.push(id);
    }
  }
  return ids.sort(compareIds);
}

function outside(inner: readonly CellId[], outer: readonly CellId[]): CellId[] {
  const innerSet = new Set(inner);
  return outer.filter((id) => !innerSet.has(id));
}

export function planStreamCoverage(
  city: CityIndex,
  cover: CoverIndex,
  bounds: BoundsXZ,
): StreamCoveragePlan {
  const widthM = (bounds.maxX - bounds.minX) / METERS_TO_WORLD;
  const detail = stockDetailForGroundWidth(widthM);
  const visibleStock = cellsForBounds(city, bounds, SILHOUETTE_MARGIN_M);
  const wantedStock = cellsForBounds(city, bounds, SILHOUETTE_MARGIN_M + PREFETCH_RING_M);
  const retainStock = cellsForBounds(
    city,
    bounds,
    SILHOUETTE_MARGIN_M + PREFETCH_RING_M + HYSTERESIS_RING_M,
  );
  const visibleCover = coverCellsForBounds(cover, bounds, 0);
  const wantedCover = coverCellsForBounds(cover, bounds, PREFETCH_RING_M);
  const retainCover = coverCellsForBounds(cover, bounds, PREFETCH_RING_M + HYSTERESIS_RING_M);
  return {
    bounds,
    detail,
    visibleStock,
    prefetchStock: outside(visibleStock, wantedStock),
    retainStock,
    visibleCover,
    prefetchCover: outside(visibleCover, wantedCover),
    retainCover,
  };
}
