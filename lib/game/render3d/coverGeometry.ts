import * as THREE from 'three';
import type { BuildJob } from './buildScheduler';

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
  let resources = new Set<{ dispose(): void }>();
  let terminal = false;
  let stepping = false;
  const cleanup = (): unknown[] => {
    terminal = true;
    const owned = resources;
    resources = new Set();
    const pending = iterator;
    iterator = null;
    const root = context?.root;
    context = null;
    const errors: unknown[] = [];
    try {
      pending?.return(undefined);
    } catch (error) {
      errors.push(error);
    }
    try {
      root?.removeFromParent();
    } catch (error) {
      errors.push(error);
    }
    for (const resource of owned) {
      try {
        resource.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    return errors;
  };
  const clock = (): number => {
    const time = options.now();
    if (!Number.isFinite(time)) throw new RangeError('clock must be finite');
    return time;
  };
  return {
    id: options.id,
    generation: options.generation,
    essential: options.essential,
    cancel() {
      if (terminal) return;
      const errors = cleanup();
      if (errors.length) throw new AggregateError(errors, 'Cover cancellation failed');
    },
    step() {
      if (terminal || stepping) return terminal;
      stepping = true;
      try {
        const started = clock();
        if (terminal) return true;
        if (!context) {
          context = {
            root: new THREE.Group(),
            own(resource) {
              resources.add(resource);
              return resource;
            },
          };
          iterator = produce(context);
        }
        for (let units = 0; units < 64; units++) {
          if (units > 0 && clock() - started >= sliceMs) return false;
          const result = iterator!.next();
          if (terminal) return true;
          if (result.done) {
            if (!context.root.children.length) {
              const errors = cleanup();
              if (errors.length) throw new AggregateError(errors, 'Empty cover cleanup failed');
              options.onReady(null);
              return true;
            }
            options.onReady(context.root.children.length ? context.root : null);
            if (!terminal) {
              terminal = true;
              iterator = null;
              context = null;
              resources = new Set();
            }
            return true;
          }
          if (terminal) return true;
        }
        return false;
      } catch (error) {
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

export function* coverMesh(
  context: CoverBuildContext,
  positions: ArrayLike<number>,
  indices: ArrayLike<number>,
  material: THREE.Material,
  colors: ArrayLike<number> | null = null,
  upNormals = false,
): Generator<void, THREE.Mesh | null> {
  if (!indices.length) return null;
  const geometry = context.own(new THREE.BufferGeometry());
  const vertices = new Float32Array(positions.length);
  yield;
  for (let start = 0; start < positions.length; start += 1024) {
    const end = Math.min(start + 1024, positions.length);
    for (let i = start; i < end; i++) vertices[i] = positions[i]!;
    yield;
  }
  const position = new THREE.BufferAttribute(vertices, 3);
  geometry.setAttribute('position', position);
  const triangles =
    vertices.length / 3 <= 65535
      ? new Uint16Array(indices.length)
      : new Uint32Array(indices.length);
  yield;
  for (let start = 0; start < indices.length; start += 1024) {
    const end = Math.min(start + 1024, indices.length);
    for (let i = start; i < end; i++) triangles[i] = indices[i]!;
    yield;
  }
  geometry.setIndex(new THREE.BufferAttribute(triangles, 1));
  if (colors) {
    const values = new Float32Array(colors.length);
    yield;
    for (let start = 0; start < colors.length; start += 1024) {
      const end = Math.min(start + 1024, colors.length);
      for (let i = start; i < end; i++) values[i] = colors[i]!;
      yield;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(values, 3));
  }
  const normal = new THREE.BufferAttribute(new Float32Array(vertices.length), 3);
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
    yield;
  }
  const box = new THREE.Box3();
  for (let i = 0; i < position.count; i++) {
    if (upNormals) n.set(0, 1, 0);
    else n.fromBufferAttribute(normal, i).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
    box.expandByPoint(a.fromBufferAttribute(position, i));
    yield;
  }
  const center = box.getCenter(new THREE.Vector3());
  let radiusSq = 0;
  for (let i = 0; i < position.count; i++) {
    radiusSq = Math.max(radiusSq, center.distanceToSquared(a.fromBufferAttribute(position, i)));
    yield;
  }
  geometry.boundingBox = box;
  geometry.boundingSphere = new THREE.Sphere(center, Math.sqrt(radiusSq));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
