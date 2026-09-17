# Independent review — build scheduler drain contract, `e153df91bd2fa8b50d8b0e26c6baea2bcd8f1845`

Branch `devin/1789676440-camera-stream`, base `7a720815a1f63632e92fb7264778fc640f8362ad`. Scope: `lib/game/render3d/buildScheduler.ts`, `scripts/test-build-scheduler.ts`, `scripts/test-cover-index.ts` (status.md treated as evidence only). Read-only; probe scripts written to untracked paths and removed, `git status` clean, no worktrees left.

## Verdict: **ACCEPT** — `e153df91bd2fa8b50d8b0e26c6baea2bcd8f1845`

No required fixes. Browser/production runtime acceptance remains separate.

## Source change (exact)
```diff
+const MAX_STEPS_PER_DRAIN = 4096;
 ...
-        while (queue.length > 0) {
+        let steps = 0;
+        while (queue.length > 0 && steps < MAX_STEPS_PER_DRAIN) {
           const beforeStart = now();
           if (beforeStart - startedAt >= budgetMs) break;
+          steps++;
 ...
-          const afterStep = now();
-          if (!isComplete && pending.get(job.id) === job && afterStep <= beforeStart) break;
```
Matches the accepted contract: budget check before every step is unchanged; the equal-reading break (the starvation cause) is removed; an explicit step cap provides constant-clock termination. `budgetMs === 0` early return, FIFO `shift`/`unshift`, error cleanup and reentrancy guard are untouched.

## Behaviour verified (candidate)
| Property | Evidence |
| --- | --- |
| Coarse 100 µs / 1 ms clocks no longer starve | New check `rounded browser clocks do not starve short steps`: 2000 × 1 µs steps complete in one `drain(4)` for both resolutions. Same test copied onto base `7a72081` **fails** (`completed: []` vs `['short-steps']`) — confirms the regression is real and fixed. |
| Budget still enforced under rounded clock | New check: 0.25 ms steps with `Math.floor` clock stop after exactly 16 steps when floored elapsed reaches 4 ms. |
| Constant clock bounded | `stuck` job: exactly 4096 calls per drain, 8192 after a second drain, job remains pending. Replaces the old `calls === 1` assertion, which encoded the starvation itself; this is a replaced requirement, not a weakened one. |
| Backwards clock bounded | Probe with a decreasing clock: 4096 steps, job pending, drain returns. (Negative elapsed never meets the budget; the cap terminates.) |
| Continuation across drains | `keeps an incomplete head ahead of later jobs across drains` unchanged and passing; constant-clock probe shows progress resumes on each call. |
| FIFO under coarse clock | Probe: jobs a(3 steps), b(2 steps), 1 ms floor clock → step log `aaabb`, completed `['a','b']`. |
| Cancellation mid-drain, exact cleanup | Probe: `cancelGeneration` from inside step 5 → exactly 5 steps, exactly 1 `cancel()`, `pending 0`. Existing lifecycle checks (`test-cover-job-lifecycle`, 6 adversarial) pass. |
| Error path | Probe: throwing job under coarse clock → 1 failure, 1 cleanup, following job completes in the same drain. |
| Real clock sanity | 100,000 trivial steps finish in 25 drains of 4 ms (`performance.now()`). |

Focused suites on `e153df9`: `test-build-scheduler` (11 checks), `test-cover-index` (26), `test-cover-job-lifecycle` (6), `test-city-stream`, `test-cover-cell-job` — all pass. ESLint on the three files clean; project `tsc --noEmit` clean.

## Test-change assessment
- `test-build-scheduler.ts`: two new regressions (non-starvation; budget under rounding) plus the constant-clock assertion tightened to the exact cap across repeated drains. All are strictly stronger or equivalent requirements; nothing removed.
- `test-cover-index.ts`: the constant-clock scheduler check needed a job that cannot finish within 4096 steps, so the fixture grows from `longRoad(300)` to a 300,000-pair road (`new Uint16Array(600_000)`). `drains > 1`, `drains < 1000`, zero failures and the final `coverForBounds` selection `[0]` are preserved. Note (non-blocking): the fixture is an all-zero coordinate road (every point coincident at the origin), which exercises resumability and step counting but not spatially meaningful indexing; the remaining 25 index checks cover geometry, so this is acceptable for its purpose.

## Notes / non-blocking
1. `CityStream.drain` gives the context scheduler `remaining = 4 - (now() - started)`; under equal readings that is a full second 4 ms budget in the same frame (worst case ≈ 8 ms + one in-flight step). Pre-existing, not introduced here; acceptable for startup, worth a later look if frame-time budgets tighten.
2. The reported CPU reproduction (base 4458/4647 drains → candidate 6/7 drains) is consistent with the one-step-per-drain diagnosis and with the 60.4 s browser index at ~60 Hz; treated as supporting evidence, not browser acceptance.
