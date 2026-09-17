# R6 independent review — `8393133b3b39ff266247348a564e74a475005df3`

Repo: newbie1668/runway-startup-game. Reviewed exact commit `8393133` (superseding `2a5b3d0`; delta from `2a5b3d0` is only `scripts/test-park-cover-eligibility.ts`). Base for comparison: `f941b48`. Scope: CityStream / renderer acceptance findings only. No edits, no commits; probe scripts were written to untracked paths and removed (`git status` clean).

## Verdict: **ACCEPT** (renderer/CityStream scope, CPU-only evidence)

Browser acceptance remains explicitly separate and is not claimed here.

## Findings against the six criteria

### 1. Decor satisfied only by matching-tier resident stock with decoration — PASS
`cityStream.ts` `resident()`:
```ts
if (request.kind === 'decor') {
  const stock = this.stocks.get(request.id);
  return stock !== undefined && stock.detail === request.detail && stock.hasDecor();
}
```
Previously (`f941b48`) `!stock || stock.hasDecor()` treated a missing stock as satisfied and ignored tier. Now an absent or wrong-tier stock is never "resident", so a decor request cannot be silently dropped.

### 2. Decor admission waits for matching stock; build asserts invariant — PASS
`drain()` head-of-line gate:
```ts
if (request.kind === 'decor') {
  const stock = this.stocks.get(request.id);
  if (!stock || stock.detail !== request.detail) break;
}
```
`build()` throws `decor stock detail mismatch` if the invariant is violated. Decor requests are appended last in `update()` (after visible stock, visible cover, prefetch stock/cover, trees), so the `break` cannot starve any other request kind. Detailed stock requests are essential and `resident()` for essential stock requires exact tier match, so the gate always resolves once the visible stock publishes (or the generation is cancelled and the request list reset). `detailedStock = cellsForBounds(city, bounds, 0)` ⊆ `visibleStock` (margin ≥ 0), so the awaited stock is always requested.

### 3. Focused test proves detailed stock gets decoration after idle, incl. replacement after overview — PASS with a noted test gap
`scripts/test-city-stream.ts` asserts `firstStock.children.length > 1` after idle and again for the replacement after the overview tour. Verified via a throwaway probe: the stock group contains exactly one `Mesh` (from `cellStockJob`, `root.add(mesh)`), and the second child is the decor `Group`, so `> 1` does identify decor attachment. Test passes (`Camera streaming, replacement, queue bounds, overview and eviction passed`).

**Gap (non-blocking):** the attached decor group is empty (`[Mesh, Group(0 children)]`). This is expected in Node, not a runtime loss: `scratch.windows`/`scratch.rooftops` are never populated anywhere in `lib/` (windows are emitted in-plane in stock geometry since `50d7d53`; instanced rooftops dropped in `b6bd9bd`), so `createStockDecorJob` only ever emits facade signs, the fixture building (style 1, 0.2 world units) never satisfies `wantSign`, and `buildFacadeSigns` returns `null` when `document` is undefined (`cityBuilder.ts:1756`). Consequently the test proves the decor pipeline runs, is tier-gated and attaches, but cannot detect a regression that produces an empty decoration. Recommended follow-up (not required for this acceptance): assert on the decor job's input rather than DOM output — e.g. a fixture with a `STYLE_RETAIL` building with longest edge ≥ 8 m and an assertion that `scratch.signs.length > 0` reaches the job, or a `document` stub so `buildFacadeSigns` yields a child. Also consider removing the dead `windows`/`rooftops` branches in `stockDecorJob.ts`.

### 4. Place catalog IDs unique; Fitzrovia exactly once with intended framing/search — PASS
`mapSearch.ts` skips `FITZROVIA` in the `AREA_LABELS` loop and pushes a single explicit entry (`id: 'area:FITZROVIA'`, `viewH: 1.92`, projected from `[-0.1358, 51.5196]`, identical to `geo.ts:306`). Runtime check: `placeCatalog()` → 68 hits, one Fitzrovia hit, `searchPlaces('fitzrovia')` → `['area:FITZROVIA']`. `scripts/test-city-read.ts` now asserts catalog ID uniqueness; full script passes (40 checks). At `f941b48` the ID was duplicated (loop + explicit push).

### 5. Axis-normal packing preserves semantics; overview CPU profile < 128 MiB without raising limit — PASS (thin margin)
- `coverGeometry.ts` `pageMesh` packs normals to `Int8Array` normalized (`±127/0`) only when every component is exactly `-1/0/1`; otherwise the Float32 attribute is kept. three.js decodes normalized Int8 as `max(v/127, -1)`, so `getX/Y/Z` return exactly `±1/0` — semantic normals preserved. Tests compare normals through `BufferAttribute` getters (`test-water-cover-job`, `test-park-cover-eligibility`, `test-cover-pages` new coincident-source case), positions/indices remain byte-exact.
- `MAX_RESIDENT_BYTES = 128 * 1024 * 1024` unchanged from `f941b48`; `BACKGROUND_RESIDENT_BYTES` unchanged at 96 MiB.
- `pnpm tsx scripts/profile-city-stream.ts --overview` at `8393133`: visible coverage at frame 3433, 113,563 buildings, 3,233 resident cells, **peak 127.54 MiB**, max drain slice 5.59 ms, no fatal. Same script on a `f941b48` worktree: **fatal `stream:resident-budget`** (exceeds 128 MiB). So the packing is what brings the full overview under budget.
- **Caution:** headroom is 0.46 MiB (0.36 %). Any additional overview geometry (data refresh, extra cover kind, tracker accounting change) will trip the fatal path. This is CPU-only evidence, excludes landmarks/GPU/frame waits, and is not browser acceptance.
- Note: `assertValidPages` in `test-cover-pages.ts` requires `Int8Array` on every page, which holds for the axis-aligned fixtures; real diagonal kerbs will keep Float32 pages by design, so the 48 KiB/page normal figure in the doc comment is an upper bound only for axis-aligned pages.

### 6. No regression in cancellation, eviction, ownership, coverage or ordinary stock — PASS
All focused suites pass on `8393133`: `test-city-stream`, `test-stream-coverage`, `test-stream-resident-store`, `test-cover-cell-job`, `test-cover-job-lifecycle` (6 adversarial), `test-cover-context-ownership`, `test-cell-stock-job`, `test-stock-replacements` (7), `test-city-coverage` (7), `test-tree-cover-job`, `test-road-cover-job` (full binary parity), `test-park-cover-job`, `test-park-cover-eligibility`, `test-cover-clipping` (5), `test-cover-sequence`, `test-street-mark-stream` (142,792 exact dashes), `test-cover-index` (26), `test-water-cover-job`, `test-cover-pages`, `test-city-read` (40). `waterCoverJob.ts` `points.indexOf(p)` replaces the coordinate `findIndex`, fixing normal lookup for distinct source indices at one position (covered by the new `water-clipped-coincident-source` case). ESLint clean on all changed files. Stream test ends with `tracker.bytes() === 0`, `root.children.length === 0`, no material disposal leaks.

## Required fixes
None blocking.

## Recommended follow-ups (non-blocking)
1. Strengthen the decor focused test so it proves decoration *content*, not only group attachment (see §3).
2. Remove dead `windows`/`rooftops` branches in `stockDecorJob.ts` or document that decor is signs-only.
3. Track the 0.46 MiB overview headroom; consider a profile assertion with an explicit margin so future data/cover changes fail loudly before browser runs.

## Environment note
Snapshot build was incomplete; `pnpm install --frozen-lockfile` was run before tests (lockfile unchanged, supply-chain policy passed).
