# R5a scheduler review — 0872cce

Spec: FAIL. Quality: FAIL.

- HIGH `buildScheduler.ts:83,105`: an incomplete job is `shift()`ed then `push()`ed, so it moves behind later queued jobs. This violates the required caller FIFO priority: an incomplete head must stay head between drains (and must not interleave with later jobs merely because a frame ended). Reinsert at the front or only remove from the queue on terminal completion/failure/cancellation.
- MEDIUM `buildScheduler.ts:107-108`: `afterStep <= beforeStart` stops a drain after *every* non-advancing step, including a completed job. The brief requires this guard only for an incomplete job, to prevent a constant-clock infinite loop; completed synchronous jobs should continue while budget permits. Gate the break on `!isComplete` and still honour cancellation during the step.
- MEDIUM `test-build-scheduler.ts:55-75,159-186`: tests cover a solitary multistep job and a solitary constant-clock incomplete job, so neither catches the two cases above. Add a multistep head plus queued follower across drains, and multiple completed constant-clock jobs within budget.
- PASS otherwise: duplicate pending IDs, obsolete/late cancellation, cancellation from `step`, cleanup aggregation, and reentrant-drain rejection follow the bounded helper contract.

## Correction review — 0872cce..3f1c966

Spec: PASS. Quality: PASS.

- `buildScheduler.ts:83,108` now reinserts an incomplete executed head with `unshift`, retaining caller FIFO priority across drains; `test-build-scheduler.ts:75-86` proves a follower cannot run before that head completes.
- `buildScheduler.ts:111` applies the non-advancing-clock guard only while the same job remains incomplete; `test-build-scheduler.ts:88-112` proves multiple completed jobs still drain under a constant clock.
- Submitted evidence records all nine focused checks plus `tsc`, ESLint, Prettier and `git diff --check` as passing. No broader gates were needed for this scoped correction.
