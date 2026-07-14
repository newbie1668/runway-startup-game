# Isometric map — art style guide

Target: **Silicon Valley HBO title sequence** (yU+co), adapted for daytime London.

## References

- [yU+co — Silicon Valley](https://www.yuco.com/works/silicon-valley) — primary visual target; browse season stills
- [Wired — title sequence](https://www.wired.com/2016/05/silicon-valley-title-sequence/) — dense gags, satire, always refreshing
- [Zach Christy — SV opening](https://www.zachchristy.com/siliconvalley) — isometric CG diorama, timelapse growth metaphor

Local comparison (grilling): `.scratch/isometric-london-ui/assets/isometric-style-comparison.png` — **ILLUSTRATED** panel is the direction; **GEOMETRIC** panel is rejected.

## Do

- **Illustrated CG diorama** — crafted miniature city, not flat vector or canvas primitives
- **Daytime palette** — warm sky, soft ambient shadow, saturated natural colour
- **Textured facades** — brick, glass, painted signage, window depth
- **Per-hub character** — distinct silhouettes (Canary towers vs Camden low-rises vs Shoreditch brick lofts)
- **Moderate whimsy** — roof gags, London easter eggs, startup parody signage; readability over gag density
- **Pre-rendered PNG sprites** — composited via `drawImage`; metadata in `lib/game/sprite-loader.ts`

## Don't

- Procedural `fillRect` buildings passed off as final art
- Dark neon / circuit-board “geometric” look
- Emoji-as-architecture
- System-font labels baked into sprites (hub names via UI/tooltip/card only)
- Night-time twinkle palette (legacy map)

## Asset tiers

| Tier | Description |
|------|-------------|
| **Illustrated** | Hand-crafted or CG-rendered hub cluster PNG; player/rival as overlays |
| **Procedural fallback** | Canvas-drawn placeholders when PNG absent or hub not yet illustrated |

## File layout

```
public/map/hubs/{hubId}.png   # @2x hub cluster sprite
docs/art/{hubId}-brief.md     # per-hub gag list + layout notes
```

## Zoom tiers (Google / Apple Maps LOD)

| Relative zoom | Level | What you see |
|---------------|-------|--------------|
| &lt; 1.1× fit | City | Flat coloured pins on the continuous map (footprints) |
| 1.1–1.35× | District | Slightly larger pins, labels appear |
| 1.35–1.65× | Neighbourhood | Isometric plazas + procedural buildings fade in |
| &gt; 1.65× | Street | Full illustrated hub sprites |

Logic: `lib/game/map-lod.ts`
