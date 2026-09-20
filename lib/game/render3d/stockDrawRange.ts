import type { BuildJob } from './buildScheduler';

export type IndexArray = Uint16Array | Uint32Array;
export type DrawRangeResult<T extends IndexArray> = { readonly index: T; readonly count: number };
export type StockDrawRangeJobArgs<T extends IndexArray> = {
  id: string;
  generation: number;
  essential: boolean;
  positions: Float32Array;
  index: T;
  direction: { x: number; y: number; z: number };
  now(): number;
  sliceMs?: number;
  epsilon?: number;
  maxIndexBytes?: number;
  onReady(result: DrawRangeResult<T> | null): void;
};

const DEFAULT_MAX_INDEX_BYTES = 64 * 1024;
const TRIPLES_PER_UNIT = 1024;
const MAX_UNITS_PER_STEP = 16;

function sameLength<T extends IndexArray>(source: T): T {
  return (source instanceof Uint16Array ? new Uint16Array(source.length) : new Uint32Array(source.length)) as T;
}

export function createStockDrawRangeJob<T extends IndexArray>(args: StockDrawRangeJobArgs<T>): BuildJob {
  const sliceMs = args.sliceMs ?? 4;
  if (!Number.isFinite(sliceMs) || sliceMs <= 0 || sliceMs > 4) throw new RangeError('sliceMs must be a finite positive number no greater than 4');
  const epsilon = args.epsilon ?? 0.02;
  if (!Number.isFinite(epsilon) || epsilon < 0 || epsilon >= 1) throw new RangeError('epsilon must be a finite number in [0, 1)');
  const maxIndexBytes = args.maxIndexBytes ?? DEFAULT_MAX_INDEX_BYTES;
  if (!Number.isInteger(maxIndexBytes) || maxIndexBytes <= 0) throw new RangeError('maxIndexBytes must be a positive integer');
  const positions = args.positions, source = args.index;
  if (positions.length % 3 !== 0) throw new RangeError('positions length must be divisible by three');
  if (source.length % 3 !== 0) throw new RangeError('index length must be divisible by three');
  const dirLength = Math.hypot(args.direction.x, args.direction.y, args.direction.z);
  if (!Number.isFinite(dirLength) || dirLength <= 0) throw new RangeError('direction must be a finite non-zero vector');
  const dirX = args.direction.x / dirLength, dirY = args.direction.y / dirLength, dirZ = args.direction.z / dirLength;
  const vertexCount = positions.length / 3, tripleCount = source.length / 3;
  let staging: T | null = null;
  let tripleAt = 0, kept = 0, backAt = tripleCount, swapAt = 0;
  let phase: 'reject' | 'classify' | 'reverse' | 'publish' = source.byteLength > maxIndexBytes ? 'reject' : 'classify';
  let terminal = false, stepping = false;
  const stop = (): void => { terminal = true; staging = null; };
  const fail = (error: unknown): never => { stop(); throw error; };
  const vertex = (i: number): number => {
    const v = source[i]!;
    if (v >= vertexCount) throw new RangeError(`index ${v} out of bounds for ${vertexCount} vertices`);
    return v * 3;
  };
  const classify = (): void => {
    const end = Math.min(tripleAt + TRIPLES_PER_UNIT, tripleCount);
    for (; tripleAt < end; tripleAt++) {
      const t = tripleAt * 3;
      const a = vertex(t), b = vertex(t + 1), c = vertex(t + 2);
      const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
      const vx = positions[c]! - positions[a]!, vy = positions[c + 1]! - positions[a + 1]!, vz = positions[c + 2]! - positions[a + 2]!;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const dot = nx * dirX + ny * dirY + nz * dirZ;
      const magnitude = Math.hypot(nx, ny, nz);
      const culled = Number.isFinite(dot) && Number.isFinite(magnitude) && dot > epsilon * magnitude;
      const target = culled ? (--backAt) * 3 : (kept++) * 3;
      staging![target] = source[t]!; staging![target + 1] = source[t + 1]!; staging![target + 2] = source[t + 2]!;
    }
    if (tripleAt === tripleCount) phase = 'reverse';
  };
  const reverse = (): void => {
    const rejected = tripleCount - kept, pairs = Math.floor(rejected / 2);
    const end = Math.min(swapAt + TRIPLES_PER_UNIT, pairs);
    for (; swapAt < end; swapAt++) {
      const left = (kept + swapAt) * 3, right = (tripleCount - 1 - swapAt) * 3;
      for (let k = 0; k < 3; k++) { const tmp = staging![left + k]!; staging![left + k] = staging![right + k]!; staging![right + k] = tmp; }
    }
    if (swapAt === pairs) phase = 'publish';
  };
  return {
    id: args.id,
    generation: args.generation,
    essential: args.essential,
    cancel() { stop(); },
    step() {
      if (terminal) return true;
      if (stepping) throw new Error('Reentrant stock draw range job step is unsupported');
      stepping = true;
      try {
        const deadline = args.now() + sliceMs;
        let units = 0;
        while (!terminal && units < MAX_UNITS_PER_STEP) {
          if (units > 0 && args.now() >= deadline) return false;
          if (phase === 'reject') {
            args.onReady(null);
            if (terminal) return true;
            terminal = true;
            return true;
          }
          if (phase === 'classify') {
            if (!staging) staging = sameLength(source);
            classify();
          } else if (phase === 'reverse') reverse();
          else {
            const result: DrawRangeResult<T> = { index: staging!, count: kept * 3 };
            args.onReady(result);
            if (terminal) return true;
            terminal = true;
            staging = null;
            return true;
          }
          units++;
        }
        return terminal;
      } catch (e) {
        return fail(e);
      } finally {
        stepping = false;
      }
    },
  };
}
