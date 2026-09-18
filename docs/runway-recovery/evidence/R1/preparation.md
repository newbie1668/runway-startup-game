# R1 preparation at b8724e4 (source unchanged by R2)
Lead preparation for the next task, not a worker assignment. Finalize the reporter API and exact accepted start SHA before dispatch; no Foo decision is required. R2 does not change these renderer sources.

Observed source seams:
- MapCanvas owns createMapRenderer result, RAF, onFatal camera handoff, and fireReady. 2D fireReady currently occurs before the first canvas frame.
- factory.ts chooses explicit2D/session fallback/WebGL2/memory then dynamically imports CityRenderer3D and forwards opts. R1 callback options require an explicit factory.ts ownership allowance; do not bypass typing or widen IMapRenderer just to avoid editing the boundary.
- CityRenderer3D BuildJob currently has only kind/run. enqueue centralizes most work; IDs and essential classification belong here. Water/parks/roads + stock chunks are essential; tree/decorative/hero work needs separate optional classification even when current kind=cover.
- drainBuildQueue catches and discards errors and calls markReady when queue empty, before renderer.render. This cannot satisfy C1 useful frame. Keep errors and mark readiness after useful essential content is rendered. Empty stock must not qualify.
- CityScratch.picks is appended per emitted stock building in cityBuilder around1448; investigate whether its length after successful chunk attachment is a precise stock count before choosing a nullable counter. It is not an OSM source identity registry.
- C1 residentCells refers to R4 cells that do not exist yet. Keep it explicitly unknown until R4; do not claim current chunks are those cells. C1 currently requires numbers, so update the proposed type/meaning before dispatch. No runtime API has yet been published.
- C1 initial actual mode is likewise unmeasured before factory selection; distinguish pending from requested3D. A null mode before selection is preferable to fabricated3D.
- Unique buffer accounting must handle index, regular/interleaved attributes and morph buffers; update on attachment/disposal, not per frame. Counts are geometry array bytes, never total GPU memory. R3 later owns full resource lifetime.
- Preserve pending mesh queue ordering/build shapes in R1; do not sneak R5 scheduling changes into telemetry. First establish which jobs block readiness and how long.

Next lead decision: compact pure reporter/state/accounting API with null unknown measurements and explicit generation guards; then a separately serialized renderer/factory/canvas hookup. Bind errors latest20 + total, first useful frame definition and essential stock/cover classification. Browser qa=1 bridge absent otherwise, retain debug context-loss control.

## Adjacent navigation finding for R6 / pilot handoff

R2 browser inspection confirmed `searchPlaces("Fitzrovia")` returns no results in the unchanged offline catalogue, although the R0 B6 tour expects it. The pure catalogue includes Farringdon as a unique hub and live selection works. Preserve the B6 Fitzrovia case as open; issue a separate source-backed catalogue/navigation fix before claiming a pilot tour. R2 checks existing search behavior using Farringdon and does not change catalogue content.
