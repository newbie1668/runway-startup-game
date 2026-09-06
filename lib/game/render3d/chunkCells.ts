/**
 * Keep-disk stock is still one job per (chunk, major). Kilometre meshes
 * cannot miss the 8.5 wu mid frustum, so render() vertex-shaded the whole
 * disk and Aw Snapped. Split that geometry into DRAW_CELL_M cells here,
 * after emit, so cityBuilder's extrusion loop stays a plain const buffer.
 */
import * as THREE from 'three';
import { METERS_TO_WORLD } from '../geo';
import { DRAW_CELL_M } from './lookClip';

type CellBuf = {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  remap: Map<number, number>;
};

function drawCellKey(x: number, z: number): string {
  const s = DRAW_CELL_M * METERS_TO_WORLD;
  return `${Math.floor(x / s)},${Math.floor(z / s)}`;
}

/** Cell meshes under a chunk group. The group itself is not culled. */
export function chunkTierMeshes(root: THREE.Object3D | null): THREE.Mesh[] {
  if (!root) return [];
  const out: THREE.Mesh[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) out.push(obj);
  });
  return out;
}

function copyVert(from: number[], i: number, into: number[]): void {
  const o = i * 3;
  into.push(from[o]!, from[o + 1]!, from[o + 2]!);
}

/**
 * Split one chunk's building buffers into DRAW_CELL_M meshes.
 * Stock stays in the scene. Off-screen cells skip render().
 */
export function splitChunkCells(args: {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
  chunkId: number;
  major: boolean;
}): THREE.Group | null {
  const { positions, normals, colors, indices, chunkId, major } = args;
  if (positions.length === 0 || indices.length < 3) return null;

  const cells = new Map<string, CellBuf>();
  const vertOf = (buf: CellBuf, old: number): number => {
    const cached = buf.remap.get(old);
    if (cached !== undefined) return cached;
    copyVert(positions, old, buf.positions);
    copyVert(normals, old, buf.normals);
    copyVert(colors, old, buf.colors);
    const next = buf.positions.length / 3 - 1;
    buf.remap.set(old, next);
    return next;
  };

  for (let t = 0; t + 2 < indices.length; t += 3) {
    const i0 = indices[t]!;
    const i1 = indices[t + 1]!;
    const i2 = indices[t + 2]!;
    const x = positions[i0 * 3]!;
    const z = positions[i0 * 3 + 2]!;
    const key = drawCellKey(x, z);
    let buf = cells.get(key);
    if (!buf) {
      buf = { positions: [], normals: [], colors: [], indices: [], remap: new Map() };
      cells.set(key, buf);
    }
    buf.indices.push(vertOf(buf, i0), vertOf(buf, i1), vertOf(buf, i2));
  }

  const group = new THREE.Group();
  group.frustumCulled = false;
  group.userData.chunkId = chunkId;
  group.userData.major = major;
  for (const buf of cells.values()) {
    if (buf.positions.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
    geometry.setIndex(buf.indices);
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.userData.chunkId = chunkId;
    mesh.userData.major = major;
    group.add(mesh);
  }
  return group.children.length > 0 ? group : null;
}
