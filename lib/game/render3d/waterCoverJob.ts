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
import { clippedCoverPieces, type CoverPoint as Point } from './coverClip';
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

/** Source vertices whose normal sums share one fixed-size page. */
const NORMAL_PAGE = COVER_PAGE_VERTICES;

/**
 * Face-normal sums at every source vertex of one water record, computed the
 * way `BufferGeometry.computeVertexNormals` does on Float32 positions, so a
 * record split across pages or clipped keeps the shared-vertex normals of the
 * legacy merged surface. Sums live in fixed-size pages; work yields per triangle.
 */
class SourceNormals {
  private readonly pages: Float32Array[] = [];
  private readonly n = new THREE.Vector3();
  constructor(private readonly poly: CityPoly) {}

  *accumulate(): Generator<void> {
    const vertexCount = this.poly.verts.length / 2;
    for (let start = 0; start < vertexCount; start += NORMAL_PAGE) {
      this.pages.push(new Float32Array(Math.min(NORMAL_PAGE, vertexCount - start) * 3));
      yield;
    }
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3(),
      ab = new THREE.Vector3();
    const indices = this.poly.indices;
    for (let i = 0; i < indices.length; i += 3) {
      const ia = indices[i]!,
        ib = indices[i + 1]!,
        ic = indices[i + 2]!;
      const cb = this.face(ia, ib, ic, a, b, c, ab);
      for (const index of [ia, ib, ic]) {
        const page = this.pages[Math.floor(index / NORMAL_PAGE)]!;
        const offset = (index % NORMAL_PAGE) * 3;
        page[offset] += cb.x;
        page[offset + 1] += cb.y;
        page[offset + 2] += cb.z;
      }
      yield;
    }
  }

  /** Unnormalised face vector `(c - b) x (a - b)` of one source triangle. */
  face(
    ia: number,
    ib: number,
    ic: number,
    a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    ab = new THREE.Vector3(),
  ): THREE.Vector3 {
    this.position(ia, a);
    this.position(ib, b);
    this.position(ic, c);
    const cb = c.sub(b);
    ab.subVectors(a, b);
    return cb.cross(ab);
  }

  /** Normalised source-vertex normal, written into `out`. */
  at(index: number, out = this.n): THREE.Vector3 {
    const page = this.pages[Math.floor(index / NORMAL_PAGE)];
    const offset = (index % NORMAL_PAGE) * 3;
    if (!page || offset + 3 > page.length)
      throw new RangeError(`water index ${index} outside its record`);
    return out.set(page[offset]!, page[offset + 1]!, page[offset + 2]!).normalize();
  }

  private position(index: number, out: THREE.Vector3): void {
    const verts = this.poly.verts;
    if (index * 2 + 1 >= verts.length)
      throw new RangeError(`water index ${index} outside its record`);
    out.set(
      Math.fround(dequantizeX(verts[index * 2]!)),
      Math.fround(WATER_Y),
      Math.fround(dequantizeY(verts[index * 2 + 1]!)),
    );
  }
}

function* waterSteps(
  context: CoverBuildContext,
  cityData: CityData,
  selection: readonly number[],
  bounds: BoundsXZ | null,
): Generator<void> {
  const surface = createCoverPageWriter(
    context,
    () =>
      context.own(
        new THREE.MeshLambertMaterial({
          color: pal.WATER,
          side: THREE.DoubleSide,
          fog: true,
        }),
      ),
    { normals: true, parent: context.root },
  );
  const normal = new THREE.Vector3();
  for (const source of selection) {
    const poly = cityData.water[source];
    if (!poly || poly.verts.length < 6 || poly.verts.length % 2 || poly.indices.length % 3)
      throw new RangeError(`invalid water record ${source}`);
    yield;
    const normals = new SourceNormals(poly);
    yield* normals.accumulate();
    const vertexCount = poly.verts.length / 2;
    if (
      !bounds &&
      vertexCount <= COVER_PAGE_VERTICES &&
      poly.indices.length <= COVER_PAGE_INDICES
    ) {
      yield* surface.reserve(vertexCount, poly.indices.length);
      const base = surface.vertexCount;
      for (let i = 0; i < vertexCount; i++) {
        const index = surface.vertex(
          dequantizeX(poly.verts[i * 2]!),
          WATER_Y,
          dequantizeY(poly.verts[i * 2 + 1]!),
        );
        normals.at(i, normal);
        surface.normal(index, normal.x, normal.y, normal.z);
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
      continue;
    }
    for (let i = 0; i < poly.indices.length; i += 3) {
      const corners = [poly.indices[i]!, poly.indices[i + 1]!, poly.indices[i + 2]!] as const;
      const points = corners.map((index) => point(poly, index));
      if (!bounds) {
        yield* surface.reserve(3, 3);
        const base = surface.vertexCount;
        for (let k = 0; k < 3; k++) {
          const p = points[k]!;
          const index = surface.vertex(p.x, WATER_Y, p.z);
          normals.at(corners[k]!, normal);
          surface.normal(index, normal.x, normal.y, normal.z);
        }
        surface.triangle(base, base + 1, base + 2);
        yield;
        continue;
      }
      // Clipping keeps inside corners bit-exact; vertices it introduces on
      // the boundary take the face normal, as a vertex touching only this
      // triangle would under legacy accumulation.
      let face: THREE.Vector3 | null = null;
      for (const piece of clippedCoverPieces(points, bounds)) {
        yield* surface.reserve(piece.length, (piece.length - 2) * 3);
        const base = surface.vertexCount;
        for (const p of piece) {
          const index = surface.vertex(p.x, WATER_Y, p.z);
          const k = points.indexOf(p);
          if (k >= 0) normals.at(corners[k]!, normal);
          else {
            face ??= normals.face(corners[0], corners[1], corners[2]).normalize();
            normal.copy(face);
          }
          surface.normal(index, normal.x, normal.y, normal.z);
        }
        for (let k = 1; k < piece.length - 1; k++) surface.triangle(base, base + k, base + k + 1);
      }
      yield;
    }
  }
  yield* surface.finish(context.root);
  yield;
  const halfWidth = 3.4 * METERS_TO_WORLD;
  const banks = createCoverPageWriter(
    context,
    () =>
      context.own(
        new THREE.MeshLambertMaterial({
          color: pal.WATER_BANK,
          side: THREE.DoubleSide,
          fog: true,
        }),
      ),
    { parent: context.root },
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
