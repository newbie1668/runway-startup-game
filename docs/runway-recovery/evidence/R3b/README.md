# R3b stock restoration and failure coverage

Production source: `d51a42b7a6ac71446ca871707c89ea5248d4ba27`. Ordinary OSM stock remains when a mapped replacement is unavailable, disabled, failed, empty, or invisible. Exclusion activates only after visible replacement geometry attaches; zero-instance meshes do not activate it. The parked No. 1 Poultry asset remains disabled and its ordinary footprint remains. The fallback camera clamp is integrated at `fcc48c0`.

All four required app checks and focused stock/camera checks passed on the integrated source; [exact commands and exits](final-checks/results.json). The isolated production server on port 4318 serves that build. Later runner/evidence commits initially changed no app source.

## Normal views

[Capture](normal-views/map-diagnostics-browser.json) at clean `e9ff3e3`: 2/2 readiness cases passed with zero unexpected browser errors. Citystreet drew 5,685 buildings (90 more than the previous capture), using 205,648,046 geometry-array bytes and a first useful frame at 4,689.3 ms. Mid view drew 7,930 buildings (86 more), 283,261,360 geometry-array bytes, 5,588.3 ms. These results demonstrate restored coverage, not the proposed 128 MiB/performance acceptance. Full-city default remains unresolved.

## Failure capture in progress

Runner `00a19e5` includes reviewed bounded committed-data fixtures. The Wardian target maps through production ownership to original building 49,404, which is present in the 80-building fixture. All roads, parks and water are deliberately omitted from that fixture. This tests fallback lifecycle and stock availability, not city-wide coverage or visual fidelity.

The [initial city failures](city-failures-initial/map-lifecycle-browser.json) show actual ready 2D fallback at zoom 26 for city HTTP 503 and a truncated binary. L5 passed completely. L4 behavior checks passed but event classification rejected Chromium's expected503 console message and owned-fetch cancellations. The [initial optional-GLB result](failure-browser/map-lifecycle-browser.json) drew all 80 stock buildings in degraded 3D and recorded the exact optional asset failure; its event check rejected the injected target503 console message. This first invocation also records two invalid case names supplied by the lead; they were corrected in the separate city-failure run. Both red reports are retained without changing their exits.

The lead inspected the fallback and degraded 3D screenshots. Scoped event-classifier correction and final reviewed capture remain pending. No G1, visual-recognition, release or deployment acceptance is claimed.
