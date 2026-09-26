# Bounded overview browser comparison

Candidate `758bfe49784fb519bd401b0ca05f7d57c006e2f7` versus context-only
baseline `e1aa66096545422a7eebea1419867a937ff4094a`, 20 September 2026.
The candidate passes the two-million-triangle ceiling in three matched wide
views. Startup and wide draw-call acceptance still fail. This is not release
or faithful-London visual acceptance.

## Independent decision and integration

The [corrected independent evidence review](https://app.devin.ai/attachments/0d9fdaf1-2019-4e31-a881-3a321b634163/review-overview-browser-evidence-758bfe4.md)
accepts publication as a limited triangle-count checkpoint on draft PR #30.
Integrated source `1c52c13` is byte-identical to the tested `758bfe4` source,
tests and assets; only documentation differs. The [combined gates](integration-checks/758bfe4.log)
passed before the browser experiment. No build overlapped measurement.

Startup remains unaccepted. The candidate adds per-frame compatibility checks,
a readiness dependency on settled draw ranges and index re-uploads. The CPU
samples do not bound their wall-clock effect or exclude GPU/scheduling costs.
Regression is neither demonstrated nor excluded; the 30.6726-second cold sample
remains valid evidence with undetermined attribution. Diagnostic hypotheses in
the review do not replace the documented acceptance thresholds.

## Conditions

Visible Chrome 153.0.8010.48, native ANGLE Metal / Apple Paravirtual device,
macOS 26.5.2; desktop 1440×900 DPR1. Mobile is 390×844 DPR2 coarse-touch
emulation, not physical Safari. Every worktree used its own frozen install;
production builds completed before browser measurements. Fresh browser
process/profile per timing pair, HTTP cache cleared and disabled.
OS/driver/compiler/shader caches were not reset.

Build IDs: candidate `ZKLAgukhtxdkpQGwh-fkS`, native baseline
`aMGncfYmdwstC6h6RHs1k`, published software baseline `44bdd96`:
`MvmtA5_TqBBp3DVEf4iCO`.

## Measurements

Diagnostic `firstUsefulFrameMs`; all twelve native observations eventually
showed actual useful 3D and visible city screenshots.

| Sample | Baseline e1aa660 (ms) | Candidate 758bfe4 (ms) |
| --- | ---: | ---: |
| Wide 1 cold | 17,266.4 | 17,701.5 |
| Wide 1 reload | 14,705.1 | 15,819.0 |
| Wide 2 cold | 19,444.6 | 30,672.6 |
| Wide 2 reload | 23,932.6 | 21,690.6 |
| Default cold | 6,279.3 | 5,714.2 |
| Default reload | 4,998.8 | 4,835.2 |

Wide cold medians are 18,355.5/24,187.1ms; reload medians
19,318.9/18,754.8ms. The small samples and overlapping ranges establish no
dependable improvement. The 30,672.6ms observation is retained. All wide
observations and both default cold observations fail five seconds.
Both default reload observations pass.

| Metric | Baseline | Candidate | Result |
| --- | ---: | ---: | --- |
| Settled zero-angle triangles | 2,658,931 | 1,908,689 | Candidate passes 2M; 28.22% reduction |
| Settled zero-angle calls | 2,817 | 2,817 | Fails 300 |
| Settled zero-angle geometry bytes | 130,812,722 | 130,812,722 | Below 128MiB; no reduction |
| Desktop held-pan p95 | 18.6ms | 18.7ms | Below 33ms |
| Touch-emulated held-pan p95 | Not repeated | 18.9ms | Below 50ms |
| Touch-emulated useful readiness | Not repeated | 18,637ms | Fails 10s |

The three matched zero/stpauls/eye azimuths submitted
1,908,689/1,889,114/1,817,927 candidate triangles. Calls and bytes matched
baseline at each angle. Bounded visual inspection found continuous city
surfaces without new missing visible roofs, walls, cover or seams. It does
not establish universal pixel parity.

Both revisions completed Fitzrovia/Shoreditch search, zoom-out, matching
Residence picks and overview return. Candidate setup, Build and exact
serialized save/reload/Continue passed. Context loss reached usable 2D
fallback with reason `WebGL context lost`; later Build increased product
11.1036→16.7094.

## Diagnostic attribution

One separate instrumented candidate run was excluded from startup acceptance.
Sampled prepare inclusive weight was 799.3ms, with refresh701.6ms nested
inside it. Drain75.0ms includes partition step70.9ms. These inclusive groups
overlap and must not be summed.

Existing elapsed job lifetimes were cover-index154.7ms, load:city136.0ms,
stream:indices15.1ms, road-context8,631.9ms and coverage16,783.5ms. They
include scheduling/yields and are not exclusive CPU costs.

Index bufferData recorded 2,808 calls/15,953,406B/6.7ms summed CPU-call time;
bufferSubData recorded 853 calls/6,458,748B/2.1ms. Maximum payloads were
33,078B/31,368B, with no index uploads over the five-second steady interval.
Actual GPU execution/transfer cost, baseline-relative filter overhead and
every-slice compliance remain unmeasured.

A [read-only idle-index assessment](https://app.devin.ai/attachments/caa09621-e57e-4f0a-a908-fdf44861fa68/report-758bfe4-idle-cover-index.md)
identified a safe possible split of cover-index and stream idle drains.
No change was implemented: the measured 154.7ms indexing phase cannot
explain or close the much larger startup gap. Its earlier 13s/7.7s discussion
refers to historical measurements and is not current performance evidence.
The next diagnosis should distinguish road-context CPU work from scheduling
and added prepare work before another startup implementation.

## Failures, controls and limitations

Separate paired SwiftShader controls on published `44bdd96` and context-only
`e1aa660` both remained 3d/loading behind “Laying out London…” at the fixed
45-second bound, with no finite useful-frame time. The failure is reproduced
on both revisions; it is not exclusive to context reuse. The earlier unpaired
software failure and historical 5.069s cold / 13.5–15s wide results remain
preserved, not replaced by this experiment.

Console evidence has eighteen favicon404s and eight SwiftShader ReadPixels
warnings; no captured page errors or crashes. There is no clean-console claim.
One incidental screenshot occurred during baseline pan. An initial hidden-query
search reset the camera, and a title-overlay pick did not reach the canvas;
those artifacts remain preserved, with corrected in-play evidence used.

Physical Safari, formal London fidelity and physical driver-memory reclamation
remain untested. All owned browsers, harnesses, servers and recordings stopped;
ports4319–4321 had no listeners and all three build checkouts were clean.

## Durable evidence

- [Complete measurements and full screenshots](https://app.devin.ai/attachments/b9453564-bb58-44c3-936b-398d22252abb/evidence.zip)
- [Compact results](https://app.devin.ai/attachments/927e9223-cd76-4a6f-abc0-7f5bee65c38c/final-measurements.json)
- [Raw observations](https://app.devin.ai/attachments/ab9dd982-a45f-4b8d-aceb-30a7c2a24de1/observations.json)
- [Timing summary](https://app.devin.ai/attachments/5c0ddd2f-6061-4a76-9235-1307871b0c40/timing-summary.json)
- [Diagnostic summary](https://app.devin.ai/attachments/99d32af0-5cf6-4666-ae18-c97f1d68c56a/diagnostic-summary.json)
- [Raw CPU profile](https://app.devin.ai/attachments/cbbd8ee8-18df-4872-8ed1-ad7d28cee5d2/profile.json)
- [Upload observations](https://app.devin.ai/attachments/34dc3012-c728-4334-a8fc-2c2ee5699ca1/uploads.json)
- [Browser/GPU provenance](https://app.devin.ai/attachments/8b9d7ba3-9f68-476b-bb35-778046d0dc79/browsers.json)
- [Console events](https://app.devin.ai/attachments/4aec997a-1934-45f2-a8e8-2ff77833772a/events.jsonl)
- [Cleanup](https://app.devin.ai/attachments/94792fb8-444d-4080-9b89-c68d9e6c2ca5/cleanup.json)
- [Native recording](https://app.devin.ai/attachments/9ae4892c-68f0-40f4-8081-a0e6be1649dd/runway-overview-native-edited.mp4)
- [Visual/gameplay recording](https://app.devin.ai/attachments/b4c66318-c13d-4c0b-be98-3c94dae676d7/runway-overview-visual-game-edited.mp4)
- [Diagnostics/software recording](https://app.devin.ai/attachments/77a3e9cc-6c20-47e7-bffd-091b26a7386e/runway-overview-diagnostics-software-edited.mp4)

| Baseline overview | Candidate overview |
| --- | --- |
| ![Baseline](https://app.devin.ai/attachments/731b1a25-ae0b-4bcc-a796-a1490a35264a/baseline-angle-zero.png) | ![Candidate](https://app.devin.ai/attachments/2149482b-e4ad-4b59-80b4-7aebe5df6587/candidate-angle-zero.png) |

| Candidate pick | Candidate playable fallback |
| --- | --- |
| ![Residence](https://app.devin.ai/attachments/cd2f5a2f-e589-4260-8cfd-1e3461993346/candidate-pick-play.png) | ![Fallback](https://app.devin.ai/attachments/8a6b92e1-d114-4e83-96e6-558890a69832/candidate-fallback-settled.png) |
