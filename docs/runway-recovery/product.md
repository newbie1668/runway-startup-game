# Product contract

## Current decision and outcome

On 5 September 2026, Foo confirmed the recommended scope: **daytime SFSIM street/isometric London, with the existing RUNWAY game preserved**. This resolves the night/day and map/game-redesign questions. This contract governs this recovery effort; conflicting historical specs are evidence of earlier directions, not simultaneous requirements.

RUNWAY already lets a player found a London startup, choose one of eight HQ neighbourhoods and six sectors, spend weekly focus, hire/build/sell/network/fundraise, attend events, encounter rivals and dilemmas, and race toward a £1 billion valuation while managing runway. Preserve those rules, save compatibility, and action semantics. The map should make that game feel located in London and remain useful during play.

## Player-facing acceptance criteria

| ID  | Required outcome                                                                                                                                                    | Evidence                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| P1  | A recognizable, bright, stylized London city at `/game`, with real OSM street and building placement.                                                               | Unlabelled overview and street captures; eight-hub tour.                         |
| P2  | Ordinary streets have continuous blocks, plausible height variation, readable cream/brick/stone/glass facades, pavement and roads; landmarks sit within a city.     | Fixed Fitzrovia and Cheapside captures, including a wider contextual frame.      |
| P3  | Landmarks read through silhouette, proportions and placement at normal play scale.                                                                                  | Named feature cards with same-camera before/after and context views.             |
| P4  | Fixed isometric pitch; responsive pan, wheel/pinch zoom, hub focus, search, and overview. Moving anywhere in the supported bbox brings the relevant city into view. | Cold-load and continuous navigation tests, not separate reload-only screenshots. |
| P5  | HQ selection, player/rival/event markers, tooltips, focus actions and gameplay controls work in 3D and in fallback.                                                 | Desktop and mobile gameplay flow; SSR tests plus browser checks.                 |
| P6  | A failed optional asset leaves a sensible building; essential 3D failure gives working 2D. Loading cannot silently claim success with an empty city.                | Failure-injection tests and screenshots of the result.                           |
| P7  | Responsive mobile layout, reachable controls and touch targets, no horizontal page overflow. Low-capability devices retain playable 2D.                             | 390×844 touch checks, real mobile check before G4.                               |
| P8  | Play needs no third-party geodata, image, map or AI requests. Assets are served by this app.                                                                        | Production network log with third-party network blocked.                         |
| P9  | The existing game stays deterministic and save-compatible.                                                                                                          | Protected-file comparison, engine suite and resume/action browser checks.        |

## Art direction for the first slice

Use PR #26/#27's daytime SFSIM direction as the starting point: matte low-poly geometry, clear material colours, fixed elevated orthographic/isometric camera, legible roads, structured facade detail, and restrained glass HUD. Current pitch is 48 degrees; preserve it through G1. Do not introduce bloom, photoreal surfaces, cinematic blur or additional UI treatments during reliability work.

The quality target is the **street scene as a whole**. Start with Fitzrovia (`/game?map=3d&chrome=0`) and Cheapside (`look=citystreet`) at 1440×900 and 390×844. Include the mid view to reveal missing stock or coverage tricks. Gates judge continuous streets, proportion, material contrast, navigability and performance as well as named buildings.

The original external references were [David's SFSIM post](https://x.com/davidfromkansas/status/2090527548157669715) and [his building-pipeline breakdown](https://x.com/davidfromkansas/status/2090527551961940028). Their media could not be independently recovered during this audit. The older [yU+co Silicon Valley sequence](https://www.yuco.com/works/silicon-valley) explains the earlier miniature-city inspiration, but its fixed postcard geography, pre-rendered presentation and logo/gag density are **not** requirements of this recovery.

**One remaining art input:** an accessible SFSIM reference frame or a concrete scene Foo approves at G2. Until then, workers may fix correctness and reliability; the tech lead must not claim visual equivalence. The tech lead prepares the reference comparison for Foo instead of asking Foo to invent technical instructions.

## Scope boundaries

- Map/rendering recovery only; no engine, balance, content, RNG, audio rules, save-schema or modal-action changes.
- Preserve `Scene`, `HitTarget`, the shared overlay and `IMapRenderer` behavior. Additive diagnostic types are allowed when explicitly assigned.
- Three.js must remain behind the existing dynamic factory boundary. Keep SSR free of browser/WebGL side effects.
- Keep the current bbox and committed binary during recovery. No broader OSM ingest or invented missing neighbourhoods.
- Keep automatic 2D fallback. Earlier specs asking to delete it are superseded for this effort.
- Bake-time photo reference and code-generated GLBs are allowed under the current asset workflow. No paid tooling or new outside services is assumed.
- No live weather, traffic, citizens, transit animation, generative asset calls, day/night switch, logo/gag programme, or broader game redesign.
- Keep `londonstartupmap.com` separate. Product approval is required before attaching or deploying this app there.

## Open decisions, with safe defaults

| Decision                             | Current default                                                                                                               | When required                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Exact visual reference               | Daytime SFSIM direction; reference media not yet available.                                                                   | Before G2 visual approval. Does not block G0/G1.                                       |
| Minimum real phone/browser           | Maintain 2D fallback and responsive 390×844; use current Chrome desktop and Safari on a representative iPhone for release QA. | Tech lead records named hardware/browser at G0 and obtains a real mobile result at G4. |
| Landmark fidelity                    | Recognizable silhouettes and placement at play scale; expand detail only after the representative street passes.              | Per-feature card at G3. No blanket photoreal or every-building-unique target.          |
| Delivery date / agent spending limit | Sequential critical path, compact models for bounded tasks, no paid service setup.                                            | Before scheduling a paid autonomous run; no calendar promise in this plan.             |
| Game's pre-extraction vision         | Recovered from repository gameplay and later specs, not an original pre-repo conversation.                                    | Only needed if wider product goals change.                                             |

Performance limits in the verification document are proposed engineering budgets. G0 calibrates them once against named hardware; any change needs a recorded tradeoff and reviewer agreement, never an automatic threshold increase to pass a test.
