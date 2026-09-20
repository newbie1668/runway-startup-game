# Supplemental cleanup and hidden-controls layout

Two bounded native production-Chrome procedures supplement the
[03e5f02 matrix](browser-03e5f02.md). They do not rerun performance acceptance.

- Resource/layout diagnosis: `d12232613be52b9fce2319bd8f14dbb53cea4cf6`,
  unchanged renderer source `70b4cc2`.
- Layout correction: `00a7465ca82c5dd2fdfb01f5ae51ed3fc8ce7f4a`,
  production build `J418vZDv_O2uOcGghAA2J`.
- Native Chrome/ANGLE on the same Apple virtual GPU environment. Narrow
  configurations are emulation: 390×844 DPR1 without touch and DPR2 with
  coarse touch; desktop is 1440×900. Physical Safari remains unavailable.
- No build overlapped browser measurements. All tester-owned processes and
  recordings were stopped after each procedure.

## Controlled retention and cleanup on d122326

One warm-up followed by three identical nine-destination tours produced
matching cameras within 1e-6 and identical resident cells/geometry at every
destination. Each London Bridge endpoint was 105 cells / 53,905,481 bytes.
Post-GC endpoint heaps were 79,432,612 / 79,582,064 / 79,648,996 bytes
(+0.27%). Small monotonic drift occurred at every destination: this proves
neither a leak nor complete heap reclamation.

The older Shoreditch first-arrival comparison, 35,549,731 → 59,008,689 bytes
(+66%), remains raw evidence with different camera histories. Controlled
warmed repeats all ended at 109 cells / 59,008,689 bytes there.

Direct registered cleanup deleted all 1,600 buffers, 18 programs, 36 shaders
and 389 VAOs, plus 175 of 179 textures. Four remaining textures match the
`WebGLState.js` empty textures for 2D, cube, array and 3D targets. Three FBOs
match `WebGLRenderer.js` scratch/source/destination framebuffers. These are
fixed library baseline handles, not established application leaks.
Loaded context loss also invalidates the remaining context's handles;
physical driver-memory reclamation is not proven.

The separate capability-probe context created no tracked resources and
became unreachable after GC. Loaded fallback retained one application
animation chain without duplicate idle generation. Direct registered effect
cleanup left zero application animation/idle callbacks over five seconds.
The attempted routed unmount replaced the document; directly invoking its
registered cleanup is not evidence of ordinary React unmount scheduling.
Four intentional not-found probes produced four recorded 404s.

## Layout failure and correction

On d122326, hiding chrome during active play left the map at 44dvh
(371.359px), leaving the rest of the narrow viewport blank. Title/reload
already filled the viewport. Reproduction: found a company, enter play,
set `chrome=0` with same-document history/popstate, without reloading.

The one-line correction selects the split-height map only under the same
condition as the visible game sidebar: `screen === 'play' && game &&
!hideChrome`. It changes no renderer, save, gameplay or committed asset.

All 28 focused browser assertions passed on 00a7465:

- Both narrow configurations expand the map and canvas to 844px when
  controls hide, then restore 371.359px when controls return.
- Actual city pixels fill the resized map; held pan changes the camera
  after both transitions. There is no horizontal overflow.
- Title/setup/HQ retain the full-height map; normal play retains the split.
- Exact saves survive hidden reload and Continue in both narrow modes.
- Desktop map/canvas remain 1440×900 through hide/show and held pan.

| Historical non-touch failure | Corrected non-touch play |
| --- | --- |
| ![Blank lower viewport](https://app.devin.ai/attachments/a0b60867-87c0-41a7-9c9f-8554e5a75b60/narrow-hidden-held.png) | ![Full-height map](https://app.devin.ai/attachments/9f9855bf-30e2-4c5b-ae13-6be60ad5b9fb/narrow-hidden.png) |

The parent ran `pnpm test:game` (111 checks), `pnpm test:ui` (9),
`pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm build`,
`pnpm tsx scripts/fetch-geodata.ts --verify` and `git diff --check`
sequentially; all exited 0. [Gate output](integration-checks/00a7465.log).

## Preserved limits

Six original resource-404 console messages lacked URLs. One authorized
diagnostic navigation reproduced `/favicon.ico` 404, with both response URL
and console location, and no other captured 4xx/5xx responses or QA errors.
It cannot retrospectively identify every original message. Narrow HQ
instructions remain partly behind the search HUD, also visible in d122326;
the selector and Found control remain reachable. Neither issue was changed
by this correction.

Prior 5.069s desktop cold startup, 13.5–15s wide startup and 2.659M wide
triangles remain failures. Exact all-generation-slice timing, full heap and
physical GPU reclamation, ordinary routed unmount, physical Safari,
current-candidate SwiftShader and formal faithful-London acceptance remain
unproven. Controlled GC/handle instrumentation is not timing acceptance.
PR #30 remains draft; no merge, deployment or asset change is authorized.

## Raw evidence

- [Supplemental recording](https://app.devin.ai/attachments/66dd0ed3-4cbc-4a85-b954-b5f7d70d610e/runway-d122-supplement-edited.mp4)
- [Supplemental bundle, method and measurements](https://app.devin.ai/attachments/2e3a3a01-e38d-47e0-bc42-784c93e74239/evidence.zip)
- [Corrected layout recording](https://app.devin.ai/attachments/cdff480c-7d80-46d3-8a77-8bc43ef32455/runway-00a7465-layout-edited.mp4)
- [Correction assertions, events, provenance and screenshots](https://app.devin.ai/attachments/f27659d5-b12f-4d11-a2fa-db201d25b0bc/evidence.zip)
- [404 response/location evidence](https://app.devin.ai/attachments/86ffa019-b7dd-45b2-a06d-4a270aae54bd/404-diagnostic.json)
