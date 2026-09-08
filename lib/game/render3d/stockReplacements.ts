/** Pure replacement eligibility and footprint ownership for ordinary stock. */
import { dequantizeX, dequantizeY, type CityData } from './format';

export type ReplacementState = { id: string; available: boolean; enabled: boolean };
export type ReplacementAnchor = { id: string; x: number; z: number };

export type FootprintMapping = {
  buildingIndexById: Map<string, number>;
  unmatchedIds: string[];
  ambiguousIds: string[];
};

/** Enabled, attached replacements own stock; malformed duplicate ownership is rejected. */
export function selectActiveReplacementIds(input: readonly ReplacementState[]): Set<string> {
  const seen = new Set<string>();
  const active: string[] = [];
  for (const replacement of input) {
    if (seen.has(replacement.id)) throw new Error(`duplicate replacement id: ${replacement.id}`);
    seen.add(replacement.id);
    if (replacement.enabled && replacement.available) active.push(replacement.id);
  }
  active.sort(compareCodePoints);
  return new Set(active);
}

function compareCodePoints(a: string, b: string): number {
  const aa = Array.from(a);
  const bb = Array.from(b);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    const av = aa[i]!.codePointAt(0)!;
    const bv = bb[i]!.codePointAt(0)!;
    if (av !== bv) return av - bv;
  }
  return aa.length - bb.length;
}

function pointOnSegment(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const cross = (x - ax) * dz - (z - az) * dx;
  if (cross !== 0) return false;
  return (x - ax) * (x - bx) + (z - az) * (z - bz) <= 0;
}

/** Boundary-inclusive point-in-ring without the biased water-query epsilon. */
function containsPoint(verts: Uint16Array, x: number, z: number): boolean {
  const n = verts.length / 2;
  if (n < 3 || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  const ring: Array<{ x: number; z: number }> = [];
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = dequantizeX(verts[i * 2]!);
    const pz = dequantizeY(verts[i * 2 + 1]!);
    if (!Number.isFinite(px) || !Number.isFinite(pz)) return false;
    ring.push({ x: px, z: pz });
    minX = Math.min(minX, px);
    minZ = Math.min(minZ, pz);
    maxX = Math.max(maxX, px);
    maxZ = Math.max(maxZ, pz);
  }
  if (x < minX || x > maxX || z < minZ || z > maxZ) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[j]!;
    const b = ring[i]!;
    if (pointOnSegment(x, z, a.x, a.z, b.x, b.z)) return true;
    if (a.z > z !== b.z > z) {
      const hitX = a.x + ((z - a.z) * (b.x - a.x)) / (b.z - a.z);
      if (hitX > x) inside = !inside;
    }
  }
  return inside;
}

/** Maps each anchor only when exactly one committed footprint contains it. */
export function mapReplacementAnchors(
  cityData: CityData,
  anchors: readonly ReplacementAnchor[],
): FootprintMapping {
  const buildingIndexById = new Map<string, number>();
  const unmatchedIds: string[] = [];
  const ambiguousIds: string[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    if (seen.has(anchor.id)) throw new Error(`duplicate replacement anchor id: ${anchor.id}`);
    seen.add(anchor.id);
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.z)) {
      unmatchedIds.push(anchor.id);
      continue;
    }
    const matches: number[] = [];
    for (let i = 0; i < cityData.buildings.length; i++) {
      if (containsPoint(cityData.buildings[i]!.verts, anchor.x, anchor.z)) matches.push(i);
    }
    if (matches.length === 1) buildingIndexById.set(anchor.id, matches[0]!);
    else if (matches.length === 0) unmatchedIds.push(anchor.id);
    else ambiguousIds.push(anchor.id);
  }
  return { buildingIndexById, unmatchedIds, ambiguousIds };
}

/** Only attached, unambiguous replacements can remove an ordinary footprint. */
export function excludedBuildingIndices(
  activeIds: ReadonlySet<string>,
  mapping: FootprintMapping,
): ReadonlySet<number> {
  const excluded = new Set<number>();
  for (const id of activeIds) {
    const index = mapping.buildingIndexById.get(id);
    if (index != null) excluded.add(index);
  }
  return excluded;
}
