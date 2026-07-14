# Map sprites

Hub cluster PNGs for the isometric map.

## Illustrated hubs (Silicon Valley diorama style)

| Hub | Status | Brief |
|-----|--------|-------|
| Shoreditch | **Pilot** | `docs/art/shoreditch-pilot-brief.md` |
| Others | Placeholder | Procedural bake until illustrated |

Illustrated hubs are listed in `lib/game/sprite-loader.ts` → `ILLUSTRATED_HUBS`. The renderer draws the PNG as the cluster and overlays player/rival markers only (no procedural buildings on top).

## Layout

```
public/map/hubs/shoreditch.png   ← illustrated pilot
public/map/hubs/kingscross.png   ← procedural placeholder (re-bake or replace)
...
```

Metadata (anchor, draw size) lives in `lib/game/sprite-loader.ts` as `HUB_SPRITE_META`.

## Regenerate procedural placeholders

```bash
pnpm bake:map
```

Does **not** overwrite hand-illustrated hubs in `ILLUSTRATED_HUBS` once we add bake guards — for now, avoid re-baking Shoreditch after the pilot lands.

## Art references

- https://www.yuco.com/works/silicon-valley
- https://www.wired.com/2016/05/silicon-valley-title-sequence/
- https://www.zachchristy.com/siliconvalley
