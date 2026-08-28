# London building factory (SFSIM-style, bake-time)

**Goal:** Neighbourhoods that read cream / brick / terracotta / glass from real data, plus unique low-poly meshes for the skyline the camera actually looks at — all committed, no runtime APIs.

## What the X post did

Two stacked systems, then a big number:

1. **Whole city** — Three.js from public geospatial data (footprints, streets, parks). 174,647 buildings is a footprint count, not a Blender-file count.
2. **Noticed buildings** — address → photos → “what stands out” → Devin drives Blender → drop the mesh on the real footprint. The collage is a tray of the ones you notice. [sfsim.net](http://sfsim.net) is a hosted sim with live APIs; we cannot call Exa or Blender when someone opens `/game`.

## What we ship

**Layer 1 — whole city (~113k):** Pack OSM `building:colour` / `building:material` / `roof:colour` / `roof:material` into `london-city.bin` (format v2). Runtime uses those paints; hashed palettes remain the fallback.

**Layer 2a — hand silhouettes:** Distinctive landmarks (Shard, Walkie, Gherkin, 22 Bishopsgate, Heron, Tower 42, …) stay procedural builders baked to `public/map/landmarks/`. Unique massing, not photo-extruded boxes.

**Layer 2b — noticed factory:** Named OSM towers ≥100 m that are *not* already landmarks. Bake-time Wikimedia thumbnail → dominant colours → Blender extrudes the real footprint (podium / shaft / crown + window grid) into `public/map/noticed/`. Runtime `fetch('/map/noticed/...')` only.

**Not in v1:** Exa, Devin, 113k unique GLBs, live Mapbox/Cesium, calling Wikipedia at play time.

## Regen

```
pnpm tsx scripts/fetch-geodata.ts   # cache; no Overpass unless miss
pnpm bake:landmarks
pnpm bake:noticed                   # needs Blender + Wikimedia
```
