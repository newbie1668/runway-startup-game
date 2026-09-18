# Review: idle-time city generation candidate

- Repo: newbie1668/runway-startup-game
- Candidate: `6309990e363733a3c2d64bd08bcc83d826e36c08` (origin/devin/1789689422-idle-generation)
- Base: `56bde734390e0980801cdbd7501220a079560422` (merge-base confirmed; one commit ahead)
- Diff: 4 files, +149/−0: `idleGeneration.ts` (new), `CityRenderer3D.ts`, `scripts/test-idle-generation.ts` (new), `scripts/test-renderer-disposal.ts`
- Mode: read-only, no implementation

## Verdict: ACCEPT (code scope)

No blocking findings. Two low-severity notes below for the integrator.

## Scope confirmation

- No geometry, footprint, detail-policy, cover/stream request ordering or budget constants changed. `CityStream.drain()` remains the existing 4 ms / `MAX_REQUESTS_PER_DRAIN` bounded unit; `coverIndexScheduler.drain(4, …)` unchanged.
- No scheduler clock change: both drains keep `() => performance.now()`; `idleGeneration.ts` uses only the `IdleDeadline.timeRemaining()` supplied by the browser.
- No app rules touched: three.js still reached only via `render3d/`; `idleGeneration.ts` is browser-free and imports nothing (SSR-safe, matches architecture C-table guidance for pure helpers).
- No data/assets, manifests or lockfile changes.
- rAF path in `frame()` is unchanged apart from a trailing `this.idleGeneration?.wake()`; every browser keeps the per-frame drain. No `requestIdleCallback` `timeout` option, so no forced callbacks.

## Behaviour checks (idleGeneration.ts + wiring)

| Concern | Result |
|---|---|
| Request dedup | `pending !== null` guard; `wake()` from every frame is a no-op while a callback is outstanding (tested). |
| Handle zero | Null sentinel, not falsy check; test forces handle 0. |
| Insufficient deadline | `< 5 ms` → no drain, re-request; no busy loop because rIC only fires in idle periods (tested). |
| Long deadline | Exactly one existing bounded drain per callback regardless of remaining time (tested at 100 ms). |
| Settled stream | `hasWork` = `!disposed && cssW>0 && cssH>0 && !coverIndexBuild && cityStream.idle === false`; settled stream stops rescheduling; `update()` on camera change makes `idle` false and the next frame's `wake()` restarts it (tested). |
| Work finished by rAF between request and callback | `hasWork` re-checked inside callback (tested). |
| Cancellation / late callbacks | `dispose()` cancels pending, sets `disposed`; a callback already dequeued by the browser returns early (tested). Second `dispose()` idempotent. |
| Fatal teardown mid-drain | `drainStreaming` → `onFatal` → MapCanvas `old.dispose()` → `idleGeneration.dispose()`; the trailing `wake()` in the callback then sees `disposed` (tested; also cover-index catch path sets `coverIndexBuild=null` before `onFatal`). |
| Constructor rollback | `idleGeneration` created inside the try block; `rollbackConstruction` cleanup list disposes it first; `?.` handles pre-creation failure. |
| Dynamic import / Canvas fallback | `IdleGeneration` created only when `requestIdleCallback` and `cancelIdleCallback` are both functions (Safari → null, rAF only). Fallback to `MapRenderer` 2D goes through `dispose()`, which now stops idle callbacks first. |
| Cover-index + stream in idle | Impossible: `hasWork` requires `coverIndexBuild === null`, and `cityStream` is only constructed by the cover-index `onReady`, so idle drains are stream-only. |
| Camera sync | Idle path calls `syncRig()` before `drainStreaming()`; stream bounds key includes cam/zoom/css/azimuth, so an idle drain after a pointer move uses the same bounds the next frame will. Rendering happens only in `frame()`. |
| Resize / zero-size / hidden | `resize()` sets `cssW/cssH` before returning early; `hasWork` gates on both > 0, and `drainStreaming` repeats the guard. |
| Rendered readiness | `markReady()` still driven solely by `frame()` via `diagnostics.getState()`; idle drains only register/complete stream jobs, which the same state machine already accounts for. No readiness is claimed without a frame. |

## Budget analysis

Per animation frame the existing work is unchanged. The idle path adds at most one extra `CityStream.drain()` (≤4 ms nominal, existing single-step overrun risk unchanged) per idle callback, and only when the browser reports ≥5 ms remaining before its next frame deadline. Net effect: up to 2 stream drains per 16.7 ms frame when idle time exists, never a stream drain plus a cover-index drain in idle, and no drain when the frame is already busy. No other task is added; `drainBuildQueue` (hero/replacement/rest jobs) is not touched by the idle path.

## Low-severity notes (non-blocking)

1. **No frame-level safety net in the idle callback.** MapCanvas wraps `r.frame()` in try/catch → `onFatal('3D frame failed')`. The idle callback runs `syncRig()` + `drainStreaming()` unwrapped. `drainStreaming` catches stream/cover errors internally, so the exposure is limited to `rig.update()` throwing, which would surface as an uncaught rIC error rather than a 2D fallback. Acceptable for a candidate; consider a try/catch → `onFatal` in the idle lambda at integration if parity is wanted.
2. **New test not wired into `pnpm test:game`.** `scripts/test-idle-generation.ts` (like the pre-existing `test-renderer-disposal.ts`) is run manually only. Consistent with current repo practice, but the integrator may wish to add it to a script so the guarantees above are gated.
3. Behavioural observation (not a defect): Chrome throttles but does not stop `requestIdleCallback` in background tabs, so a hidden tab with a non-zero canvas may keep streaming slowly while rAF is paused. Uploads still happen only at render.

## Checks run (scoped, against candidate worktree)

- `tsx scripts/test-idle-generation.ts` — pass
- `tsx scripts/test-renderer-disposal.ts` — pass
- `tsc --noEmit -p tsconfig.json` — pass
- `eslint` on the four changed files — pass

Not run (per instruction): `pnpm build`, `pnpm test:game`, `pnpm test:ui`, browser harness, performance measurement. A `pnpm tsx` invocation triggered a dependency reinstall against the candidate lockfile in the shared node_modules; it was killed and the checks re-run with the existing `node_modules/.bin` binaries. No manifests or lockfiles were modified.
