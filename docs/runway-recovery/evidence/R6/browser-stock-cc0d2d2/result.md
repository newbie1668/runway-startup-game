# cc0d2d2 bounded native production-browser validation

Completed the procedure against preserved accepted 0e3a314 evidence. **Not acceptance: wide startup, repeatable default startup and the 300-call ceiling fail; early reversals visibly regenerate lost overview coverage.** No application edits, commits, PR writes or deployments.

## Conditions

Runtime cc0d2d2; documentation HEAD 585f3704a86536349f656aaa2b4f06a04ab797a5; reused production build `akRqQkiss6Dd_W_6pro4f`.
Visible Chrome153.0.8010.48, native ANGLE Metal/Apple Paravirtual device, macOS26.5.2.
Desktop1440×900 DPR1/fine pointer; mobile390×844 DPR2/coarse touch is emulation, not physical.
URLs: `http://127.0.0.1:4321/game?qa=1`; wide appends `&view=wide`.
Matched views use `/game?view=wide&chrome=0&qa=1&look=zero|stpauls|eye`.
Fresh browser process/profile per cold/reload pair; HTTP cache cleared/disabled. OS/driver/compiler/shader caches were NOT reset. Reload shares process/JIT/GPU state.
No source reopening, build or CPU profile overlapped timing measurements. Resource/debugger observations below are separate diagnostics, not performance samples.

## First useful city

All eight candidates rendered actual useful city within the60s cap and have full screenshots. Values are passive renderer `firstUsefulFrameMs`, corroborated by visible city captures, not readiness markers alone.

|Observation|Milliseconds|≤5000ms|
|---|---:|---|
|default-1-cold|4,832.5|pass|
|default-1-reload|4,139.2|pass|
|wide-1-cold|12,063.9|FAIL|
|wide-1-reload|11,241.0|FAIL|
|default-2-cold|5,151.7|FAIL|
|default-2-reload|4,298.7|pass|
|wide-2-cold|13,321.0|FAIL|
|wide-2-reload|11,780.5|FAIL|

Wide4/4 fail; default cold1/2 fails, reload2/2 passes. Preserved baseline wide cold median13,674.35ms versus candidate12,692.45ms; reload13,088.70 versus11,510.75ms. Historical—not freshly alternating—baseline, small samples and uncontrolled compiler caches prohibit a causal timing-win claim.
Prior baseline default cold/reload were4,933.7/4,112.5ms; candidate default cold median4,992.1ms and reload4,218.95ms.
Passive road-context completion captured5/8; cover-index6/8; coverage8/8. Missing values are unavailable, not zero; stages include yields/scheduling and are not exclusive CPU.

## Matched submitted workload

All three cameras matched. Candidate calls remain over300; triangles remain under2M and tracked geometry under128MiB (134,217,728B).

|Angle|Baseline → candidate calls|Triangles|Geometry bytes|
|---|---:|---:|---:|
|zero|2390 → 905|1,908,689 → 1,908,689|130,812,722 → 130,812,722|
|stpauls|2351 → 900|1,889,114 → 1,895,193|130,812,722 → 130,812,722|
|eye|2148 → 868|1,817,927 → 1,844,302|126,393,623 → 127,349,543|

Zero call reduction is62.13%. St Paul's triangles increase6,079; Eye triangles increase26,375 and bytes955,920. These are measured frustum/workload differences, not exact parity. Bounded settled images showed no newly identified persistent missing roofs/stock/cover or seams; this is not formal London fidelity.

|🔴 Accepted0e3a314—zero overview|🟢 Candidatecc0d2d2—zero overview|
|---|---|
|![Accepted overview](https://app.devin.ai/attachments/23bc93ca-ea84-476e-b054-f1a028616eeb/candidate-angle-zero-settled.png)|![Candidate overview](https://app.devin.ai/attachments/119e54d5-7993-43f4-82c7-36f20d8bdad8/candidate-angle-zero-settled.png)|

## Interaction, persistence and reversal results

- Passed—default/wide30s held pan: p95 **20.5/19.7ms**,1,800 rAF intervals each, camera movement; below33ms. rAF intervals are not GPU execution times.
- Passed—new Road QA company, legal Build, exact save after reload and corrected Continue: **1491 characters/1492 UTF-8 bytes**.
- Passed—Fitzrovia/Shoreditch/Canary Wharf/Battersea/Camden searches and ordinary stock/cover, Residence6 Goodge St card/beam and Business23 Bank St pick.
- **Failed visual continuity**—30ms and500ms overview→near→overview reversals visibly shed overview stock (roughly20k versus113.5k stock) before regeneration. Recovery passed; no persistent holes/fallback/duplicate source cells/attached hidden replacements identified. Sampled immediate reversal regained full stock about2.4s after the first returned-wide sample and settled essential jobs about6.4s after that returned-wide sample; interrupted values about2.5s/6.7s from return. These instrumented100ms sampled intervals are approximate diagnostics, not performance acceptance.
- Passed—near→overview→near reversal and interrupted distant Canary Wharf search recovered useful stock/cover and picks.
- One exact `/^Continue$/` harness locator timed out. Source-confirmed `/^Continue/` corrected it; initial title-overlay pick is retained but explicitly not accepted proof. `*-verified` artifacts are valid.

|🔴 Immediate reversal—coverage lost|🟢 Same view—coverage regenerated|
|---|---|
|![Intermediate coverage](https://app.devin.ai/attachments/271b4a3d-8db9-4334-a5b5-8123cd8a26f6/candidate-reversal-immediate-intermediate.png)|![Recovered coverage](https://app.devin.ai/attachments/71bd50a0-0f85-407c-ad0c-ecbbf8688230/candidate-reversal-immediate-settled.png)|

## Resources, faults and touch

- Passed—warm loop plus3 identical settled overview→Fitzrovia→Shoreditch→Canary Wharf→overview loops returned **131,137,538B tracked geometry,1,100 geometries,1 texture**, zero staging/hidden/pending,1,609 tile-covered source cells. No monotonic settled tracked growth. The warmed tour overview is1,105 calls/1,914,059 triangles, distinct from the cold canonical905-call workload; do not conflate them.
- Across sampled reversals/tours: zero duplicate exposed source cells and zero attached hidden meshes. Peak resident+stock staging by flow and post-GC JS heap values are retained in `final-measurements.json`; sampled—not exhaustive allocation maxima.
- Excluded/unmeasured: cover/tree/decor/hero staging beyond stock getter; decoded CPU arrays, browser heap, texture/material/driver allocations are not totalled by geometry accounting. Physical GPU/driver reclamation and GPU execution latency are unmeasured.
- Passed—noticed manifestHTTP503 kept `3d/degraded`, ordinary Canary Wharf stock and Business23 Bank St pick. Stock count113,542 versus successful zero113,538; do not infer individual-building identity from aggregate count. Individual landmark GLB failure was not independently observed/injected.
- Passed—essential `/map/london-city.bin`503 produced playable Canvas fallback; legal Build increased product11.1036→16.7094.
- Passed—debug context loss produced `2d/fallback`, reason `WebGL context lost`, playable Build. Old controller disposed; stream null; scene empty; tracker/staging/geometries/textures/pending all zero.
- Passed—one reference-mobile emulated useful city sample **4,888.2ms≤10s**, touch pan p9519.9ms≤50ms with1,799 intervals and moved camera; Continue and Build usable. Not physical-device/Safari validation.
- Console:11 favicon404s,2 deliberate503 errors;18 aborted requests all during essential-fault fallback. No captured page errors/crashes. One corrected harness locator timeout retained.

## Preservation and cleanup

Historical save/baseline hashes unchanged; no tracked source diff. Owned server/browser/harness/recorders stopped;4321 has no listener. `cleanup.json` records checks.
No new dependencies or builds. Existing blueprint covers reused production server/native Chrome/cache setup; no suggested blueprint change. SKILL.md suggestions:none. Still needed from user:none for this bounded handback.
Physical Safari, formal London fidelity, total browser/driver memory and earlier software/mobile/startup limitations remain unresolved. No software control replay or completion claim.

## Artifacts

All raw observations, per-state PNG/JSON files, console events, diagnostics, contact sheets, `final-measurements.json`, `error-summary.json`, `cleanup.json`, and this report live in `/Users/devin/repos/runway-streaming/docs/runway-recovery/evidence/R6/browser-stock-cc0d2d2`.
External harness: `/Users/devin/runway-stock-cc0d2d2/run.cjs`.
Recordings:
- `/Users/devin/screencasts/runway-stock-startup/runway-stock-startup-edited.mp4`
- `/Users/devin/screencasts/runway-stock-game/runway-stock-game-edited.mp4`
- `/Users/devin/screencasts/runway-stock-streaming/runway-stock-streaming-edited.mp4`
- `/Users/devin/screencasts/runway-stock-faults-touch/runway-stock-faults-touch-edited.mp4`
