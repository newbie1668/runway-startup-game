# RUNWAY

RUNWAY is a standalone preview app for the London startup strategy game.

It is a separate experiment from [London Startup Map](https://londonstartupmap.com/),
so the game can continue without adding `/game` to the main product codebase.

## Local Development

```bash
pnpm install
pnpm dev
```

The game route is `/game`. The root route redirects there.

## Checks

```bash
pnpm test:game
pnpm lint
pnpm build
```

## 3D Map

The `/game` map is a procedural 3D city (buildings, streets, parks, water,
landmarks) built from real OpenStreetMap data, with the original 2D canvas
map kept as an automatic fallback (no WebGL2, low device memory, context
loss, or a failed data fetch all fall back cleanly).

`public/map/london-city.bin` (+ `.stats.json`) is generated but committed —
the shipped game only ever fetches it as a same-origin static asset and
never talks to Overpass at runtime. To regenerate it after changing the
pipeline or the `geo.ts` bbox:

```bash
pnpm tsx scripts/fetch-geodata.ts            # full fetch + process + write
pnpm tsx scripts/fetch-geodata.ts --verify   # decode the committed .bin, no network
```

Debug query params on `/game`:

- `?map=2d` — force the 2D canvas map.
- `?map=3d` — force the 3D map, overriding a prior fallback for this session.
- `?map=debug` — 3D map, plus exposes `window.__runwayForceContextLoss()` in
  devtools to exercise the 3D → 2D fallback path on demand.

## Repo Boundary

This repo is intentionally separate from the main London Startup Map product.
Do not deploy it under `londonstartupmap.com` without product approval.
