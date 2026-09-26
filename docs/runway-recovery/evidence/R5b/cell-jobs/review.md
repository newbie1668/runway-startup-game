# R5b-3 review — 11a5803..532961a

## Verdict: FAIL

1. The allocation phase is not time-sliced. `allocate` loops over every
   emitted fragment to total the cell and allocates all four target arrays in
   one call (`lib/game/render3d/cellStockJob.ts:172-186`). A dense owner cell
   can have many more than 16 fragments, yet this work has neither a deadline
   check nor a bounded unit. The later copy chunks are capped, but that does
   not make the packing/allocation phase meet the packet's one-step time bound.

2. The focused test omits the expressly required exceptional lifetime and
   Uint32-offset scenarios. It only covers cancellation before emission and
   normal completion transfer (`scripts/test-cell-stock-job.ts:41-51`). There
   is no test for cancellation during emission, copy, or publication; a
   throwing/reentrant `onReady`; build/copy/cleanup failures; cleanup that
   throws; caller-material non-disposal on those paths; a constant-clock
   16-unit cap; or an index offset beyond 65,535. Therefore neither the
   claimed `Uint32` packing at `cellStockJob.ts:215-221` nor the publication
   ownership/throw cleanup at `:232-253` is proved against the required cases.

The basic implementation is appropriately API-scoped, snapshots only the
cell/exclusion selections, uses indexed output and a caller-supplied material,
and copies vertices/indices in the stated per-copy limits. `git diff --check
11a5803..532961a` passed. The worker's focused command could not be rerun in
its checkout after reset because `pnpm exec tsx` reported `Command "tsx" not
found`; no broader suite was substituted.

## Scoped correction review — 532961a..44e6d0a

## Verdict: FAIL

The source now accumulates totals at emission and allocates each target
attribute/index buffer in a separate unit (`cellStockJob.ts:45,49-55`). A
normal `onReady` return now makes the job terminal, preserving transferred
root/scratch/source ownership on later cancel or step (`:62-67`).

But required lifecycle evidence remains absent. The correction modifies only
the normal-success ownership case in the 53-line test
(`scripts/test-cell-stock-job.ts:48-50`). It does not test cancellation during
emission/copy/publication, throwing or reentrant callbacks, build/copy/publish
failures, throwing detach/dispose aggregation, caller-material safety on those
paths, constant-clock 16-unit behavior, unselected-city access, or Uint32
offsets over 65,535. This is a direct gap against the fix brief rather than a
reason to infer correctness from the happy path.

There are also unproved and unsafe error paths in the correction itself. If
fragment validation throws before a mesh has been added to `staged`, `emit`'s
catch disposes only `staged` and loses the invalid mesh geometry
(`cellStockJob.ts:39-47`); a second invalid mesh can likewise leak after an
earlier staged entry. The terminal branch after a synchronous emission return
calls `dispose` but drops any resulting cleanup error (`:41-42`), contrary to
the required retained/aggregated cleanup failures. These are the exact
exceptional paths the omitted tests should exercise.

`git diff --check 532961a..44e6d0a` passed. No full suite, browser, or timing
run was substituted for the missing focused cases.

## Scoped correction review — 44e6d0a..bd68430

## Verdict: FAIL

The final focused test now materially covers the prior gaps: mid-emission and
mid-copy cancellation, publication cancel/throw, unselected source access,
constant-clock cap, caller-material safety, reentrant falsy disposal, and a
real packed `Uint32` index over 65,535 with a high-offset winding tuple
(`scripts/test-cell-stock-job.ts:55-76`). I ran it once successfully; `git
diff --check 44e6d0a..bd68430` also passed.

One exact cleanup contract breach remains. If staged geometry validation fails,
`emit` disposes each staged geometry but discards every disposal result
(`lib/game/render3d/cellStockJob.ts:50-54`). The outer `fail` then has only
the validation error because those geometries were never added to `fragments`,
so a throwing disposer is neither retained nor aggregated with the original
error. This violates the required original-error-plus-cleanup-error behavior.
The validation test at `scripts/test-cell-stock-job.ts:71` checks disposal
once, but not a throwing staged disposer plus the original validation error.

This is confined to the unresolved exceptional cleanup path. The reviewed
bounded-allocation, publication-transfer, high-index, and normal cancellation
corrections otherwise meet the scoped requirements.

## Scoped final cleanup review — bd68430..423ed1b

## Verdict: PASS

The staged-validation catch now removes every staged fragment before disposal,
records `didThrow` independently of the thrown value, and throws an
`AggregateError` containing the original validation error followed by every
cleanup error (`lib/game/render3d/cellStockJob.ts:50-54`). Earlier owned
fragments remain in the job list for the outer failure cleanup, so they are
drained exactly once by the existing cleanup path.

The focused regression uses real Three constructors, forces the second
returned fragment to fail validation, and runs both `false` and `undefined`
disposal failures. It verifies original-plus-cleanup aggregation, staged and
previously owned geometry drain order, no repeat disposal after terminal calls,
caller-material safety, and `finally` restoration of every spy
(`scripts/test-cell-stock-job.ts:75-103`).

I ran `pnpm tsx scripts/test-cell-stock-job.ts` successfully and confirmed
`git diff --check bd68430..423ed1b` passes. No broader gate, runtime, timing,
or browser work was run.
