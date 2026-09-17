import * as THREE from 'three';
import { METERS_TO_WORLD } from '../geo';
import type { BoundsXZ } from './cityIndex';
import { WATER_BANK_Y, WATER_Y } from './cityBuilder';
import {
  COVER_PAGE_INDICES,
  COVER_PAGE_VERTICES,
  createCoverJob,
  createCoverPageWriter,
  type CoverBuildContext,
  type CoverJobOptions,
} from './coverGeometry';
import type { CoverPoint as Point } from './coverClip';
import { dequantizeX, dequantizeY, type CityData, type CityPoly } from './format';
import * as pal from './palette';

function point(poly: CityPoly, i: number): Point {
  return { x: dequantizeX(poly.verts[i * 2]!), z: dequantizeY(poly.verts[i * 2 + 1]!) };
}

function bankNormal(poly: CityPoly, i: number, n: number, halfWidth: number): Point {
  const before = point(poly, Math.max(0, i - 1));
  const after = point(poly, Math.min(n, i + 1) % n);
  const dx = after.x - before.x,
    dz = after.z - before.z;
  const length = Math.hypot(dx, dz) || 1;
  return { x: (-dz / length) * halfWidth, z: (dx / length) * halfWidth };
}

function* waterSteps(
  context: CoverBuildContext,
  cityData: CityData,
  selection: readonly number[],
  bounds: BoundsXZ | null,
): Generator<void> {
  const surface = createCoverPageWriter(context, () =>
    context.own(
      new THREE.MeshLambertMaterial({
        color: pal.WATER,
        side: THREE.DoubleSide,
        fog: true,
      }),
    ),
  );
  for (const source of selection) {
    const poly = cityData.water[source];
    if (!poly || poly.verts.length < 6 || poly.verts.length % 2)
      throw new RangeError(`invalid water record ${source}`);
    yield;
    const vertexCount = poly.verts.length / 2;
    if (
      !bounds &&
      vertexCount <= COVER_PAGE_VERTICES &&
      poly.indices.length <= COVER_PAGE_INDICES
    ) {
      yield* surface.reserve(vertexCount, poly.indices.length);
      const base = surface.vertexCount;
      for (let i = 0; i < poly.verts.length; i += 2) {
        surface.vertex(dequantizeX(poly.verts[i]!), WATER_Y, dequantizeY(poly.verts[i + 1]!));
        yield;
      }
      for (let i = 0; i < poly.indices.length; i += 3) {
        surface.triangle(
          base + poly.indices[i]!,
          base + poly.indices[i + 1]!,
          base + poly.indices[i + 2]!,
        );
        yield;
      }
    } else {
      for (let i = 0; i < poly.indices.length; i += 3) {
        yield* surface.polygon(
          [
            point(poly, poly.indices[i]!),
            point(poly, poly.indices[i + 1]!),
            point(poly, poly.indices[i + 2]!),
          ],
          WATER_Y,
          bounds,
        );
        yield;
      }
    }
  }
  yield* surface.finish(context.root);
  yield;
  const halfWidth = 3.4 * METERS_TO_WORLD;
  const banks = createCoverPageWriter(context, () =>
    context.own(
      new THREE.MeshLambertMaterial({
        color: pal.WATER_BANK,
        side: THREE.DoubleSide,
        fog: true,
      }),
    ),
  );
  for (const source of selection) {
    const poly = cityData.water[source]!;
    const n = poly.verts.length / 2;
    for (let i = 0; i < n; i++) {
      const a = point(poly, i),
        b = point(poly, (i + 1) % n);
      if (Math.hypot(b.x - a.x, b.z - a.z) >= 0.35 * METERS_TO_WORLD) {
        const an = bankNormal(poly, i, n, halfWidth),
          bn = bankNormal(poly, i + 1, n, halfWidth);
        yield* banks.polygon(
          [
            { x: a.x + an.x, z: a.z + an.z },
            { x: a.x - an.x, z: a.z - an.z },
            { x: b.x - bn.x, z: b.z - bn.z },
            { x: b.x + bn.x, z: b.z + bn.z },
          ],
          WATER_BANK_Y,
          bounds,
        );
      }
      yield;
    }
  }
  yield* banks.finish(context.root);
}

export function createWaterCoverJob(
  options: CoverJobOptions & {
    cityData: CityData;
    waterIndices: readonly number[];
    bounds?: BoundsXZ | null;
  },
) {
  return createCoverJob(options, (context) =>
    waterSteps(context, options.cityData, options.waterIndices, options.bounds ?? null),
  );
}
