# Independent review — `51c1b4b1803d1d9675a70068e00d0e47c543e411` (origin/devin/park-cover-index) vs `ed2203f7c762c6885d2d19f125ef3cee3352eeb1`

Repo: `newbie1668/runway-startup-game`. Read-only review; no edits, commits, subagents, PR or
asset changes. Working tree clean at the exact commit. Probe script lives outside the repo
(`/Users/devin/park-probe.ts`).

## Verdict: **ACCEPT**

Single-file, 24-line change (`lib/game/render3d/cityBuilder.ts`): `ParkInfo` gains
`edgeIndex: WaterEdgeIndex` built once per source `CityPoly` inside `parkInfoSteps`; the
five park-tile containment queries in `createParkCoverJob` and the tree-spot query in
`treeSpotsSteps` switch from `pointInRingSteps(x, z, ring)` to
`indexedPointInRingSteps(x, z, edgeIndex)`. No geometry emission, ordering, clipping,
material or disposal code is touched.

## Predicate equivalence (the main concern) — exact, by construction and by test

Linear `pointInRingSteps` toggles `inside` for every edge `(i, j=i-1 wrapping)` satisfying
`zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi`.

`indexedPointInRingSteps` evaluates the byte-identical expression (same operand order, same
`1e-12` bias) for every edge `i ∈ [start, end)` of every visited leaf, with the same
`j = i === 0 ? n - 1 : i - 1`. Leaves partition `[0, n)` exactly once, so the edge multiset is
identical; XOR toggling is order-independent.

A node is skipped only when `z < node.minZ || z >= node.maxZ`. An edge can toggle only if
`min(zi, zj) <= z < max(zi, zj)`; node bounds include both endpoints of every contained edge
(`Math.min/max(…, points.at(i).z, points.at(previous).z)`), so `node.minZ <= z < node.maxZ`
holds for every toggling edge and the filter can never drop one. The filter is on `z` only
and uses the exact half-open condition, so the `1e-12` x-sliver that `waterQuery.ringBounds`
has to widen for does not arise here — the x-comparison itself is unchanged.

Empirical confirmation on the committed binary (all 769 park rings, 15,840 vertices,
largest ring 157 vertices): 176,110 queries — every vertex-strided point, ±1e-10 x/z
perturbations, previous-edge midpoints, points at exactly `minZ`/`maxZ` and 1e-9 beyond,
plus 40 seeded random points per bounding box — gave identical results between
`pointInRingSteps` and `indexedPointInRingSteps` (`assert.equal` on every case, exit 0).

## Boundedness / cancellation / cache

- `buildWaterEdgeIndex` yields once per edge in leaves and once per branch (probe:
  20,115 build units for 15,840 vertices, i.e. no step processes more than one edge).
  Recursion depth is `⌈log2(n/4)⌉+1` (max 7 on real data; 14 for a 65k-vertex ring).
  Query stack is at most `2·depth` entries; queries yield every 16 nodes.
- Index memory is O(n) small objects per park: 9,319 nodes total across all parks (vs the
  15,840-vertex source), held in the existing `parkInfoCache` WeakMap keyed by `CityPoly`,
  same lifetime as the already-cached `ParkInfo`. This mirrors the accepted
  `incrementalEdges` cache for water rings. Not a runtime geometry intermediate.
- `parkInfoCache.set(park, info)` happens only after `buildWaterEdgeIndex` returns, so a
  job cancelled mid-`parkInfoSteps` publishes nothing; the partial tree is unreachable
  garbage. Cache hits return the identical `ring` (`sourcePointSequence` over `park.verts`)
  and `edgeIndex`, so source identity is unchanged.
- `parkTileCounts`, landmark/water exclusions (`pointOverWaterSteps`,
  `landmarkExclusionAt`, `triangleHitsExclusion`), tile ordering, tree hashing/seeding,
  writer usage and disposal are untouched by the diff. The legacy `buildParkTrees` still uses
  `pointInRing(x, z, info.ring)` via `parkCentroid`, so parity tests compare the indexed job
  against the unchanged linear baseline.

## Checks run on the exact commit

| Check | Result |
| --- | --- |
| `pnpm exec tsc --noEmit -p tsconfig.json` | exit 0 |
| `eslint lib/game/render3d/cityBuilder.ts lib/game/render3d/waterEdgeIndex.ts` | exit 0 |
| `tsx scripts/test-water-edge-index.ts` | pass |
| `tsx scripts/test-park-cover-job.ts` | "full binary parity, water context, clipping and empty selection passed" |
| `tsx scripts/test-park-cover-eligibility.ts` | "eligibility, cache and mixed-selection checks passed" |
| `tsx scripts/test-tree-cover-job.ts` | "baseline transforms, global cap, bounded pages, local selection and cancellation passed" |
| `tsx scripts/test-cover-cell-job.ts`, `test-cover-job-lifecycle.ts`, `test-city-coverage.ts`, `test-stream-coverage.ts` | all pass |
| Exhaustive predicate probe (above) | 176,110/176,110 equal |
| `prettier --check lib/game/render3d/cityBuilder.ts` | warns — **pre-existing** drift at lines ~3092/3458/4089 (`roadPtsSteps` signature, `shorelinePointSteps` call, `CrossingSpan.pts` type), already present at `9908068`/`ed2203f`, outside this diff |

Step-count reduction observed in the probe: 5,268,720 linear units → 15,771 indexed units
for the same 176,110 queries. This corroborates the worker's direction of travel but is
**not** a browser-performance certification.

## Limitations

- Full `pnpm build`, `test:ui`, and browser/renderer integration were not rerun (parent's
  gates). No browser performance is certified from step counts.
- Probe coverage is the committed `london-city.bin`; equivalence for arbitrary rings rests
  on the construction argument above (which is exact) rather than on a synthetic fuzz.

## Required fixes

None. Optional, out of scope: a formatting-only commit for the pre-existing Prettier drift
in `cityBuilder.ts`.
