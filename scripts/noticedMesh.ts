/**
 * Three.js noticed-tower baker (used when Blender is not installed).
 * Same job JSON as blender_noticed.py: footprint + bands + photo colours.
 */

import * as THREE from 'three';
import earcut from 'earcut';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { NoticedBand, NoticedShape } from './noticedFeatures';
import { bandsForShape, isCircularShape } from './noticedFeatures';

export interface NoticedBakeBuilding {
  id: string;
  ring: Array<[number, number]>;
  heightWorld: number;
  wall: [number, number, number];
  roof: [number, number, number];
  glass: boolean;
  seed: number;
  shape: NoticedShape;
  bands?: NoticedBand[];
  circular?: boolean;
}

class NodeFileReader {
  result: ArrayBuffer | null = null;
  onloadend: ((ev: unknown) => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onloadend?.(null);
    });
  }
}
(globalThis as unknown as { FileReader: typeof NodeFileReader }).FileReader = NodeFileReader;

function rgbHex(rgb: [number, number, number]): number {
  const r = Math.round(Math.min(1, Math.max(0, rgb[0])) * 255);
  const g = Math.round(Math.min(1, Math.max(0, rgb[1])) * 255);
  const b = Math.round(Math.min(1, Math.max(0, rgb[2])) * 255);
  return (r << 16) | (g << 8) | b;
}

function signedArea(ring: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum / 2;
}

function ensureClosedOpen(ring: Array<[number, number]>): Array<[number, number]> {
  if (ring.length < 3) return ring;
  const a = ring[0]!;
  const b = ring[ring.length - 1]!;
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-8) return ring.slice(0, -1);
  return ring;
}

function toCcw(ring: Array<[number, number]>): Array<[number, number]> {
  const open = ensureClosedOpen(ring);
  return signedArea(open) < 0 ? open.slice().reverse() : open;
}

function centroid(ring: Array<[number, number]>): [number, number] {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

export function transformRing(
  ring: Array<[number, number]>,
  scale: number,
  yawDeg: number,
): Array<[number, number]> {
  const [cx, cy] = centroid(ring);
  const rad = (yawDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return ring.map(([x, y]) => {
    const dx = (x - cx) * scale;
    const dy = (y - cy) * scale;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  });
}

export function circularize(ring: Array<[number, number]>, n = 28): Array<[number, number]> {
  const open = ensureClosedOpen(ring);
  const [cx, cy] = centroid(open);
  const r = Math.max(...open.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as [number, number];
  });
}

function makeWallMaterial(
  wall: [number, number, number],
  glass: boolean,
  seed: number,
): THREE.MeshStandardMaterial {
  const j = ((seed % 9) - 4) / 90;
  const rgb: [number, number, number] = [
    Math.min(1, Math.max(0, wall[0] + j)),
    Math.min(1, Math.max(0, wall[1] + j * (glass ? 0.5 : 1))),
    Math.min(1, Math.max(0, wall[2] + j * (glass ? 1.2 : 1))),
  ];
  return new THREE.MeshStandardMaterial({
    color: rgbHex(rgb),
    metalness: 0,
    roughness: glass ? 0.38 : 0.72,
  });
}

function extrudeGeometry(
  ring: Array<[number, number]>,
  y0: number,
  y1: number,
  vScale: number,
): THREE.BufferGeometry {
  const r = toCcw(ring);
  const n = r.length;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let uAcc = 0;
  for (let i = 0; i < n; i++) {
    const a = r[i]!;
    const b = r[(i + 1) % n]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1e-6;
    const nx = dz / len;
    const nz = -dx / len;
    const base = positions.length / 3;
    positions.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y1, a[1]);
    for (let k = 0; k < 4; k++) normals.push(nx, 0, nz);
    const u0 = uAcc * 2.2;
    const u1 = (uAcc + len) * 2.2;
    const v0 = y0 * vScale;
    const v1 = y1 * vScale;
    uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    uAcc += len;
  }

  const flat: number[] = [];
  for (const p of r) flat.push(p[0], p[1]);
  const tris = earcut(flat, undefined, 2);
  const topBase = positions.length / 3;
  for (const p of r) {
    positions.push(p[0], y1, p[1]);
    normals.push(0, 1, 0);
    uvs.push(p[0] * 0.25, p[1] * 0.25);
  }
  for (let i = 0; i < tris.length; i += 3) {
    indices.push(topBase + tris[i]!, topBase + tris[i + 1]!, topBase + tris[i + 2]!);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  const sideIndexCount = n * 6;
  geo.addGroup(0, sideIndexCount, 0);
  geo.addGroup(sideIndexCount, indices.length - sideIndexCount, 1);
  return geo;
}

export function buildNoticedGroup(job: NoticedBakeBuilding): THREE.Group {
  const shape = job.shape;
  const bands = job.bands ?? bandsForShape(shape);
  const circular = job.circular ?? isCircularShape(shape);
  let base = toCcw(job.ring);
  if (circular) base = circularize(base);
  const vScale = 1 / Math.max(job.heightWorld, 0.01);
  const wallMat = makeWallMaterial(job.wall, job.glass, job.seed);
  const roofMat = new THREE.MeshStandardMaterial({
    color: rgbHex(job.roof),
    metalness: 0,
    roughness: 0.78,
  });

  const group = new THREE.Group();
  group.name = job.id;
  bands.forEach((band, i) => {
    const ring = transformRing(base, band.scale, band.yawDeg);
    const y0 = job.heightWorld * band.t0;
    const y1 = job.heightWorld * band.t1;
    const geo = extrudeGeometry(ring, y0, y1, vScale);
    const mesh = new THREE.Mesh(geo, [wallMat, roofMat]);
    mesh.name = `${job.id}-${i}`;
    group.add(mesh);
  });
  appendCivicSilhouette(group, job, wallMat, roofMat);
  return group;
}

function ringSize(ring: Array<[number, number]>): { cx: number; cz: number; w: number; d: number } {
  const [cx, cz] = centroid(ring);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of ring) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { cx, cz, w: Math.max(0.04, maxX - minX), d: Math.max(0.04, maxZ - minZ) };
}

function addBox(
  group: THREE.Group,
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  name: string,
): void {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y + h / 2, z);
  mesh.name = name;
  group.add(mesh);
}

/** Churches, stations, theatres, civic piles — extra massing, not another glass taper. */
function appendCivicSilhouette(
  group: THREE.Group,
  job: NoticedBakeBuilding,
  wallMat: THREE.Material,
  roofMat: THREE.Material,
): void {
  const { cx, cz, w, d } = ringSize(job.ring);
  const H = job.heightWorld;
  const ridgeRgb: [number, number, number] = [
    Math.min(1, job.wall[0] + 0.18),
    Math.min(1, job.wall[1] + 0.18),
    Math.min(1, job.wall[2] + 0.16),
  ];
  const ridge = new THREE.MeshBasicMaterial({ color: rgbHex(ridgeRgb) });
  if (job.shape === 'church') {
    const tw = Math.min(w, d) * 0.32;
    const towerH = H * 1.35;
    addBox(group, tw, towerH, tw, wallMat, cx, 0, cz - d * 0.38, `${job.id}-tower`);
    const spireH = H * 0.55;
    const spire = new THREE.Mesh(new THREE.ConeGeometry(tw * 0.55, spireH, 4), roofMat);
    spire.position.set(cx, towerH + spireH / 2, cz - d * 0.38);
    spire.rotation.y = Math.PI / 4;
    spire.name = `${job.id}-spire`;
    group.add(spire);
    addBox(group, tw * 0.18, H * 0.22, tw * 0.18, ridge, cx, towerH * 0.55, cz - d * 0.38, `${job.id}-ridge`);
  } else if (job.shape === 'station') {
    const clockH = H * 1.15;
    const tw = Math.min(w, d) * 0.28;
    addBox(group, tw, clockH, tw, wallMat, cx + w * 0.32, 0, cz, `${job.id}-clock`);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(tw * 0.38, tw * 0.38, H * 0.18, 12), ridge);
    drum.position.set(cx + w * 0.32, clockH + H * 0.08, cz);
    drum.name = `${job.id}-clockface`;
    group.add(drum);
    addBox(group, w * 0.9, H * 0.12, d * 0.18, roofMat, cx, H * 0.72, cz, `${job.id}-shed`);
  } else if (job.shape === 'theatre') {
    addBox(group, w * 0.42, H * 1.45, d * 0.38, wallMat, cx, 0, cz + d * 0.22, `${job.id}-fly`);
    addBox(group, w * 0.7, H * 0.16, d * 0.12, ridge, cx, H * 0.42, cz - d * 0.48, `${job.id}-marquee`);
  } else if (job.shape === 'civic') {
    const domeR = Math.min(w, d) * 0.28;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(domeR, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      wallMat,
    );
    dome.position.set(cx, H, cz);
    dome.name = `${job.id}-dome`;
    group.add(dome);
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(domeR * 0.18, domeR * 0.22, H * 0.22, 8), ridge);
    lantern.position.set(cx, H + domeR * 0.55, cz);
    lantern.name = `${job.id}-lantern`;
    group.add(lantern);
  }
}

export async function exportNoticedGlb(root: THREE.Object3D): Promise<ArrayBuffer> {
  const scene = new THREE.Scene();
  scene.add(root);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true });
  if (result instanceof ArrayBuffer) return result;
  throw new Error('GLTFExporter did not return a binary glTF');
}
