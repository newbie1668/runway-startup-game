# Verification and acceptance gates

## Evidence rules

Every result names the exact Git SHA, asset hashes, command, browser/version, hardware, viewport, DPR, URL, renderer mode, run time and outcome. Use a production server for release evidence. Development-server results are useful for diagnosis but not performance acceptance.

The existing `data-map-ready=1` is only a readiness signal; at the baseline it can also mean fallback or exhausted jobs after errors. Pair it with an actual screenshot and R1's mode/state diagnostics. Browser console exceptions and page crashes fail the browser gate. Do not suppress them to obtain a green result.

Save task evidence under `docs/runway-recovery/evidence/<task-id>/` with a small `result.md`, representative screenshots and structured numeric results. Keep large videos/traces in a durable PR-linked artifact; never rely only on a private agent-session URL. QA screenshots must show the current application, not a standalone mesh viewer masquerading as the game.

## Repository gates

Run from the worker's actual worktree, using its lockfile:

```bash
pnpm install --frozen-lockfile
pnpm test:game
pnpm test:ui
pnpm lint
pnpm build
pnpm tsx scripts/fetch-geodata.ts --verify
```

The first four validation commands after install are required for every implementation gate. Binary verification is required for data/geometry/asset gates. Do not refetch Overpass for routine testing. Re-run after relevant changes or failures; do not repeat the same passing expensive suite without a reason.

R0 adds a development-only production-browser runner:

```bash
pnpm start --hostname 127.0.0.1 --port 4317
# In a second terminal, after that server reports ready:
pnpm test:map:browser
```

`test:map:browser` is **planned**, not present in the planning baseline. R0 wires it to `node scripts/test-map-browser.mjs`, with `RUNWAY_BASE_URL` defaulting to `http://127.0.0.1:4317`. Install and pin the browser-test dependency there, never in the application runtime dependencies. A failing baseline browser result is recorded, not hidden; production changes cannot be accepted until the applicable browser failures are resolved.

The existing baseline suite has 13 engine, 20 OSM/UV, 22 noticed, 16 landmark and 40 city-read checks; the UI suite has 8 SSR checks. These counts describe this pinned revision, not an immutable target for future test counts.

## Reproducible browser matrix

Each row needs a cold navigation and a reload in an isolated browser context, then a screenshot **after essential content is rendered**. Run both with chrome visible and `chrome=0` where composition is being judged.

| ID  | Route / action                                                                                             | Required observation                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| B1  | `/game`                                                                                                    | Useful title/map; actual 3D on supported desktop, no query-only safety shortcut.                                              |
| B2  | `/game?map=3d&look=citystreet&chrome=0`                                                                    | Ordinary Cheapside stock, continuous roads, contextual city; no Poultry fetch while parked.                                   |
| B3  | `/game?map=3d&view=mid&chrome=0`                                                                           | Neighbourhood stock and bounded park/road coverage; no empty carpet or crash.                                                 |
| B4  | `/game?map=3d&view=wide&chrome=0`                                                                          | Recognizable London and all eight hub regions, not just a small fixed disk.                                                   |
| B5  | `/game?map=3d&look=buckingham&chrome=0`                                                                    | Palace plus park context; no landmark-only crop hiding regressions.                                                           |
| B6  | In one loaded page: search Shoreditch → Canary Wharf → Battersea → Camden → Fitzrovia, then pan/zoom back. | Destination stock/roads arrive without reload; previous cells release; game markers still work.                               |
| B7  | Title → found company → HQ selection → play → weekly action → event/dilemma → save/reload/continue.        | Same game rules and dialogs; visible, reachable controls. Use a disposable local save, not a user's browser profile.          |
| B8  | `/game?map=2d`                                                                                             | Usable existing 2D title/setup/play.                                                                                          |
| B9  | `/game?map=debug`, trigger `window.__runwayForceContextLoss()`.                                            | Active renderer becomes 2D, camera/player focus is reasonably preserved, controls still respond, no duplicate animation loop. |
| B10 | Block `/map/london-city.bin`; separately return malformed data.                                            | Working 2D fallback with explicit diagnostic reason; no endless loading.                                                      |
| B11 | Block one optional GLB and its manifest separately.                                                        | Procedural/stock replacement stays visible; optional error recorded; essential map usable.                                    |
| B12 | Disable WebGL2 / simulate low capability in a fresh session.                                               | Supported 2D path is playable; forced-3D rules do not cause uncaught failure.                                                 |
| B13 | Block every non-same-origin request on a production build.                                                 | All title/setup/play actions and map asset loads still work.                                                                  |

Desktop: **1440×900, DPR 1**. Mobile layout: **390×844, DPR 2, touch/coarse pointer**. Run actual GPU-backed Chrome desktop and a representative iPhone Safari before G4. Headless Chrome/SwiftShader is a useful repeatable stress/debug environment, not proof of real mobile speed. Record it separately.

For reloads, clear the test session's fallback flag when checking 3D support; separately test that genuine fallback persists as intended. An all-green suite that silently rendered only 2D is invalid.

## Initial performance budgets — proposed, calibrate at G0

| Metric             | Initial acceptance target                                                                                                                                                    | How measured                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Crash/error rate   | Zero crashes, uncaught exceptions or hydration errors across 5 reloads per critical view and a 10-minute hub tour.                                                           | Browser events, console log and screenshots.                                                          |
| First useful map   | ≤5 s desktop, ≤10 s reference mobile after local production navigation.                                                                                                      | Diagnostic first useful frame; cold asset cache; named hardware. Network latency reported separately. |
| Interaction        | Desktop p95 frame interval ≤33 ms; reference mobile ≤50 ms while continuously panning after loading.                                                                         | 30 s frame sample with visibility held; report median and p95.                                        |
| Generation work    | Target ≤4 ms per scheduled slice; no repeated >50 ms main-thread tasks caused by mesh generation.                                                                            | Scheduler timings and browser trace. A whole chunk taking 300 ms is not a compliant slice.            |
| Resident geometry  | Initial ceiling 128 MiB of unique geometry buffers, ≤2 million drawn triangles and ≤300 draw calls in a typical desktop view; mobile detail must fit measured device limits. | Buffer accounting plus renderer counters. These are separate metrics, not total process/GPU memory.   |
| Resource retention | Repeat the same hub tour 3 times; settled counts/bytes return within 10% of the first settled tour, with no monotonic growth.                                                | Cell/resource counters, heap/process samples if available.                                            |
| Transport          | No new initial map payload above the baseline asset inventory without an explicit budget review.                                                                             | Production HAR and committed artifact sizes.                                                          |

These are engineering proposals, not measurements from this audit and not Foo's negotiated device SLOs. G0 records feasible limits and the reference device before R5 tuning. A worker cannot widen them after a failure; the tech lead must show the tradeoff and get reviewer agreement. A lower detail tier must retain street massing and gameplay readability.

## Visual gate G2 — real-place recognition

Apply [fidelity contract C7](fidelity.md). The selected SFSIM media defines the visual benchmark; geolocated London imagery and observations establish factual resemblance. Both are necessary. A nice stylized street or skyline does not meet the clarified requirement.

- Preselect a continuous 200–300 m route, both frontages and a junction. Record movement in both directions at a close exploration scale plus wider context.
- Compare ten preselected ordinary buildings (or all if fewer) against their real references: actual footprint/order, heights/roofs, materials, openings and distinguishing facade features. Required salient features must match.
- Compare at least five observed tree/street-object instances where present plus the salient signs/crossings, checking real position, street side, heading and recognizable form. Inventory all if fewer; no invented filler to satisfy a count.
- A familiar-area reviewer identifies the street and sampled buildings without in-game labels, then checks the source imagery. Record errors and unknowns explicitly. A tree generated from spacing is never evidence of that particular tree.
- Evaluate a close street-facing camera and a pedestrian-eye variant; 48-degree orthographic pitch is not a product constraint. Preserve the existing game view and marker behavior.
- Keep G1 stability/performance and mobile checks; budgets include texture costs as well as geometry. Reassess budgets transparently if enriched assets require it, never silently lower fidelity.

Foo approves the concrete pilot against the chosen reference after its media is accessible. Record sources, camera route, accepted images/hashes and the decision in `evidence/G2/result.md`. Reference access failure blocks exact equivalence approval, not the independent source or runtime audits.

## G3 — repeatability, coverage and game regression

First require F6 to reproduce the quality in a second ordinary area and prepare an explicit coverage/cost rollout. The eight hubs remain a gameplay regression sample, not proof of city-wide reconstruction. Visit and capture Shoreditch, King's Cross, Soho, Farringdon, Canary Wharf, London Bridge, Camden and Battersea. Reuse real hub coordinates from `content.ts`/`overlay.ts`. Do not copy the older compressed-diorama coordinates.

Expected character: brick/industrial Shoreditch, granary/mixed King's Cross, dense low-rise Soho, warehouse/office Farringdon, tower/dock Canary, riverside/market London Bridge, low-rise/canal Camden, and Power Station/riverside Battersea. These are interpretation guides for the existing geography, not authority to invent OSM data. Assess the existing eight hubs; City/Westminster provide landmark context but are not new playable HQs.

Named landmarks get individual acceptance cards: real anchor, at least three distinguishing features, one chosen source/builder, transport/geometry budget, isolated inspection, and **two in-game views including context**. Do not start with another unlimited Poultry pass. Existing heroes stay frozen until their explicit card is active.

## Offline meaning and release gate

“Offline at play time” here means no third-party runtime services: with the local/hosted app and its same-origin assets reachable, play works while outside network calls are blocked. There is no service-worker guarantee of a first-ever load with the entire network disabled. A downloadable/PWA offline product is separate scope.

G4 requires all repository commands, B1–B13 plus the F5 close street tour, the eight-hub game tour, reference-device performance, approved G2 recognition evidence, F6 repeatability/coverage reporting, P1–P12 traceability, protected-file/save checks, and an independent result on the exact candidate SHA. A limited-area release is named as such; it does not complete the London-wide ambition. Record Git push, PR state, preview availability, browser verification, merge and deployment separately. Vercel green is a build/deploy signal, not browser QA. Do not deploy to `londonstartupmap.com` without explicit product approval.
