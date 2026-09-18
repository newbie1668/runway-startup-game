# Independent review: cover grid 1600 m

- Repo: `newbie1668/runway-startup-game`
- Candidate: `eed997d1d94371fa443beb505537119cf9e92d02` (`origin/devin/cover-grid-1600`)
- Base: `56bde734390e0980801cdbd7501220a079560422` (verified as merge-base)
- Diff: 7 files, +343/-22, as claimed. Read-only review in a detached worktree; no edits.

## Verdict: ACCEPT (no blocking findings)

## Implementation review

- `coverIndex.ts`: `cellSizeM` optional arg, default remains `CELL_SIZE_M = 400`;
  validation rejects non-finite/≤0 and sizes whose world cell coordinate exceeds
  a safe integer (`Number.MIN_VALUE` covered by test). `cellWorld` lives in
  private state, published `index.cellSizeM` reflects the live value. 64-unit
  step bound, slice deadline, single publication, detach-before-callback and
  cancellation paths are untouched. Original `CityData` still passed through;
  selections remain original record indices.
- `cityStream.ts`: the real fix. Base `cellBounds(id)` computed *every* cell's
  bounds from `coverIndex.cellSizeM`, which was only correct because both grids
  were 400 m. Now `ordered()` takes a `grid` tag: stock/decor/eviction ordering
  use `cityIndex.cells.get(id).bounds`; cover/trees use `coverCellBounds`.
  Cover and tree jobs receive cover-cell bounds; `coverForBounds(..., 32)` pad,
  `paintMarks` on street, road-context dependency (`cover` waits on
  `roadContext`), decor→stock detail dependency, `MAX_PENDING`,
  `BACKGROUND_RESIDENT_BYTES`/`MAX_RESIDENT_BYTES`, `trimResidents`
  retain sets, and `settleCoverage` readiness are unchanged.
- `CityRenderer3D.ts`: only `cellSizeM: 1600` on the cover index job;
  `indexCity(data, 400)` remains for stock.
- `streamCoverage.ts` (unchanged) already derives cover cells from
  `index.cellSizeM`; prefetch/hysteresis rings are in metres so they are
  grid-independent. Pre-existing inclusive edge comparison (`>=`/`<=`) means a
  view exactly on a cell edge selects both neighbours — not introduced here.
- `createTreeCoverJob` recomputes whole-city `treeSpotsSteps` per cell and
  filters by bounds (pre-existing); fewer, larger cover cells reduce that
  repeated work. Tree pages are fixed at 1024 instances and paged, so 16× cell
  area does not break the page contract.

## Tests reviewed

- `test-city-stream.ts`: arg is positional `process.argv[2]`, **default 1600**
  (not 400; not `--large-cover-grid`). Two-park fixture at (10,10)/(60,10) world
  ≈ 1.1 km/6.7 km; at 1600 m the stock (`2,2`/`16,2`) and cover (`0,0`/`4,0`)
  ids are asserted distinct. Tree check reads every `InstancedMesh` matrix
  translation against the cover-cell union of the view; a bounds leak would
  import (60,10) trees and fail. Eviction, zero residents/bytes/queued jobs
  after dispose, shared material survival checked.
- `test-cover-cell-job.ts`: boundary-crossing road+polygon at x = 1600 m world
  edge plus far records; ordered material (type/color/vertexColors/side/
  renderOrder) and full per-index attribute tuples compared indexed vs full
  selection; geometry dispose count equals mesh count. Real parity, not
  nonempty-scene.
- `test-cover-index.ts`: invalid sizes; 1600 grid 3×3 cells for a 3.4 km
  polygon, boundary road selected via a 1 m box, enclosing polygon via point
  query; whole-world polygon needs >1 step and cancel-before-publish leaves
  `ready === 0`.
- `test-stream-coverage.ts`: mixed 400 m stock / 1600 m cover plan yields 7
  stock cells and one cover cell.

## Checks actually run (worktree at eed997d, exit 0 each)

```
pnpm exec tsx scripts/test-city-stream.ts 400
pnpm exec tsx scripts/test-city-stream.ts 1600
pnpm exec tsx scripts/test-city-stream.ts          # default = 1600
pnpm exec tsx scripts/test-stream-coverage.ts
pnpm exec tsx scripts/test-cover-index.ts          # 29 checks
pnpm exec tsx scripts/test-cover-cell-job.ts
pnpm exec tsx scripts/test-tree-cover-job.ts
pnpm exec tsc --noEmit
pnpm exec eslint <7 changed files>
git diff --check 56bde73 eed997d
```

Not run: `pnpm test:game`, `pnpm test:ui`, `pnpm build`, browser harness
(per brief; and the changed stream tests are not part of `test:game`).

## Non-blocking observations

1. `test-city-stream.ts` defaults to 1600 while the library default is 400;
   harmless but the report's "runs explicitly at both" relies on callers
   passing `400`. None of the new stream tests are wired into `pnpm test:game`.
2. `test-city-stream` 400 vs 1600 exercise the same code path except the
   distinct-id assertion; the fixture never places a view that straddles a
   1600 m cover boundary while inside one 400 m stock cell, so the ordering
   split in `ordered()` is validated by construction (type-safe tag) rather
   than by a boundary-ordering assertion.
3. Tradeoff assessment: with per-cell tree/cover jobs each re-deriving global
   context, 1600 m cuts overview cover submissions ~10× (9,650→957) for a
   ~3.6% geometry reduction, at the cost of more offscreen close-range cover
   (+~2% Fitzrovia bytes, 23k tris). Bounded and reasonable; but these are CPU
   estimates only — no browser/GPU frame-time or readiness evidence for the
   larger essential cover jobs on the first street-level frame.

## Caveats

- First `pnpm exec tsx` invocation took ~7 min (pnpm store warm-up on this
  VM); subsequent runs were <1 s. Not a test-time signal.
- No asset/data changes in the diff; `london-city.bin` untouched.
