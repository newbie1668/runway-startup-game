/**
 * Playtime mesh budget. Wide cameras (view=mid, look=eye, look=lcy) used to
 * tessellate the whole city — water, parks, roads, chunks — then draw it at
 * once and Aw Snap. look=buckingham sits in Hyde / Green Park / St James's:
 * the unclipped lawn grid fills the frustum with green, then Chrome error 9
 * before the palace job paints. Clip that look the same way as view=mid.
 * look=citystreet is a street-scale camera on Cheapside. FULL budget still
 * queued every London chunk behind the roads, so the frame was pavement
 * pancakes until Chrome error 9. Clip to a 1600 m disk like view=mid.
 * Buildings inside that disk stay; dropping them to save memory empties
 * the street. Minor chunks stay on.
 * Other close looks still get the neighbourhood around the camera.
 * Minor chunks stay on: they are the terraces / houses. Skipping them made
 * view=mid a field of typed office boxes.
 */

/** Cheapside carriageway — not a courtyard, not a skyline punch-hole. */
export const CITYSTREET_AT = [-0.09052, 51.51354] as const;

export type KeepDisk = { x: number; z: number; r: number };

export type MeshBudget = {
  skipGlb: boolean;
  skipTrees: boolean;
  skipWindows: boolean;
  skipLamps: boolean;
  skipNoticedStock: boolean;
  skipMinorChunks: boolean;
  skipAntialias: boolean;
  skipRoadMarks: boolean;
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
  skipRoadMarks: false,
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
  skipRoadMarks: true,
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
  if (look === 'buckingham') {
    return { ...WIDE_BASE, skipMinorChunks: false, chunkKeepM: 1600 };
  }
  if (look === 'citystreet') {
    return {
      ...WIDE_BASE,
      skipMinorChunks: false,
      skipRoadMarks: false,
      chunkKeepM: 1600,
    };
  }
  if (wide) {
    return { ...WIDE_BASE, skipMinorChunks: false, chunkKeepM: 1600 };
  }
  return FULL;
}

export function meshBudget(): MeshBudget {
  return meshBudgetFromSearch(query());
}

/**
 * Keep-disk cameras still extrude every stock plate inside the disk.
 * 7583632 drained one job per frame: overlay sat on "Laying out London"
 * because each job also paid a full scene render. bea5d21 used six and
 * citystreet painted. Cover (water / parks / roads) still uploads one
 * mesh per frame so leftover chunk slots cannot pack those with chunks
 * and Aw Snap the first view=mid. Do not skip keep-disk stock. Do not
 * park-carpet.
 *
 * view=mid uses an 8.5 wu frustum on the same 1600 m disk. Job count
 * only delays when that disk fills: 6→3 still Aw Snapped once chunks
 * were in (sky, then error 9). Each (chunk, major) mesh spanned
 * kilometres, so frustumCulled could not skip the ~3/4 of verts that
 * sit off the mid frame. Split keep-disk stock into DRAW_CELL_M cells
 * and cull those at render(). Do not shrink the keep-disk. Citystreet
 * stays at six jobs — it is street-scale and HOLD. No 1 Poultry is
 * outside this disk; do not paint it while freeze is broken.
 */
export type BuildJobKind = 'hero' | 'chunk' | 'cover' | 'rest';

export const BUILD_JOBS_PER_FRAME = 2;
export const BUILD_JOBS_WHILE_LOADING = 16;
export const BUILD_JOBS_WHILE_LOADING_KEEP = 6;
/** view=mid / view=default while the keep-disk is still streaming. */
export const BUILD_JOBS_WHILE_LOADING_WIDE = 3;
/**
 * Ground-plane cell for keep-disk building meshes. 8×6 city chunks are
 * ~2.8 km × 1.4 km; their bounding spheres all hit the 8.5 wu mid
 * frustum. 400 m cells can miss it. Visible streets stay extruded.
 */
export const DRAW_CELL_M = 400;

export function buildJobsThisFrame(args: {
  ready: boolean;
  keepDisk: boolean;
  kind: BuildJobKind;
  wideFrust?: boolean;
}): number {
  if (args.kind === 'cover') return 1;
  if (args.ready) return BUILD_JOBS_PER_FRAME;
  if (args.keepDisk) {
    return args.wideFrust ? BUILD_JOBS_WHILE_LOADING_WIDE : BUILD_JOBS_WHILE_LOADING_KEEP;
  }
  return BUILD_JOBS_WHILE_LOADING;
}

/** Group a queued kind list into per-frame drains. Same kind only. */
export function drainBuildJobKinds(
  kinds: readonly BuildJobKind[],
  opts: { keepDisk: boolean; wideFrust?: boolean },
): BuildJobKind[][] {
  const q = kinds.slice();
  const frames: BuildJobKind[][] = [];
  while (q.length > 0) {
    const kind = q[0]!;
    const n = buildJobsThisFrame({
      ready: false,
      keepDisk: opts.keepDisk,
      kind,
      wideFrust: opts.wideFrust,
    });
    const frame: BuildJobKind[] = [];
    while (frame.length < n && q.length > 0 && q[0] === kind) {
      frame.push(q.shift()!);
    }
    frames.push(frame);
  }
  return frames;
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
