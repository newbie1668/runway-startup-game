# R5b-1 review — d51a42b..920a374

## Verdict: FAIL

The submission stays within its two permitted files and retains the selected
original source indices. Its focused checks pass, but it does not yet preserve
the complete detailed recipe or prove the required geometry parity.

1. `buildCellStockBatch` calls `emitDetailedBuildings` with `major` set to
   `null` (`lib/game/render3d/cityBuilder.ts:1527-1534`). The shared recipe
   still uses that parameter for the parapet decision (`:1389-1396`), where a
   legacy major building receives a parapet even when `areaM2 <= 140`. A
   selected `b.major === true` building in that range therefore loses geometry
   in the batch path. This violates the packet requirement to apply each
   supplied building's original flags and preserve the complete recipe.

2. The saved-oracle comparison is not a canonical triangle-attribute tuple
   comparison. `tuples` collects and sorts the three vertex attribute streams
   independently and never reads the index buffer
   (`scripts/test-cell-build.ts:31-42`); its hashes at `:83-84` can therefore
   pass after a changed triangle order/topology or a changed position/normal/
   colour association. The contract requires parity of canonical triangle
   attribute tuples, so the oracle must expand indices (or otherwise retain
   each indexed vertex's combined attributes) before canonical sorting.

Positive evidence: the pre-change fixture retains original array slots
(`scripts/test-cell-build.ts:24-28`), invalid batches are validated before the
emitter (`cityBuilder.ts:1516-1525`), and the batch directly uses its supplied
material (`:1544`). `pnpm tsx scripts/test-cell-build.ts`, `pnpm exec tsc
--noEmit`, touched ESLint, and `git diff --check d51a42b..920a374` passed in
the submission worktree. These checks do not cover either defect above.

## Scoped correction review — 920a374..7ca3684

Verdict: PASS for both prior findings.

1. Recipe preservation is restored. The parapet decision now reads the
   emitted building's original `b.major` flag
   (`lib/game/render3d/cityBuilder.ts:1389-1396`), while the nullable `major`
   parameter remains only the legacy filter. This gives legacy and selected
   emission the same major-building semantics. The focused mixed input and
   committed 83.665 m2 major source record at index `21216` distinguish its
   geometry from the same record with `major: false`
   (`scripts/test-cell-build.ts:170-184`).

2. The oracle now binds Float32 position, normal, and colour bytes for each
   indexed vertex; it canonicalizes only cyclic rotations, so it retains
   winding, then sorts complete triangle tuples across mesh partitions
   (`scripts/test-cell-build.ts:31-62`). It explicitly requires indexed
   geometry and verifies a reversed winding changes the digest (`:113-121`).
   The committed-city SHA is asserted before the saved base oracle is used
   (`:95`), so the recorded `34976d...0a61` hash is tied to the frozen input.

No correction-side regression is visible in the two-file diff. The submitted
focused test, replacements check, TypeScript, touched ESLint, and diff check
are recorded as passing; per the scoped packet, they were not broadened or
repeated here.
