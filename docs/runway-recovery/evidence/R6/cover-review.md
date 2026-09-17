# Independent paging review — `8393133b3b39ff266247348a564e74a475005df3`

Repo: `newbie1668/runway-startup-game`. Base of comparison: `9908068` (previous reviewed
candidate). Delta reviewed: `59fb26b` (axis-normal packing), `2a5b3d0` (paging/stream
findings), `8393133` (park eligibility semantic compare). Review is read-only; no edits or
commits were made (a throwaway probe script was created and deleted, tree left clean).

## Verdict: **ACCEPT** (scope: bounded cover generation and the exact review findings)

No blocking defects found. Two non-blocking notes are listed at the end.

## Files inspected

`lib/game/render3d/coverGeometry.ts`, `waterCoverJob.ts`, `coverSequence.ts`, `coverClip.ts`,
`coverCellJob.ts`, `cityBuilder.ts` (`createParkCoverJob` 2405–2626, `createRoadCoverJob`
4551–4676, `snapSpanToApproachesSteps` delta), `cityStream.ts` (delta), `mapSearch.ts`
(delta), `scripts/test-cover-pages.ts`, `test-park-cover-eligibility.ts`,
`test-water-cover-job.ts`, `test-city-stream.ts`, `test-city-read.ts`.

## Checks run (all on the exact commit, `git status` clean)

| Check | Result |
| --- | --- |
| Explicit strict TS: `pnpm exec tsc --noEmit --strict --skipLibCheck --esModuleInterop --moduleResolution bundler --module esnext --target es2017 --lib dom,dom.iterable,esnext scripts/test-cover-pages.ts scripts/test-park-cover-eligibility.ts scripts/test-water-cover-job.ts scripts/test-city-stream.ts scripts/test-cover-context-ownership.ts scripts/test-cover-job-lifecycle.ts scripts/test-park-cover-job.ts scripts/test-cover-sequence.ts` | exit 0 |
| `tsx scripts/test-cover-pages.ts` | exit 0 (32 s) |
| `tsx scripts/test-park-cover-eligibility.ts` | exit 0 |
| `tsx scripts/test-water-cover-job.ts` | exit 0 — "parity, clipping, slicing, ownership and real binary passed" |
| `tsx scripts/test-cover-context-ownership.ts`, `test-cover-job-lifecycle.ts`, `test-park-cover-job.ts`, `test-cover-sequence.ts`, `test-cover-cell-job.ts`, `test-cover-clipping.ts` | all exit 0 |
| `tsx scripts/test-city-stream.ts`, `test-city-read.ts` | exit 0 |
| `pnpm lint` (eslint) | exit 0 |
| `git diff --check 9908068 8393133` | exit 0 |
| `prettier --check` on changed `.ts` files | all clean except `cityBuilder.ts`, which is **pre-existing** at `9908068` (verified by checking out that revision of the file) and not introduced by this delta |
| Probe: `new THREE.BufferAttribute(new Int8Array([127,0,-127]),3,true).getX/Y/Z` on three r185 | returns exactly `1, 0, -1`; `setXYZ(-1,1,0)` round-trips to `-127,127,0`; `-0*127` stores `0` |
| Probe: `clippedCoverPieces` identity | inside corners are returned as the *same objects* (`indexOf` finds them); boundary intersections are fresh objects |

## Findings against the six criteria

### 1. Fixed-capacity generation; no source-sized runtime intermediates — PASS
- `createCoverPageWriter` holds exactly one `CoverPage` (16,384 verts / 49,152 indices);
  `pageMesh` copies in `COVER_COPY_CHUNK` slices and yields; the temporary Float32 normal
  array and the Int8 replacement are both page-sized.
- Water: `SourceNormals` allocates only `NORMAL_PAGE`(=16,384)-vertex `Float32Array` pages,
  one per yield; per-triangle work uses three-element `corners`/`points`. Bank quads are
  emitted one at a time through `banks.polygon`.
- Parks: grass tiles and fallback triangles emitted per triangle through `reserve(3,3)`;
  ring access is via `CoverSequence` (`sourcePointSequence` / `CoverPages`, 256-element leaf
  pages, radix tree). `parkTileCounts` is a per-`CityData` WeakMap holding one integer per
  park — a small cache, not geometry.
- Roads: per tier, per road, per run, per clipped piece → `appendCoverRibbonSteps`; the
  `marks` helper drains its `pending` dash array on every step so it never accumulates.
  `snapSpanToApproachesSteps` now yields every 64 run ends with a cheap Chebyshev reject
  before `hypot`/`overWater` — bounded, behaviour-preserving (any point rejected by the
  new pre-check would also fail `d >= bestD`).

### 2. Exact geometry / order / clipping / source identity / material ownership / cancel / cleanup / page ownership — PASS
- Triangle order preserved across pages; `finish()` attaches remaining pages in
  `COVER_ATTACH_CHUNK` slices (resolves the earlier "unsliced final attachment" finding);
  `parent` option streams pages during `flush`.
- Materials are created lazily via `context.own(...)`; road asphalt/pavement shared per job
  through closures; `coverCellJob` retains per-layer resources in one pool and disposes on
  cancel unless transferred.
- `createCoverJob`: reentrancy guard, `terminal`/`advancing`/`finalizing` state, cleanup on
  cancel/throw/empty root, `AggregateError` on cleanup failures, `own()` disposes
  immediately when called after termination. Lifecycle/ownership/cancel scripts pass.
- Test suites compare per-material ordered triangle streams against the legacy builders,
  positions and indices byte-exact (`test-park-cover-eligibility.ts`,
  `test-water-cover-job.ts`).

### 3. Clipped coincident water source indices keep their own accumulated normals; generated intersections use face normals — PASS
- `waterCoverJob.ts:189` now uses `points.indexOf(p)` (object identity) instead of a
  coordinate `findIndex`. `clipCoverPolygon` pushes the *input* point object for every
  inside vertex (`next.push(a)`), so identity is preserved through all four clip passes;
  intersections are new objects and fall through to `normals.face(...)`.
- Two source indices at one position (the new `water-clipped-coincident-source` case in
  `test-cover-pages.ts` uses duplicated vertex 0/1) therefore map to their own `corners[k]`
  and their own accumulated sums. Test passes.

### 4. Normalized Int8 only for exact axis-aligned normals and semantically exact — PASS
- `pageMesh` scans every normal component for `∈ {-1, 0, 1}` (strict `!==`, so any
  non-axis value disables packing for the whole page and the Float32 attribute is kept).
- Packed as `v * 127` into `Int8Array` with `normalized=true`. three r185 decodes
  `v / 127` → exactly `±1` / `0` (verified by probe). `-0` becomes `0` in Int8, which is
  semantically identical for a normal. Zero-length (degenerate) normals stay `(0,0,0)` as in
  the Float32 path.
- All cover surfaces are horizontal, so accumulated/explicit/up normals reduce exactly to
  `(0,±1,0)` and in practice every page packs; `assertValidPages` asserts this for real data.

### 5. `test-cover-pages` explicit strict TypeScript passes without losing attachment-order assertions — PASS
- The `let root/published` closure-narrowing problem is replaced with a `captured` object;
  the assertions `'root published once'`, `'every page attached in order'`, the per-index
  `position.getX(0) === i` check, `maxAddsPerStep`, `finishSteps` and
  `childrenBeforeFinish` are all still present and exercised for 100/1000/5000 pages,
  streamed and non-streamed. Strict `tsc` exit 0.

### 6. Existing paging findings resolved — PASS
- Coincident-index normal identity (3), Int8 normal assertion in `assertValidPages`, strict
  TS of the page test (5), semantic (`getComponent`) comparison of packed normals/colours in
  the park eligibility and water job tests (positions and indices remain raw byte-equal).
- Stream findings in `2a5b3d0`: overview stock is no longer force-retained in
  `trimResidents`; the "everything else as overview stock" background request is removed;
  decor requests wait (`break`) until their detailed stock exists at the requested detail and
  `build()` rejects a detail mismatch; `test-city-stream.ts` gains the decor/eviction/ring
  assertions and passes. `placeCatalog` duplicate-id fix covered by `test-city-read.ts`.

## Non-blocking notes (no fix required for acceptance)

1. **Boundary-coincident duplicate (behavioural nuance, not a regression in exactness).**
   With identity matching, a source corner lying exactly on a clip edge whose neighbour is
   outside yields the original object *and* an intersection object at the same coordinates
   (`t = 0`). The duplicate takes the face normal while the original keeps the accumulated
   normal. The only triangles touching both are zero-area slivers, so nothing visible
   changes; mentioned for completeness since `findIndex` previously merged these.
2. **Pre-existing Prettier drift in `cityBuilder.ts`** (`roadPtsSteps` signature,
   `shorelinePointSteps` call, `CrossingSpan.pts` type) exists at `9908068` and is not part of
   this delta; ESLint passes. Worth a separate formatting-only commit.
3. The `decor` `break` in `CityStream.drain` is safe because detailed stock is always an
   essential request ahead of it in the queue and an essential failure is fatal, so the
   queue cannot stall silently.
