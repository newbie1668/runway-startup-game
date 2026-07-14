# Shoreditch hub cluster — art pilot brief

Status: **pilot in progress** — style approval gate before remaining seven hubs.

## Style references (mandatory)

| Source | URL | Take |
|--------|-----|------|
| yU+co | https://www.yuco.com/works/silicon-valley | Daytime isometric CG diorama; textured facades; soft shadow; gag density |
| Wired | https://www.wired.com/2016/05/silicon-valley-title-sequence/ | Satirical sight-gags; blink-and-miss-it detail; seasonally refreshed |
| Zach Christy | https://www.zachchristy.com/siliconvalley | Hand-crafted 3D animation; buildings as characters; timelapse energy (static for v1) |

**Do not:** flat `fillRect` prisms, emoji labels, system-font overlays, neon circuit roads, night-mode unless explicitly requested.

**Do:** miniature-city illustration, warm daylight, material texture (brick, glass, cobbles), roof/sign gags, readable silhouettes.

## Pilot hub: Shoreditch

**Game copy:** “The classic. Exposed brick, flat whites, an event every night.”  
**Synergy sector:** Consumer  
**Theme:** `brick-loft` — converted warehouses, courtyard plaza, Brick Lane adjacency

### Cluster layout (engineering slots)

Static art covers **plaza + neutral buildings** only. Player, rivals, and event tents are drawn dynamically on top.

| Slot | Role | Iso offset | Notes for artist |
|------|------|------------|------------------|
| Centre | Player | (0, 0) | Leave readable pad or generic loft shell — overlaid with sector colour + company name |
| East | Rival | (+1.5, −0.35) | Medium brick loft — rival badge overlays |
| West | Rival | (−1.35, +0.45) | Smaller loft |
| SE | Neutral | (+0.75, +1.15) | **Paint in sprite** — purple/indie startup vibe |
| NW | Neutral | (−0.85, −1.05) | **Paint in sprite** — green/social app vibe |

### London gags (moderate whimsy)

- Street sign: **BRICK LN**
- Flat-white / coffee cup on a roof or awning
- Exposed-brick texture, black window frames
- Optional: tiny street art, fixed-gear bike, event poster on wall
- No real company logos — parody startup energy only

### Technical delivery

| Field | Value |
|-------|-------|
| Path | `public/map/hubs/shoreditch.png` |
| Anchor | (0.5, 0.55) — cluster centre slightly above geometric centre |
| Draw size | 9.2 × 7.4 iso tile units (@2x → ~1016×409 px) |
| Background | **Transparent** — composited over map ground |
| Format | PNG, @2x retina |

Metadata lives in `lib/game/sprite-loader.ts` → `HUB_SPRITE_META.shoreditch`.

## Approval checklist

- [x] Reads as **Silicon Valley title diorama**, not programmer art
- [x] Distinct from other hubs at city zoom (brick lofts, low-rise cluster)
- [x] Neutral buildings painted in; player/rival slots still work when overlaid
- [x] Tap targets unchanged (`scripts/test-iso-map.ts`)
- [x] Product sign-off → rolled out to all eight hubs

## Remaining hubs (after pilot)

| Hub | Silhouette | Gag direction |
|-----|------------|---------------|
| King's Cross | Campus blocks, St Pancras adjacency | AI / talent |
| Soho | Narrow terraces | Media / creative |
| Farringdon | Warehouse conversions | DevTools / rail |
| Canary Wharf | Glass towers, tallest cluster | Fintech |
| London Bridge | Riverside low-rise | Borough / food |
| Camden | Market stalls, scruffy low-rise | Consumer / music |
| Battersea | Industrial / power station | Climate / hardware |
