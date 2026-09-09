import * as THREE from 'three';
import { buildCellStockBatch, createScratch, type CityScratch } from './cityBuilder';
import type { BuildJob } from './buildScheduler';
import type { CityCell } from './cityIndex';
import type { StockDetail } from './detailPolicy';
import type { CityData } from './format';

export type CellStockReady = { group: THREE.Group | null; scratch: CityScratch; sourceBuildingIndices: readonly number[]; geometryBytes: number };
export type CellStockJobArgs = { id: string; generation: number; essential: boolean; cityData: CityData; cell: CityCell; excludedBuildingIndices: ReadonlySet<number>; material: THREE.Material; detail: StockDetail; now: () => number; sliceMs?: number; onReady: (ready: CellStockReady) => void };
type Fragment = { geometry: THREE.BufferGeometry; vertices: number; indices: number };
function clear(s: CityScratch): void { s.windows.length = s.windowColors.length = s.picks.length = s.rooftops.length = s.rooftopColors.length = s.signs.length = 0; }
function append(a: CityScratch, b: CityScratch): void { a.windows.push(...b.windows); a.windowColors.push(...b.windowColors); a.picks.push(...b.picks); a.rooftops.push(...b.rooftops); a.rooftopColors.push(...b.rooftopColors); a.signs.push(...b.signs); }
type Disposal = { didThrow: boolean; error?: unknown };
function dispose(g: THREE.BufferGeometry): Disposal { try { g.dispose(); return { didThrow: false }; } catch (error) { return { didThrow: true, error }; } }

export function createCellStockJob(args: CellStockJobArgs): BuildJob {
  const sliceMs = args.sliceMs ?? 4;
  if (!Number.isFinite(sliceMs) || sliceMs <= 0 || sliceMs > 4) throw new RangeError('sliceMs must be a finite positive number no greater than 4');
  if (!['overview', 'neighbourhood', 'street'].includes(args.detail)) throw new RangeError(`unknown stock detail: ${String(args.detail)}`);
  const sources = [...args.cell.buildingIndices], excluded = new Set<number>(), seen = new Set<number>();
  const valid = (n: number) => Number.isInteger(n) && n >= 0 && n < args.cityData.buildings.length;
  for (const n of sources) { if (!valid(n)) throw new RangeError(`invalid building index: ${n}`); if (seen.has(n)) throw new RangeError(`duplicate building index: ${n}`); seen.add(n); }
  for (const n of args.excludedBuildingIndices) { if (!valid(n)) throw new RangeError(`invalid excluded building index: ${n}`); excluded.add(n); }
  const scratch = createScratch(), fragments: Fragment[] = [], emitted: number[] = [];
  let totalVertices = 0, totalIndices = 0, emitAt = 0, vertexAt = 0, indexAt = 0, targetVertexAt = 0, targetIndexAt = 0, allocationAt = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let target: THREE.BufferGeometry | null = null, root: THREE.Group | null = null;
  let position: Float32Array | null = null, normal: Float32Array | null = null, color: Float32Array | null = null, indices: Uint32Array | null = null;
  let phase: 'emit' | 'allocate' | 'copy' | 'publish' = 'emit', terminal = false, transferred = false, stepping = false;
  const cleanup = (): unknown[] => {
    const errors: unknown[] = []; const detached = root; root = null;
    if (detached?.parent) { try { detached.parent.remove(detached); } catch (e) { errors.push(e); } }
    if (!transferred && target) { const result = dispose(target); if (result.didThrow) errors.push(result.error); } target = null;
    while (fragments.length) { const f = fragments.shift()!; const result = dispose(f.geometry); if (result.didThrow) errors.push(result.error); }
    clear(scratch); emitted.length = 0; position = normal = color = null; indices = null; return errors;
  };
  const stop = () => { if (terminal) return []; terminal = true; return cleanup(); };
  const fail = (error: unknown): never => { const errors = stop(); if (errors.length) throw new AggregateError([error, ...errors], 'Cell stock job failed and cleanup failed'); throw error; };
  const emit = (source: number): void => {
    const local = createScratch(); let group: THREE.Group | null = null; let staged: Fragment[] = [];
    try {
      group = buildCellStockBatch({ cityData: args.cityData, cellId: args.cell.id, buildingIndices: [source], excludedBuildingIndices: excluded, material: args.material, detail: args.detail, scratch: local });
      if (terminal) {
        const errors: unknown[] = [];
        group?.traverse((o) => { if (o instanceof THREE.Mesh) { const result = dispose(o.geometry); if (result.didThrow) errors.push(result.error); } });
        if (errors.length) throw new AggregateError(errors, 'Cell stock job cancellation cleanup failed');
        return;
      }
      if (!group) return;
      group.traverse((o) => { if (o instanceof THREE.Mesh) staged.push({ geometry: o.geometry, vertices: 0, indices: 0 }); });
      for (const fragment of staged) { const p = fragment.geometry.getAttribute('position'), n = fragment.geometry.getAttribute('normal'), c = fragment.geometry.getAttribute('color'), ix = fragment.geometry.getIndex(); if (!p || !n || !c || !ix) throw new Error('stock fragment is not indexed and complete'); fragment.vertices = p.count; fragment.indices = ix.count; }
      fragments.push(...staged); for (const f of staged) { totalVertices += f.vertices; totalIndices += f.indices; } staged = [];
      const ids = group.userData.sourceBuildingIndices as readonly number[] | undefined; if (ids) emitted.push(...ids); append(scratch, local);
    } catch (e) { const errors: unknown[] = []; while (staged.length) { const f = staged.shift()!; const result = dispose(f.geometry); if (result.didThrow) errors.push(result.error); } if (errors.length) throw new AggregateError([e, ...errors], 'Cell stock fragment validation and cleanup failed'); throw e; }
  };
  const allocate = (): void => {
    if (totalVertices === 0) { phase = 'publish'; return; } if (!target) target = new THREE.BufferGeometry();
    if (allocationAt === 0) { position = new Float32Array(totalVertices * 3); target.setAttribute('position', new THREE.BufferAttribute(position, 3)); }
    else if (allocationAt === 1) { normal = new Float32Array(totalVertices * 3); target.setAttribute('normal', new THREE.BufferAttribute(normal, 3)); }
    else if (allocationAt === 2) { color = new Float32Array(totalVertices * 3); target.setAttribute('color', new THREE.BufferAttribute(color, 3)); }
    else { indices = new Uint32Array(totalIndices); target.setIndex(new THREE.BufferAttribute(indices, 1)); phase = 'copy'; } allocationAt++;
  };
  const copy = (): boolean => {
    const f = fragments[0]!, p = f.geometry.getAttribute('position') as THREE.BufferAttribute, n = f.geometry.getAttribute('normal') as THREE.BufferAttribute, c = f.geometry.getAttribute('color') as THREE.BufferAttribute, ix = f.geometry.getIndex() as THREE.BufferAttribute;
    if (vertexAt < f.vertices) { const count = Math.min(1365, f.vertices - vertexAt), start = vertexAt * 3, end = (vertexAt + count) * 3; position!.set((p.array as Float32Array).subarray(start, end), targetVertexAt * 3); normal!.set((n.array as Float32Array).subarray(start, end), targetVertexAt * 3); color!.set((c.array as Float32Array).subarray(start, end), targetVertexAt * 3); const a = p.array as Float32Array; for (let i = start; i < end; i += 3) { minX = Math.min(minX, a[i]!); minY = Math.min(minY, a[i + 1]!); minZ = Math.min(minZ, a[i + 2]!); maxX = Math.max(maxX, a[i]!); maxY = Math.max(maxY, a[i + 1]!); maxZ = Math.max(maxZ, a[i + 2]!); } vertexAt += count; targetVertexAt += count; return false; }
    if (indexAt < f.indices) { const count = Math.min(4096, f.indices - indexAt), a = ix.array as Uint16Array | Uint32Array, offset = targetVertexAt - f.vertices; for (let i = 0; i < count; i++) indices![targetIndexAt + i] = a[indexAt + i]! + offset; indexAt += count; targetIndexAt += count; return false; }
    const done = fragments.shift()!, result = dispose(done.geometry); if (result.didThrow) throw result.error; vertexAt = indexAt = 0; return fragments.length === 0;
  };
  const publish = (): void => {
    if (target) { target.boundingBox = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ)); const center = target.boundingBox.getCenter(new THREE.Vector3()); target.boundingSphere = new THREE.Sphere(center, center.distanceTo(target.boundingBox.max)); const mesh = new THREE.Mesh(target, args.material); mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = true; mesh.userData.cellId = args.cell.id; mesh.userData.sourceBuildingIndices = emitted; root = new THREE.Group(); root.frustumCulled = false; root.userData.cellId = args.cell.id; root.userData.sourceBuildingIndices = emitted; root.add(mesh); }
    const bytes = target ? target.getAttribute('position').array.byteLength + target.getAttribute('normal').array.byteLength + target.getAttribute('color').array.byteLength + target.getIndex()!.array.byteLength : 0;
    args.onReady({ group: root, scratch, sourceBuildingIndices: emitted, geometryBytes: bytes }); if (terminal) return; terminal = true; transferred = true; target = null;
  };
  return { id: args.id, generation: args.generation, essential: args.essential, cancel() { const errors = stop(); if (errors.length) throw new AggregateError(errors, 'Cell stock job cleanup failed'); }, step() { if (terminal) return true; if (stepping) throw new Error('Reentrant cell stock job step is unsupported'); stepping = true; try { const deadline = args.now() + sliceMs; let units = 0; while (!terminal && units < 16) { if (args.now() >= deadline) return false; if (phase === 'emit') { if (emitAt === sources.length) { phase = 'allocate'; continue; } emit(sources[emitAt++]!); } else if (phase === 'allocate') allocate(); else if (phase === 'copy') { if (copy()) phase = 'publish'; } else { publish(); return true; } units++; } return terminal; } catch (e) { return fail(e); } finally { stepping = false; } } };
}
