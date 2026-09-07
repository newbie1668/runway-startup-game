# RUNWAY Startup Game

This is a standalone experimental repo for the RUNWAY startup game.

## Current recovery plan

For the owner-confirmed faithful virtual London reconstruction in Three.js, start at
[`docs/runway-recovery/README.md`](docs/runway-recovery/README.md). It links
the product contract, source audit, architecture, task plan, verification
gates and agent handoff, including real ordinary-building and tree/sign fidelity.
Read the linked F0–F6 reconstruction track as well as runtime recovery.
Preserve the existing game. Workers execute only
their assigned task on an exact accepted commit; the tech lead owns scope
and integration. The planning PR does not certify the map as complete.

Earlier plans under `docs/plans/` are historical context where they conflict
with the current recovery product contract. Keep the constraints below.

Keep it separate from the main London Startup Map repo and domain for now:

- Main product URL: `https://londonstartupmap.com/`
- Game route in this app: `/game`

Do not deploy or attach this app to `londonstartupmap.com` without explicit
product approval.

Prefer small, verified changes. Run `pnpm test:game`, `pnpm lint`, and
`pnpm build` before saying a change is done. Run `pnpm test:ui` too when
touching anything under `components/game/` or `lib/game/`.

## 3D map

The map is a procedural 3D city built from OpenStreetMap data
(`lib/game/render3d/`), with the original 2D canvas renderer
(`lib/game/render.ts`) kept as the automatic fallback. `public/map/london-city.bin`
is generated but committed — regenerate it with
`pnpm tsx scripts/fetch-geodata.ts` (`--verify` decodes the committed file
with no network) after changing the pipeline or the `geo.ts` bbox. Landmark
GLBs in `public/map/landmarks/` are generated with `pnpm bake:landmarks`
after changing `lib/game/render3d/landmarks.ts`. Noticed-tower GLBs in
`public/map/noticed/` are generated with `pnpm bake:noticed` (Wikimedia
thumbnails + feature silhouettes + Blender or the three.js baker — bake time
only, never at play time). Debug
params on `/game`: `?map=2d`, `?map=3d`, `?map=debug` (exposes
`window.__runwayForceContextLoss()`), `?chrome=0`, `?look=<landmark>`,
`?view=wide|mid`. The 3D map’s glass HUD searches committed place names only. three.js is only ever reached via a
dynamic `import()` inside `lib/game/render3d/factory.ts` — never add a
static import of `three` or anything under `render3d/` outside that
boundary, or it will leak into the SSR path that `pnpm test:ui` exercises.
