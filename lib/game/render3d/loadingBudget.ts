/**
 * Generation time per animation frame while the map is still loading. Before the first ready
 * frame nothing on the map is interactive, so generation takes half the measured frame interval
 * instead of a fixed 4 ms. Loading then keeps pace on slow GPUs, where each frame takes much
 * longer to render. Work still runs as separate drains of at most one 4 ms slice each, and the
 * 40 ms cap keeps every frame's task below the 50 ms long-task limit. Once the map is ready, the
 * renderer returns to one 4 ms drain per frame.
 */
export const SLICE_MS = 4;
export const MAX_LOADING_BUDGET_MS = 40;
const MAX_DRAINS = 16;

export function loadingBudgetMs(frameIntervalMs: number): number {
  if (!Number.isFinite(frameIntervalMs) || frameIntervalMs <= 0) return SLICE_MS;
  return Math.min(MAX_LOADING_BUDGET_MS, Math.max(SLICE_MS, frameIntervalMs / 2));
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
