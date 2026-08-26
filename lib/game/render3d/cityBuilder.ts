/**
 * RUNWAY — decoded city data -> three.js geometry.
 *
 * Real OSM footprints don't have consistent winding, so wall/roof faces
 * compute their own outward-facing normal (from the footprint centroid) and
 * pick triangle order to match it at build time, rather than assuming a
 * fixed winding convention. This is a one-time streaming-build cost, not a
 * per-frame one.
 */

import * as THREE from 'three';
import { METERS_TO_WORLD, TUBE_LINES, WORLD, project } from '../geo';
import { HUB_POS } from '../overlay';
import type { HubId } from '../types';
import { dequantizeX, dequantizeY, type CityData, type CityPoly, type CityRoad } from './format';

/** Style exaggeration applied to every extruded height (buildings + landmarks). */
export const HEIGHT_SCALE = 1.5;

export const CHUNK_COLS = 8;
export const CHUNK_ROWS = 6;
export const CHUNK_COUNT = CHUNK_COLS * CHUNK_ROWS;

const SLATES = [0x0f1730, 0x121b36, 0x16203e, 0x1b2748].map((c) => new THREE.Color(c));
const AO_DARK = new THREE.Color(0x070c14);

const ROAD_WIDTHS_M = [14, 10, 6];
const ROAD_COLORS = [0x2c3a66, 0x222c50, 0x161e38].map((c) => new THREE.Color(c));
const ROAD_Y = 0.15;

const TUBE_WIDTH_M = 4;
const TUBE_Y = 0.25;

const HUB_GLOW_COLOR = 0x7dd3fc;
export const HUB_GLOW_PLAYER_COLOR = 0xf8c33a;
const HUB_GLOW_SIZE_M = 50;
const HUB_GLOW_HEIGHT_M = 8;

function hashBuildingIndex(heightM: number, chunkId: number, verts: Uint16Array, mod: number): number {
  let h = (Math.imul(chunkId, 2654435761) ^ Math.imul(heightM, 40503)) | 0;
  for (let i = 0; i < verts.length; i++) h = (Math.imul(h, 31) + verts[i]) | 0;
  h ^= h >>> 15;
  return Math.abs(h) % mod;
}

/** Perpendicular to edge a->b that points away from the footprint centroid. */
function outwardNormal(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): [number, number] {
  let nx = bz - az;
  let nz = -(bx - ax);
  const midX = (ax + bx) / 2;
  const midZ = (az + bz) / 2;
  if (nx * (cx - midX) + nz * (cz - midZ) > 0) {
    nx = -nx;
    nz = -nz;
  }
  const len = Math.hypot(nx, nz) || 1;
  return [nx / len, nz / len];
}

export function createBuildingMaterial(windowsTexture: THREE.Texture): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    vertexColors: true,
    emissive: 0xffffff,
    emissiveMap: windowsTexture,
    emissiveIntensity: 0.8,
  });
}

/** One merged, flat-shaded, indexed geometry for every building in (chunkId, major). */
const LANDMARK_EXCLUSION_WORLD = 80 * METERS_TO_WORLD;

export function buildChunkTier(
  cityData: CityData,
  chunkId: number,
  major: boolean,
  landmarkAnchors: readonly { x: number; y: number }[] = [],
): THREE.Mesh | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const pushVertex = (
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
    color: THREE.Color,
  ): number => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
    colors.push(color.r, color.g, color.b);
    return positions.length / 3 - 1;
  };

  for (const b of cityData.buildings) {
    if (b.chunkId !== chunkId || b.major !== major) continue;
    const n = b.verts.length / 2;
    if (n < 3) continue;

    const ring = new Array<{ x: number; z: number }>(n);
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < n; i++) {
      const x = dequantizeX(b.verts[i * 2]);
      const z = dequantizeY(b.verts[i * 2 + 1]);
      ring[i] = { x, z };
      cx += x;
      cz += z;
    }
    cx /= n;
    cz /= n;

    if (landmarkAnchors.some((a) => Math.hypot(cx - a.x, cz - a.y) < LANDMARK_EXCLUSION_WORLD)) continue;

    const heightWorld = b.heightM * METERS_TO_WORLD * HEIGHT_SCALE;
    const base = SLATES[hashBuildingIndex(b.heightM, b.chunkId, b.verts, SLATES.length)];
    const wallBottomColor = base.clone().lerp(AO_DARK, 0.45);
    const roofColor = base.clone().multiplyScalar(0.7);

    // --- Walls: 2 triangles per edge, fresh vertices per face for flat shading.
    let cumMeters = 0;
    for (let i = 0; i < n; i++) {
      const a = ring[i];
      const bp = ring[(i + 1) % n];
      const edgeLenMeters = Math.hypot(bp.x - a.x, bp.z - a.z) / METERS_TO_WORLD;
      const uStart = cumMeters / 4;
      const uEnd = (cumMeters + edgeLenMeters) / 4;
      cumMeters += edgeLenMeters;
      const vTop = b.heightM / 3.4;

      const [nx, nz] = outwardNormal(a.x, a.z, bp.x, bp.z, cx, cz);
      // Candidate winding (bottomA, bottomB, topB): does its own normal agree with the outward one?
      const dx = bp.x - a.x;
      const dz = bp.z - a.z;
      const candX = -dz * heightWorld;
      const candZ = dx * heightWorld;
      const flip = candX * nx + candZ * nz < 0;

      const iBottomA = pushVertex(a.x, 0, a.z, nx, 0, nz, uStart, 0, wallBottomColor);
      const iBottomB = pushVertex(bp.x, 0, bp.z, nx, 0, nz, uEnd, 0, wallBottomColor);
      const iTopA = pushVertex(a.x, heightWorld, a.z, nx, 0, nz, uStart, vTop, base);
      const iTopB = pushVertex(bp.x, heightWorld, bp.z, nx, 0, nz, uEnd, vTop, base);

      if (!flip) {
        indices.push(iBottomA, iBottomB, iTopB, iBottomA, iTopB, iTopA);
      } else {
        indices.push(iBottomA, iTopB, iBottomB, iBottomA, iTopA, iTopB);
      }
    }

    // --- Roof: shared flat-up vertex block, reuse the offline earcut triangulation.
    const roofBase = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      roofBase[i] = pushVertex(ring[i].x, heightWorld, ring[i].z, 0, 1, 0, 0, 0, roofColor);
    }
    for (let t = 0; t < b.indices.length; t += 3) {
      const i0 = b.indices[t];
      let i1 = b.indices[t + 1];
      let i2 = b.indices[t + 2];
      const p0 = ring[i0];
      const p1 = ring[i1];
      const p2 = ring[i2];
      const signedArea = (p1.x - p0.x) * (p2.z - p0.z) - (p1.z - p0.z) * (p2.x - p0.x);
      if (signedArea < 0) {
        const tmp = i1;
        i1 = i2;
        i2 = tmp;
      }
      indices.push(roofBase[i0], roofBase[i1], roofBase[i2]);
    }
  }

  if (positions.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry);
  mesh.userData.chunkId = chunkId;
  mesh.userData.major = major;
  return mesh;
}

function buildMergedPolyMesh(polys: CityPoly[], color: number, y: number): THREE.Mesh | null {
  let totalVerts = 0;
  let totalTris = 0;
  for (const p of polys) {
    totalVerts += p.verts.length / 2;
    totalTris += p.indices.length / 3;
  }
  if (totalTris === 0) return null;

  const positions = new Float32Array(totalVerts * 3);
  const indices = new Uint32Array(totalTris * 3);
  let vOff = 0;
  let iOff = 0;
  let vertBase = 0;
  for (const p of polys) {
    const n = p.verts.length / 2;
    for (let i = 0; i < n; i++) {
      positions[vOff++] = dequantizeX(p.verts[i * 2]);
      positions[vOff++] = y;
      positions[vOff++] = dequantizeY(p.verts[i * 2 + 1]);
    }
    for (let i = 0; i < p.indices.length; i++) indices[iOff++] = p.indices[i] + vertBase;
    vertBase += n;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  // Flat unlit ground decal — DoubleSide sidesteps earcut/offline winding entirely.
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, material);
}

export function buildWater(cityData: CityData): THREE.Mesh | null {
  return buildMergedPolyMesh(cityData.water, 0x1d3a68, 0.05);
}

export function buildParks(cityData: CityData): THREE.Mesh | null {
  return buildMergedPolyMesh(cityData.parks, 0x14261c, 0.1);
}

function buildRibbonGeometry(
  ptsWorld: { x: number; z: number }[],
  halfWidthWorld: number,
  y: number,
): { positions: number[]; indices: number[] } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < ptsWorld.length - 1; i++) {
    const a = ptsWorld[i];
    const bp = ptsWorld[i + 1];
    const dx = bp.x - a.x;
    const dz = bp.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * halfWidthWorld;
    const pz = (dx / len) * halfWidthWorld;
    const base = positions.length / 3;
    positions.push(
      a.x + px,
      y,
      a.z + pz,
      a.x - px,
      y,
      a.z - pz,
      bp.x - px,
      y,
      bp.z - pz,
      bp.x + px,
      y,
      bp.z + pz,
    );
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, indices };
}

/** One merged mesh per tier (not one merged mesh overall) so tier 2 can be hidden independently at low zoom. */
export function buildRoads(cityData: CityData): THREE.Group | null {
  const group = new THREE.Group();
  for (let tier = 0; tier <= 2; tier++) {
    const positions: number[] = [];
    const indices: number[] = [];
    const halfW = (ROAD_WIDTHS_M[tier] * METERS_TO_WORLD) / 2;
    for (const road of cityData.roads as CityRoad[]) {
      if (road.tier !== tier) continue;
      const n = road.pts.length / 2;
      if (n < 2) continue;
      const pts = new Array<{ x: number; z: number }>(n);
      for (let i = 0; i < n; i++) pts[i] = { x: dequantizeX(road.pts[i * 2]), z: dequantizeY(road.pts[i * 2 + 1]) };
      const { positions: segPositions, indices: segIndices } = buildRibbonGeometry(pts, halfW, ROAD_Y);
      const vertBase = positions.length / 3;
      for (const v of segPositions) positions.push(v);
      for (let i = 0; i < segIndices.length; i++) indices.push(segIndices[i] + vertBase);
    }
    if (positions.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const material = new THREE.MeshBasicMaterial({ color: ROAD_COLORS[tier], side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.roadTier = tier;
    group.add(mesh);
  }
  return group.children.length > 0 ? group : null;
}

export function buildTubeLines(): THREE.Group {
  const group = new THREE.Group();
  const halfW = (TUBE_WIDTH_M * METERS_TO_WORLD) / 2;
  for (const line of TUBE_LINES) {
    const pts = line.points.map((p) => {
      const w = project(p);
      return { x: w.x, z: w.y };
    });
    const { positions, indices } = buildRibbonGeometry(pts, halfW, TUBE_Y);
    if (positions.length === 0) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const material = new THREE.MeshBasicMaterial({
      color: line.color,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    group.add(new THREE.Mesh(geometry, material));
  }
  return group;
}

export function buildGround(): THREE.Mesh {
  const marginX = WORLD.width * 0.3;
  const marginY = WORLD.height * 0.3;
  const geometry = new THREE.PlaneGeometry(WORLD.width + marginX * 2, WORLD.height + marginY * 2);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({ color: 0x0b1020 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(WORLD.width / 2, 0, WORLD.height / 2);
  return mesh;
}

export function buildHubGlows(glowTexture: THREE.Texture): { group: THREE.Group; sprites: Map<HubId, THREE.Sprite> } {
  const group = new THREE.Group();
  const sprites = new Map<HubId, THREE.Sprite>();
  const size = HUB_GLOW_SIZE_M * METERS_TO_WORLD;
  const height = HUB_GLOW_HEIGHT_M * METERS_TO_WORLD;
  for (const hubId of Object.keys(HUB_POS) as HubId[]) {
    const pos = HUB_POS[hubId];
    const material = new THREE.SpriteMaterial({
      map: glowTexture,
      color: HUB_GLOW_COLOR,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(size, size, 1);
    sprite.position.set(pos.x, height, pos.y);
    group.add(sprite);
    sprites.set(hubId, sprite);
  }
  return { group, sprites };
}

