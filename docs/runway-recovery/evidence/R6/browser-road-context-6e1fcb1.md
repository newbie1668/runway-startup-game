# Road-context native browser comparison

Candidate `6e1fcb1fc8b34788805199148545e554a91a4c74` versus
`bff439cd92ee0a8fc96502683e1078b2d788eb90`. Testing-agent handback:
2026-09-20. Desktop startup and wide draw-call acceptance still fail.

## Recorded evidence

- [Full report](https://app.devin.ai/attachments/bbfc5cfb-949a-42e1-8367-a71d2ab5610c/result.md)
- [Complete evidence bundle: observations, stage captures, 62 screenshots and cleanup](https://app.devin.ai/attachments/67fa5f64-2635-43fc-be64-eeb2db44e50a/evidence.zip)
- [Game and fallback recording](https://app.devin.ai/attachments/e453252f-5da4-44a7-8632-25256abb5a32/runway-road-game-edited.mp4)
- [Timing recording](https://app.devin.ai/attachments/38fab764-53e9-4b3e-a02f-92a77c371683/runway-road-native-edited.mp4)

Chrome 153.0.8010.48, native ANGLE Metal/Apple Paravirtual device,
1440×900 DPR 1. Independent frozen installs and sequential production builds
preceded timing. A fresh process/profile per pair and cleared/disabled HTTP
cache do not reset OS/driver/compiler/shader caches. No parent build or CPU
probe overlapped the measurement run.

## Startup

Milliseconds; median [minimum–maximum]. All 20 observations rendered actual
useful 3D within the 60-second cap; none was discarded.

| View/state | Baseline | Candidate |
| --- | ---: | ---: |
| Default cold, n=3 each | 5665.8 [5361.6–5674.6] | 5144.8 [4766.2–5332.7] |
| Default reload, n=3 each | 4692.0 [4641.2–5046.0] | 4241.4 [4158.5–4505.4] |
| Wide cold, n=2 each | 15462.0 [15035.8–15888.2] | 16208.7 [16050.3–16367.2] |
| Wide reload, n=2 each | 16365.7 [14574.3–18157.2] | 13967.0 [13843.9–14090.2] |

Candidate default cold passed ≤5 seconds in 1/3 runs and reload in 3/3.
Baseline passed 0/3 cold and 2/3 reload. All eight wide observations failed.
Lower default medians suggest a benefit but do not establish dependable
causal improvement; candidate wide cold was slower.

## Settled workload and regression checks

Both revisions had matching cameras and counters:

| View | Triangles | Calls | Tracked geometry bytes |
| --- | ---: | ---: | ---: |
| Default | 371,167 | 128 | 36,188,922 |
| Wide | 1,908,689 | 2,817 | 130,812,722 |

Geometry and triangle ceilings pass; the wide 300-call ceiling fails.
Candidate held-pan p95 was 19.6 ms over 30 seconds/1,800 rAF intervals.
Fitzrovia→Shoreditch→overview, zoom, Residence selection, Build, exact
1,339-byte save/reload/Continue and playable context-loss fallback passed.
One 390×844 DPR 2/coarse-touch default sample reached useful city in
4,520.3 ms; this is emulation, not physical-device evidence.

Sixteen resource-404 console messages pointed to `/favicon.ico`; no captured
page errors or crashes. Road-context stage completion was captured in 15/20
observations and coverage in 20/20; missing durations remain unavailable.
Elapsed stages are not exclusive CPU. Historical startup/mobile and paired
SwiftShader failures remain in the record. Physical Safari, formal street
fidelity, GPU execution cost and driver-memory reclamation are unverified.
All owned test processes and recordings were stopped.

## Consequence

Retain the independently reviewed road-context source optimization, but keep
startup acceptance open. The road-page shared-writer candidate was not part of
this browser run. Its source evidence cannot replace browser measurement.
