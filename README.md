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
A separate OpenStreetMap mesh of central London is at `/sim`.

## Checks

```bash
pnpm test:game
pnpm test:sim
pnpm lint
pnpm build
```

`/sim` fetches the compact mesh `public/sim/london.bin` (quantized footprints,
not the raw 136k FeatureCollection). Rebuild that file with `pnpm pack:sim`.
The clean GeoJSON extract stays in `data/` for the clay-board work; refresh it
with `pnpm osm:fetch`. It is not requested on first paint of `/sim`.

## Repo Boundary

This repo is intentionally separate from the main London Startup Map product.
Do not deploy it under `londonstartupmap.com` without product approval.
