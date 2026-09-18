# Native production browser evidence on `03e5f02`

Runtime source: `70b4cc2d656df636c2045038708cc2665d4d337b`.
Evidence commit: `03e5f02b20b9b23c7f250891c7f665257c264517`.
BUILD_ID: `0t8Md1BMzLkjIAUVln6h5`.

This procedure used Chrome 153.0.8010.48 with native ANGLE / Apple
Paravirtual Metal on an Apple M4 Pro Virtual machine with 12 cores and
16 GiB memory. Desktop measurements used 1440×900 at DPR 1. Mobile emulation
used 390×844 at DPR 2 with touch and coarse-pointer input. HTTP cache was
disabled. The initial default navigation and the separate trace used fresh
Chrome processes and disposable profiles; later files labelled cold record
first navigation rather than a reset of OS, driver or compiler caches.

The production game renders and streams actual London city pixels. Gameplay,
search, pan/zoom, forced 2D, failure fallback and exact save continuity work
in the tested environments. Performance and complete disposal are not
accepted.

## Performance

| Measurement | Result | Decision |
| --- | ---: | --- |
| Desktop default useful 3D, fresh process | 5,069 ms | FAIL, target ≤5,000 ms |
| Desktop default reload | 4,580 ms | PASS |
| Separate visible mid navigation | 5,111.9 ms | FAIL |
| Desktop wide first navigation / reload | 14,950.7 / 13,529.2 ms | FAIL |
| Mobile-emulated wide first navigation / reload | 13,024.1 / 13,381.3 ms | FAIL |
| Desktop wide counters | 2,817 calls / 2,658,931 triangles | Over the 2 M triangle ceiling; 300 calls is defined for a typical desktop view |
| Mobile-emulated wide counters | 2,794 calls / 2,655,420 triangles | Not a physical-mobile result |
| Maximum sampled geometry | 130,812,722 B / 124.75 MiB | PASS, target ≤128 MiB |
| Desktop continuous-pan rAF p95 | 20.4 ms | PASS, target ≤33 ms |
| Touch-emulated continuous-pan rAF p95 | 20.2 ms | PASS, target ≤50 ms |

Five navigation/search cycles at each previously failing close hub stayed
below 300 calls. The maxima were 192 at Canary Wharf, 93 at King's Cross and
123 at London Bridge.

An independent CPU-only attribution found that the current complete overview
ring extrusion contributes 2,089,716 stock triangles before cover. Removing
degenerate or collinear stock geometry could save only about 0.3%. This
establishes that trivial clean-up cannot make the current wide representation
fit 2 M. It does not establish that every footprint-preserving optimisation is
impossible, and it does not change an acceptance target.

## Coverage, retention and gameplay

- The ten-minute-thirty-second production tour completed 27 destination
  selections: three passes over all eight hubs plus Fitzrovia. Every selection
  reached settled 3D with ordinary stock, roads and park/water context beyond
  the initial view.
- Completed tours 1, 2 and 3 all ended at London Bridge with exactly 105
  resident cells and 53,905,481 geometry bytes.
- The first Shoreditch arrival had 80 cells / 35,549,731 bytes; later arrivals
  had 109 / 59,008,689, about 66% more bytes. The first arrival followed
  gameplay while later arrivals followed London Bridge. This strict
  first-arrival comparison fails, while the equal completed-tour endpoints
  establish a geometry plateau. Neither result proves complete disposal.
- Unforced endpoint JS heaps were 136,091,359, 135,675,727 and 191,262,545
  bytes. GC timing and QA logging were uncontrolled, so forced-GC heap/GPU
  disposal remains unresolved.
- Title, setup validation, HQ and sector selection, Build and Growth, events,
  week advancement, dilemma, funding and audio controls were exercised.
  Desktop and mobile saves matched exactly after reload and Continue.
- Mobile emulation retained touch/coarse input, reachable dilemma/funding
  controls and no horizontal document overflow. Physical iPhone Safari was not
  available.

## Failure matrix

Blocked and truncated essential binaries reached playable 2D with an explicit
diagnostic. Optional manifest and GLB 503 responses retained ordinary stock
and useful degraded 3D. Constructor failure reached playable 2D and released
registered WebGL listeners. Loaded context loss preserved the camera centre
and the fallback flag persisted on reload. Pending fetch teardown aborted and
settled without late 3D resurrection. Low-memory and unavailable-WebGL2 paths
remained playable.

There were no unexpected console/page errors, crashes, 404 responses or
third-party requests. Three console errors corresponded to injected faults.
Duplicate animation-loop counting after fallback remains incomplete.

## Bounded trace

A separate diagnostic wide run reached useful 3D in 13,664.9 ms. The trace
sampled 10.30 s of main-thread CPU over 13.81 s. Both scheduling paths ran:
761 animation callbacks and 747 idle callbacks occurred while streaming.
These are callback counts rather than exact drain counts.

Sample-weighted inclusive stacks attribute 4.35 s to `drainStreaming` and
3.73 s to `renderer.render`; the weights overlap and are not additive CPU
billing. Three.js `WebGLBindingStates.setup/needsUpdate` had about 1.92 s of
self sample weight. A 471 ms WebGL2 capability-probe task contained about
18 ms of thread CPU and 450 ms waiting for GPU commands. Shader program-link
spans totalled 0.223 ms, so expensive shader compilation was not established.
Idle callbacks measured median 4.0 ms, p95 4.2 ms and maximum 4.8 ms, but this
does not prove every generation slice meets the approximate 4 ms contract.

The cold road-context job completed at 7,534 ms after a 6,795 ms lifetime;
the trace sampled equivalent completion at 7,415 ms followed by cover
emission until about 13,730 ms. Job lifetime is not CPU attribution.

## Evidence

- [Concise browser report](https://app.devin.ai/attachments/3c6b6bed-34f6-4b0d-b6d6-e65012a45f2e/report.md)
- [Structured measurements and provenance](https://app.devin.ai/attachments/743fc373-bb82-45ab-aaa9-4b860dce5d12/measurements.json)
- [Complete evidence bundle](https://app.devin.ai/attachments/cf52ac3f-cfc5-414d-9eba-794084225aa6/evidence.zip)
- [Production recording](https://app.devin.ai/attachments/f878f577-cfb2-47a9-83e7-a57664c7f2db/runway-03e5f02-production-edited.mp4)
- [Diagnostic recording](https://app.devin.ai/attachments/2a3894ec-50f4-49d5-82b8-7ffd3a844898/runway-03e5f02-wide-profile-edited.mp4)
- [Native trace](https://app.devin.ai/attachments/62d74794-dbd0-4f79-87b9-8571005a8c35/trace.json.gz)
- [CPU profile](https://app.devin.ai/attachments/7c4aba01-6b5a-4f1d-a765-88789660ab53/startup.cpuprofile)
- [Corrected CPU-only overview attribution](https://app.devin.ai/attachments/33c52d60-ef8f-44c7-9ae7-f2209213e5f0/diag-overview-cost-report.md)

## Open acceptance

Desktop cold startup remains slightly above five seconds. Wide startup and
the submitted triangle count remain outside the initial targets. Exact
all-slice timing, forced-GC/GPU disposal, duplicate-loop counting, a separate
non-touch mobile-sized run, current-candidate SwiftShader, physical Safari and
formal G2/F6 fidelity remain open. No source, committed geography or asset was
changed during this procedure.
