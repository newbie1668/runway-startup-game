import * as THREE from 'three';
import type { BuildJob } from './buildScheduler';
import type { BoundsXZ } from './cityIndex';
import { clippedCoverPieces, type CoverPoint } from './coverClip';

export interface CoverJobOptions {
  id: string;
  generation: number;
  essential: boolean;
  now(): number;
  sliceMs?: number;
  onReady(group: THREE.Group | null): void;
}

export interface CoverBuildContext {
  root: THREE.Group;
  own<T extends { dispose(): void }>(resource: T): T;
}

export function createCoverJob(
  options: CoverJobOptions,
  produce: (context: CoverBuildContext) => Generator<void>,
): BuildJob {
  const sliceMs = options.sliceMs ?? 4;
  if (!Number.isFinite(sliceMs) || sliceMs <= 0 || sliceMs > 4)
    throw new RangeError('sliceMs must be positive and no greater than 4');
  let context: CoverBuildContext | null = null;
  let iterator: Generator<void> | null = null;
  const resources = new Set<{ dispose(): void }>();
  const disposed = new WeakSet<{ dispose(): void }>();
  let terminal = false;
  let stepping = false;
  let advancing = false;
  let finalizing = false;
  let now: CoverJobOptions['now'] | null = options.now;
  let publish: CoverJobOptions['onReady'] | null = options.onReady;
  let producer: typeof produce | null = produce;
  const detach = (): void => {
    iterator = null;
    context = null;
    now = null;
    publish = null;
    producer = null;
  };
  const dispose = (resource: { dispose(): void }): void => {
    if (disposed.has(resource)) return;
    disposed.add(resource);
    resource.dispose();
  };
  const cleanup = (): unknown[] => {
    if (advancing || finalizing) return [];
    finalizing = true;
    const pending = iterator;
    iterator = null;
    const errors: unknown[] = [];
    try {
      pending?.return(undefined);
    } catch (error) {
      errors.push(error);
    }
    try {
      context?.root.removeFromParent();
    } catch (error) {
      errors.push(error);
    }
    for (const resource of resources) {
      resources.delete(resource);
      try {
        dispose(resource);
      } catch (error) {
        errors.push(error);
      }
    }
    detach();
    finalizing = false;
    return errors;
  };
  const clock = (): number => {
    const time = now!();
    if (!Number.isFinite(time)) throw new RangeError('clock must be finite');
    return time;
  };
  return {
    id: options.id,
    generation: options.generation,
    essential: options.essential,
    cancel() {
      if (terminal) return;
      terminal = true;
      const errors = cleanup();
      if (errors.length) throw new AggregateError(errors, 'Cover cancellation failed');
    },
    step() {
      if (terminal) return true;
      if (stepping) throw new Error('Reentrant cover job step is unsupported');
      stepping = true;
      try {
        const started = clock();
        if (terminal) return true;
        if (!context) {
          context = {
            root: new THREE.Group(),
            own(resource) {
              if (terminal && !advancing && !finalizing) dispose(resource);
              else resources.add(resource);
              return resource;
            },
          };
          advancing = true;
          try {
            iterator = producer!(context);
          } finally {
            advancing = false;
          }
        }
        for (let units = 0; units < 64; units++) {
          const elapsed = units > 0 && !terminal ? clock() - started : 0;
          if (terminal) {
            const errors = cleanup();
            if (errors.length) throw new AggregateError(errors, 'Cover cancellation failed');
            return true;
          }
          if (elapsed >= sliceMs) return false;
          let result: IteratorResult<void>;
          advancing = true;
          try {
            result = iterator!.next();
          } finally {
            advancing = false;
          }
          if (terminal) {
            const errors = cleanup();
            if (errors.length) throw new AggregateError(errors, 'Cover cancellation failed');
            return true;
          }
          if (result.done) {
            const onReady = publish!;
            const root = context!.root.children.length ? context!.root : null;
            if (!root) {
              const errors = cleanup();
              if (errors.length) throw new AggregateError(errors, 'Empty cover cleanup failed');
            }
            onReady(root);
            if (!terminal) {
              terminal = true;
              resources.clear();
              detach();
            }
            return true;
          }
        }
        return false;
      } catch (error) {
        terminal = true;
        const errors = cleanup();
        if (errors.length)
          throw new AggregateError([error, ...errors], 'Cover build and cleanup failed');
        throw error;
      } finally {
        stepping = false;
      }
    },
  };
}

/**
 * Cover geometry is emitted in fixed-capacity pages. A page is the largest
 * unit ever allocated or copied by a cover job: 16,384 vertices keep every
 * index within Uint16 range and cap one page at 192 KiB positions, 192 KiB
 * normals, 96 KiB indices and (grass only) 192 KiB colours, so a page split
 * costs one extra draw call rather than a multi-million-element copy.
 */
export const COVER_PAGE_VERTICES = 16384;
/** Fan triangulation of k points uses 3(k - 2) indices, so 3x vertices always fits. */
export const COVER_PAGE_INDICES = COVER_PAGE_VERTICES * 3;
/** Elements copied between yields while finalising a page. */
const COVER_COPY_CHUNK = 4096;
/** Triangles or vertices visited between yields while computing normals and bounds. */
const COVER_MATH_CHUNK = 256;

interface CoverPage {
  positions: Float32Array;
  colors: Float32Array | null;
  indices: Uint16Array;
  vertexCount: number;
  indexCount: number;
}

export interface CoverPageOptions {
  /** Store per-vertex RGB alongside positions. */
  colors?: boolean;
  /** Emit constant +Y normals instead of accumulated face normals. */
  upNormals?: boolean;
  /** Applied to every page mesh before it is attached. */
  decorate?(mesh: THREE.Mesh): void;
}

/**
 * Appends triangles for one material into fixed-capacity pages and turns each
 * full page into its own mesh. Triangle order is preserved across pages; the
 * writer never holds more than one page of intermediate data.
 */
export interface CoverPageWriter {
  /** Meshes finalised so far, in emission order. */
  readonly meshes: readonly THREE.Mesh[];
  /** Vertices written into the current, unfinalised page. */
  readonly vertexCount: number;
  /** Indices written into the current, unfinalised page. */
  readonly indexCount: number;
  /** Flush the current page first if `vertices`/`indices` would not fit. */
  reserve(vertices: number, indices: number): Generator<void>;
  /** Append one vertex to the reserved page and return its page-local index. */
  vertex(x: number, y: number, z: number, r?: number, g?: number, b?: number): number;
  /** Append one triangle of page-local indices. */
  triangle(a: number, b: number, c: number): void;
  /** Clip `points` to `bounds` and fan-triangulate every surviving piece. */
  polygon(
    points: readonly CoverPoint[],
    y: number,
    bounds: BoundsXZ | null,
    shade?: THREE.Color | null,
  ): Generator<void>;
  /** Finalise the current page into a mesh even if it is not full. */
  flush(): Generator<void>;
  /** Flush, then attach every page mesh to `parent` in order; returns the page count. */
  finish(parent: THREE.Object3D): Generator<void, number>;
}

export function createCoverPageWriter(
  context: CoverBuildContext,
  material: THREE.Material | (() => THREE.Material),
  options: CoverPageOptions = {},
): CoverPageWriter {
  let page: CoverPage | null = null;
  let resolved: THREE.Material | null = typeof material === 'function' ? null : material;
  const meshes: THREE.Mesh[] = [];
  const current = (): CoverPage => {
    page ??= {
      positions: new Float32Array(COVER_PAGE_VERTICES * 3),
      colors: options.colors ? new Float32Array(COVER_PAGE_VERTICES * 3) : null,
      indices: new Uint16Array(COVER_PAGE_INDICES),
      vertexCount: 0,
      indexCount: 0,
    };
    return page;
  };
  const writer: CoverPageWriter = {
    meshes,
    get vertexCount() {
      return page?.vertexCount ?? 0;
    },
    get indexCount() {
      return page?.indexCount ?? 0;
    },
    *reserve(vertices, indices) {
      if (vertices > COVER_PAGE_VERTICES || indices > COVER_PAGE_INDICES)
        throw new RangeError(`cover primitive exceeds one page (${vertices}v/${indices}i)`);
      const active = current();
      if (
        active.vertexCount + vertices > COVER_PAGE_VERTICES ||
        active.indexCount + indices > COVER_PAGE_INDICES
      )
        yield* writer.flush();
    },
    vertex(x, y, z, r = 0, g = 0, b = 0) {
      const active = current();
      if (active.vertexCount >= COVER_PAGE_VERTICES) throw new RangeError('cover page is full');
      const index = active.vertexCount++;
      active.positions[index * 3] = x;
      active.positions[index * 3 + 1] = y;
      active.positions[index * 3 + 2] = z;
      if (active.colors) {
        active.colors[index * 3] = r;
        active.colors[index * 3 + 1] = g;
        active.colors[index * 3 + 2] = b;
      }
      return index;
    },
    triangle(a, b, c) {
      const active = current();
      if (active.indexCount + 3 > COVER_PAGE_INDICES) throw new RangeError('cover page is full');
      if (
        a >= active.vertexCount ||
        b >= active.vertexCount ||
        c >= active.vertexCount ||
        a < 0 ||
        b < 0 ||
        c < 0
      )
        throw new RangeError('cover triangle references a vertex outside its page');
      active.indices[active.indexCount++] = a;
      active.indices[active.indexCount++] = b;
      active.indices[active.indexCount++] = c;
    },
    *polygon(points, y, bounds, shade = null) {
      for (const piece of clippedCoverPieces(points, bounds)) {
        yield* writer.reserve(piece.length, (piece.length - 2) * 3);
        const base = writer.vertexCount;
        for (const point of piece) writer.vertex(point.x, y, point.z, shade?.r, shade?.g, shade?.b);
        for (let i = 1; i < piece.length - 1; i++) writer.triangle(base, base + i, base + i + 1);
      }
    },
    *flush() {
      if (!page || !page.indexCount) {
        if (page) page.vertexCount = page.indexCount = 0;
        return;
      }
      resolved ??= (material as () => THREE.Material)();
      const mesh = yield* pageMesh(context, page, resolved, options.upNormals ?? false);
      page.vertexCount = page.indexCount = 0;
      options.decorate?.(mesh);
      meshes.push(mesh);
    },
    *finish(parent) {
      yield* writer.flush();
      page = null;
      for (const mesh of meshes) parent.add(mesh);
      return meshes.length;
    },
  };
  return writer;
}

function* copyInto<T extends Float32Array | Uint16Array>(
  target: T,
  source: ArrayLike<number>,
  length: number,
): Generator<void, T> {
  for (let start = 0; start < length; start += COVER_COPY_CHUNK) {
    const end = Math.min(start + COVER_COPY_CHUNK, length);
    for (let i = start; i < end; i++) target[i] = source[i]!;
    yield;
  }
  return target;
}

function* pageMesh(
  context: CoverBuildContext,
  page: CoverPage,
  material: THREE.Material,
  upNormals: boolean,
): Generator<void, THREE.Mesh> {
  const geometry = context.own(new THREE.BufferGeometry());
  const position = new THREE.BufferAttribute(
    yield* copyInto(new Float32Array(page.vertexCount * 3), page.positions, page.vertexCount * 3),
    3,
  );
  geometry.setAttribute('position', position);
  const triangles = yield* copyInto(
    new Uint16Array(page.indexCount),
    page.indices,
    page.indexCount,
  );
  geometry.setIndex(new THREE.BufferAttribute(triangles, 1));
  if (page.colors) {
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(
        yield* copyInto(new Float32Array(page.vertexCount * 3), page.colors, page.vertexCount * 3),
        3,
      ),
    );
  }
  const normal = new THREE.BufferAttribute(new Float32Array(page.vertexCount * 3), 3);
  geometry.setAttribute('normal', normal);
  yield;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const cb = new THREE.Vector3(),
    ab = new THREE.Vector3(),
    n = new THREE.Vector3();
  for (let i = 0; !upNormals && i < triangles.length; i += 3) {
    const ia = triangles[i]!,
      ib = triangles[i + 1]!,
      ic = triangles[i + 2]!;
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib);
    c.fromBufferAttribute(position, ic);
    cb.subVectors(c, b);
    ab.subVectors(a, b);
    cb.cross(ab);
    for (const index of [ia, ib, ic]) {
      n.fromBufferAttribute(normal, index).add(cb);
      normal.setXYZ(index, n.x, n.y, n.z);
    }
    if ((i / 3 + 1) % COVER_MATH_CHUNK === 0) yield;
  }
  const box = new THREE.Box3();
  for (let i = 0; i < position.count; i++) {
    if (upNormals) n.set(0, 1, 0);
    else n.fromBufferAttribute(normal, i).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
    box.expandByPoint(a.fromBufferAttribute(position, i));
    if ((i + 1) % COVER_MATH_CHUNK === 0) yield;
  }
  const center = box.getCenter(new THREE.Vector3());
  let radiusSq = 0;
  for (let i = 0; i < position.count; i++) {
    radiusSq = Math.max(radiusSq, center.distanceToSquared(a.fromBufferAttribute(position, i)));
    if ((i + 1) % COVER_MATH_CHUNK === 0) yield;
  }
  yield;
  geometry.boundingBox = box;
  geometry.boundingSphere = new THREE.Sphere(center, Math.sqrt(radiusSq));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * One mesh from at most one page of already-triangulated geometry. Larger
 * inputs must stream through `createCoverPageWriter`.
 */
export function* coverMesh(
  context: CoverBuildContext,
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  material: THREE.Material,
  colors: ArrayLike<number> | null = null,
  upNormals = false,
): Generator<void, THREE.Mesh | null> {
  if (!indices.length) return null;
  if (positions.length % 3 || indices.length % 3 || (colors && colors.length !== positions.length))
    throw new RangeError('cover mesh arrays must hold whole vertices and triangles');
  const vertexCount = positions.length / 3;
  if (vertexCount > COVER_PAGE_VERTICES || indices.length > COVER_PAGE_INDICES)
    throw new RangeError('cover mesh input exceeds one page');
  const writer = createCoverPageWriter(context, material, { colors: !!colors, upNormals });
  for (let i = 0; i < vertexCount; i++) {
    writer.vertex(
      positions[i * 3]!,
      positions[i * 3 + 1]!,
      positions[i * 3 + 2]!,
      colors?.[i * 3],
      colors?.[i * 3 + 1],
      colors?.[i * 3 + 2],
    );
    if ((i + 1) % COVER_COPY_CHUNK === 0) yield;
  }
  for (let i = 0; i < indices.length; i += 3) {
    writer.triangle(indices[i]!, indices[i + 1]!, indices[i + 2]!);
    if ((i / 3 + 1) % COVER_COPY_CHUNK === 0) yield;
  }
  yield* writer.flush();
  return writer.meshes[0] ?? null;
}
