import * as THREE from 'three';
import { buildCellStockBatch, createScratch, type CityScratch } from './cityBuilder';
import type { BuildJob } from './buildScheduler';
import type { CellId, CityCell } from './cityIndex';
import type { StockDetail } from './detailPolicy';
import type { CityData } from './format';

export type CellStockReady = { group: THREE.Group | null; scratch: CityScratch; sourceBuildingIndices: readonly number[]; geometryBytes: number };
export type CellStockJobArgs = { id: string; generation: number; essential: boolean; cityData: CityData; cell: CityCell; excludedBuildingIndices: ReadonlySet<number>; material: THREE.Material; detail: StockDetail; now: () => number; sliceMs?: number; onReady: (ready: CellStockReady) => void };
/** A stock job that also reports the bytes of geometry it currently holds outside the scene (fragments, open target, sealed unpublished pages). */
export type StockJob = BuildJob & { stagingBytes(): number };
/** One cell-aligned overview page: consecutive source buildings (whole cells where they fit) packed into a single Uint16-indexed mesh. */
export type StockPage = { mesh: THREE.Mesh; cellIds: readonly CellId[]; sourceBuildingIndices: readonly number[]; vertices: number; indexBytes: number; geometryBytes: number };
export type StockTileReady = { group: THREE.Group | null; pages: readonly StockPage[]; cellIds: readonly CellId[]; scratch: CityScratch; sourceBuildingIndices: readonly number[]; geometryBytes: number };
export type StockTileJobArgs = { id: string; generation: number; essential: boolean; cityData: CityData; tileId: string; cells: readonly CityCell[]; excludedBuildingIndices: ReadonlySet<number>; material: THREE.Material; now: () => number; sliceMs?: number; maxPageVertices?: number; maxPageIndexBytes?: number; onReady: (ready: StockTileReady) => void };
type PagesReady = { root: THREE.Group | null; pages: readonly StockPage[]; scratch: CityScratch; emitted: number[]; bytes: number };
type PagesJobArgs = { id: string; generation: number; essential: boolean; cityData: CityData; cells: readonly CityCell[]; label: { cellId: CellId } | { tileId: string }; excludedBuildingIndices: ReadonlySet<number>; material: THREE.Material; detail: StockDetail; now: () => number; sliceMs?: number; maxPageVertices: number; maxPageIndexBytes: number; split: boolean; onReady: (ready: PagesReady) => void };
type Fragment = { geometry: THREE.BufferGeometry; vertices: number; indices: number; bytes: number };
/** Every fragment one source building emitted; the smallest piece a page boundary may separate. */
type Unit = { sources: readonly number[]; fragments: number; vertices: number; indices: number };
type PageSpec = { cellIds: CellId[]; sources: number[]; fragments: number; vertices: number; indices: number };
export const MAX_PAGE_VERTICES = 65535;
export const MAX_PAGE_INDEX_BYTES = 256 * 1024;
function geometryBytes(g: THREE.BufferGeometry): number { let bytes = g.getIndex()?.array.byteLength ?? 0; for (const attribute of Object.values(g.attributes)) bytes += attribute.array.byteLength; return bytes; }
function clear(s: CityScratch): void { s.windows.length = s.windowColors.length = s.picks.length = s.rooftops.length = s.rooftopColors.length = s.signs.length = 0; }
function append(a: CityScratch, b: CityScratch): void { a.windows.push(...b.windows); a.windowColors.push(...b.windowColors); a.picks.push(...b.picks); a.rooftops.push(...b.rooftops); a.rooftopColors.push(...b.rooftopColors); a.signs.push(...b.signs); }
type Disposal = { didThrow: boolean; error?: unknown };
function dispose(g: THREE.BufferGeometry): Disposal { try { g.dispose(); return { didThrow: false }; } catch (error) { return { didThrow: true, error }; } }
function newPage(): PageSpec { return { cellIds: [], sources: [], fragments: 0, vertices: 0, indices: 0 }; }

/**
 * Emits source cells in order and packs them into pages. A page closes at a cell boundary once the
 * next whole cell would exceed the vertex or index-byte cap. A cell that cannot fit an empty page
 * is either kept whole (legacy single-cell path: Uint32 indices above 65,535 vertices) or, with
 * `split`, divided at building boundaries into consecutive bounded Uint16 pages; a building that
 * alone exceeds a cap fails the job explicitly. Staging holds at most one open page plus one open
 * cell of fragments, and `stagingBytes()` reports everything held outside the scene.
 */
function createStockPagesJob(args: PagesJobArgs): StockJob {
  const sliceMs = args.sliceMs ?? 4;
  if (!Number.isFinite(sliceMs) || sliceMs <= 0 || sliceMs > 4) throw new RangeError('sliceMs must be a finite positive number no greater than 4');
  if (!['overview', 'neighbourhood', 'street'].includes(args.detail)) throw new RangeError(`unknown stock detail: ${String(args.detail)}`);
  if (!Number.isInteger(args.maxPageVertices) || args.maxPageVertices < 3 || args.maxPageVertices > MAX_PAGE_VERTICES) throw new RangeError(`maxPageVertices must be an integer between 3 and ${MAX_PAGE_VERTICES}`);
  if (!Number.isInteger(args.maxPageIndexBytes) || args.maxPageIndexBytes < 6 || args.maxPageIndexBytes > MAX_PAGE_INDEX_BYTES) throw new RangeError(`maxPageIndexBytes must be an integer between 6 and ${MAX_PAGE_INDEX_BYTES}`);
  if (args.split && args.detail !== 'overview') throw new RangeError('split pages are overview-only');
  const cells = args.cells, sources: number[] = [], cellEnds: number[] = [], excluded = new Set<number>(), seen = new Set<number>(), seenCells = new Set<CellId>();
  const valid = (n: number) => Number.isInteger(n) && n >= 0 && n < args.cityData.buildings.length;
  for (const cell of cells) {
    if (seenCells.has(cell.id)) throw new RangeError(`duplicate cell: ${cell.id}`); seenCells.add(cell.id);
    for (const n of cell.buildingIndices) { if (!valid(n)) throw new RangeError(`invalid building index: ${n}`); if (seen.has(n)) throw new RangeError(`duplicate building index: ${n}`); seen.add(n); sources.push(n); }
    cellEnds.push(sources.length);
  }
  for (const n of args.excludedBuildingIndices) { if (!valid(n)) throw new RangeError(`invalid excluded building index: ${n}`); excluded.add(n); }
  const indexBytes = (vertices: number, indices: number): number => indices * (args.detail === 'overview' && vertices <= 65535 ? 2 : 4);
  const fits = (into: PageSpec, vertices: number, indices: number): boolean => into.vertices + vertices <= args.maxPageVertices && indexBytes(into.vertices + vertices, into.indices + indices) <= args.maxPageIndexBytes;
  const take = (into: PageSpec, unit: Unit): void => { into.sources.push(...unit.sources); into.fragments += unit.fragments; into.vertices += unit.vertices; into.indices += unit.indices; };
  const scratch = createScratch(), staged: Fragment[] = [], emitted: number[] = [], pages: StockPage[] = [];
  let page = newPage(), open: Unit[] = [], openVertices = 0, openIndices = 0, stagedBytes = 0, targetBytes = 0, sealedBytes = 0;
  let emitAt = 0, cellAt = 0, vertexAt = 0, indexAt = 0, targetVertexAt = 0, targetIndexAt = 0, allocationAt = 0, copied = 0;
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let target: THREE.BufferGeometry | null = null, root: THREE.Group | null = null;
  let position: Float32Array | null = null;
  let normal: Float32Array | Int8Array | null = null, color: Float32Array | Uint8Array | null = null;
  let indices: Uint32Array | Uint16Array | null = null;
  let phase: 'emit' | 'allocate' | 'copy' | 'seal' | 'publish' = 'emit', terminal = false, transferred = false, stepping = false;
  const cleanup = (): unknown[] => {
    const errors: unknown[] = []; const detached = root; root = null;
    if (detached?.parent) { try { detached.parent.remove(detached); } catch (e) { errors.push(e); } }
    if (!transferred && target) { const result = dispose(target); if (result.didThrow) errors.push(result.error); } target = null;
    if (!transferred) while (pages.length) { const p = pages.shift()!; const result = dispose(p.mesh.geometry); if (result.didThrow) errors.push(result.error); }
    while (staged.length) { const f = staged.shift()!; const result = dispose(f.geometry); if (result.didThrow) errors.push(result.error); }
    stagedBytes = targetBytes = sealedBytes = 0; open = []; openVertices = openIndices = 0;
    clear(scratch); emitted.length = 0; position = normal = color = null; indices = null; return errors;
  };
  const stop = () => { if (terminal) return []; terminal = true; return cleanup(); };
  const fail = (error: unknown): never => { const errors = stop(); if (errors.length) throw new AggregateError([error, ...errors], 'Cell stock job failed and cleanup failed'); throw error; };
  const emit = (source: number, cell: CityCell): void => {
    const local = createScratch(); let group: THREE.Group | null = null; let fragments: Fragment[] = [];
    try {
      group = buildCellStockBatch({ cityData: args.cityData, cellId: cell.id, buildingIndices: [source], excludedBuildingIndices: excluded, material: args.material, detail: args.detail, scratch: local });
      if (terminal) {
        const errors: unknown[] = [];
        group?.traverse((o) => { if (o instanceof THREE.Mesh) { const result = dispose(o.geometry); if (result.didThrow) errors.push(result.error); } });
        if (errors.length) throw new AggregateError(errors, 'Cell stock job cancellation cleanup failed');
        return;
      }
      if (!group) return;
      group.traverse((o) => { if (o instanceof THREE.Mesh) fragments.push({ geometry: o.geometry, vertices: 0, indices: 0, bytes: 0 }); });
      const unit: Unit = { sources: Object.freeze([...((group.userData.sourceBuildingIndices as readonly number[] | undefined) ?? [])]), fragments: fragments.length, vertices: 0, indices: 0 };
      for (const fragment of fragments) { const p = fragment.geometry.getAttribute('position'), n = fragment.geometry.getAttribute('normal'), c = fragment.geometry.getAttribute('color'), ix = fragment.geometry.getIndex(); if (!p || !n || !c || !ix) throw new Error('stock fragment is not indexed and complete'); fragment.vertices = p.count; fragment.indices = ix.count; fragment.bytes = geometryBytes(fragment.geometry); unit.vertices += p.count; unit.indices += ix.count; }
      if (args.split && !fits(newPage(), unit.vertices, unit.indices)) throw new RangeError(`building ${unit.sources.join(',')} in ${cell.id} exceeds page bounds: ${unit.vertices} vertices, ${indexBytes(unit.vertices, unit.indices)} index bytes`);
      for (const f of fragments) { staged.push(f); stagedBytes += f.bytes; } open.push(unit); openVertices += unit.vertices; openIndices += unit.indices; fragments = [];
      emitted.push(...unit.sources); append(scratch, local);
    } catch (e) { const errors: unknown[] = []; while (fragments.length) { const f = fragments.shift()!; const result = dispose(f.geometry); if (result.didThrow) errors.push(result.error); } if (errors.length) throw new AggregateError([e, ...errors], 'Cell stock fragment validation and cleanup failed'); throw e; }
  };
  const closeCell = (): void => {
    const cell = cells[cellAt]!;
    const whole = fits(page, openVertices, openIndices);
    if (!whole && page.fragments > 0) { phase = 'allocate'; return; }
    page.cellIds.push(cell.id);
    if (whole || !args.split) {
      for (const unit of open) take(page, unit); open = []; openVertices = openIndices = 0;
      if (++cellAt === cells.length) phase = 'allocate';
      return;
    }
    // The cell alone overflows an empty page: this page takes its leading buildings, the rest stays open.
    while (open.length && fits(page, open[0]!.vertices, open[0]!.indices)) { const unit = open.shift()!; take(page, unit); openVertices -= unit.vertices; openIndices -= unit.indices; }
    phase = 'allocate';
  };
  const allocate = (): void => {
    if (page.vertices === 0) { phase = 'seal'; return; } if (!target) target = new THREE.BufferGeometry();
    if (allocationAt === 0) { position = new Float32Array(page.vertices * 3); target.setAttribute('position', new THREE.BufferAttribute(position, 3)); targetBytes += position.byteLength; }
    else if (allocationAt === 1) { normal = args.detail === 'overview' ? new Int8Array(page.vertices * 3) : new Float32Array(page.vertices * 3); target.setAttribute('normal', new THREE.BufferAttribute(normal, 3, args.detail === 'overview')); targetBytes += normal.byteLength; }
    else if (allocationAt === 2) { color = args.detail === 'overview' ? new Uint8Array(page.vertices * 3) : new Float32Array(page.vertices * 3); target.setAttribute('color', new THREE.BufferAttribute(color, 3, args.detail === 'overview')); targetBytes += color.byteLength; }
    else { indices = args.detail === 'overview' && page.vertices <= 65535 ? new Uint16Array(page.indices) : new Uint32Array(page.indices); target.setIndex(new THREE.BufferAttribute(indices, 1)); targetBytes += indices.byteLength; phase = 'copy'; } allocationAt++;
  };
  const copy = (): boolean => {
    const f = staged[0]!, p = f.geometry.getAttribute('position') as THREE.BufferAttribute, n = f.geometry.getAttribute('normal') as THREE.BufferAttribute, c = f.geometry.getAttribute('color') as THREE.BufferAttribute, ix = f.geometry.getIndex() as THREE.BufferAttribute;
    if (vertexAt < f.vertices) { const count = Math.min(1365, f.vertices - vertexAt), start = vertexAt * 3, end = (vertexAt + count) * 3; position!.set((p.array as Float32Array).subarray(start, end), targetVertexAt * 3); const sourceNormals = n.array as Float32Array, sourceColors = c.array as Float32Array; if (args.detail === 'overview') { for (let i = start; i < end; i++) { (normal as Int8Array)![targetVertexAt * 3 + i - start] = Math.round(Math.max(-1, Math.min(1, sourceNormals[i]!)) * 127); (color as Uint8Array)![targetVertexAt * 3 + i - start] = Math.round(Math.max(0, Math.min(1, sourceColors[i]!)) * 255); } } else { normal!.set(sourceNormals.subarray(start, end), targetVertexAt * 3); color!.set(sourceColors.subarray(start, end), targetVertexAt * 3); } const a = p.array as Float32Array; for (let i = start; i < end; i += 3) { minX = Math.min(minX, a[i]!); minY = Math.min(minY, a[i + 1]!); minZ = Math.min(minZ, a[i + 2]!); maxX = Math.max(maxX, a[i]!); maxY = Math.max(maxY, a[i + 1]!); maxZ = Math.max(maxZ, a[i + 2]!); } vertexAt += count; targetVertexAt += count; return false; }
    if (indexAt < f.indices) { const count = Math.min(4096, f.indices - indexAt), a = ix.array as Uint16Array | Uint32Array, offset = targetVertexAt - f.vertices; for (let i = 0; i < count; i++) indices![targetIndexAt + i] = a[indexAt + i]! + offset; indexAt += count; targetIndexAt += count; return false; }
    const done = staged.shift()!; stagedBytes -= done.bytes; const result = dispose(done.geometry); if (result.didThrow) throw result.error; vertexAt = indexAt = 0; return ++copied === page.fragments;
  };
  const seal = (): void => {
    if (target) {
      target.boundingBox = new THREE.Box3(new THREE.Vector3(minX, minY, minZ), new THREE.Vector3(maxX, maxY, maxZ)); const center = target.boundingBox.getCenter(new THREE.Vector3()); target.boundingSphere = new THREE.Sphere(center, center.distanceTo(target.boundingBox.max));
      const mesh = new THREE.Mesh(target, args.material); mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = true;
      const cellIds = Object.freeze([...page.cellIds]), pageSources = Object.freeze([...page.sources]);
      if ('cellId' in args.label) { mesh.userData.cellId = args.label.cellId; mesh.userData.sourceBuildingIndices = emitted; } else { mesh.userData.tileId = args.label.tileId; mesh.userData.cellIds = cellIds; mesh.userData.sourceBuildingIndices = pageSources; }
      const bytes = position!.byteLength + normal!.byteLength + color!.byteLength + indices!.byteLength;
      pages.push({ mesh, cellIds, sourceBuildingIndices: pageSources, vertices: page.vertices, indexBytes: indices!.byteLength, geometryBytes: bytes });
      sealedBytes += bytes; targetBytes -= bytes; target = null;
    }
    position = normal = color = null; indices = null; allocationAt = copied = targetVertexAt = targetIndexAt = 0;
    minX = minY = minZ = Infinity; maxX = maxY = maxZ = -Infinity;
    page = newPage();
    phase = cellAt === cells.length && open.length === 0 ? 'publish' : 'emit';
  };
  const publish = (): void => {
    if (pages.length) { root = new THREE.Group(); root.frustumCulled = false; root.userData.sourceBuildingIndices = emitted; if ('cellId' in args.label) root.userData.cellId = args.label.cellId; else { root.userData.tileId = args.label.tileId; root.userData.cellIds = Object.freeze(cells.map((cell) => cell.id)); } for (const p of pages) root.add(p.mesh); }
    let bytes = 0; for (const p of pages) bytes += p.geometryBytes;
    // Ownership of the sealed pages passes to the consumer inside onReady (tracker attach or
    // disposal), so they leave the staging total before the callback rather than after it.
    sealedBytes = 0;
    args.onReady({ root, pages: Object.freeze([...pages]), scratch, emitted, bytes }); if (terminal) return; terminal = true; transferred = true; target = null;
  };
  return { id: args.id, generation: args.generation, essential: args.essential, stagingBytes: () => stagedBytes + targetBytes + sealedBytes, cancel() { const errors = stop(); if (errors.length) throw new AggregateError(errors, 'Cell stock job cleanup failed'); }, step() { if (terminal) return true; if (stepping) throw new Error('Reentrant cell stock job step is unsupported'); stepping = true; try { const deadline = args.now() + sliceMs; let units = 0; while (!terminal && units < 16) { if (args.now() >= deadline) return false; if (phase === 'emit') { if (cellAt === cells.length) { phase = 'allocate'; continue; } if (emitAt === cellEnds[cellAt]) { closeCell(); continue; } emit(sources[emitAt++]!, cells[cellAt]!); } else if (phase === 'allocate') allocate(); else if (phase === 'copy') { if (copy()) phase = 'seal'; } else if (phase === 'seal') seal(); else { publish(); return true; } units++; } return terminal; } catch (e) { return fail(e); } finally { stepping = false; } } };
}

export function createCellStockJob(args: CellStockJobArgs): StockJob {
  return createStockPagesJob({
    ...args,
    cells: [args.cell],
    label: { cellId: args.cell.id },
    maxPageVertices: MAX_PAGE_VERTICES,
    maxPageIndexBytes: MAX_PAGE_INDEX_BYTES,
    split: false,
    onReady: ({ root, scratch, emitted, bytes }) => args.onReady({ group: root, scratch, sourceBuildingIndices: emitted, geometryBytes: bytes }),
  });
}

/** Overview-only: pack several existing source cells into bounded Uint16 pages under one group, splitting a dense cell at building boundaries. */
export function createStockTileJob(args: StockTileJobArgs): StockJob {
  if (args.cells.length === 0) throw new RangeError('a stock tile needs at least one cell');
  const cellIds = Object.freeze(args.cells.map((cell) => cell.id));
  return createStockPagesJob({
    ...args,
    detail: 'overview',
    label: { tileId: args.tileId },
    maxPageVertices: args.maxPageVertices ?? MAX_PAGE_VERTICES,
    maxPageIndexBytes: args.maxPageIndexBytes ?? MAX_PAGE_INDEX_BYTES,
    split: true,
    onReady: ({ root, pages, scratch, emitted, bytes }) => args.onReady({ group: root, pages, cellIds, scratch, sourceBuildingIndices: emitted, geometryBytes: bytes }),
  });
}
