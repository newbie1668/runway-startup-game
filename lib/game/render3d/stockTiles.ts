import type { BoundsXZ, CellId, CityCell, CityIndex } from './cityIndex';

/** World-origin aligned block of `STOCK_TILE_CELLS`×`STOCK_TILE_CELLS` source cells. */
export type StockTileId = `tile:${number},${number}`;

export interface StockTile {
  readonly id: StockTileId;
  readonly bounds: BoundsXZ;
  readonly cells: readonly CityCell[];
}

export interface StockTileIndex {
  readonly tiles: ReadonlyMap<StockTileId, StockTile>;
  readonly tileOf: ReadonlyMap<CellId, StockTileId>;
}

export const STOCK_TILE_CELLS = 4;

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function parseCellId(id: CellId): [number, number] {
  const comma = id.indexOf(',');
  const ix = Number(id.slice(0, comma));
  const iz = Number(id.slice(comma + 1));
  if (!Number.isInteger(ix) || !Number.isInteger(iz)) throw new RangeError(`malformed cell id: ${id}`);
  return [ix, iz];
}

export function stockTileIdFor(cellId: CellId): StockTileId {
  const [ix, iz] = parseCellId(cellId);
  return `tile:${Math.floor(ix / STOCK_TILE_CELLS)},${Math.floor(iz / STOCK_TILE_CELLS)}`;
}

/** Group every existing source cell into its enclosing tile without changing the cell index. */
export function indexStockTiles(city: CityIndex): StockTileIndex {
  const working = new Map<StockTileId, CityCell[]>();
  const tileOf = new Map<CellId, StockTileId>();
  for (const cell of city.cells.values()) {
    const tileId = stockTileIdFor(cell.id);
    tileOf.set(cell.id, tileId);
    let members = working.get(tileId);
    if (!members) {
      members = [];
      working.set(tileId, members);
    }
    members.push(cell);
  }
  const tiles = new Map<StockTileId, StockTile>();
  for (const tileId of [...working.keys()].sort(compareIds)) {
    const cells = working.get(tileId)!.sort((a, b) => compareIds(a.id, b.id));
    const bounds = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
    for (const cell of cells) {
      bounds.minX = Math.min(bounds.minX, cell.bounds.minX);
      bounds.minZ = Math.min(bounds.minZ, cell.bounds.minZ);
      bounds.maxX = Math.max(bounds.maxX, cell.bounds.maxX);
      bounds.maxZ = Math.max(bounds.maxZ, cell.bounds.maxZ);
    }
    tiles.set(tileId, { id: tileId, bounds, cells: Object.freeze(cells) });
  }
  return { tiles, tileOf };
}
