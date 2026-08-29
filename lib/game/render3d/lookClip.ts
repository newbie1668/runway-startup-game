/**
 * Playtime mesh budget. Wide cameras (view=mid, look=eye, look=lcy) used to
 * enqueue the whole city — windows, trees, GLBs — and Aw Snap. Close looks
 * still get the full neighbourhood around the camera.
 */

export type MeshBudget = {
  skipGlb: boolean;
  skipTrees: boolean;
  skipWindows: boolean;
  skipLamps: boolean;
  skipNoticedStock: boolean;
  skipMinorChunks: boolean;
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
  chunkKeepM: null,
  pixelRatioCap: 2,
};

function query(): URLSearchParams | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search);
}

export function meshBudget(): MeshBudget {
  const q = query();
  if (!q) return FULL;
  const look = q.get('look');
  const view = q.get('view');
  const wide = view === 'mid' || view === 'default' || view === 'wide';
  if (look === 'eye') {
    return {
      skipGlb: true,
      skipTrees: true,
      skipWindows: true,
      skipLamps: true,
      skipNoticedStock: true,
      skipMinorChunks: true,
      chunkKeepM: 2400,
      pixelRatioCap: 1.25,
    };
  }
  if (look === 'lcy') {
    return {
      skipGlb: true,
      skipTrees: true,
      skipWindows: true,
      skipLamps: true,
      skipNoticedStock: true,
      skipMinorChunks: false,
      chunkKeepM: 2800,
      pixelRatioCap: 1.25,
    };
  }
  if (wide) {
    return {
      skipGlb: true,
      skipTrees: true,
      skipWindows: true,
      skipLamps: true,
      skipNoticedStock: true,
      skipMinorChunks: true,
      chunkKeepM: 3400,
      pixelRatioCap: 1.25,
    };
  }
  return FULL;
}
