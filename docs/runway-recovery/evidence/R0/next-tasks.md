# Next execution packets

These are the next two runtime assignments selected from the recorded baseline. The lead supplies a fresh isolated worktree and the exact current reviewed integration SHA at dispatch, as required by the agent contract. Do not use a moving branch name as a substitute or assume another worker's files are available on the task branch. No Foo input is required to start preparation.

## R2 — hydration error

**Outcome:** server and initial client HUD text match; the London clock updates after hydration; the search and game flow remain unchanged. **Evidence:** [B8 smoke](smoke/baseline.json) has four independently captured #418 cases, and [full capture](full/baseline.json) reproduces the error across visible/hidden chrome routes. `CityHud.tsx` currently initializes its clock with `new Date()`; confirm the differing text before changing it.

**Read:** [R2 card](../../../superpowers/plans/2026-09-05-runway-recovery.md#r2--fix-the-independently-observed-hydration-error), `components/game/CityHud.tsx`, the `useSyncExternalStore` hydration pattern in `GameApp.tsx`, clock helpers in `lib/game/mapSearch.ts` and the relevant UI/browser tests. **Allowed changes:** `CityHud.tsx`, `scripts/test-ui.tsx`, browser runner/fixtures only. Preserve unconditional hooks, HUD props, search callbacks and game behavior.

**Execution:** decompose into a specified clock-store edit and a separate browser-regression packet for Luna. Use a stable neutral server snapshot and a cached client clock snapshot with 30-second notifications; a new Date returned on every external-store snapshot would itself be unstable. Keep typical monthly climate labelled as typical, not live observations. Add a genuine hydration regression with different server/client time, visible/hidden chrome, reload and clock rollover. Do not use warning suppression as the fix. Run applicable repository checks and the focused browser regression once; the lead independently verifies the claim.

## R1 — renderer observability

**Outcome:** the app reports actual 2D/3D state and useful-frame/job status instead of treating a drained queue or requested mode as proof of a working view. **Evidence:** [B2](full/screenshots/B2-desktop-cold.png) and [B3](full/screenshots/B3-desktop-cold.png) draw city geometry while readiness still times out; B6 cannot begin and performance metrics remain unmeasured.

**Read:** [R1 card](../../../superpowers/plans/2026-09-05-runway-recovery.md#r1--expose-actual-renderer-state-and-costs), [C1](../../architecture.md#c1-observable-state-r1), `MapCanvas.tsx`, `CityRenderer3D.ts` and the existing factory boundary. **Allowed changes:** the R1 card's diagnostic modules, renderer adapter, canvas host, focused tests and browser assertions. No geometry redesign, binary/GLB changes or new runtime service.

**Execution:** the lead finalizes the reporter/counter seam before dispatch. Split browser-independent state/accounting tests from the serialized renderer hookup so a smaller worker receives concrete inputs and outputs. Preserve unknown measurements explicitly; unavailable counts must not masquerade as measured zero. Expose the read-only bridge only with `qa=1`, retain fallback and SSR boundaries, and rerun the blocked B6 observations after meaningful state is available. A capable worker is reserved for a hookup that still requires material judgment after decomposition.

In parallel, the next F1 source packet must close the documented south/east map-extract gap and obtain dated, matched frontage/object evidence. F1a is not F1 GO, and no asset modelling is unlocked by the inventory alone.
