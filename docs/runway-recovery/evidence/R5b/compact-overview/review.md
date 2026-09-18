# R5b-3a review — 851c147..01609d9

## Verdict: FAIL

The core overview packing is correctly isolated: overview allocates normalized
`Int8Array` normals and `Uint8Array` colours, retains exact Float32 positions,
and chooses Uint16 only at or below 65,535 vertices. Neighbourhood/street stay
on the existing Float32/Uint32 path. The focused job and cell-builder tests
pass, including the saved street oracle.

1. The new preview cell-job failure cleanup is ineffective. In
`scripts/render-stock-tiers.ts`, `drain` and `assert.ok(ready)` run before the
`try/finally`; if either fails, the job is not cancelled. Inside the later
`finally`, `if (previewJob && !group)` is unreachable after `assert.ok(group)`
has passed. An incomplete or failed preview job can therefore retain fragments
and target geometry. The required runner cleanup must cover its entire job
lifetime, including guard/exception paths.

2. Saved preview metadata drops storage needed to audit compact output. The
fixture records `indexStorage`, but `tierSummaries` and the final
`stock-tier-comparison.json` omit it. They also omit the position storage
type. This prevents the resulting evidence from establishing Uint16 versus
Uint32 fallback or documenting the retained Float32 position format, despite
the HTML reconstruction consuming `indexStorage`.

3. The overview overflow assertion proves the backing type and a maximum index
above 65,535, but it only range-checks the first decoded normal/colour
component (`scripts/test-cell-stock-job.ts` overflow block). It does not prove
a high-offset indexed triangle's winding and decoded normal/colour values as
the brief requires. Existing street high-offset coverage does not exercise the
new overview quantized attributes.

Focused evidence: `pnpm tsx scripts/test-cell-stock-job.ts` and
`pnpm tsx scripts/test-cell-build.ts` passed in the submission worktree; `git
diff --check 851c147..01609d9` passed. No browser, full gate, profiling, or
runtime integration was run.

## Scoped correction review — 01609d9..d778fc3

## Verdict: FAIL

The correction fixes the three reviewed items: preview extraction now has one
full-lifetime `try/finally` that cancels the job and disposes geometry on guard
and extraction failures; position/index storage are persisted in fixture and
saved summaries; and the overview overflow test compares high-offset position,
decoded normal/colour precision, and winding with its source batch.

It introduces a default-preview regression. The new HTML guard rejects every
batch tier unless `indexStorage === "Uint32Array"`
(`scripts/stock-tier-preview.html:20-22`). The existing batch API uses
`geometry.setIndex(number[])`, which legitimately produces `Uint16Array` for
the first-16-source preview when its index maximum fits. The default batch
mode must accept either Uint16 or Uint32 indices while retaining Float32
position/normal/colour checks; otherwise the unchanged default preview now
fails before rendering.

`pnpm tsx scripts/test-cell-stock-job.ts` and `git diff --check
01609d9..d778fc3` passed. Neither check executes the standalone HTML batch
guard, so it does not expose this regression. No browser/capture, full gate,
or profiling run was performed.

## Final batch-guard correction review — d778fc3..5ea21ac

## Verdict: PASS

The only changed condition now accepts both `Uint16Array` and `Uint32Array`
for Float32 batch geometry (`scripts/stock-tier-preview.html:20-26`), while
retaining the normal/colour and known-storage guards. This restores valid
first-16 batch previews without weakening storage validation for other types.
`git diff --check d778fc3..5ea21ac` passed. No additional tests were needed
for this one-condition correction.

## Browser-discovered preview correction review — 5ea21ac..a23b33e

## Verdict: PASS

The preview now passes each reconstructed Uint16/Uint32 index array to
`BufferGeometry.setIndex` as a `THREE.BufferAttribute`, which is the required
Three.js API shape (`scripts/stock-tier-preview.html:23-26`). This preserves
the recorded index storage type and fixes the observed raw-typed-array error.
The runner also includes captured page errors when its render-complete wait
times out (`scripts/render-stock-tiers.ts:64-68`), making a future browser
failure actionable without loosening any assertion.

The two-file diff is scoped to that correction and `git diff --check
5ea21ac..a23b33e` passed. No tests or broader checks were repeated.
