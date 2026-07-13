# Map sprites

Hub cluster PNGs for the isometric map. Drop files here to override procedural canvas art.

## Layout

```
public/map/hubs/shoreditch.png
public/map/hubs/kingscross.png
... (all eight hubs)
```

Metadata (anchor, draw size) lives in `lib/game/sprite-loader.ts` as `HUB_SPRITE_META`.

When PNGs are absent, the renderer draws illustrated procedural buildings via `lib/game/iso-draw.ts`.

Regenerate sprites after art changes:

```bash
pnpm bake:map
```
