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
not GeoJSON). Rebuild that file with `pnpm pack:sim` from the local full
extract (`pnpm osm:fetch`). The clay board on PR #22 should use
`data/osm-central-london-simplified.geojson` (hub-to-hub fabric, streets,
Thames, a few MB) — not the 50MB `data/osm-central-london.geojson`, which is
gitignored and never requested on first paint of `/sim`. Rebuild the subset
with `pnpm simplify:sim`.

## Repo Boundary

This repo is intentionally separate from the main London Startup Map product.
Do not deploy it under `londonstartupmap.com` without product approval.
