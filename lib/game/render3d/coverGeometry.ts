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
