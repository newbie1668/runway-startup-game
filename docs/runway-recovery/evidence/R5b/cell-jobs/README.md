# R5b-3 incremental cell job acceptance

The cell job and R5b-2 tier APIs passed scoped review and combined integration checks at `0aa752edee6daa95212ac962b289feb45f894b06` on 9 September 2026. The final reviewed worker source `423ed1b` matches the two integrated job/test files exactly. These helpers are not wired into CityRenderer3D; R5b cover generation and R6 navigation integration remain open.

The helper starts at most 16 units per step, checks the injected clock between units, emits selected original building records, allocates one target attribute per unit and copies at most 4,095 entries per vertex attribute or 4,096 index entries per unit. It packs a cell into one Uint32 indexed mesh. Publication transfers ownership only on a normal callback return. Cancellation/failure drains unpublished geometry once, detaches partial publication, preserves original and cleanup errors including falsy thrown values, and leaves caller material untouched.

[Independent review](review.md) records the initial failures and final PASS. Focused tests cover tier tuple/scratch parity, immutable successful ownership, cancellation during emission/copy/publication, validation/callback/disposal failures, reentrancy, unselected data, constant-clock bounds and an actual index above 65,535.

All eight sequential commands exited 0 on initially clean source `0aa752e`: `pnpm test:game`, `pnpm test:ui`, `pnpm lint`, `pnpm build`, and focused cell-build, cell-stock-job, build-scheduler and offline geodata verification scripts. UI has 9 checks; binary remains 113,569 buildings / 56,793 roads / 769 parks / 62 water polygons. [Authoritative exits and logs](integration-checks/results.json).

## Densest cell measurement

Cell `14,10` contains 320 original owners. Both runs for each tier emitted 320 sources into one mesh. The host was Apple M1 / Node 26.5.0. Runs are first/repeat within one process with shared module/JIT state; they are not separate cold starts. No app build, browser capture or other benchmark overlapped this measurement.

| Tier | Buffer bytes | First total / max step | Repeat total / max step |
| --- | ---: | ---: | ---: |
| Overview | 486,528 | 41.33 /9.55 ms | 19.22 /3.03 ms |
| Neighbourhood | 2,716,056 | 78.00 /7.63 ms | 21.96 /2.47 ms |
| Street | 11,339,040 | 94.09 /4.76 ms | 77.37 /4.20 ms |

[Profile summary](profile-summary.json) · [Every raw step/unit interval, gzip JSON](profile-cell-jobs.json.gz) · [Exact scratch harness](profiling-harness.txt)

The timing is instrumented Node evidence, not browser, phone or G1 certification. Some slices exceed the 4 ms target. Largest observed emission units were 8.48 ms in the first overview run, 7.17 ms in the first neighbourhood run and 2.87 ms in the first street run. Largest target allocation unit was 0.27 ms, copy 0.41 ms and publication 0.56 ms across these runs. Atomic building emission and typed-array allocation cannot be preempted within a unit; these overruns remain explicit limits for runtime integration. Total target bytes exceed the earlier batch totals because the packed cell uses Uint32 indices. Temporary fragments and target arrays coexist during packing; these totals are final retained geometry buffers, not peak process/GPU memory.

To reproduce the recorded harness, copy profiling-harness.txt into `.superpowers/sdd/2026-09-05-runway-recovery/profile-cell-jobs.ts` in this repository, then run `RUNWAY_EVIDENCE_DIR=/tmp/runway-cell-profile pnpm exec tsx .superpowers/sdd/2026-09-05-runway-recovery/profile-cell-jobs.ts`. The harness records actual source and dirty state and reads only the committed binary.

The [standalone tier image](../detail-tiers/README.md) is separate bounded geometry evidence. Earlier R3b browser success remains tied to its recorded source; no new in-game performance result is inferred from these API-only changes. G1, full-city memory, continuous cover and faithful street recognition remain open.

## Full overview accounting

A separate sequential accounting run on unchanged source `0aa752e` generated and immediately disposed each cell. The only dirty state at its start was untracked integration evidence. All 1,609 cells emitted geometry, with 113,563 source records; six records were omitted by the existing builder eligibility rules. This is a sum of actual buffer sizes, not a simultaneous residency or GPU measurement.

The overview buffers total **195,161,688 bytes (186.12 MiB)** before cover, heroes or object overhead, above the proposed 128 MiB ceiling. The largest cell is `5,15` at 522,960 bytes. [Accounting output](overview-budget.json) and [exact harness](overview-accounting-harness.txt) preserve provenance, omitted IDs and limitations.

This measurement requires a compact overview storage step before runtime integration. The lead has authorized normalized Int8 normals, normalized Uint8 linear colours and Uint16 indices when vertex count permits, retaining Float32 positions and unchanged street/neighbourhood storage. With every actual overview cell below the Uint16 limit, the predicted buffer total is exactly half (93.06 MiB); this prediction must be verified after implementation. Footprints, heights, source coverage and winding must remain unchanged, with bounded colour/normal rounding and an actual rendered comparison. This is a storage change, not permission to omit buildings or declare the full renderer within budget.
