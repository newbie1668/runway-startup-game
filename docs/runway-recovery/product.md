# Product contract

## Current decision and outcome

Foo's clarification on 5 September 2026 sets the target: **a faithful, explorable Three.js representation of London at the visual standard of the two supplied SFSIM posts**. Someone familiar with an ordinary street should recognize its buildings and distinctive trees, signs and other street features. The existing RUNWAY game remains intact.

The first draft's “plausible stylized streets plus recognizable landmarks” was an insufficient interpretation. The target is real-place resemblance throughout delivered areas. Simplified meshes and reusable construction techniques are acceptable when they preserve the actual place's appearance. Randomly varied facades and evenly spaced generic trees do not establish that resemblance.

The two authoritative references are:

- **Workflow reference:** https://x.com/davidfromkansas/status/2090527551961940028
- **Visual/detail benchmark:** https://x.com/davidfromkansas/status/2090527554310635552

Foo has selected these references; no further style-choice question is pending. Automated web and browser access returned errors, including HTTP 403, so their exact text/media have not yet been independently inspected. The written owner requirement is authoritative now. Exact frame extraction and a claim of matching the clip remain pending accessible media.

RUNWAY's startup creation, HQ/sector choice, weekly actions, rivals, events, dilemmas, funding, £1 billion goal and save behavior remain protected. “We don't need details on what each building is” removes an encyclopedic description/occupant-information requirement; it does not lower the requirement that the building looks like its real counterpart.

## Player-facing acceptance criteria

| ID  | Required outcome                                                                                                                                                               | Evidence                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| P1  | A geographically coherent London city in Three.js, recognizable through actual street layout and built form.                                                                   | Overview plus continuous tours; area coverage map.                                                   |
| P2  | Ordinary buildings resemble their real counterparts: footprint, height/proportion, roof profile, facade material/colour, window/door rhythm and distinctive frontage features. | Geolocated real-image comparisons on a preselected ordinary-building sample, not only landmarks.     |
| P3  | Distinctive buildings and landmarks retain their individual silhouette, proportions and position.                                                                              | Source-backed feature cards; multiple in-game viewpoints.                                            |
| P4  | Responsive city overview, pan/zoom, search and close street exploration. Fixed 48-degree pitch is a legacy implementation choice, not the final product constraint.            | Continuous street tour; camera comparison and supported-device checks.                               |
| P5  | Existing HQ selection, player/rival/event markers, controls and game actions work in 3D and fallback.                                                                          | Desktop/mobile gameplay and SSR/browser regression checks.                                           |
| P6  | Missing optional detail has a usable fallback; essential rendering failure gives playable 2D.                                                                                  | Failure injection and truthful loading state. A fallback is not an accepted faithful reconstruction. |
| P7  | Responsive mobile layout and usable controls; weak devices retain playable 2D.                                                                                                 | Named reference devices, touch checks and performance record.                                        |
| P8  | Shipped play uses committed same-origin assets without third-party geodata, imagery or AI requests.                                                                            | Production network test; bake/runtime separation.                                                    |
| P9  | Existing game remains deterministic and save-compatible.                                                                                                                       | Protected-file comparison, engine tests and resume/actions.                                          |
| P10 | Distinctive trees, signs, lamps and other visible street features occupy their observed positions and resemble the referenced features.                                        | A surveyed feature inventory with source, date, placement and in-game comparisons.                   |
| P11 | Visual accuracy is supported by per-object source evidence and explicit unknowns. Generated guesses never count as verified real detail.                                       | Provenance records and independent place-recognition review.                                         |
| P12 | The reconstruction process can reproduce this quality in another ordinary area before city-wide rollout.                                                                       | A second area built from the same pipeline, with costs/coverage recorded.                            |

## Quality and scope

Daytime SFSIM remains the visual reference. Do not lock all future work to PR #27's current palette, generated facade grammar, height exaggeration or orthographic camera. Fidelity to real London and the selected visual benchmark controls those choices. The exact camera style will be extracted from accessible reference media and demonstrated in a close street exploration prototype. A literal pedestrian-eye mode must be evaluated; full walking-game mechanics are not implied.

The destination is London as a recognizable virtual city. The current central-London bbox and eight game hubs are an initial engineering area, not proof that the whole city is represented. Progress by approved spatial areas; report exactly which streets meet the quality bar and which remain baseline geometry. Final geographic extent must be explicit before estimating city-wide delivery.

**First proof:** a continuous 200–300 m ordinary street segment, covering both sides, a junction and distinctive street furniture/vegetation. Charlotte Street in Fitzrovia is the working candidate because it is inside the existing area; source coverage must be verified before committing to it. Foo may nominate a familiar public street instead. The pilot is a feasibility and quality gate, not a reduction of the London-wide ambition.

Detailed shape, facade and streetscape evidence requires an additional [reconstruction pipeline](fidelity.md) and [execution track](../superpowers/plans/2026-09-05-london-fidelity.md). Runtime reliability is necessary but cannot alone meet this product contract.

## Scope boundaries

- Map/rendering and offline city reconstruction only; preserve game rules, balance, content, RNG, audio rules, save schema and action semantics.
- Preserve existing `Scene`, `HitTarget`, overlay and game-facing `IMapRenderer` behavior. Camera exploration extensions need an additive visual interface and regression checks.
- Three.js stays behind the dynamic factory boundary; no browser/WebGL side effects in SSR.
- Freeze the current bbox/binary during reliability tasks R0–R6. The fidelity track may add versioned pilot detail assets and change preprocessing in separately assigned, verified tasks. Expansion follows repeatable quality evidence.
- Keep automatic 2D fallback. Reduced detail may preserve usability but cannot be certified as street-faithful merely because it runs.
- Offline reference gathering, optional model-assisted feature extraction and generated/baked geometry are within the proposed workflow. No paid provider purchase or credential setup is assumed. Record source-use rights, costs and human/agent effort before scaling.
- No runtime AI generation, live weather/traffic/citizens, day/night switch, interiors, resident information, encyclopedic building descriptions, startup-logo gag programme or broader game redesign.
- Keep `londonstartupmap.com` separate; attaching/deploying there requires explicit product approval.

## Remaining inputs and uncertainty

| Item                                                          | State                                                                | Next step                                                                                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Visual ambition and reference                                 | Confirmed by Foo; both post URLs recorded.                           | Do not ask Foo to choose the style again.                                                                               |
| Exact reference pixels/workflow text                          | Access blocked here; not inspected.                                  | Obtain the attached clip/screenshots or another accessible copy of the same media; F0 records what is actually visible. |
| Pilot street                                                  | Charlotte Street working candidate; familiar public street optional. | F1 checks source sufficiency and fixes geographic bounds.                                                               |
| Accuracy data for facades and small objects                   | Not yet established for the pilot.                                   | F1 inventories available evidence, gaps and practical collection/enrichment cost.                                       |
| Target devices, total geographic extent and spending envelope | Not yet fixed for city-wide delivery.                                | Tech lead prepares evidence-backed choices after the pilot; no unsupported cost or completion-date promise.             |

The project is active at planning stage. Missing clip access does not block source auditing or runtime diagnosis, but exact visual-equivalence approval must wait until that media can be inspected.
