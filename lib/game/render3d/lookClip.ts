/**
 * Playtime mesh budget. Wide cameras (view=mid, look=eye, look=lcy) used to
 * tessellate the whole city — water, parks, roads, chunks — then draw it at
 * once and Aw Snap. Close looks still get the full neighbourhood around the
 * camera. Wide looks clip cover meshes to a keep-disk and skip garnish.
 * Minor chunks stay on: they are the terraces / houses. Skipping them made
 * view=mid a field of typed office boxes.
 */

export type KeepDisk = { x: number; z: number; r: number };

export type MeshBudget = {
  skipGlb: boolean;
  skipTrees: boolean;
  skipWindows: boolean;
  skipLamps: boolean;
  skipNoticedStock: boolean;
  skipMinorChunks: boolean;
  skipAntialias: boolean;
  chunkKeepM: number | null;
  pixelRatioCap: number;
};

const FULL: MeshBudget = {
  skipGlb: false,
  skipTrees: false,
  skipWindows: false,
  skipLamps: false,
  skipNoticedStock: false,
  skipMinorChunks: false,
  skipAntialias: false,
  chunkKeepM: null,
  pixelRatioCap: 2,
};

const WIDE_BASE: Omit<MeshBudget, 'chunkKeepM'> = {
  skipGlb: true,
  skipTrees: true,
  skipWindows: true,
  skipLamps: true,
  skipNoticedStock: true,
  skipMinorChunks: false,
  skipAntialias: true,
  pixelRatioCap: 1,
};

function query(): URLSearchParams | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search);
}

export function meshBudgetFromSearch(q: URLSearchParams | null): MeshBudget {
  if (!q) return FULL;
  const look = q.get('look');
  const view = q.get('view');
  const wide = view === 'mid' || view === 'default' || view === 'wide';
  if (look === 'eye') {
    return { ...WIDE_BASE, skipMinorChunks: false, chunkKeepM: 1800 };
  }
  if (look === 'lcy') {
    return { ...WIDE_BASE, skipMinorChunks: false, chunkKeepM: 2200 };
  }
  if (wide) {
    return { ...WIDE_BASE, skipMinorChunks: false, chunkKeepM: 1600 };
  }
  return FULL;
}

export function meshBudget(): MeshBudget {
  return meshBudgetFromSearch(query());
}

export function inKeepDisk(x: number, z: number, keep: KeepDisk | null, pad = 0): boolean {
  if (!keep) return true;
  const dx = x - keep.x;
  const dz = z - keep.z;
  const r = keep.r + pad;
  return dx * dx + dz * dz <= r * r;
}

export function ptsHitKeep(
  pts: readonly { x: number; z: number }[],
  keep: KeepDisk | null,
  pad = 0,
): boolean {
  if (!keep) return true;
  for (const p of pts) {
    if (inKeepDisk(p.x, p.z, keep, pad)) return true;
  }
  return false;
}

/** True when the axis-aligned box overlaps the keep-disk (or keep is off). */
export function aabbHitsKeep(
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
  keep: KeepDisk | null,
): boolean {
  if (!keep) return true;
  const cx = Math.min(maxX, Math.max(minX, keep.x));
  const cz = Math.min(maxZ, Math.max(minZ, keep.z));
  return inKeepDisk(cx, cz, keep);
}

/** Split a polyline into runs that stay inside the keep-disk. */
export function clipPolylineToKeep(
  pts: readonly { x: number; z: number }[],
  keep: KeepDisk | null,
  pad = 0,
): { x: number; z: number }[][] {
  if (!keep) return pts.length >= 2 ? [[...pts]] : [];
  const runs: { x: number; z: number }[][] = [];
  let cur: { x: number; z: number }[] = [];
  for (const p of pts) {
    if (inKeepDisk(p.x, p.z, keep, pad)) {
      cur.push(p);
    } else if (cur.length > 0) {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 2) runs.push(cur);
  return runs;
}
