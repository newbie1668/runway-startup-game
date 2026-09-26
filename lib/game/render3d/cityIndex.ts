import { METERS_TO_WORLD } from '../geo';
import { dequantizeX, dequantizeY } from './format';
import type { CityData } from './format';

export type CellId = `${number},${number}`;

export interface BoundsXZ {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export interface CityCell {
  id: CellId;
  bounds: BoundsXZ;
  buildingIndices: readonly number[];
}

export interface CityIndex {
  cells: ReadonlyMap<CellId, CityCell>;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Build a stable owner-cell index without changing the decoded city data. */
export function indexCity(data: CityData, cellSizeM: number): CityIndex {
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) {
    throw new RangeError('cellSizeM must be a finite positive number');
  }
  const cellWorld = cellSizeM * METERS_TO_WORLD;
  if (!Number.isFinite(cellWorld) || cellWorld <= 0) {
    throw new RangeError('cellSizeM is too small to produce a positive world cell size');
  }
  const working = new Map<CellId, { bounds: BoundsXZ; indices: number[] }>();

  data.buildings.forEach((building, buildingIndex) => {
    if (building.verts.length < 6 || building.verts.length % 2 !== 0) {
      throw new RangeError(`building ${buildingIndex} has a malformed footprint`);
    }
    const vertexCount = building.verts.length / 2;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < vertexCount; i++) {
      cx += dequantizeX(building.verts[i * 2]!);
      cz += dequantizeY(building.verts[i * 2 + 1]!);
    }
    cx /= vertexCount;
    cz /= vertexCount;
    const ix = Math.floor(cx / cellWorld);
    const iz = Math.floor(cz / cellWorld);
    const id = `${ix},${iz}` as CellId;
    let entry = working.get(id);
    if (!entry) {
      entry = {
        bounds: {
          minX: ix * cellWorld,
          minZ: iz * cellWorld,
          maxX: (ix + 1) * cellWorld,
          maxZ: (iz + 1) * cellWorld,
        },
        indices: [],
      };
      working.set(id, entry);
    }
    entry.indices.push(buildingIndex);
    for (let i = 0; i < vertexCount; i++) {
      const x = dequantizeX(building.verts[i * 2]!);
      const z = dequantizeY(building.verts[i * 2 + 1]!);
      entry.bounds.minX = Math.min(entry.bounds.minX, x);
      entry.bounds.minZ = Math.min(entry.bounds.minZ, z);
      entry.bounds.maxX = Math.max(entry.bounds.maxX, x);
      entry.bounds.maxZ = Math.max(entry.bounds.maxZ, z);
    }
  });

  const cells = new Map<CellId, CityCell>();
  [...working.keys()].sort(compareIds).forEach((id) => {
    const entry = working.get(id)!;
    entry.indices.sort((a, b) => a - b);
    cells.set(id, {
      id,
      bounds: { ...entry.bounds },
      buildingIndices: Object.freeze([...entry.indices]),
    });
  });
  return { cells };
}
