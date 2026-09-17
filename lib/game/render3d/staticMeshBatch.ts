/**
 * RUNWAY — conservative runtime static batching for prefab / procedural assets.
 *
 * Merges sibling `THREE.Mesh` children that share the same material object
 * and rendering flags into one mesh per (parent, material, flags) page, baking
 * each sibling's local transform into its vertices. Nested groups keep their
 * own transforms and are batched independently, so animated sub-groups (the
 * London Eye wheel) never merge with their parent's static shell. Anything
 * unsupported — skinned/instanced/morphed/transparent meshes, draw ranges,
 * material arrays, interleaved attributes, custom render callbacks, singular
 * or reflected transforms — is left untouched. With `keepUniquelyNamed`,
 * a mesh whose name is unique within the asset also stays as-is (authored
 * procedural parts are lookup anchors; repeated names such as per-storey bays
 * still merge). Only imported behind the factory's dynamic import of three.js.
 */

import * as THREE from 'three';

export interface StaticBatchOptions {
  /** Max vertices per merged page. Default keeps Uint16 indices. */
  maxVertices?: number;
  /** Max geometry-array bytes per merged page. */
  maxBytes?: number;
  /** Leave meshes whose name is unique within `root` untouched. Default false. */
  keepUniquelyNamed?: boolean;
  /** Test hook: invoked with each merged geometry before the scene is mutated. */
  onPageBuilt?: (geometry: THREE.BufferGeometry) => void;
}

export interface StaticBatchSource {
  name: string;
  uuid: string;
  vertexStart: number;
  vertexCount: number;
  indexStart: number;
  indexCount: number;
  userData?: Record<string, unknown>;
}

export interface StaticBatchMetadata {
  sources: StaticBatchSource[];
}

export interface StaticBatchReport {
  /** Meshes examined as batch candidates (direct Mesh children of any node). */
  candidates: number;
  /** Meshes left untouched because they were unsupported or unpaired. */
  skipped: number;
  /** Source meshes removed from the tree. */
  merged: number;
  /** Merged meshes added to the tree. */
  batches: number;
  /** Superseded geometries disposed by this call. */
  disposedGeometries: number;
}

export const DEFAULT_MAX_BATCH_VERTICES = 65535;
export const DEFAULT_MAX_BATCH_BYTES = 8 * 1024 * 1024;
export const STATIC_BATCH_KEY = 'staticBatch';

type TypedArray = Float32Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array | Float64Array;
type TypedArrayCtor = { new (length: number): TypedArray; BYTES_PER_ELEMENT: number };

interface Candidate {
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
  vertexCount: number;
  indexCount: number;
  bytes: number;
  key: string;
}

interface Page {
  parent: THREE.Object3D;
  members: Candidate[];
}

interface PlannedBatch {
  page: Page;
  mesh: THREE.Mesh;
}

const MIN_DETERMINANT = 1e-12;

/**
 * True when a render callback is the inherited Object3D no-op rather than an
 * instance or subclass override. Resolved by prototype walk, not by identity
 * with this module's `THREE`, so scenes parsed by another three instance
 * (e.g. ESM addons under a CJS test runner) are judged the same way.
 */
function hasDefaultRenderCallback(mesh: THREE.Mesh, name: 'onBeforeRender' | 'onAfterRender'): boolean {
  const has = Object.prototype.hasOwnProperty;
  if (has.call(mesh, name)) return false;
  let proto = Object.getPrototypeOf(mesh) as object | null;
  while (proto !== null && proto !== Object.prototype) {
    if (has.call(proto, name)) {
      return has.call(proto, 'traverse') && has.call(proto, 'updateMatrixWorld') && has.call(proto, 'onAfterRender');
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return false;
}

function typedArrayName(array: ArrayLike<number>): string {
  return (array as { constructor: { name: string } }).constructor.name;
}

function attributeBytes(attribute: THREE.BufferAttribute): number {
  return attribute.array.byteLength;
}

function geometryBytes(geometry: THREE.BufferGeometry): number {
  let bytes = geometry.index ? geometry.index.array.byteLength : 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += attributeBytes(attribute as THREE.BufferAttribute);
  }
  return bytes;
}

function attributeSignature(name: string, attribute: THREE.BufferAttribute): string {
  return `${name}:${typedArrayName(attribute.array)}:${attribute.itemSize}:${attribute.normalized ? 1 : 0}:${attribute.gpuType}`;
}

function candidateOf(mesh: THREE.Mesh, maxVertices: number, maxBytes: number): Candidate | null {
  const flagged = mesh as THREE.Mesh & {
    isSkinnedMesh?: boolean;
    isInstancedMesh?: boolean;
    isBatchedMesh?: boolean;
    customDepthMaterial?: THREE.Material;
    customDistanceMaterial?: THREE.Material;
  };
  if (flagged.isSkinnedMesh || flagged.isInstancedMesh || flagged.isBatchedMesh) return null;
  if (mesh.children.length > 0) return null;
  if (!hasDefaultRenderCallback(mesh, 'onBeforeRender') || !hasDefaultRenderCallback(mesh, 'onAfterRender')) return null;
  if (flagged.customDepthMaterial || flagged.customDistanceMaterial) return null;
  if (mesh.morphTargetInfluences && mesh.morphTargetInfluences.length > 0) return null;
  if (Array.isArray(mesh.material)) return null;
  const material = mesh.material;
  if (!material || material.transparent || !material.visible) return null;
  const geometry = mesh.geometry;
  if (!geometry || !(geometry as { isBufferGeometry?: boolean }).isBufferGeometry) return null;
  if (geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) return null;
  if (Object.keys(geometry.morphAttributes).length > 0) return null;
  const position = geometry.getAttribute('position');
  if (!position || (position as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) return null;
  if (position.itemSize !== 3 || !(position.array instanceof Float32Array)) return null;
  const vertexCount = position.count;
  if (vertexCount === 0 || vertexCount > maxVertices) return null;
  const signatures: string[] = [];
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const typed = attribute as THREE.BufferAttribute & { isInterleavedBufferAttribute?: boolean; isInstancedBufferAttribute?: boolean };
    if (typed.isInterleavedBufferAttribute || typed.isInstancedBufferAttribute) return null;
    if (typed.count !== vertexCount) return null;
    if (name === 'normal' && (typed.itemSize !== 3 || !(typed.array instanceof Float32Array))) return null;
    if (name === 'tangent' && (typed.itemSize !== 4 || !(typed.array instanceof Float32Array))) return null;
    signatures.push(attributeSignature(name, typed));
  }
  signatures.sort();
  const index = geometry.index;
  if (index && ((index as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute || index.itemSize !== 1)) return null;
  const indexCount = index ? index.count : vertexCount;
  if (indexCount % 3 !== 0) return null;
  const bytes = geometryBytes(geometry);
  if (bytes > maxBytes) return null;

  if (mesh.matrixAutoUpdate) mesh.updateMatrix();
  const matrix = mesh.matrix.clone();
  const det = matrix.determinant();
  if (!Number.isFinite(det) || det <= MIN_DETERMINANT) return null;
  for (const value of matrix.elements) if (!Number.isFinite(value)) return null;

  const key = [
    material.uuid,
    mesh.visible ? 1 : 0,
    mesh.castShadow ? 1 : 0,
    mesh.receiveShadow ? 1 : 0,
    mesh.frustumCulled ? 1 : 0,
    mesh.renderOrder,
    mesh.layers.mask,
    signatures.join('|'),
  ].join('/');
  return { mesh, geometry, material, matrix, vertexCount, indexCount, bytes, key };
}

function meshNameCounts(root: THREE.Object3D): Map<string, number> {
  const counts = new Map<string, number>();
  root.traverse((node) => {
    if (!(node as { isMesh?: boolean }).isMesh || node.name.length === 0) return;
    counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
  });
  return counts;
}

function planPages(
  root: THREE.Object3D,
  maxVertices: number,
  maxBytes: number,
  keepUniquelyNamed: boolean,
  report: StaticBatchReport,
): Page[] {
  const pages: Page[] = [];
  const nameCounts = keepUniquelyNamed ? meshNameCounts(root) : null;
  root.traverse((node) => {
    const byKey = new Map<string, Candidate[]>();
    for (const child of node.children) {
      if (!(child as { isMesh?: boolean }).isMesh) continue;
      report.candidates += 1;
      const uniquelyNamed = nameCounts !== null && child.name.length > 0 && nameCounts.get(child.name) === 1;
      const candidate = uniquelyNamed ? null : candidateOf(child as THREE.Mesh, maxVertices, maxBytes);
      if (!candidate) {
        report.skipped += 1;
        continue;
      }
      const list = byKey.get(candidate.key);
      if (list) list.push(candidate);
      else byKey.set(candidate.key, [candidate]);
    }
    for (const list of byKey.values()) {
      let current: Candidate[] = [];
      let vertices = 0;
      let bytes = 0;
      const flush = (): void => {
        if (current.length >= 2) pages.push({ parent: node, members: current });
        else report.skipped += current.length;
        current = [];
        vertices = 0;
        bytes = 0;
      };
      for (const candidate of list) {
        if (current.length > 0 && (vertices + candidate.vertexCount > maxVertices || bytes + candidate.bytes > maxBytes)) flush();
        current.push(candidate);
        vertices += candidate.vertexCount;
        bytes += candidate.bytes;
      }
      flush();
    }
  });
  return pages;
}

function allocateLike(source: TypedArray, length: number): TypedArray {
  const ctor = source.constructor as TypedArrayCtor;
  return new ctor(length);
}

const scratchVector = new THREE.Vector3();
const scratchNormalMatrix = new THREE.Matrix3();

function buildPageGeometry(page: Page): THREE.BufferGeometry {
  const first = page.members[0]!;
  const attributeNames = Object.keys(first.geometry.attributes);
  let totalVertices = 0;
  let totalIndices = 0;
  let indexed = false;
  for (const member of page.members) {
    totalVertices += member.vertexCount;
    totalIndices += member.indexCount;
    if (member.geometry.index) indexed = true;
  }

  const merged = new THREE.BufferGeometry();
  try {
    const outputs = new Map<string, { array: TypedArray; itemSize: number; normalized: boolean }>();
    for (const name of attributeNames) {
      const template = first.geometry.getAttribute(name) as THREE.BufferAttribute;
      outputs.set(name, {
        array: allocateLike(template.array as TypedArray, totalVertices * template.itemSize),
        itemSize: template.itemSize,
        normalized: template.normalized,
      });
    }
    const IndexCtor = totalVertices > 65535 ? Uint32Array : Uint16Array;
    const indexArray = indexed ? new IndexCtor(totalIndices) : null;

    let vertexOffset = 0;
    let indexOffset = 0;
    for (const member of page.members) {
      scratchNormalMatrix.getNormalMatrix(member.matrix);
      for (const name of attributeNames) {
        const source = member.geometry.getAttribute(name) as THREE.BufferAttribute;
        const output = outputs.get(name)!;
        const sourceArray = source.array as TypedArray;
        const base = vertexOffset * output.itemSize;
        if (name === 'position') {
          for (let i = 0; i < member.vertexCount; i++) {
            scratchVector.fromArray(sourceArray, i * 3).applyMatrix4(member.matrix);
            scratchVector.toArray(output.array, base + i * 3);
          }
        } else if (name === 'normal') {
          for (let i = 0; i < member.vertexCount; i++) {
            scratchVector.fromArray(sourceArray, i * 3).applyMatrix3(scratchNormalMatrix).normalize();
            scratchVector.toArray(output.array, base + i * 3);
          }
        } else if (name === 'tangent') {
          for (let i = 0; i < member.vertexCount; i++) {
            scratchVector.fromArray(sourceArray, i * 4).transformDirection(member.matrix);
            scratchVector.toArray(output.array, base + i * 4);
            output.array[base + i * 4 + 3] = sourceArray[i * 4 + 3]!;
          }
        } else {
          output.array.set(sourceArray.subarray(0, member.vertexCount * output.itemSize), base);
        }
      }
      const index = member.geometry.index;
      if (indexArray && index) {
        const sourceIndex = index.array;
        for (let i = 0; i < member.indexCount; i++) indexArray[indexOffset + i] = sourceIndex[i]! + vertexOffset;
      } else if (indexArray) {
        for (let i = 0; i < member.indexCount; i++) indexArray[indexOffset + i] = vertexOffset + i;
      }
      vertexOffset += member.vertexCount;
      indexOffset += member.indexCount;
    }

    for (const [name, output] of outputs) {
      merged.setAttribute(name, new THREE.BufferAttribute(output.array, output.itemSize, output.normalized));
    }
    if (indexArray) merged.setIndex(new THREE.BufferAttribute(indexArray, 1));
    merged.computeBoundingBox();
    merged.computeBoundingSphere();
    return merged;
  } catch (error) {
    merged.dispose();
    throw error;
  }
}

function pageMetadata(page: Page): StaticBatchMetadata {
  const sources: StaticBatchSource[] = [];
  let vertexStart = 0;
  let indexStart = 0;
  for (const member of page.members) {
    const source: StaticBatchSource = {
      name: member.mesh.name,
      uuid: member.mesh.uuid,
      vertexStart,
      vertexCount: member.vertexCount,
      indexStart,
      indexCount: member.indexCount,
    };
    if (Object.keys(member.mesh.userData).length > 0) source.userData = member.mesh.userData;
    sources.push(source);
    vertexStart += member.vertexCount;
    indexStart += member.indexCount;
  }
  return { sources };
}

function batchName(page: Page): string {
  const names = [...new Set(page.members.map((member) => member.mesh.name).filter((name) => name.length > 0))];
  if (names.length === 0) return '';
  if (names.length === 1) return names[0]!;
  return `${names[0]}+${names.length - 1}`;
}

function buildBatchMesh(page: Page): THREE.Mesh {
  const geometry = buildPageGeometry(page);
  const first = page.members[0]!.mesh;
  const mesh = new THREE.Mesh(geometry, page.members[0]!.material);
  mesh.name = batchName(page);
  mesh.visible = first.visible;
  mesh.castShadow = first.castShadow;
  mesh.receiveShadow = first.receiveShadow;
  mesh.frustumCulled = first.frustumCulled;
  mesh.renderOrder = first.renderOrder;
  mesh.layers.mask = first.layers.mask;
  mesh.userData[STATIC_BATCH_KEY] = pageMetadata(page);
  return mesh;
}

function geometriesInUse(root: THREE.Object3D): Set<THREE.BufferGeometry> {
  const used = new Set<THREE.BufferGeometry>();
  root.traverse((node) => {
    const geometry = (node as { geometry?: THREE.BufferGeometry }).geometry;
    if (geometry) used.add(geometry);
  });
  return used;
}

/**
 * Batches compatible static sibling meshes under `root` in place.
 *
 * All merged geometries are built before the tree is touched; a failure
 * disposes only the new buffers and leaves `root` exactly as it was. After a
 * successful swap, superseded source geometries no longer referenced anywhere
 * under `root` are disposed exactly once. Materials and textures are never
 * disposed — the batch mesh keeps the shared material object.
 */
export function batchStaticMeshes(root: THREE.Object3D, options: StaticBatchOptions = {}): StaticBatchReport {
  const maxVertices = Math.min(options.maxVertices ?? DEFAULT_MAX_BATCH_VERTICES, 0xffffffff);
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BATCH_BYTES;
  const report: StaticBatchReport = { candidates: 0, skipped: 0, merged: 0, batches: 0, disposedGeometries: 0 };
  const pages = planPages(root, maxVertices, maxBytes, options.keepUniquelyNamed ?? false, report);
  if (pages.length === 0) return report;

  const planned: PlannedBatch[] = [];
  try {
    for (const page of pages) {
      const mesh = buildBatchMesh(page);
      planned.push({ page, mesh });
      options.onPageBuilt?.(mesh.geometry);
    }
  } catch (error) {
    const cleanup: unknown[] = [];
    for (const { mesh } of planned) {
      try { mesh.geometry.dispose(); } catch (disposeError) { cleanup.push(disposeError); }
    }
    if (cleanup.length) throw new AggregateError([error, ...cleanup], 'Static batch build failed');
    throw error;
  }

  const superseded = new Set<THREE.BufferGeometry>();
  for (const { page, mesh } of planned) {
    const parent = page.parent;
    const insertAt = parent.children.indexOf(page.members[0]!.mesh);
    for (const member of page.members) {
      parent.remove(member.mesh);
      superseded.add(member.geometry);
    }
    parent.add(mesh);
    if (insertAt >= 0 && insertAt < parent.children.length - 1) {
      parent.children.pop();
      parent.children.splice(insertAt, 0, mesh);
    }
    report.merged += page.members.length;
    report.batches += 1;
  }

  const inUse = geometriesInUse(root);
  for (const geometry of superseded) {
    if (inUse.has(geometry)) continue;
    geometry.dispose();
    report.disposedGeometries += 1;
  }
  return report;
}

export function staticBatchMetadata(mesh: THREE.Object3D): StaticBatchMetadata | null {
  const value = mesh.userData[STATIC_BATCH_KEY] as StaticBatchMetadata | undefined;
  return value && Array.isArray(value.sources) ? value : null;
}
