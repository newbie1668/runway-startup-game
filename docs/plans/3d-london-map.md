# SFSIM-style 3D London Map for RUNWAY

> **This plan is a self-contained execution spec for an AI agent (e.g. Sonnet 5) in a fresh session.** Follow it phase by phase. Every phase ends with a verification gate — do not start the next phase until the gate is green. Commit at each gate. Do not improvise art direction or architecture beyond what is specified.

## Context

RUNWAY (`/Users/foomingli/Documents/runway-startup-game-1`) is a London startup tycoon game: Next.js 16 App Router, React 19, TypeScript strict, Tailwind v4, pnpm, Turbopack. Its map today is a hand-drawn **Canvas 2D** night map of central London (`lib/game/render.ts` + `lib/game/geo.ts`).

The user wants the map upgraded to look like **SFSIM** by X user @davidfromkansas ([post](https://x.com/davidfromkansas/status/2090527548157669715)): a Three.js 3D night city **procedurally generated from public geospatial data** — real OSM building footprints extruded to height, real streets and parks (his SF version: 174,647 buildings, 15,923 street segments, 252 parks) — with a dark, glowing, tilted-camera aesthetic.

**Locked decisions (from the user — do not revisit):**
1. **3D city map only.** No live data feeds, no synthetic citizens, no transit animation. **Game mechanics must not change at all.**
2. **Landmarks are procedural Three.js geometry written in code.** No Blender, no external AI services, no downloaded models.
3. **The existing 2D canvas map stays as an automatic fallback** (WebGL unavailable / weak device / context loss). 3D is the default.

**Hard constraints:**
- Do NOT change `lib/game/engine.ts`, `lib/game/content.ts`, `lib/game/rng.ts`, `lib/game/audio.ts`, or Sidebar/Modal semantics. `lib/game/geo.ts` and `lib/game/types.ts` may receive **additive** changes only.
- No Mapbox, no API tokens, no runtime third-party fetches in the shipped game — all geodata is preprocessed offline and committed. The built game must work fully offline.
- SSR safety: `pnpm test:ui` runs `renderToStaticMarkup(<GameApp/>)` in Node — nothing may touch `window`/`document`/WebGL at module scope. Load three.js via dynamic `import()` only.
- AGENTS.md requires `pnpm test:game`, `pnpm lint`, `pnpm build` green before calling any change done. Run `pnpm test:ui` too at every gate.
- Mobile matters: map pane is 44dvh on mobile; recent commits were mobile QA fixes.

## Verified ground truth (as of commit `1145af5`)

- **World space** (`lib/game/geo.ts:19-36`): bbox LON −0.265..0.065, LAT 51.452..51.552; `LAT_COS ≈ 0.6226`; `WORLD.width ≈ 205.5`, `WORLD.height = 100` world units. `project([lng,lat])` maps lng→x (east+), lat→y (**south is +y**, y grows downward). 1 world unit ≈ 111.32 m. Add `export const METERS_TO_WORLD = 1000 / 111320;` to `geo.ts` (additive).
- **Renderer public surface** (`lib/game/render.ts`, class `MapRenderer`), used by the app: fields `scene`, `hover`; methods `resize()`, `fitAll()`, `focusHub(hubId, zoom?)`, `frame(t, dt)`, `pan(dxPx, dyPx)`, `zoomAt(sx, sy, factor)`, `hitTest(sx, sy)`, `burstConfetti(hubId|null)`, `floatText(hubId|null, text, color?)`, `puffSmoke(hubId|null)`, `sparkle(hubId|null)`. Types `Scene`, `SceneRival`, `SceneEvent`, `HitTarget` at `render.ts:38-67`. Camera is `{x, y, zoom}` in world units; zoom = px per world unit; `maxZoom = 26`; camera clamped to WORLD ± 25%.
- Only `components/game/MapCanvas.tsx` (value import) and `components/game/GameApp.tsx` (type-only) import from `render.ts`.
- **Engine↔visual contract**: engine pushes `FxEvent`s; `GameApp.runFx` (`GameApp.tsx:150-179`) calls the four particle methods + sfx. Keep this pipeline working unchanged.
- **Hubs** (`lib/game/content.ts`): shoreditch (−0.081, 51.526), kingscross (−0.124, 51.533), soho (−0.135, 51.513), farringdon (−0.105, 51.52), canarywharf (−0.019, 51.505), londonbridge (−0.086, 51.503), camden (−0.142, 51.539), battersea (−0.144, 51.48). `HUB_POS` precomputed in `render.ts`.
- **Landmarks** (`geo.ts:277-292`): kinds `eye | shard | bigben | bttower | stpauls | o2`. **Gherkin and Tower Bridge are missing — add them (additive).**
- `geo.ts` also exports `THAMES`, `PARKS`, `TUBE_LINES` (real TfL colours), `AREA_LABELS` — reuse `TUBE_LINES` in 3D.
- **`scripts/test-ui.tsx:50-52`** locates the map pane via `html.indexOf('<canvas')` then `lastIndexOf('<div class="', canvasAt)`. **This breaks when MapCanvas gains a wrapper div — fix it in the same commit (Phase A6).**
- `.gitignore` blocks only root-level image files — `public/map/*.bin` commits fine. No `public/` dir exists yet; create it.
- Deps today: only next/react/react-dom.

## Architecture

```
components/game/MapCanvas.tsx        — two stacked canvases + async factory + shared input/rAF loop
lib/game/scene.ts          (NEW)     — Scene types, HitTarget, SECTOR_COLORS, CameraState, IMapRenderer
lib/game/overlay.ts        (NEW)     — MapOverlay: pins/labels/tooltips/particles/hitTest/vignette (camera-agnostic)
lib/game/render.ts         (MOD)     — MapRenderer (2D fallback) = background painter + MapOverlay
lib/game/render3d/
  ├── CityRenderer3D.ts    (NEW)     — implements IMapRenderer; three.js city + MapOverlay on 2D canvas
  ├── cameraRig.ts         (NEW)     — {x,y,zoom} ↔ PerspectiveCamera; ground unproject; fit math
  ├── cityBuilder.ts       (NEW)     — decoded data → chunked BufferGeometries (buildings/roads/parks/water)
  ├── landmarks.ts         (NEW)     — 8 procedural landmark Groups keyed by LandmarkKind
  ├── textures.ts          (NEW)     — CanvasTexture generators (windows, diagrid, glow sprite)
  ├── factory.ts           (NEW)     — createMapRenderer(): 3D-with-fallback decision + dynamic import
  └── format.ts            (NEW)     — binary codec (encode used by script, decode at runtime; pure TS, no DOM)
scripts/fetch-geodata.ts   (NEW)     — one-time Overpass pipeline → public/map/london-city.bin
public/map/london-city.bin (NEW, committed)  + london-city.stats.json
```

**Key decision — the overlay canvas.** All game-facing 2D chrome (hub markers, shield pins, event/rival pins, player pin + company label, tooltips, area labels, particles, vignette) is extracted from `MapRenderer.frame()` into a camera-agnostic `MapOverlay` class drawing on a plain 2D canvas, given a `Projector` function `(worldPoint) => {x,y} | null`. The 2D renderer passes its affine projector; the 3D renderer passes "project ground point through the three.js camera". Consequences: `hitTest`/pin layout stay **screen-space circle checks — zero raycasting for game logic**, pixel-identical in both modes; all four particle methods and the FxEvent pipeline work unchanged in 3D. The WebGL scene contains ONLY the city (ground, water, parks, roads, buildings, tube ribbons, landmarks, hub glows, fog) — no text, no pins, no particles.

**Camera model.** The logical camera stays `{x, y, zoom}` so `pan`/`zoomAt`/`fitAll`/`focusHub`/clamp semantics carry over. Three.js mapping (in `cameraRig.ts`): ground plane = XZ, world `(x, y)` → three `(x, 0, y)` so north = −Z.

```
FOV = 45°
pitch(zoom) = lerp(64°, 38°, clamp01((zoom − minZoom) / (18 − minZoom)))   // top-down far, cinematic near
dist        = cssH / (2 · zoom · tan(FOV/2))                                // exact px/world-unit at target
target      = (cam.x, 0, cam.y)
camera.pos  = target + (0, dist·sin(pitch), dist·cos(pitch))                // camera south of target, looking north
camera.lookAt(target)
```

- `worldToScreen(p)`: `Vector3(p.x, 0, p.y).project(camera)` → `{x:(v.x+1)/2·cssW, y:(1−v.y)/2·cssH}`; return `null` when behind camera (v.z > 1). **MapOverlay must null-skip every projection.**
- `groundUnproject(sx, sy)`: Raycaster through NDC onto plane y=0 → `{x: hit.x, y: hit.z}`. Reuse Raycaster/Vector3 instances (no per-frame allocation).
- `pan(dxPx, dyPx)`: unproject screen center before/after offset, subtract, apply same clamp as 2D (WORLD ± 25%).
- `zoomAt(sx, sy, f)`: same structure as 2D (`render.ts:182-189`) using groundUnproject before/after.
- `fitAll()`: `zoom = min(cssW / WORLD.width, (cssH / WORLD.height) · sin(64°)) · 1.02`, center WORLD midpoint. `resize()` recomputes `minZoom = fit · 0.85` like 2D.
- `focusHub`: identical logic to 2D via shared `HUB_POS`.

---

## Phase A — Shared contract refactor (2D stays pixel-identical)

**A1. Deps:** `pnpm add three` and `pnpm add -D @types/three earcut` — pin `three` and `@types/three` to the same latest minor. `earcut` is devDependency only (offline script). earcut v3 may ship its own types; add `@types/earcut` only if tsx/tsc complains.

**A2. `lib/game/scene.ts` (new):** move verbatim from `render.ts`: `SceneRival`, `SceneEvent`, `Scene`, `HitTarget`, `SECTOR_COLORS`, plus the private colour consts `PLAYER_COLOR`, `EVENT_COLOR` (export them). Add:

```ts
export interface CameraState { x: number; y: number; zoom: number }
export interface IMapRenderer {
  scene: Scene;
  hover: HitTarget | null;
  resize(): void; fitAll(): void; focusHub(hubId: HubId, zoom?: number): void;
  frame(t: number, dt: number): void;
  pan(dxPx: number, dyPx: number): void;
  zoomAt(sx: number, sy: number, factor: number): void;
  hitTest(sx: number, sy: number): HitTarget | null;
  burstConfetti(hubId: HubId | null): void;
  floatText(hubId: HubId | null, text: string, color?: string): void;
  puffSmoke(hubId: HubId | null): void;
  sparkle(hubId: HubId | null): void;
  getCamera(): CameraState; setCamera(c: CameraState): void;
  dispose(): void;
}
```

`render.ts` re-exports these types so imports don't churn. Update `GameApp.tsx` to `import type { IMapRenderer, Scene } from '@/lib/game/scene'` and type `rendererRef` as `IMapRenderer | null` — every call it makes is in the interface.

**A3. `lib/game/overlay.ts` (new):** `export type Projector = (p: WorldPoint) => {x:number;y:number} | null;` Move `HUB_POS` here from `render.ts`. `class MapOverlay { constructor(projector, size: () => {w,h}) }` — move verbatim from MapRenderer: `pinLayout()`, `hitTest()`, `particleOrigin()`, the four particle methods, `stepParticles()`, `drawShieldPin()`, tooltip drawing, and area labels (`drawAreaLabels(ctx, zoom)`, guarded by zoom > 3.2). `draw(ctx, t, dt, zoom)` reproduces the exact order/styling of `render.ts:464-578`: hub circles/setup rings → rival/event pins → player pin + company label → particles → vignette. Every former `worldToScreen` call becomes `projector(...)` with null-skip. Keep every constant byte-identical — the 2D fallback must not change visually.

**A4. Refactor `lib/game/render.ts`:** `MapRenderer implements IMapRenderer`. Keeps camera/clamp/twinkles/sky/parks/Thames/tube/landmark-doodles/zoom limits/resize/fit/focus/pan/zoomAt. Delegates to an internal `MapOverlay` (projector = its own worldToScreen wrapped non-null): `scene`/`hover` become accessors proxying the overlay; `hitTest` + particles delegate. Add `getCamera()`/`setCamera()` (clamp after set) and no-op `dispose()`. `frame()` = background (unchanged) + `overlay.drawAreaLabels` + `drawLandmarks` + `overlay.draw`.

**A5. `components/game/MapCanvas.tsx` — two canvases, ref-driven loop:**

```tsx
<div data-map-shell="" ref={shellRef} role="img"
     aria-label="Illustrated London startup neighbourhood map; use the neighbourhood selector to choose an HQ"
     className={className ?? 'relative h-full w-full touch-none select-none'}>
  <canvas ref={cityRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
  <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
</div>
```

- Move ALL pointer/wheel listeners (logic unchanged, including the 6px drag threshold and pinch) from the canvas to the shell div; cursor style on the shell.
- rAF loop and every handler read `rendererRef.current` on each invocation (not a closed-over variable) — required for the Phase D runtime swap. Loop no-ops while ref is null.
- ResizeObserver observes the shell → `rendererRef.current?.resize()`.
- `document.visibilitychange`: hidden → cancel rAF; visible → resume with fresh `last` timestamp (keep the existing dt clamp of 0.05).
- In Phase A the factory is trivially `new MapRenderer(overlayCanvas)`; city canvas stays transparent. Cleanup calls `dispose()`.

**A6. Fix `scripts/test-ui.tsx` (same commit as A5):** in the first check, replace the `<canvas`/`lastIndexOf('<div class="')` locator with: find `data-map-shell`, assert present, then `lastIndexOf('<div class="', shellAt)` finds the pane div (works because `data-map-shell` is the FIRST JSX attribute on the shell, so the shell doesn't render as `<div class="`). Also assert two `<canvas` occurrences and the aria-label.

**Gate A:** `pnpm test:game && pnpm test:ui && pnpm lint && pnpm build` green. Manual (`pnpm dev` → `localhost:3000/game`): game visually and behaviorally **identical** — title map, setup hub picking, drag/pinch/wheel, hover tooltips, confetti on founding, keyboard, mute. Commit.

---

## Phase B — Data pipeline (Overpass → committed binary)

**Decision: Overpass API tiled bbox queries** (not a Geofabrik PBF): pure HTTPS + Node 20 `fetch`, zero parser deps, one-time script, all output committed. The shipped game never fetches third-party data.

**`scripts/fetch-geodata.ts`** (run: `pnpm tsx scripts/fetch-geodata.ts`):

- **Bbox** = exactly the geo.ts extent: `s=51.452, w=-0.265, n=51.552, e=0.065`. No padding.
- **Endpoints**: primary `https://overpass-api.de/api/interpreter`, fallback `https://overpass.kumi.systems/api/interpreter`. POST `data=<query>`. Retry 429/504/timeout with backoff (5s/15s/45s), switch mirror after 3 failures, sleep 2s between requests.
- **Cache** every raw response in `scripts/.geocache/<name>.json`; skip fetch when cached (idempotent). Add `scripts/.geocache/` to `.gitignore`.
- **Buildings** — 40 tiles (10×4 grid), per tile:
  ```
  [out:json][timeout:180];
  ( way["building"]["building"!~"^(no|entrance)$"]({s},{w},{n},{e});
    relation["building"]["type"="multipolygon"]({s},{w},{n},{e}); );
  out geom qt;
  ```
  Dedupe across tiles by `type/id`. Multipolygons: each **outer** ring is an independent polygon; ignore holes. Skip `building:part`.
- **Roads** — 4 tiles: `way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|residential|unclassified|pedestrian|living_street)$"]`. Tiers: 0 = motorway/trunk/primary(+links), 1 = secondary/tertiary, 2 = rest. No service/footway.
- **Parks** — 1 query: `leisure~"^(park|garden|common|recreation_ground|golf_course)$"` OR `landuse~"^(grass|meadow|forest|cemetery|allotments)$"` OR `natural=wood` (ways + relations). Keep area ≥ 8,000 m².
- **Water** — 1 query: `way["natural"="water"]`, `relation["natural"="water"]`, `way["waterway"="riverbank"]`. Assemble outer rings, **clip to bbox with Sutherland–Hodgman** (~40 lines, inline — the Thames relation extends far outside), keep area ≥ 10,000 m².
- **No OSM rail** — reuse the game's `TUBE_LINES` in 3D instead.

**Per-building processing** (world units via `project()`; meters via ×111.32): drop area < 30 m² → Douglas–Peucker simplify ε = 1.2 m, drop degenerate (<3 distinct verts or >250) → height meters (uint8): `tags.height` → else `levels × 3.2 + 3` → else deterministic hash(id) in 7..17 nudged by `sqrt(area)/8`; clamp 3..255 → quantize verts to uint16 over WORLD → **earcut-triangulate the roof polygon offline** (roofs offline, walls generated at runtime; keeps earcut out of the client bundle and avoids 100k+ runtime ExtrudeGeometry) → chunk id: 8×6 grid over WORLD by centroid (48 chunks); tier `major` if height ≥ 20 m or area ≥ 700 m², else `minor` → **adaptive cap**: if total > 130,000, raise the area floor stepwise (30→40→50→65 m², minor tier only) until ≤ 130k; print final floor.

Parks/water: simplify ε = 3 m, quantize, earcut offline. Roads: simplify ε = 2 m, quantize.

**Binary format** — `lib/game/render3d/format.ts` exports `encodeCity(data): ArrayBuffer` and `decodeCity(buf): CityData` (pure TS, no DOM). The script does an encode→decode→deep-compare round-trip before writing. Little-endian:

```
Header:   magic uint32 'LDN1', version uint16, buildingCount uint32,
          roadCount uint32, parkCount uint16, waterCount uint16
Building: tierFlags uint8 (bit0=major), heightM uint8, chunkId uint8,
          vertCount uint8, triCount uint8, verts vertCount×(uint16,uint16),
          indices triCount×3×uint8
Road:     tier uint8, ptCount uint16, pts ptCount×(uint16,uint16)
Park/Water: vertCount uint16, verts…, triCount uint16, indices triCount×3×uint16
```

Expected ~5.5–7 MB on disk (~2.5–3 MB gzipped over the wire — Next prod server compresses). **Hard gate ≤ 8 MB**, else raise thresholds. Outputs (committed): `public/map/london-city.bin` + `london-city.stats.json` (counts per class/tier, byte size, thresholds, bbox, date, endpoints). Script flags: default full run; `--verify` = decode committed bin + print stats, no network.

**Gate B:** script completes; stats sane (buildings 60k–140k, roads 8k–25k, parks ≥ 100, water polys ≥ 3, file ≤ 8 MB); `--verify` round-trips; `git status` shows only the two public files + script + .gitignore line; `pnpm lint && pnpm build` green. Commit (repo grows ~6 MB — intended). If both Overpass mirrors fail persistently: **stop and report — do not substitute a keyed/paid service.**

---

## Phase C — 3D renderer: static city + full interaction parity

**`lib/game/render3d/CityRenderer3D.ts`:** `constructor(cityCanvas, overlayCanvas, opts: { onFatal: () => void })`, implements `IMapRenderer`.

- `WebGLRenderer({ canvas: cityCanvas, alpha: true, antialias: !isCoarsePointer, powerPreference: 'high-performance' })`; `setPixelRatio(min(devicePixelRatio, isCoarsePointer ? 1.5 : 2))` where `isCoarsePointer = matchMedia('(pointer: coarse)').matches`. Overlay canvas keeps DPR ≤ 2.
- Owns `cam {x,y,zoom}`, min/max zoom mirroring 2D, a `CameraRig`, a `MapOverlay` (projector = rig's worldToScreen), and the overlay 2D ctx.
- `frame(t, dt)`: update rig → advance streaming build queue → animate (Eye wheel rotation; fog near/far = `dist·0.8 / dist·3.5`; window `emissiveIntensity = clamp(0.55 + zoom·0.02, 0.55, 1.1)`) → `renderer.render` → clear overlay → `overlay.drawAreaLabels` → `overlay.draw`.
- Data: `fetch('/map/london-city.bin')` in constructor (fire-and-forget); non-200/parse failure → `opts.onFatal()`. Before data arrives render sky/ground/tube/hub-glows only (city "streams in").
- **Streaming build**: enqueue 48 chunks × {major, minor} + roads + parks + water + landmarks; execute ≤ 2 build jobs per frame (no main-thread stall).
- `dispose()`: dispose all geometries/materials/textures, `renderer.dispose()`, remove listeners.
- Context loss: `webglcontextlost` → `preventDefault()`, 2s timer; if no restore → `sessionStorage.setItem('runway-force-2d','1')` + `onFatal()`.

**Visual spec (concrete — do not improvise):**
- **Sky**: CSS gradient on the shell div (`#070c1a → #0a1124 55% → #0d142b`, matches `render.ts:374-377`); WebGL canvas alpha-transparent; `scene.fog = new THREE.Fog(0x0d142b, …)`.
- **Ground**: PlaneGeometry WORLD ± 30%, MeshBasicMaterial `#0b1020`, y=0.
- **Water** (y=0.05): merged triangulated polys, `#1d3a68`. **Parks** (y=0.1): `#14261c`.
- **Roads** (y=0.15): expand polylines to per-segment quad ribbons; widths tier 0/1/2 = 14/10/6 m; one merged geometry, vertex colors `#2c3a66`/`#222c50`/`#161e38`, `MeshBasicMaterial({vertexColors:true})`. This glowing street grid is the SFSIM look — no postprocessing needed.
- **Tube lines** (y=0.25): 4 m ribbons from `TUBE_LINES`, per-line `MeshBasicMaterial({ color: line.color, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false })`.
- **Buildings**: per chunk × tier one merged indexed BufferGeometry (positions/normals/vertex colors/uvs). Roof at `h · METERS_TO_WORLD · HEIGHT_SCALE` from stored indices; walls = 2 triangles per footprint edge. `HEIGHT_SCALE = 1.5` (style exaggeration, applied to landmarks too). Vertex colors: hash-pick per building from slates `#0f1730 #121b36 #16203e #1b2748`; wall bottoms lerped 45% toward `#070c14` (fake AO); roofs at 70% base. One shared `MeshLambertMaterial({ vertexColors: true, emissive: 0xffffff, emissiveMap: windowsTexture, emissiveIntensity: 0.8 })`.
- **Windows texture** (`textures.ts`): 256×256 canvas, 32×32 grid of 8px cells; 62% dark, else 4×5px lit rect — 70% warm `rgb(255,214,140)`, 25% cool `rgb(160,196,255)`, 5% white, ±25% jitter; **reserve the (0,0) texel region fully dark**. NearestFilter, RepeatWrapping. Wall UVs: `u = cumulative horizontal meters / 4`, `v = height meters / 3.4`; roof UVs pinned to (0,0) → unlit roofs.
- **Lighting**: `HemisphereLight(0x16204a, 0x05070f, 0.9)` + `DirectionalLight(0x8fa8ff, 0.35)` NW-high. **No shadow maps, no bloom/postprocessing** — glow = emissive windows + additive ribbons + fog + overlay vignette.
- **Hub glows**: 8 additive Sprites (radial-gradient CanvasTexture, ~50 m) at `HUB_POS`, `#7dd3fc`; player's hub swaps to `#f8c33a`.
- Skip the 2D twinkles in 3D (windows replace them).

**`lib/game/render3d/factory.ts`:** `createMapRenderer(city, overlay, onFatal): Promise<{renderer: IMapRenderer; mode: '2d'|'3d'}>`. Decision order: (1) `?map=2d` → 2D; (2) `sessionStorage['runway-force-2d']==='1'` → 2D unless `?map=3d`; (3) `getContext('webgl2')` probe null → 2D (three r163+ is WebGL2-only — that IS the heuristic); (4) `navigator.deviceMemory <= 2` (when defined) → 2D; (5) `await import('./CityRenderer3D')` (dynamic — keeps three ~170 kB gz out of the initial chunk and away from test:ui) + construct in try/catch → throw → 2D. 2D path constructs `MapRenderer` (statically imported).

**MapCanvas wiring:** init effect becomes async-aware — `let cancelled = false; createMapRenderer(...).then(({renderer}) => { if (cancelled) { renderer.dispose(); return; } renderer.scene = sceneRef.current; renderer.resize(); renderer.fitAll(); rendererRef.current = renderer; })`. Loop no-ops until ref set; the CSS sky prevents flash. `onFatal`: capture `cam = old?.getCamera()`, dispose old, construct `new MapRenderer(overlayCanvas)`, `setCamera(cam)`, `resize()`, reassign ref (loop picks it up next frame — this is why A5 made everything ref-driven).

**Gate C:** all four commands green. Manual: tilted 3D night London; Thames + Isle of Dogs bend visible; glowing streets; lit windows; TfL tube ribbons; fitAll frames the city on title. Setup flow: hub rings clickable; found company → confetti at the hub's screen position; hover tooltips on rivals/events; drag pans tracking the ground; wheel/pinch zoom to cursor; focusHub centers; area labels past zoom 3.2. `?map=2d` shows the untouched 2D map. Sidebar/modals/keyboard/sound unchanged. Commit.

---

## Phase D — Landmarks, LOD/perf, fallback hardening

**D1. `geo.ts` (additive):** extend `LandmarkKind` with `'gherkin' | 'towerbridge'`; append `{ kind: 'gherkin', name: 'The Gherkin', at: [-0.0803, 51.5145] }` and `{ kind: 'towerbridge', name: 'Tower Bridge', at: [-0.0754, 51.5055] }`. Add two simple doodle cases to the 2D `drawLandmarks` (gherkin: pointed oval; towerbridge: two towers + two deck lines) for parity.

**D2. `landmarks.ts`:** `build(kind): THREE.Group` anchored at `project(at)`, heights in meters × `METERS_TO_WORLD × HEIGHT_SCALE`. cityBuilder **skips generic buildings whose centroid is < 80 m from a landmark anchor** (no z-fighting doubles). Recipes:
- **Shard** (310 m): ConeGeometry(16, 310, 4) scaled (1,1,0.7), glass `#16223d` + EdgesGeometry lines `#9fc4ff` @ 0.5 + emissive white tip.
- **Gherkin** (180 m): LatheGeometry sine-bulge profile (max r 28 m at 40% height, rounded top), `#14303a`, emissive diagrid CanvasTexture (±45° line sets).
- **Big Ben** (96 m): Box(12,85,12) + 4 emissive warm `#ffe9a8` clock-face planes near top + Cone(9,18,4) spire.
- **London Eye** (135 m): vertical Torus(60, 1.2, 8, 48) + 32 spoke cylinders + 16 pod spheres (emissive `#7dd3fc`) + 2 A-frame legs; yawed to face across the river; rotates 1 rev/60 s in `frame()` (visual-only — allowed).
- **St Paul's** (111 m): nave Box(75,20,30) + drum Cylinder(18,18,20) + hemisphere dome r 22 + lantern; warm floodlit `#d9d3c0`.
- **Tower Bridge**: two Box(14,60,14) towers 61 m apart spanning the river + pyramid tops + walkway boxes at 40 m + roadway + suspension curves (QuadraticBezierCurve3 → thin TubeGeometry); emissive `#7dd3fc` accents.
- **BT Tower** (177 m): Cylinder(8,8,160) + 3 wider ring cylinders at 100–130 m + mast + emissive dot ring near top.
- **The O2**: Sphere(190, 24, 12, 0, 2π, 0, ~0.5) scaled (1, 0.35, 1) `#cbd5e1` + 12 slanted masts (r 0.8, h 95) emissive `#fbbf24`.

**D3. Performance:** `minor` chunk meshes `visible = zoom >= 5.5` (coarse pointer) / `>= 4.8` (fine); tier-2 roads hidden below zoom 4.5; `computeBoundingSphere()` per chunk mesh (frustum culling). Budgets: ≤ ~60 draw calls typical view; ≤ 130k buildings; verify no per-frame allocations in the hot path; confirm rAF pauses on hidden tab.

**D4. Fallback hardening:** test live 3D→2D swap with camera carry-over via forced context loss (`renderer.forceContextLoss()` temporarily exposed or behind `?map=debug`); sessionStorage flag persists 2D for session; `?map=3d` overrides; data-fetch failure (devtools request blocking on the .bin) → clean 2D fallback.

**Gate D:** all four commands green. Manual: landmarks recognizable at correct anchors (Shard by londonbridge hub, Gherkin in The City, O2 across from canarywharf); Chrome devtools CPU 4× throttle still interactive while panning; iPhone viewport (44dvh pane) smooth, pinch works; blocked .bin → working 2D, no crash; forced context loss → working 2D at same camera. Commit.

---

## Phase E — Final verification + docs

1. `pnpm test:game` — must be untouched-green (if it fails, you changed something forbidden).
2. `pnpm test:ui` — green (three only behind dynamic import inside effects).
3. `pnpm lint`, `pnpm build` — green; confirm three sits in an async chunk (route first-load JS roughly unchanged).
4. Offline: `pnpm build && pnpm start`, disconnect network, load `/game` — 3D map loads (all same-origin).
5. Docs: append to `AGENTS.md` + `README.md`: regen command (`pnpm tsx scripts/fetch-geodata.ts`), `?map=2d|3d` debug params, and that `public/map/london-city.bin` is generated-but-committed.

## Risks / known trade-offs

1. **Overpass availability/volume** — raw responses may total hundreds of MB and 15–40 min with sleeps; `.geocache` makes re-runs cheap. Both mirrors down → stop and report.
2. **Real building count unknown until fetched** (est. 250k–500k raw in bbox) — the adaptive area-floor cap is the control; expect to tune the 130k cap / LOD thresholds after first render.
3. **Pins can float over tall buildings near hubs** (screen-space HUD look, like SFSIM) — accepted; hub glow sprites mitigate. Do not attempt occlusion.
4. **Pan clamp at low pitch** may expose ground-plane edge to the north — fog + CSS sky should cover; enlarge ground margin if a hard edge is visible.
5. **Projector null-handling**: every overlay path (tooltips, player label) must null-skip or extreme-south pans can throw.
6. **Repo grows ~6 MB** of committed binary — intended, but permanent in git history.
