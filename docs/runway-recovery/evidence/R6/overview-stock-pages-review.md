# Independent review — overview stock pages (PR #30)

Base `0e3a314` → frozen candidate `9867e31` → correction `b4e90c3`
(`origin/devin/1789948671-overview-stock-pages`).

Read-only review in detached worktrees `/Users/devin/review-9867e31` and
`/Users/devin/review-b4e90c3`. No source, test, branch, PR, deployment or browser action.
All numbers below are CPU-only source probes and are **not** native-browser acceptance evidence.

## Verdict

**Accept the source, conditional on one small correction (F1) and one disclosure (D2).**

- The two known corrections are properly fixed in `b4e90c3`, verified independently (§1).
- No additional blocking correctness, ordering, identity, coverage or ownership defect was found.
- One verified ownership defect (F1) survives from base and is amplified by the new tile path.
- One introduced, bounded behavioural regression (D1) and one measurement gap (D2) are
  documented below; neither blocks integration, but D2 qualifies the 128 MiB claim.

## 1. The two known corrections (verified fixed)

| Known issue | Verified state at `b4e90c3` |
| --- | --- |
| Oversized single-cell pages bypassing the tile `Uint16`/index bounds | Fixed. `createStockPagesJob` gains `split` (overview/tile only): a cell that cannot fit an empty page is divided at **building** boundaries into consecutive bounded `Uint16` pages. Ran `scripts/test-cell-stock-job.ts`: the synthetic oversized cell now yields `['0,0','1,0'] / ['2,0'] (64,538 v) / ['2,0','3,0']`, all `Uint16`, all ≤ caps, with every vertex of the legacy `Uint32` output preserved. |
| Transition peaks above 128 MiB | Fixed by trimming outside the new retain rings at `update()` instead of only at settle. Mechanism reproduced independently (§D1 A/B: the eviction now happens at the update that starts the transition). Worker's real-data peaks 49.1 / 17.8 MiB. |

Independently rerun at `b4e90c3` (all exit 0): `test-cell-stock-job`, `test-city-stream`,
`test-stock-draw-ranges`, `test-stream-resident-store`, `tsc --noEmit`.

Independently reproduced real-data profile (`--overview --draw-ranges`, my run used the
script default `--cover-cell=400`, so its 127.54 MiB plateau is not comparable to the
worker's production-configured 122.62 MiB): stock shape identical to the worker's —
124 stock calls, 1,338,712 triangles, 113,563 buildings, 105 tiles / 124 pages,
**maxPageVertices 65,268, maxPageIndexBytes 172,080**. Both caps are respected on committed
data *before* the fix, i.e. the page-splitting correction is preventative, not a live bug fix.
Confirmed the worker's `--cover-cell=1600` matches production (`CityRenderer3D.ts`,
`createCoverIndexJob({ cellSizeM: 1600 })`), so 122.623495 MiB is the right plateau figure.

## 2. Findings

### F1 — Low/Medium, **verified**, pre-existing pattern replicated and amplified by the tile path

A throwing host eviction callback leaves evicted groups permanently parented to the scene root
with their geometry already released.

*Location:* `lib/game/render3d/cityStream.ts`, `publishStock` → `resident.dispose()`
(`onStockEvicted(ready.scratch.picks)` is called **before** `ready.group?.removeFromParent()`;
the `finally` block only clears scratch and calls `release()`), and the identical ordering
copied into the new `publishTile` → tile `dispose()`. Base `0e3a314` has the same ordering for
the single-cell case, so the pattern is pre-existing; the tile cutover multiplies the blast
radius from 1 group to all 16 member groups at once.

*Reproduction* (`/Users/devin/probes/probe-callback.ts`, 8×8-cell synthetic city, zoom in to
per-cell residents, then zoom out so `publishTile` evicts them, with `onStockEvicted` throwing):

```
{"before":{"children":16,"bytes":38496},"fatals":["tile:tile:0,0"],
 "rootChildren":17,"orphanedPerCellGroupsStillInScene":16,
 "trackedBytes":7296,"picks":16}
dispose threw: City stream disposal failed
{"afterDisposeRootChildren":17,"afterDisposeBytes":0}
```

All 16 groups stay in the scene next to the freshly published tile page (the same buildings
drawn twice), their geometry is disposed by `release()` while still attached, and
`CityStream.dispose()` never detaches them because the resident was already removed from the
store and its `disposed` flag is set. Identical on `9867e31` and `b4e90c3`. Exactly-once
disposal itself holds — only the detach is skipped. Mitigated in practice: the aggregated error
reaches `onFatal`, which tears the 3D renderer down to the 2D fallback, and the production
callback is a one-line beam clear.

*Smallest correction* (both sites): detach before notifying, i.e. move
`ready.group?.removeFromParent()` above `onStockEvicted(...)`, or wrap the callback
`try { onStockEvicted(picks); } finally { ready.group?.removeFromParent(); }`.
A decisive test exists for the job-level publish throw but not for a throwing host callback
on the resident path.

### D1 — Low, **introduced by `b4e90c3`**, verified, bounded

Moving the trim to `update()` drops useful old coverage when a zoom is reversed within the
first few frames — one of the stated acceptance behaviours ("retained useful old coverage under
cancellation, reversed zoom").

*Location:* `cityStream.ts` `update()` now calls `trimResidents()` (was `reconcile()`);
`trimResidents()` evicts everything outside the **new** plan's `retainStock`
(bounds + 1600 m) immediately, before any of the new coverage exists.

*A/B* (`/Users/devin/probes/probe-reversal.template.ts`, 16×8 cells / 512 sources, wide →
one far-corner cell → wide, reversed after `hold` frames; same probe against both commits):

| hold frames | 9867e31 exposed after reversal | frames to restore | b4e90c3 exposed | frames to restore |
| --- | --- | --- | --- | --- |
| 0 | 512 (all) | 0 | 256 | 15 |
| 1 | 512 (all) | 0 | 256 | 15 |
| 4 | 232 | 18 | 232 | 18 |
| 16 | 232 | 18 | 232 | 18 |

So the change costs retention only inside a ≈3-frame window, after which both commits behave
identically; coverage is always fully restored, with no fatals and no leak. The new view itself
is never uncovered, structurally: `retainStock ⊇ visibleStock` and a tile is retained when **any**
member cell is retained. I consider this an acceptable trade for the memory fix, but it is a
real change to the stated behaviour and should be recorded rather than assumed absent.

### D2 — Low/Medium, **measurement adequacy** (verified mechanism, estimated magnitude)

`CityStream.stagingBytes` counts only stock/tile jobs (registered in `this.staging` in `build()`)
plus one draw-range scratch index. **Cover, tree and decor jobs are never registered**, so their
in-flight geometry is excluded from every "resident + staging" number, including the profile's
`peakCombinedBytes` guard that throws above 128 MiB.

This matters specifically at the plateau the parent asked about: in my real-data profile the
**entire tail of the overview build is cover jobs** while resident geometry is at its maximum —
e.g. consecutive samples `stream:1:cover:57,25` … `stream:1:cover:57,26` at 127.47 → 127.53 MiB
(my `--cover-cell=400` run). The worker's "peak resident + staging = 122.623 MiB (staging peaks
occur far below the resident plateau)" is therefore consistent with, but not evidence against,
uncounted cover staging exactly at the plateau. Magnitude is an **estimate, not verified**: stock
pages dominate the 122.62 MiB total, so cover staging is likely ≲ 1–2 MiB against 5.4 MiB of
headroom.

*Smallest correction:* either register cover/tree/decor jobs in the same `staging` map (they
already expose their own staged geometry lifetime), or state explicitly in the report and in the
`stagingBytes` doc comment that the figure excludes cover/tree/decor staging, so the 128 MiB
claim is not read as total.

### D3 — Informational, verified

`stagingBytes` is observability only. `trimResidents()` still gates on `tracker.bytes()` alone
and the background-request gate still uses `tracker.bytes() >= BACKGROUND_RESIDENT_BYTES`; only
`scripts/profile-city-stream.ts` throws on the combined figure. Consistent with the parent's
caveat — noted so no one treats combined bytes as enforced at runtime.

### D4 — Low, introduced, verified unreachable on committed data

With `split`, a single building that alone exceeds a page cap now throws
(`building … exceeds page bounds`). For an essential tile request that failure reaches `onFatal`
and drops the whole map to the 2D fallback, where `9867e31` would have emitted a `Uint32` page
instead. Measured on the committed dataset: 113,569 buildings, mean footprint 6.8 points,
**max 152 points** (≈ 840 vertices, 1.3 % of the 65,535 cap). Unreachable today; recording it as
residual risk only — no change requested.

## 3. Checked and found sound (no defect)

- **Multi-page tiles end to end.** `9867e31`'s focused stream test never drives a tile with more
  than one page. Probe `/Users/devin/probes/probe-multipage.ts` (3,216-building tile → 2 pages,
  61,600 + 8,800 vertices, both `Uint16`) passes on both commits: page `cellIds` partition the
  tile, no source exposed twice, picks == exposed sources, `stockBuildings` consistent, hidden
  members never visible while the tile is exposed, tile dissolves and re-forms, and the round
  trip returns to byte-identical steady state with `tracker.bytes() == 0` after dispose. Same
  with a fully excluded member cell (`--exclude`).
- **Split pages and cell identity.** A split cell appears in more than one page's
  `mesh.userData.cellIds`, but `TileResident.cellIds` uses `ready.cellIds` (unique), so
  `tileCoveredCells`, `residentCells`, eviction and hidden staging are unaffected.
- **Draw-range staging accounting.** `StockDrawRanges.stagingBytes` returns the active stamp's
  index byteLength, numerically identical to the job's `sameLength` scratch copy; bounded by the
  256 KiB cap, 0 when idle, no double count against the tracker.
- **No test weakening.** The delta replaces "pages cover every cell exactly once" with a strictly
  stronger set: consecutive-run partition, per-page cell uniqueness, a proof obligation that a
  cell is split *only* when it overflows an empty page, full concatenated position / packed
  normal / packed colour / rebased-index parity against the unchanged single-cell path, and a
  per-step `stagingBytes() == live job geometry` invariant with a monkey-patched geometry census.
- Store generation/stale-publication semantics, attach-before-insert, evict-before-dispose,
  hidden-replacement exclusion from picks/`buildingMeshes`/counts, and `staging` map cleanup on
  completion, failure, `cancelPending()` and `dispose()`.

## 4. Pre-existing, not introduced

- Slice overruns above the 4 ms target exist on both sides (worker: base max 6.72 / 15.44 ms,
  candidate 5.45 / 10.95 ms; my `--cover-cell=400` run 16.3 ms). Candidate is no worse.
- F1's callback-ordering pattern (single-cell form) is in base.
- Per-cell overview jobs still keep the legacy `Uint32` path for an oversized single cell
  (`split: false`); unreachable on committed data and out of scope for the tile bound.
