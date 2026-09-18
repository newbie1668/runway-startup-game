# R4 pure coverage index

Reviewed implementation `e92162b` plus correction `7d22e98`, integrated as `5bce958` and `d02d23d`. The helper assigns all 113,569 committed buildings to 1,609 owner cells, using the arithmetic mean of footprint vertices to match the existing renderer's centroid convention. Cells start at 400 m and expand to include their owned footprints, so a building crossing a cell boundary remains selectable without being owned twice.

C3's pure `indexCity`, `cellsForBounds` and `coverageDelta` are implemented with deterministic ordering, world-coordinate bounds, explicit metre conversion, inclusive overlap and input validation. Fixtures cover empty data, negative query coordinates, portrait selection, padding, malformed footprints, cell-size underflow and full-binary ownership. No decoded data is mutated and no Three.js/DOM dependency was added.

Worker focused tests, TypeScript, lint and diff checks passed. The [independent review](review.md) accepted the bounded correction. Final combined app gates are recorded with the R5a-0 integration checkpoint. This index is not yet connected to runtime cell loading or eviction; its approximately 91 ms construction time is not a rendered-performance measurement.
