import * as THREE from 'three';
import type { BuildJob } from './buildScheduler';
import { createStockDrawRangeJob } from './stockDrawRange';

type Stamp = {
  geometry: THREE.BufferGeometry;
  position: THREE.BufferAttribute;
  index: THREE.BufferAttribute;
  positionVersion: number;
  indexVersion: number;
};

type Entry = { mesh: THREE.Mesh; stamp: Stamp | null; pending: boolean };

const IDENTITY = new THREE.Matrix4();
// Matches the cell-aligned overview page index cap; serial staging copies at most one index.
export const MAX_INDEX_BYTES = 256 * 1024;

function identityTransform(object: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (!node.matrixWorldAutoUpdate) return false;
    if (!node.matrixAutoUpdate) {
      if (!node.matrix.equals(IDENTITY)) return false;
    } else if (
      node.position.x !== 0 || node.position.y !== 0 || node.position.z !== 0 ||
      node.quaternion.x !== 0 || node.quaternion.y !== 0 || node.quaternion.z !== 0 ||
      node.quaternion.w !== 1 ||
      node.scale.x !== 1 || node.scale.y !== 1 || node.scale.z !== 1
    ) return false;
  }
  return true;
}

function compatible(mesh: THREE.Mesh, previous: Stamp | null): Stamp | null {
  const material = mesh.material;
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.index;
  if (
    mesh instanceof THREE.InstancedMesh || mesh instanceof THREE.SkinnedMesh ||
    !(material instanceof THREE.MeshLambertMaterial) ||
    material.side !== THREE.FrontSide || material.transparent || material.opacity !== 1 ||
    material.wireframe || material.displacementMap !== null ||
    material.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile ||
    geometry.groups.length !== 0 || (geometry.morphAttributes.position?.length ?? 0) !== 0 ||
    !identityTransform(mesh) ||
    !(position instanceof THREE.BufferAttribute) || position.itemSize !== 3 ||
    position.normalized || !(position.array instanceof Float32Array) ||
    !index || index.itemSize !== 1 || index.normalized ||
    !(index.array instanceof Uint16Array || index.array instanceof Uint32Array)
  ) return null;
  if (previous?.geometry === geometry && previous.position === position &&
    previous.index === index && previous.positionVersion === position.version &&
    previous.indexVersion === index.version) return previous;
  return { geometry, position, index, positionVersion: position.version, indexVersion: index.version };
}

function sameStamp(a: Stamp | null, b: Stamp | null): boolean {
  return a === b || (a !== null && b !== null &&
    a.geometry === b.geometry && a.position === b.position && a.index === b.index &&
    a.positionVersion === b.positionVersion && a.indexVersion === b.indexVersion);
}

export class StockDrawRanges {
  private readonly entries = new Map<THREE.Mesh, Entry>();
  private readonly queue = new Set<Entry>();
  private readonly nextDirection = new THREE.Vector3();
  private direction: THREE.Vector3 | null = null;
  private active: { entry: Entry; job: BuildJob } | null = null;
  private generation = 0;
  private closed = false;

  constructor(
    private readonly now: () => number,
    private readonly onError: (error: unknown) => void,
  ) {}

  get idle(): boolean {
    return this.active === null && this.queue.size === 0;
  }

  /** Scratch index the active job may hold: one same-length copy, at most MAX_INDEX_BYTES. */
  get stagingBytes(): number {
    return this.active?.entry.stamp?.index.array.byteLength ?? 0;
  }

  settled(mesh: THREE.Mesh): boolean {
    return !this.entries.get(mesh)?.pending;
  }

  add(mesh: THREE.Mesh): void {
    if (this.closed || this.entries.has(mesh)) return;
    const entry: Entry = { mesh, stamp: null, pending: false };
    this.entries.set(mesh, entry);
    this.refresh(entry);
  }

  remove(mesh: THREE.Mesh): void {
    const entry = this.entries.get(mesh);
    if (!entry) return;
    this.reset(entry);
    this.entries.delete(mesh);
  }

  beginGeneration(): void {
    this.generation++;
    if (!this.active) return;
    const { entry, job } = this.active;
    this.active = null;
    job.cancel();
    if (entry.pending) this.queue.add(entry);
  }

  prepare(camera: THREE.Camera, shadows: boolean): void {
    if (this.closed) return;
    let next: THREE.Vector3 | null = null;
    if (camera instanceof THREE.OrthographicCamera && !shadows) {
      camera.getWorldDirection(this.nextDirection);
      if (Number.isFinite(this.nextDirection.x) && Number.isFinite(this.nextDirection.y) &&
        Number.isFinite(this.nextDirection.z)) next = this.nextDirection;
    }
    // Pan and zoom perturb lookAt rounding far below the conservative culling margin.
    const changed = next === null
      ? this.direction !== null
      : this.direction === null || next.distanceToSquared(this.direction) > 1e-20;
    if (changed) {
      for (const entry of this.entries.values()) this.reset(entry);
      this.direction = next?.clone() ?? null;
    }
    for (const entry of this.entries.values()) this.refresh(entry);
  }

  private reset(entry: Entry): void {
    if (this.active?.entry === entry) {
      const job = this.active.job;
      this.active = null;
      job.cancel();
    }
    this.queue.delete(entry);
    entry.stamp?.geometry.setDrawRange(0, Infinity);
    entry.stamp = null;
    entry.pending = false;
  }

  private refresh(entry: Entry): void {
    const stamp = this.direction ? compatible(entry.mesh, entry.stamp) : null;
    if (sameStamp(entry.stamp, stamp)) return;
    this.reset(entry);
    entry.stamp = stamp;
    if (stamp && stamp.index.array.byteLength <= MAX_INDEX_BYTES) {
      entry.pending = true;
      this.queue.add(entry);
    }
  }

  drain(budgetMs: number): void {
    if (this.closed || budgetMs <= 0 || !this.direction) return;
    const started = this.now();
    for (let steps = 0; steps < 16 && (steps === 0 || this.now() - started < budgetMs); steps++) {
      let entry = this.active?.entry;
      try {
        if (!this.active) {
          entry = this.queue.values().next().value;
          if (!entry) return;
          this.queue.delete(entry);
          const stamp = entry.stamp!;
          const source = stamp.index.array;
          const positions = stamp.position.array;
          if (!(source instanceof Uint16Array || source instanceof Uint32Array) ||
            !(positions instanceof Float32Array)) throw new Error('Stock buffer type changed');
          const generation = this.generation;
          const target = entry;
          const job = createStockDrawRangeJob({
            id: `stock:draw-range:${entry.mesh.id}`,
            generation,
            essential: false,
            index: source,
            positions,
            direction: this.direction,
            now: this.now,
            sliceMs: Math.min(2, budgetMs),
            maxIndexBytes: MAX_INDEX_BYTES,
            onReady: (result) => {
              if (this.closed || generation !== this.generation ||
                this.entries.get(target.mesh) !== target || target.stamp !== stamp) return;
              if (!sameStamp(stamp, compatible(target.mesh, stamp))) {
                this.reset(target);
                return;
              }
              if (result) {
                source.set(result.index);
                stamp.index.needsUpdate = true;
                stamp.indexVersion = stamp.index.version;
                stamp.geometry.setDrawRange(0, result.count);
              }
              target.pending = false;
            },
          });
          this.active = { entry, job };
        }
        const current = this.active;
        if (current.job.step() && this.active === current) this.active = null;
      } catch (error) {
        if (entry) {
          const stamp = entry.stamp;
          this.reset(entry);
          entry.stamp = stamp;
        }
        this.onError(error);
      }
    }
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of this.entries.values()) this.reset(entry);
    this.entries.clear();
  }
}
