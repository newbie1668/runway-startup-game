# Independent review — CityStream same-drain refill / capped admission

- Candidate: `9573562799bf245df4a1aee18ab3c65cf1ae2d51` (origin/devin/1789676440-camera-stream)
- Base: `ed2203f7c762c6885d2d19f125ef3cee3352eeb1`
- Scope: `lib/game/render3d/cityStream.ts`, `scripts/test-city-stream.ts` (diff stat confirms only these two files: +150/-47)
- Mode: read-only; no edits, PR, merge, deploy, assets, subagents, browser runs or full gates.

## Verdict: ACCEPT — no material defects, no required fixes.

CPU-only evidence; this does not constitute browser acceptance (runtime remains NOT accepted: 13.3 s cold / 12.6 s reload, wide view >30 s, 566 hub calls).

## Findings by requested area

1. **Deadline enforcement.** Admission (`now()-started < 4`), normal scheduler (`remaining = 4 - elapsed`, break if `<= 0`), and road-context scheduler (only if `remaining > 0`) all consume the same `started` reference. Probe with a 0.01 ms/read advancing clock: max single `drain()` = 4.19 ms of clock (budget 4 ms plus one step overshoot inherent to check-before-step). Bounded.
2. **Coarse / constant clocks, boundedness.** Constant clock: outer loop terminates via `requests >= 64`, `cursor >= requests.length`, or `pending.size > 0` after a scheduler drain (scheduler itself is capped at 4096 steps per accepted `e153df9`). Every outer iteration either admits ≥1 request (cursor strictly advances) or breaks, so the loop is finite. Test asserts `stockBuildings <= 64` under constant clock — passes.
3. **Essential/optional order.** Request list order unchanged (visible stock → visible cover → `essentialEnd` → prefetch stock/cover → trees → decor). Cursor is monotonic; optional work cannot be reached before essential work is considered. The 96 MiB background skip still applies only to `!essential`.
4. **Decor dependencies.** Decor gate (`stock.detail !== request.detail → break`) retained in the inner admission loop and duplicated in the post-drain re-check before another admission pass, so a refill iteration cannot bypass it. `resident()` and `build()` mismatch assertion unchanged.
5. **Readiness during replacement.** `settleCoverage()` adds two stricter guards (`cursor < essentialEnd` and any pending essential → return) *before* the unchanged exact stock/cover tier checks. Coverage can only settle later, never earlier, than base. The removed drain-start `settleCoverage()` call is covered by the end-of-drain call and by `update()` (probe: fully-resident re-plan latches with 0 drains on both base and candidate).
6. **Cancellation / failure / ownership.** `cancelPending()` additionally resets `essentialEnd = 0`; failure and completion handlers are the same code moved inside the loop; `pending.delete`, `diagnostics.completeJob/failJob`, `fatal('stream:drain')` paths unchanged. Test asserts root children 0, tracker bytes 0, queuedJobs 0 after dispose in both clock modes — passes.
7. **Retained residents / budget.** `trimResidents()`, retention rings, `MAX_RESIDENT_BYTES = 128 MiB`, `BACKGROUND_RESIDENT_BYTES = 96 MiB` unchanged. Trim trigger now uses accumulated `completed` across the loop (superset of base behaviour). Probe: 380 residents retained through a one-column eviction re-plan on both base and candidate.

## Commands and results

```
cd ~/repos/runway-startup-game && git checkout 9573562
pnpm tsx scripts/test-city-stream.ts
→ Camera streaming, replacement, queue bounds, overview and eviction passed  (exit 0)
```

Temporary probe `scripts/.probe-latch.ts` (400 buildings, 20×20 grid, wide bounds; removed afterwards, `git status` clean):

| clock | metric | base ed2203f | candidate 9573562 |
|---|---|---|---|
| constant (0) | drains until coverage latched | 95 | **6** |
| +0.01 ms/read | drains until coverage latched | 95 | 15 |
| +0.01 ms/read | max clock consumed by one drain | 0.64 ms (under-utilised) | 4.19 ms (budget-bound) |
| both | residents after cold coverage | 380 | 380 |
| both | warm re-plan (one column evicted): drains to latch / to idle | 0 / 0 | 0 / 0 |
| both | tracker bytes after dispose | 0 | 0 |

Interpretation: base performs ~4 admissions per frame regardless of remaining budget (idle gap); candidate refills within the same drain and uses the budget, while the constant-clock case is still capped by the 64-request limit. Parent's report that the new regression fails on base at "completed batches refill within the same drain" is consistent with the base 95-drain figure (4 buildings per drain).

## Non-blocking notes

- One-step overshoot (~0.19 ms at the probe's step size) is inherent to check-before-step budgeting and matches scheduler semantics accepted in `e153df9`.
- With `MAX_REQUESTS_PER_DRAIN` counting already-resident requests, a very large mostly-resident essential span still needs `ceil(n/64)` drains before `settleCoverage` can pass the `cursor < essentialEnd` guard; this is the intended trade against per-frame rescans and is bounded.
- The CPU profile improvement (15,559 → 14,369 ms, 9.30 → 5.41 ms max slice) is modest and excludes browser/GPU/frame waits and landmarks; park containment and road-context work remain outstanding for the browser target.
