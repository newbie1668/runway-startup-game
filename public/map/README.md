# Map sprites

All eight hub clusters use **illustrated PNG sprites** in Silicon Valley diorama style (see `docs/art/style-guide.md`).

## Layout

```
public/map/hubs/{hubId}.png   # @2x hub cluster sprite
docs/art/sources/{hubId}-source.png   # full-res source before crop
```

Metadata (anchor, draw size) → `lib/game/sprite-loader.ts` → `HUB_SPRITE_META`.

Illustrated hubs → `ILLUSTRATED_HUBS` — renderer draws PNG + player/rival overlays only.

## Add or replace a hub sprite

1. Create source art (1536×1024 or similar, 16:9)
2. Process to sprite dimensions:

```bash
pnpm process:hub-sprite shoreditch path/to/source.png
```

3. Add hub id to `ILLUSTRATED_HUBS` in `sprite-loader.ts` if new.

## Procedural fallback (dev only)

```bash
pnpm bake:map
```

Skips hubs in `ILLUSTRATED_HUBS`.
