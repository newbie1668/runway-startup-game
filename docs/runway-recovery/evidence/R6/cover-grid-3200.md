# Cover-grid candidate — 3200 metres

Candidate `0cf8649`, based on integration `91e8309` (runtime `cc0d2d2`).
The sole source change is `CityRenderer3D`'s existing cover-index cell size,
1600 → 3200 metres. Stock cells/tiles, page capacities, generation budgets,
materials, geometry builders, assets and game behavior are unchanged.

**Independent source review and the full repository gate pass for the bounded
parameter change. Native measurements remain pending.** This does not
establish startup, reverse-zoom continuity or draw-call acceptance.

## Evidence

- [Independent review of the exact candidate](https://app.devin.ai/attachments/5e212395-780f-46ae-86e3-75113250021a/review-0cf8649-cover-3200.md)
- [Corrected frozen-source feasibility report](https://app.devin.ai/attachments/8321e396-9aac-4a02-bd91-20caa4823d7d/probe-report-cc0d2d2.md)
- [Raw feasibility scripts and logs](https://app.devin.ai/attachments/c58cd344-5e96-40ee-b1e5-52b00b123b32/probe-evidence-cc0d2d2.zip)
- Reviewer's Fitzrovia profiles: [1600 rerun](https://app.devin.ai/attachments/4da90650-d3c2-45a0-b2d7-ff7fc2c2cad3/review30-fitzrovia-1600-rerun.log), [3200](https://app.devin.ai/attachments/5531f3d4-b4c2-4cc7-ac5e-67a4dfa3fa39/review30-fitzrovia-3200.log), [first 1600 run](https://app.devin.ai/attachments/a6426c1d-53e8-4ce6-a860-b8fb106e3b8e/review30-fitzrovia-1600.log).

The source probe used the existing profile script with
`--overview --draw-ranges --cover-cell=1600|3200|6400`, then `--transitions`.
All figures below are CPU-only, with empty replacement exclusions.

| Cover cell | Cover jobs | Cover calls | Cover triangles | Settled stock + cover |
| --- | ---: | ---: | ---: | ---: |
| 1600 m | 104 | 530 | 530,850 | 122.62 MiB |
| 3200 m | 31 | 218 | 512,168 | 121.81 MiB |
| 6400 m, deferred | 7 | 124 | 501,338 | 121.35 MiB |

All three retain 113,563 stock buildings, 124 stock calls and 1,338,712
submitted stock triangles under the same overview draw range. The expected
native zero-angle total at 3200 m is **593**, comprising 124 stock, 218 cover,
242 landmarks/replacements and 9 other calls. This remains above 300.
It is a prediction, not a native result.

At 3200 m, the transition profile's sampled resident plus tracked staging
peaks were 50.89 MiB near Fitzrovia and 21.32 MiB at Canary Wharf, compared
with 50.70/17.68 MiB at 1600 m. These exclude cover/tree/decoration/hero
staging, replacement exclusions and total browser/GPU memory.

## Accepted limits and rejected experiment

The grid remains anchored at world origin and indexes original feature
identities against full CityData. Clipping, fixed page capacities,
cancellation and publication paths are unchanged. Source review supports
fewer clip seams as the cause of fewer triangles; cross-grid tuple equality
was not proven and is not claimed.

Larger cells retain and generate more offscreen cover in close views.
The reviewer's default Fitzrovia CPU profile took 337 synthetic frames to
coverage versus 289 at 1600 m, with 31.83 versus 29.48 MiB at coverage and
35.90 versus 32.31 MiB after prefetch. These are single-run CPU observations,
not browser frame counts or startup evidence. A close view crossing a
3200 m grid corner can require four large cells before essential readiness.
Native close-hub readiness must therefore be measured alongside the wide
call reduction. The 6400 m option is deferred.

The probe's initial suggestion to disable `keepUniquelyNamed` was rejected:
the unchanged runtime landmark test requires `getObjectByName('east-front')`,
and other runtime tests also require named anchors. Both production flags
remain explicitly `true`; no test was weakened. The corrected report
withdraws its initial batching recommendation and projected totals.

Parent checks passed on `0cf8649`: city-stream with explicit `3200`,
stream-coverage, cover-index, cover-clipping, cover-pages, static-mesh-batch,
landmarks, noticed, project lint, TypeScript and whitespace checks.
The review identifies pre-existing fixture limits: the boundary parity
fixture uses 1600 m, and one distinct-grid assertion only runs at 1600 m.
The review did not replay the full gate.

The [full repository gate](integration-checks/0cf8649.log) passed sequentially
on `0cf8649`: `pnpm test:game`, `pnpm test:ui`, `pnpm lint`,
`pnpm exec tsc --noEmit`, `pnpm build`,
`pnpm tsx scripts/fetch-geodata.ts --verify`, and `git diff --check`.
No browser measurements overlapped these checks.

The parent is publishing this reviewed source checkpoint while awaiting the
separate stock continuity correction. Any accepted correction requires its
combined gate before the affected native comparison. Startup, total calls,
uninterrupted reversal and complete memory accounting remain open.
