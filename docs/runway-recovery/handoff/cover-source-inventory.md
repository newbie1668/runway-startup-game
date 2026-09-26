# R5b cover-generation source inventory

Read-only audit of `lib/game/render3d/cityBuilder.ts`, `waterQuery.ts`,
`lookClip.ts`, and architecture C3–C5. This is source evidence at the current
integration tree; it contains no timing measurements and no implementation
recommendation has been accepted.

## Verified generation paths

| Entry point / source | Main loops and input scope | Global/cache dependencies | Potential single-feature unbounded work | Output-preserving extraction seam |
|---|---|---|---|---|
| `buildWater` (`cityBuilder.ts:1928-1969`) | Calls `buildMergedPolyMesh(cityData.water, ...)`, which scans every water polygon and every vertex/triangle (`1829-1926`). Then scans every water polygon again, dequantizes every ring vertex, clips each closed bank polyline and appends ribbons (`1940-1950`). | `dequantizeX/Y`, `METERS_TO_WORLD`, `clipPolylineToKeep`, `appendRibbon`; no persistent cache. | Per-polygon work is proportional to ring vertices and triangles. `keep` only skips polygons through the merged mesh broad phase and clips bank runs; a large intersecting polygon still scans its full ring. | Separate `buildWater` into deterministic polygon/ring cursors: preserve `buildMergedPolyMesh` vertex/index order and bank-ring order, with `keep` passed unchanged. Do not re-order water polygons. |
| `buildParks` / `buildParkGrass` (`cityBuilder.ts:2192-2260`, `2262-2316`) | Grass scans all parks, computes each centroid/ring, then fills a grid over each park AABB (`2200-2233`, `2080-2151`). Large parks use `parkCellWorld` 32 m cells; small parks use 12 m cells (`95-99`). If tiled coverage is insufficient, it scans all source park triangles (`2154-2190`). `buildParks` then scans all parks again for paths, retaining only area ≥18,000 m² and keep/exclusion predicates (`2271-2300`). | `waterRings(cityData)` and `pointOverWater`; landmark exclusions, airport exclusion, `clipPolylineToKeep`, `buildRibbonGeometry`; no persistent park cache. | Grid iteration is proportional to clipped park AABB area / tile size², with per-cell point-in-ring, water, landmark and triangle exclusion checks (`2111-2136`). A single large or complex park can dominate one synchronous call; fallback source triangles can also be large. | Cursor over parks must preserve source park order, centroid calculation, grid x/z order, `tiled` threshold, and fallback triangle order. A separate path cursor must preserve the existing area/exclusion tests and ring point selection (`2279-2294`). |
| `buildParkTrees` (`cityBuilder.ts:2322-2499`) | First scans all parks; each eligible park requests `clamp(round(area/900), 3..80)` placements and tries up to `count*5` seeded candidates (`2330-2356`). Then scans all roads and all segments, placing seeded street trees at spacing `[20,26,36]` m until `TREE_MAX=36,000` (`2359-2405`, `81`). | `waterRings(cityData)` once; `pointInRing`, `pointOverWater`, airport/prefab exclusions, `ptsHitKeep`; deterministic `mulberry` seeds from ring/road data. | Per park attempts are bounded by 400, but the number of parks is input-sized. Road work is roads × polyline segments × spacing positions until the global cap; no cache. Output also allocates canopy/trunk geometries and materials (`2410-2498`). | Preserve park iteration and seed initialization, candidate attempt count, acceptance predicates, and road order/segment traversal. A bounded cursor must retain `h`, `placed`, `travelled`, `nextAt`, and `sign` state per feature; batching by merely slicing arrays changes RNG progression and placements. |
| `buildRoads` (`cityBuilder.ts:3446-3582`) | For each tier 0..2, scans every road and selects matching `road.tier`; each selected polyline is dequantized, keep-tested, split at water, clipped, and emits sidewalk/asphalt plus marks (`3482-3508`). Then computes `riverCrossingSpans` and emits crossing ribbons (`3535-3562`), planned crosswalks, and marks (`3564-3579`). | `waterRings`, `pointOverWater`, `splitRoadRuns`, `clipRibbonPts`, `clipPolylineToKeep`, `polylineDashes`; creates three materials and shares them across tier meshes. `riverCrossingSpans` uses a `WeakMap<CityData, CrossingSpan[]>` (`2867-2869`, `3216-3261`). | The 3×all-roads scan is linear in road/point count, but `plannedCrosswalks` builds candidates from road geometry and deduplicates with `kept.some(...)` (`3318-3443`, especially `3437-3443`), potentially quadratic in candidate count. Crossing discovery scans road runs/approaches and pairs approaches (`3175-3197`, `2902-2938`), with seed walks and snapping; this is whole-city work on a cache miss. | A road job seam must preserve tier order, road order, run splitting, clipped piece order, ribbon vertex/index append order, mark order, and shared-material identity. Crossing generation should run once per unchanged `CityData` identity and feed copied spans (`3217-3221`, `2871-2878`), then clip/emission can be bounded without recomputing spans. |

## Helper and cache facts

`waterRings` is not cached: every call maps every `cityData.water` polygon and
recomputes bounds (`waterQuery.ts:63-72`). `pointOverWater` then linearly checks
all rings after the bounds test (`74-79`). The `keep` helpers are point/vertex
scans or sequential clipping, not spatial indexes: `ptsHitKeep` is linear in a
polyline (`lookClip.ts:175-185`), `aabbHitsKeep` is constant-time for one AABB
(`187-199`), and `clipPolylineToKeep` walks every point (`201-219`).

`riverCrossingCache` is keyed by object identity, intentionally weak, and returns
deep copies (`cityBuilder.ts:2867-2878`, `3216-3261`). It therefore survives
repeated calls on the same immutable decoded `CityData`, but not a newly created
wrapper object.

## Why a `subsetCityData` wrapper changes output

This is verified from call structure, not a benchmark. A wrapper that replaces
`water` with only nearby polygons changes `waterRings`, so `pointOverWater`
changes for park tiles, park fallback triangles, street-tree candidates, road
splitting, and every water-bank ribbon. It can therefore emit land over omitted
water or omit bank/cover geometry at the subset boundary.

Replacing `roads` changes road ribbons, crosswalk candidates and the road
approaches used for crossings. For street trees, each retained road's seed is
derived from that road's first point (`2370-2373`), so merely omitting other
roads does not change that retained road's own RNG stream. Omission does change
which records are visited and how the global `TREE_MAX` cap is consumed
(`2361-2365`, `2373`, `2381`), so later-road placement and total output can
change. Replacing `parks` similarly changes park grass grid/fallback order and
large-park paths (`2200-2233`, `2271-2300`), while each retained park's
centroid, seed, count and candidate attempts remain record-local
(`2330-2356`) if its bytes and ordering are unchanged.

The wrapper also changes the `CityData` object identity, so the weak crossing
cache misses and recomputes `riverCrossingSpans`. More materially, crossing
discovery uses all road approaches and run ends, then supplements them with
the fixed `LANDMARKS`/`THAMES_CROSSINGS` seeds (`3216-3261`); a subset can lack
the land stubs needed for matching, snapping or deduplication. A subset can be
safe only if it separately preserves the full water/context predicates, the
global ownership and budget semantics, and the original feature records and
ordering needed by each deterministic loop. A plain wrapper does not establish
those conditions, so it is not an output-preserving cover restriction even
when its retained geometry lies inside the same visible bounds.

## Architecture relationship and bounded-cover implications

C3 requires the existing 400 m spatial index for selection and says cover must
cover the same visible bounds, with spatial restriction or caching rather than
leaving the old initial disk (`docs/runway-recovery/architecture.md:106-142`).
C4 requires one scheduler seam whose jobs are bounded steps and explicitly
rejects checking time only after one whole-city synchronous job
(`144-175`). C5 keeps `CityRenderer3D` as the adapter, refreshes coverage on
camera/zoom changes, retains a cheap context plus bounded detail, and requires
cover in the essential visible queue (`177-183`).

The source supports an extraction that keeps full immutable `CityData` and
advances deterministic cursors through existing loops, while using existing
`keep` clipping at emission. A `subsetCityData` approach is a suggestion to
avoid: the output changes above are verified consequences. Any new cover cache,
cursor API, or job decomposition remains a lead-reviewed design decision; this
inventory makes no timing or acceptance claim.
