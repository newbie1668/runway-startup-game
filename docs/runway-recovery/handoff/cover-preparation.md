# R5b cover packet preparation

Source inspection at c4831b0, 9 September 2026. Not a dispatched implementation card. Read r5b-cover-inventory.md for call graph.

Committed data decoded read-only: roads 56,793 records / 147,990 vertices / maximum 96 at original index 10022; parks 769 / 15,840 / maximum157 at274; water62 /3,720 /maximum577 at41. This records input sizes, not timing.

Existing full/visible park-grid and road generation have measured long synchronous calls in R1/R5a-0/R3b evidence. Wrapping their current full calls inside BuildJob.step would not meet C4. A single park needs a resumable grid cursor; water triangle and bank polyline scans, road run emission, and tree placement need bounded units. Preserve full immutable CityData for water predicates/crossing cache and retained-record RNG semantics. Do not invent subset wrappers that recompute global crossing context per cell.

Current buildMergedPolyMesh with keep discards a triangle whenever any vertex is outside the disk. A new bounded cover emitter must cover requested bounds even where a source polygon spans the view and its vertices lie outside. Rectangle clipping / conservative selected triangles need their own crossing-boundary fixtures; only testing vertices inside bounds could hide missing coverage.

C3/C5 require cover at the same camera coverage as stock. C4 permits a later deterministic coarse bake only after measured runtime coarse generation fails; no new pipeline is currently unlocked. Global cheap stock estimate151,566,228bytes (not generated-output measurement) already exceeds proposed128MiB ceiling before cover/heroes; measure actual full eligible overview buffers before deciding its resident representation. Existing fullcity B1 remains red. Do not assume densest-cell saving alone proves a city budget.

Next acceptance before dispatch: finish R5b-3 cleanup review, corrected-source cell profile and combined app gates; record actual limits. Then decompose cover, retaining material ownership, deterministic output and ordinary road/park/water continuity. No runtime/art changes have been assigned by this preparation note.

Post-accounting note: compact storage is being implemented because actual full overview sums186.12MiB, not the earlier151MB estimate. It preserves1609 nonempty owner-cell meshes; if all are visible simultaneously, that is above the proposed300drawcall typical-view ceiling beforecover/heroes. This is a planning implication of meshcount, not a measured browser drawcall result. R6 must measure actual visible cells/drawcalls and decide spatial aggregation only if evidence requires it; do not silently raise budgets or let helper acceptance certify fullview readiness.
