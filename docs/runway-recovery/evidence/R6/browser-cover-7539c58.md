# Native cover-grid comparison: 7539c58

**Bounded call reduction verified; startup, 300-call acceptance and early
reverse-zoom continuity still fail. PR #30 remains draft.**

Runtime source `0cf8649`, evidence head `7539c58`, changes cover cells from
1600 to 3200 m. The previous stock-page runtime `cc0d2d2` is the baseline.
The persistent testing agent ran production builds in visible Chrome
153.0.8010.48, native ANGLE Metal / Apple Paravirtual, 1440×900 DPR1.
Fresh browser process/profile per pair; HTTP cache cleared/disabled.
OS, driver, compiler and shader caches were not reset.
Parent builds/profiles did not overlap browser measurements.

- [Full testing report](https://app.devin.ai/attachments/e82ff4f6-99b2-4cce-882c-b568179615ec/result.md)
- [Raw evidence bundle, including corrected annotations](https://app.devin.ai/attachments/b303309b-f986-414e-9679-89c57436fc3a/evidence.zip)
- [Native recording](https://app.devin.ai/attachments/4b2609cd-1a36-409e-b597-38361bf5e951/runway-cover-native-edited.mp4)
- [Close coverage and gameplay recording](https://app.devin.ai/attachments/e1591cbb-e43b-43df-b49a-809bb760d1cd/runway-cover-close-edited.mp4)
- [Matched startup controls recording](https://app.devin.ai/attachments/a3df5420-00fe-4274-9495-c1e121f04280/runway-cover-startup-control-edited.mp4)
- [Source review and full repository gate](cover-grid-3200.md)

## Draw submissions and geometry

| Look | Baseline calls | Candidate calls | Candidate triangles | Candidate geometry bytes |
|---|---:|---:|---:|---:|
| Zero | 905 | 593 | 1,890,007 | 129,956,978 |
| St Paul's | 900 | 588 | 1,876,511 | 129,956,978 |
| London Eye | 868 | 569 | 1,825,574 | 126,503,795 |

Two actual submission frames reconcile exactly:
124 stock + 218 cover (104 road, 44 water, 70 park)
+ 242 landmarks/replacements + 9 other = 593 calls.
Instrumented frames are not timing evidence. Geometry and triangles stay below
128 MiB / 2 million at these measured views; all exceed 300 calls.

## Startup: every observation retained

Milliseconds to useful 3D. The original candidate matrix passes 5 seconds
once in eight samples; all eight contemporaneous controls fail.
Every sample produces useful 3D within 60 seconds.

| Observation | Cold | Reload |
|---|---:|---:|
| Candidate default 1 | 8,453.1 | 6,173.0 |
| Candidate wide 1 | 16,262.0 | 14,105.6 |
| Candidate default 2 | 5,828.6 | 4,875.7 |
| Candidate wide 2 | 18,182.3 | 18,469.5 |
| Baseline default control | 7,666.2 | 6,110.7 |
| Candidate default control | 7,269.4 | 6,378.7 |
| Baseline wide control | 16,902.5 | 19,805.7 |
| Candidate wide control | 14,775.7 | 14,088.9 |

The contemporary baseline also ran slower than its historical observations.
Candidate wide controls were faster and default controls were mixed.
Small sample sizes do not establish causality or dependable improvement.

Passive stage capture was incomplete: city 11/16, indices 12/16,
cover-index 11/16; road-context and coverage 16/16. Missing values are
unavailable, not zero. The startup-control recording's final annotation
was corrected to **failed**; the corrected sidecar is in the evidence bundle.
Raw samples were not altered.

## Close views, boundaries and preservation

First-tour cover readiness for Fitzrovia, Shoreditch, Canary Wharf,
Battersea and Camden was respectively 851.2 / 1152.5 / 402.1 / 550.4 /
451.2 ms. No persistent missing cover remained. All sampled repeat
cover/essential transitions stayed under five seconds; slowest was
Shoreditch at 3902.7 ms.

Real drags crossed four 3200 m quadrants. The exact corner exposed four
street-detail cover cells with missing cover, pending jobs, duplicate sources
and hidden attached groups all zero. The southeast trace took 5522.3 ms
including gestures and held screenshots; it is not a five-second timing pass.

Fitzrovia essential-ready geometry increased from 46,889,342 to 49,987,565
bytes (+2.95 MiB), and settled geometry from 47,080,842 to 50,391,929 bytes.
Larger cover cells retain more close-view work; workload parity is not claimed.

Four settled tour endpoints repeated exactly at 129,956,978 bytes,
586 geometries and one texture, with no staging, pending jobs or hidden groups.
Residence pick/card/beam, Build and exact 1491-byte save/reload/Continue passed.
Build increased product from 11.104 to 16.709.

The known early reversal still loses stock from 113,538 to 20,514 before
recovery. This cover-grid change does not correct stock eviction.
The separate continuity candidate requires independent review and native
validation before any improved-continuity claim.

## Limits and decision

Sixteen favicon 404s were recorded; no page errors, crashes or failed stream
jobs were captured. Historical evidence hashes stayed unchanged, tracked
source was untouched, baseline checkout was clean, and owned browsers,
harnesses, recordings and servers were stopped.

Tracked geometry and stock staging exclude cover/tree/decoration/hero
staging, CPU arrays, browser heap, materials/textures and driver allocations.
They are not total allocation peaks. The unchanged fault/mobile matrix and
held-pan p95 were not rerun. Physical Safari/device behavior, total GPU/driver
memory and faithful-London recognition remain untested.

Retain the reviewed parameter change as a measured call reduction with
documented close-view retention cost. Keep all acceptance thresholds and
historical failures. Next: independently review the reserve-before-allocation
stock continuity correction, then validate the accepted combined candidate.
