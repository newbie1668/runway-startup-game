# Recovery handoff — 20 September 2026

Continue from **draft PR #30**, branch `build/runway-recovery`, base `docs/runway-recovery-plan` (planning PR #29). This is the active integration branch; do not restart from old map PR #27 or the primary checkout. The owner subsequently requested completion of PR #30. No merge or deployment is authorized by this handoff.

Latest supplemental checkpoint: UI `00a7465` fixes hidden-controls play height
and passes all repository gates plus 28 focused browser assertions. Renderer
source remains `70b4cc2`. Controlled warmed tours repeat resident resources
exactly; application cleanup and loop cessation are measured, with physical
reclamation and ordinary React routed unmount still unproven. The
[supplemental report](../evidence/R6/browser-cleanup-layout.md) preserves the
old first-arrival observation, 404 attribution limits, HQ overlap and all
performance failures. The parent awaits a read-only overview feasibility
review; no new rendering algorithm is accepted. Read current status before
using the historical continuation below.

Continuation checkpoint: source `8393133` independently passes bounded cover
and renderer/stream review; [repository gates and reports](../evidence/R6/README.md)
are recorded. Camera-driven stock/cover generation, detail, prefetch, replacement
and eviction are connected to `CityRenderer3D`. Fitzrovia is unique in search.
The parent owns integration in `devin/1789676440-camera-stream` and publishes
reviewed checkpoints to this PR's `build/runway-recovery` branch. Production
`7a72081` then failed startup (index at 60.4 seconds; no useful frame by 74.3
seconds). Scheduler correction `e153df9` independently passes review and all
repository gates. Its [native browser run](../evidence/R6/browser-e153df9.md)
restored 3D navigation and game/save continuity, but still fails startup
(13.35 s cold), wide-view readiness (>30 s) and three hub draw-call budgets.
Stream admission `9573562`, park containment `56bde73` and water leaf cache
`a22118e` are independently reviewed integration changes. `2a61884` strengthens leaf-capacity and full-road
context parity regressions. Cover-grid `eed997d` is independently accepted
and integrated through `7e12480`; stock stays 400m and cover becomes 1600m.
Static batching `95041a9` is independently accepted and integrated through
`171419d`; idle-generation `6309990` is independently accepted and integrated
as `2ce587c`. All six combined repository gates and affected focused checks
passed on that source, published at `ce8716a`. Native production startup
subsequently measured 7.23s cold / 5.43s reload; a bounded trace measured
6.27s and identified repeated replacement-anchor and road/water queries.
See [native diagnostic evidence](../evidence/R6/browser-ce8716a.md).
Lead candidate `9c7e187` reuses exact road-water classifications and passes
[independent review](../evidence/R6/road-classification-cpu.md). The separate
replacement-anchor candidate `b77f6ae` (runtime `227b85e`, then test-only
corrections) also passes [independent review](../evidence/R6/anchor-bounds-cpu.md).
Both are integrated through `70b4cc2`, with byte-identical reviewed file sets.
All six combined gates, affected focused tests, scoped lint and TypeScript
pass on that exact source. The [native production matrix](../evidence/R6/browser-03e5f02.md)
is now complete on published source `03e5f02`. Actual city streaming,
typical hub budgets, interaction, gameplay/save continuity and fallback pass.
Desktop cold startup, wide startup/triangles, strict first-arrival retention
and complete disposal do not pass or remain unresolved. Scope a measured
correction before another browser run; do not restart accepted integration.
See status before counting any browser acceptance as complete.
The newer 122.62 MiB CPU-only overview also excludes landmarks/GPU/browser
work. Its long CPU drain outliers and slower street sample remain caveats.
Source audit `1aa3fef` is accepted as an honest modelling NO-GO packet.
See [current status](../status.md) before using the historical notes below.

## First read

1. [Execution status](../status.md), [product contract](../product.md), [architecture](../architecture.md), [agent contract](../agent-contract.md).
2. [Runtime recovery plan](../../superpowers/plans/2026-09-05-runway-recovery.md) and [London fidelity plan](../../superpowers/plans/2026-09-05-london-fidelity.md).
3. [Latest verified compact overview checkpoint](../evidence/R5b/compact-overview/README.md).
4. [Accepted cover-index contract](cover-index-task.md), [cover source inventory](cover-source-inventory.md), and [preparation notes](cover-preparation.md). Preparation includes historical estimates; 93.06 MiB covers stock only, while the later 127.54 MiB CPU profile includes stock and cover.

## Earlier completed and verified checkpoint

Source `f1af3e85e763e3d06a412f5df9912ef0affd0454`, evidence commit `403d927c7e1d4e056f8312c9d050bf7d38179dc5`:

- Replacement/ordinary-stock fallback and 2D camera clamp are integrated. Earlier final R3b browser evidence passes three failure cases and two normal views at its recorded source.
- Selected building batches, three detail tiers, bounded cell stock job and compact overview storage passed their scoped reviews. These newer helpers are **not connected to CityRenderer3D**.
- Overview geometry buffers total 97,580,844 bytes (93.06 MiB), half the previous 186.12 MiB, preserving the same 113,563 emitted original buildings and 1,609 nonempty cells. Six existing omissions remain unchanged.
- Paired standalone browser previews passed with no browser errors. Neighbourhood/street are pixel-identical; overview has small colour-rounding differences. This is a bounded fixture, not full-map fidelity evidence.
- All eight sequential integration checks passed on clean `f1af3e8`: `pnpm test:game`, `pnpm test:ui`, `pnpm lint`, `pnpm build`, and the cell-build, cell-stock-job, scheduler and offline geodata scripts. [Exact logs/exits](../evidence/R5b/compact-overview/integration-checks/results.json). Later commits are documentation/evidence only; these checks were not rerun for handoff.

## Historical interrupted draft (superseded by cover-index acceptance)

R5b-4a stopped at a worker usage limit. There is **no completed submission, no test file, no test result, and no independent review**. The original isolated worktree has one untracked file: `lib/game/render3d/coverIndex.ts`.

A byte-for-byte copy is preserved remotely as [cover-index.draft.ts.txt](cover-index.draft.ts.txt), SHA-256 `584b85f7c471f65896e22d11c7562eaeff51fd75461d2dcb111d43e3d23bb9ce`. It is intentionally outside compiled source. Recover it into the allowed production path only when resuming its task; do not treat it as accepted code. The original local file remains untouched.

Known draft gaps observed during handoff (not an exhaustive review): publication copies every bucket into a new Map despite the bounded-publication contract; queries enumerate the unbounded query rectangle rather than clamping to index bounds; closure references and construction allocations require checking against the cancellation/constructor contract. The required `scripts/test-cover-index.ts` is entirely missing. Complete the task card, add its tests, get scoped independent review, run integration gates, then commit/integrate the implementation. Do not simply commit this draft as done.

The previously uncommitted architecture/status/plan edits are included in this handoff commit. **No accepted integration work remains uncommitted after this publication.** The pending production implementation is the cover-index draft and its missing tests.

Two unrelated untracked files remain in the user's original primary checkout (`worktree-3d-london-map` at `d36b8a4`): `lib/game/render3d/buildScheduler.ts` and `scripts/test-build-scheduler.ts`. They predate this work and were left untouched. Accepted scheduler code is already on the integration branch; do not overwrite or blindly stage these primary-checkout files.

## Remaining sequence

1. R5b-4a is complete; use the accepted production API and tests rather than restoring the historical draft.
2. Bounded cover and R6 renderer integration are reviewed and connected. Preserve their geometry, identity, clipping, ownership, cancellation, cleanup and camera coverage guarantees while reducing measured runtime costs.
3. Finish and independently review the bounded runtime corrections listed in status. The lead alone integrates; workers have disjoint file ownership and separate branches. Run full gates once on the accepted combined candidate.
4. Rerun native production-browser timing and draw-call checks, then the incomplete failure/mobile/reload matrix. Distinguish native Chrome, headless SwiftShader and mobile emulation. Keep PR #30 draft while acceptance fails. The 127.54 MiB CPU-only stock/cover result omits heroes and other costs; it does not certify the running map's budget.
5. Keep Charlotte Street as the fidelity candidate with modelling NO-GO. Follow the accepted finite [reference acquisition recommendation](../evidence/F1/acquisition-recommendation.md) before modelling. Generic facades cannot fill evidence gaps; runtime recovery does not satisfy faithful-London acceptance.

Keep gameplay/save/audio/UI semantics, the automatic 2D fallback, dynamic Three import boundary, current bbox/binary/GLBs and main London Startup Map separation intact. Do not deploy to londonstartupmap.com. Never overlap build/browser timing workloads or rerun completed baselines merely because the agent changed.

Historical judgment estimate was roughly 50% of runtime recovery and 20–25% of the full faithful-London goal; these are not measured delivery percentages. [Execution ledger](execution-ledger.md) preserves prior acceptance decisions and rulings for recovery, including interrupted attempts.
