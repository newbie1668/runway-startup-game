# Context reuse: bounded production A/B — 20 September 2026

**Startup acceptance fails. No reliable performance improvement is established.**
Baseline `44bdd96ebc63d52bd7a310515780958880b5723e` and candidate
`e1aa66096545422a7eebea1419867a937ff4094a` both failed every cold observation.
This experiment does not supersede the historical wide-view failures or
certify runtime recovery.

The candidate removes the detached capability-probe canvas, reuses the actual
city-canvas WebGL2 context with Three.js's normal attributes, and releases that
context on failed initialization. Its [independent source review](https://app.devin.ai/attachments/749e2558-a07c-4f2b-bd7b-b898d786a259/review-e1aa660.md)
passed with no material findings. Context ownership and native regression
checks pass; the separate software-rendering readiness check fails.

## Observations

Milliseconds to the diagnostic first useful 3D frame, paired with actual-city
screenshots for all 20 observations:

| Round | Baseline cold | Candidate cold | Baseline reload | Candidate reload |
| --- | ---: | ---: | ---: | ---: |
| 1 | 5835.8 | 5886.8 | 5159.4 | 5025.7 |
| 2 | 5447.3 | 6334.4 | 4698.9 | 5416.8 |
| 3 | 6180.9 | 5667.7 | 5290.7 | 4727.0 |
| 4 | 6015.1 | 5724.1 | 5126.6 | 4763.8 |
| 5 | 6134.8 | 6101.4 | 6310.7 | 5162.6 |
| Median | 6015.1 | 5886.8 | 5159.4 | 5025.7 |
| Range | 5447.3–6180.9 | 5667.7–6334.4 | 4698.9–6310.7 | 4727.0–5416.8 |
| At most 5000ms | 0/5 | 0/5 | 1/5 | 2/5 |

The approximately 128ms cold and 134ms reload median differences have
overlapping ranges and a small sample. Do not attribute a dependable
improvement to context reuse or compare these directly with historical runs
under different conditions.

## Conditions

- Visible Chrome 153.0.8010.48; native ANGLE Metal / Apple Paravirtual device;
  macOS 26.5.2, Apple M4 Pro Virtual, 12 cores, 16GB.
- 1440×900, DPR1, fine pointer; production `/game`.
- Separate detached worktrees with independent frozen dependency installs.
  Baseline build `MvmtA5_TqBBp3DVEf4iCO`; candidate `aMGncfYmdwstC6h6RHs1k`.
- Sequential builds; no build/measurement overlap. Alternating revision
  order; fresh Chrome process/profile per pair; HTTP cache cleared before
  navigation and disabled for both observations.
- OS/driver/compiler/shader caches were not reset. Reload retained
  process/GPU state. Timing runs had no injected instrumentation; diagnostic
  instrumentation ran separately.

## Focused regression result

Two WebGL2 requests returned the same single context on the connected city
canvas, with matching factory/Three attributes and no detached probe.
Fine-pointer antialiasing was enabled. A 390×844 DPR2 coarse-pointer
emulation rendered actual useful 3D with antialiasing disabled.

Company setup, Build, week advancement, Fitzrovia search, held pan/zoom and
exact serialized save continuity passed. Loaded context loss recovered to
playable 2D, persisted after reload and respected explicit `map=3d`.
WebGL-unavailable and corrected constructor-failure fixtures also recovered
to playable 2D; constructor failure recorded `init:3d` and lost the acquired
context. The first constructor fixture was consumed by diagnostic DPR
evaluation and was inconclusive; the corrected execution passed.

**Separate SwiftShader smoke failed its 45-second readiness bound.** It
remained `3d/loading` behind “Laying out London…” with no finite useful-frame
time. No comparable baseline software run was performed in this packet, so
this does not establish that context reuse introduced the failure.

Seventeen resource errors identified `/favicon.ico` 404. SwiftShader also
reported four ReadPixels GPU-stall warnings. No captured page errors or
crashes. No clean-console claim.

Physical Safari, wide-view remeasurement, formal London fidelity and physical
driver-memory reclamation were outside this bounded run. Owned processes,
servers and recordings were stopped; application source and QA worktrees
were unchanged.

## Durable evidence

- [Complete bundle, full screenshots and raw records](https://app.devin.ai/attachments/7569f27c-d06e-4d56-b13c-64f99ab91e7e/evidence.zip)
- [Consolidated measurements/assertions](https://app.devin.ai/attachments/ac44215c-9047-44f7-9c3c-69ecf4b57625/final-measurements.json)
- [Native timing observations](https://app.devin.ai/attachments/7a045e46-acd1-4a2c-9cc9-b828dc9ddb5d/observations.json)
- [Gameplay and fallback recording](https://app.devin.ai/attachments/410e3495-64aa-4508-a5f6-f1643563c4d1/runway-context-game-fallback-edited.mp4)
- [Constructor/coarse/software recording](https://app.devin.ai/attachments/3e5fc814-41ca-45c7-87f9-87bd58039942/runway-context-edge-checks-edited.mp4)
- [Timing recording](https://app.devin.ai/attachments/0868e7a6-41b3-49cc-ab11-15e785fcac11/runway-context-ab-timings-edited.mp4)

Next: validate the separately reviewed overview draw-range candidate, including
actual counters, frame intervals, index upload cost and seams. Startup still
requires a new measured diagnosis; do not repeat the context experiment or
raise thresholds to obtain acceptance.
