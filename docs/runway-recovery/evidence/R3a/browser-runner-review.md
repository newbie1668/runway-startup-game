# R3a browser-runner review — 49d3979

Spec: FAIL. Quality: FAIL.

- HIGH `test-map-lifecycle-browser.mjs:141-147`: L1 accepts `ready` as well as `degraded`, and its optional-error assertion uses `every`, so an empty error list passes. The brief requires degraded state and a recorded optional `asset:noticed:manifest` error containing 503. Require that exact error and state before accepting useful stock output.
- HIGH `:67-76`: L2 treats only the held city request failure as expected. The required context-loss log is classified as an unexpected console error, which can make the intended fallback fail the runner. Whitelist only the identifiable context-loss console/page error alongside the exact city abort; keep other events red.
- HIGH `:101-110,175-182`: L3 records listener add/remove events but never wraps or records actual `HTMLCanvasElement.getContext` WebGL2 calls, despite the explicit fixture requirement. Add a pass-through getContext record and assert the failed renderer's canvas made the expected WebGL2 attempt; retain the listener pairing assertion.
- PASS: per-case isolation, bounded deadlines/cleanup, held-route release, QA snapshots, screenshots, provenance and deferred runtime capture are appropriately scoped.

## Correction review — 49d3979..005e9c5

Spec: FAIL. Quality: FAIL.

- PASS `test-map-lifecycle-browser.mjs:157-161`: L1 now requires a degraded QA/shell state and the exact non-essential `asset:noticed:manifest` 503 error. `:85-89` narrowly permits only context-loss events for L2, and `:125-131,190-194` records pass-through WebGL2 calls and ties the assertion to the listener-bearing renderer canvas.
- MEDIUM `test-map-lifecycle-browser.mjs:154`: L1's wait predicate still returns at either `ready` or `degraded`, then immediately asserts degraded. If stock becomes ready before the asynchronous 503 transition, the runner fails on an early valid snapshot instead of waiting for the required state. Wait specifically for `snapshot.state === 'degraded'` (and corresponding shell state) within the existing deadline.

## Correction review — 005e9c5..d5cf209

Spec: PASS. Quality: PASS.

- `test-map-lifecycle-browser.mjs:154` now waits within the existing 30-second deadline for 3D degraded shell and QA state, ready marker, and useful stock before it evaluates the strict L1 assertions. This removes the premature-ready capture without widening the fixture or event allowances.
