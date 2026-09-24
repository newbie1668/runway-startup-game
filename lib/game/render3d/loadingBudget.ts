/**
 * Generation time per animation frame while the map is still loading. Before the first ready
 * frame nothing on the map is interactive, so generation may take half the measured frame
 * interval instead of a fixed 4 ms. Loading then keeps pace on slow GPUs, where each frame waits
 * much longer for the GPU. Two bounds keep this compatible with the generation gates:
 * - work still runs as separate drains of at most one 4 ms slice each;
 * - generation plus the rest of the frame's measured main-thread work (render submission,
 *   overlay, build queue) stays within 32 ms. That leaves room below the 50 ms long-task limit
 *   for a single step that overruns its slice.
 * The budget can therefore not feed on itself through the frame interval. Once the map is ready,
 * the renderer returns to one 4 ms drain per frame.
 */
export const SLICE_MS = 4;
export const LOADING_FRAME_TASK_MS = 32;
const MAX_DRAINS = 16;

export function loadingBudgetMs(frameIntervalMs: number, otherFrameMs: number): number {
  if (!Number.isFinite(frameIntervalMs) || frameIntervalMs <= 0) return SLICE_MS;
  const other = Number.isFinite(otherFrameMs) && otherFrameMs > 0 ? otherFrameMs : 0;
  return Math.max(SLICE_MS, Math.min(frameIntervalMs / 2, LOADING_FRAME_TASK_MS - other));
}

/**
 * Runs `drain` (one bounded slice) until `budgetMs` would be exceeded by another slice, work runs
 * out, or `MAX_DRAINS` is reached (a clock that stops advancing cannot spin). Returns the drain count.
 */
export function drainWithin(
  budgetMs: number,
  now: () => number,
  hasWork: () => boolean,
  drain: () => void,
): number {
  const started = now();
  let drains = 0;
  do {
    drain();
    drains++;
  } while (drains < MAX_DRAINS && hasWork() && now() - started + SLICE_MS <= budgetMs);
  return drains;
}
