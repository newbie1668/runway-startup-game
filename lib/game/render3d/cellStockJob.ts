import * as THREE from 'three';
import { buildCellStockBatch, createScratch, type CityScratch } from './cityBuilder';
import type { BuildJob } from './buildScheduler';
import type { CityCell } from './cityIndex';
import type { StockDetail } from './detailPolicy';
import type { CityData } from './format';

export type CellStockReady = {
  group: THREE.Group | null;
  scratch: CityScratch;
  sourceBuildingIndices: readonly number[];
  geometryBytes: number;
};

export type CellStockJobArgs = {
  id: string;
  generation: number;
  essential: boolean;
  cityData: CityData;
  cell: CityCell;
  excludedBuildingIndices: ReadonlySet<number>;
  material: THREE.Material;
  detail: StockDetail;
  now: () => number;
  sliceMs?: number;
  onReady: (ready: CellStockReady) => void;
};

type Fragment = { geometry: THREE.BufferGeometry; vertices: number; indices: number };

function appendScratch(target: CityScratch, source: CityScratch): void {
  target.windows.push(...source.windows);
  target.windowColors.push(...source.windowColors);
  target.picks.push(...source.picks);
  target.rooftops.push(...source.rooftops);
  target.rooftopColors.push(...source.rooftopColors);
  target.signs.push(...source.signs);
}

function clearScratch(scratch: CityScratch): void {
  scratch.windows.length = 0;
  scratch.windowColors.length = 0;
  scratch.picks.length = 0;
  scratch.rooftops.length = 0;
  scratch.rooftopColors.length = 0;
  scratch.signs.length = 0;
}

function disposeGeometry(geometry: THREE.BufferGeometry | null): unknown | undefined {
  if (!geometry) return undefined;
  try { geometry.dispose(); return undefined; } catch (error) { return error; }
}

function cleanupError(original: unknown, errors: unknown[]): never {
  if (errors.length === 0) throw original;
  throw new AggregateError([original, ...errors], 'Cell stock job failed and cleanup failed');
}

/**
 * Builds one owner cell without touching unrelated city records.  It deliberately
 * emits one record at a time because the existing batch builder's 16-record cap
 * is an emission bound, not a cell-sized allocation contract.
 */
export function createCellStockJob(args: CellStockJobArgs): BuildJob {
  const sliceMs = args.sliceMs ?? 4;
  if (!Number.isFinite(sliceMs) || sliceMs <= 0 || sliceMs > 4) {
    throw new RangeError('sliceMs must be a finite positive number no greater than 4');
  }
  if (args.detail !== 'overview' && args.detail !== 'neighbourhood' && args.detail !== 'street') {
    throw new RangeError(`unknown stock detail: ${String(args.detail)}`);
  }
  const sourceBuildingIndices = [...args.cell.buildingIndices];
  const selected = new Set<number>();
  for (const index of sourceBuildingIndices) {
    if (!Number.isInteger(index) || index < 0 || index >= args.cityData.buildings.length) {
      throw new RangeError(`invalid building index: ${index}`);
    }
    if (selected.has(index)) throw new RangeError(`duplicate building index: ${index}`);
    selected.add(index);
  }
  const excluded = new Set<number>();
  for (const index of args.excludedBuildingIndices) {
    if (!Number.isInteger(index) || index < 0 || index >= args.cityData.buildings.length) {
      throw new RangeError(`invalid excluded building index: ${index}`);
    }
    excluded.add(index);
  }

  const scratch = createScratch();
  const fragments: Fragment[] = [];
  const emittedSourceBuildingIndices: number[] = [];
  let root: THREE.Group | null = null;
  let target: THREE.BufferGeometry | null = null;
  let stopped = false;
  let transferred = false;
  let stepping = false;
  let phase: 'emit' | 'allocate' | 'copy' | 'publish' = 'emit';
  let emitAt = 0;
  const fragmentAt = 0;
  let vertexAt = 0;
  let indexAt = 0;
  let targetVertexAt = 0;
  let targetIndexAt = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  const cleanup = (): unknown[] => {
    const errors: unknown[] = [];
    if (root?.parent) root.parent.remove(root);
    root = null;
    if (!transferred) {
      const targetError = disposeGeometry(target);
      if (targetError !== undefined) errors.push(targetError);
      target = null;
    }
    for (const fragment of fragments) {
      const error = disposeGeometry(fragment.geometry);
      if (error !== undefined) errors.push(error);
    }
    fragments.length = 0;
    emittedSourceBuildingIndices.length = 0;
    clearScratch(scratch);
    return errors;
  };
  const stop = (): unknown[] => {
    if (stopped) return [];
    stopped = true; // must precede user-observable disposal hooks
    return cleanup();
  };
  const fail = (error: unknown): never => cleanupError(error, stop());
  const pastDeadline = (deadline: number): boolean => args.now() >= deadline;

  const emitOne = (index: number): void => {
    const fragmentScratch = createScratch();
    let group: THREE.Group | null = null;
    try {
      group = buildCellStockBatch({
        cityData: args.cityData,
        cellId: args.cell.id,
        buildingIndices: [index],
        excludedBuildingIndices: excluded,
        material: args.material,
        detail: args.detail,
        scratch: fragmentScratch,
      });
      if (stopped) {
        group?.traverse((object) => {
          if (object instanceof THREE.Mesh) object.geometry.dispose();
        });
        return;
      }
      if (!group) return;
      const meshes: THREE.Mesh[] = [];
      group.traverse((object) => { if (object instanceof THREE.Mesh) meshes.push(object); });
      for (const mesh of meshes) {
        const position = mesh.geometry.getAttribute('position');
        const normal = mesh.geometry.getAttribute('normal');
        const color = mesh.geometry.getAttribute('color');
        const indexAttribute = mesh.geometry.getIndex();
        if (!position || !normal || !color || !indexAttribute) throw new Error('stock fragment is not indexed and complete');
        fragments.push({ geometry: mesh.geometry, vertices: position.count, indices: indexAttribute.count });
      }
      const emitted = group.userData.sourceBuildingIndices as readonly number[] | undefined;
      if (emitted) emittedSourceBuildingIndices.push(...emitted);
      appendScratch(scratch, fragmentScratch);
    } catch (error) {
      if (group) group.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      throw error;
    }
  };

  const allocate = (): void => {
    let vertices = 0;
    let indices = 0;
    for (const fragment of fragments) { vertices += fragment.vertices; indices += fragment.indices; }
    if (vertices === 0) { phase = 'publish'; return; }
    const position = new Float32Array(vertices * 3);
    const normal = new Float32Array(vertices * 3);
    const color = new Float32Array(vertices * 3);
    const index = new Uint32Array(indices);
    target = new THREE.BufferGeometry();
    target.setAttribute('position', new THREE.BufferAttribute(position, 3));
    target.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    target.setAttribute('color', new THREE.BufferAttribute(color, 3));
    target.setIndex(new THREE.BufferAttribute(index, 1));
    phase = 'copy';
  };

  const copyOne = (): boolean => {
    const fragment = fragments[fragmentAt]!;
    const position = fragment.geometry.getAttribute('position') as THREE.BufferAttribute;
    const normal = fragment.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const color = fragment.geometry.getAttribute('color') as THREE.BufferAttribute;
    const index = fragment.geometry.getIndex() as THREE.BufferAttribute;
    const targetPosition = target!.getAttribute('position') as THREE.BufferAttribute;
    const targetNormal = target!.getAttribute('normal') as THREE.BufferAttribute;
    const targetColor = target!.getAttribute('color') as THREE.BufferAttribute;
    const targetIndex = target!.getIndex() as THREE.BufferAttribute;
    if (vertexAt < fragment.vertices) {
      const count = Math.min(1365, fragment.vertices - vertexAt); // <= 4096 entries per attribute
      const srcStart = vertexAt * 3;
      const srcEnd = (vertexAt + count) * 3;
      (targetPosition.array as Float32Array).set((position.array as Float32Array).subarray(srcStart, srcEnd), targetVertexAt * 3);
      (targetNormal.array as Float32Array).set((normal.array as Float32Array).subarray(srcStart, srcEnd), targetVertexAt * 3);
      (targetColor.array as Float32Array).set((color.array as Float32Array).subarray(srcStart, srcEnd), targetVertexAt * 3);
      const values = position.array as Float32Array;
      for (let v = srcStart; v < srcEnd; v += 3) {
        minX = Math.min(minX, values[v]!); minY = Math.min(minY, values[v + 1]!); minZ = Math.min(minZ, values[v + 2]!);
        maxX = Math.max(maxX, values[v]!); maxY = Math.max(maxY, values[v + 1]!); maxZ = Math.max(maxZ, values[v + 2]!);
      }
      vertexAt += count;
      targetVertexAt += count;
      return false;
    }
    if (indexAt < fragment.indices) {
      const count = Math.min(4096, fragment.indices - indexAt);
      const source = index.array as Uint16Array | Uint32Array;
      const destination = targetIndex.array as Uint32Array;
      for (let i = 0; i < count; i++) destination[targetIndexAt + i] = source[indexAt + i]! + (targetVertexAt - fragment.vertices);
      indexAt += count;
      targetIndexAt += count;
      return false;
    }
    const error = disposeGeometry(fragment.geometry);
    if (error !== undefined) throw error;
    fragments.splice(fragmentAt, 1);
    vertexAt = 0;
    indexAt = 0;
    return fragments.length === 0;
  };

  const publish = (): void => {
    if (target) {
      target.boundingBox = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ));
      const center = target.boundingBox.getCenter(new THREE.Vector3());
      target.boundingSphere = new THREE.Sphere(center, center.distanceTo(target.boundingBox.max));
      const mesh = new THREE.Mesh(target, args.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = true;
      mesh.userData.cellId = args.cell.id;
      mesh.userData.sourceBuildingIndices = emittedSourceBuildingIndices;
      root = new THREE.Group();
      root.frustumCulled = false;
      root.userData.cellId = args.cell.id;
      root.userData.sourceBuildingIndices = emittedSourceBuildingIndices;
      root.add(mesh);
    }
    const bytes = target ? (target.getAttribute('position').array.byteLength + target.getAttribute('normal').array.byteLength + target.getAttribute('color').array.byteLength + target.getIndex()!.array.byteLength) : 0;
    args.onReady({ group: root, scratch, sourceBuildingIndices: emittedSourceBuildingIndices, geometryBytes: bytes });
    if (stopped) return;
    transferred = true;
    target = null;
  };

  return {
    id: args.id,
    generation: args.generation,
    essential: args.essential,
    cancel() {
      const errors = stop();
      if (errors.length) throw new AggregateError(errors, 'Cell stock job cleanup failed');
    },
    step() {
      if (stopped) return true;
      if (stepping) throw new Error('Reentrant cell stock job step is unsupported');
      stepping = true;
      try {
        const deadline = args.now() + sliceMs;
        let units = 0;
        while (!stopped && units < 16) {
          if (pastDeadline(deadline)) return false;
          if (phase === 'emit') {
            if (emitAt >= sourceBuildingIndices.length) { phase = 'allocate'; continue; }
            emitOne(sourceBuildingIndices[emitAt++]!);
            units++;
          } else if (phase === 'allocate') {
            allocate();
            units++;
          } else if (phase === 'copy') {
            if (copyOne()) phase = 'publish';
            units++;
          } else {
            publish();
            return true;
          }
        }
        return false;
      } catch (error) {
        return fail(error);
      } finally {
        stepping = false;
      }
    },
  };
}
