# Connected-map production browser result

Runtime/build source: `e153df91bd2fa8b50d8b0e26c6baea2bcd8f1845`.
Published checkpoint: `ed2203f7c762c6885d2d19f125ef3cee3352eeb1`.
Persistent testing agent owned setup, runners, interactions and recordings.
All testing processes stopped before subsequent implementation.

**Runtime acceptance fails.** Native visible Chrome 153.0.8010.48 reached useful
3D at 13,346 ms cold and 12,618 ms reload, against 5,000 ms desktop. Ordinary
buildings and roads rendered. Wide-view readiness exceeded 30 seconds in all
four desktop/mobile cold/reload cases. City pixels in those captures do not
establish complete coverage.

## Measurements and bounded passes

| Observation | Result |
| --- | --- |
| Navigation | Three tours, 27 unique neighbourhood selections including Fitzrovia, 10m21s total |
| Identical settled endpoints | 164 cells / 52,171,258 geometry bytes on all three tours |
| Maximum settled tour geometry / triangles | 72,112,377 bytes / 507,712 triangles |
| 30s pan/wheel trace | 1,827 frames; median 16.7 ms, p95 18.2 ms |
| Typical-view draw-call failures (target 300) | Canary Wharf 476; King's Cross 326; London Bridge 566 |
| Incomplete setup overview | Up to 10,039 calls, 2,579,670 triangles, 124,703,885 geometry bytes while loading; not settled acceptance |
| Gameplay | Company, sector/HQ, Build/Growth, events and week advancement worked |
| Save continuity | Exact serialized save/reload/Continue comparison passed |
| Loaded context loss | Recovered to playable Canvas 2D |
| WebGL2 unavailable / low capability | Explicit playable 2D fallback |
| Touch layout | 390×844 coarse-touch gameplay, dilemma and investor pitch/cooldown reached |
| Errors | Successful startup path had no diagnostic/browser errors; one B1 desktop cold case had an unattributed 404; no page crashes |

The gameplay screenshot path reset DPR to 1. It is not a full DPR2 gameplay
pass. The separate runner checked DPR2 title/readiness cases. Headless Chromium
153.0.8010.12 with SwiftShader exceeded 30 seconds/stalled on reload; those
results are stress/debug evidence, separate from native-GPU acceptance.

`stream:road-context` appeared active in samples from approximately 5.0–13.2s;
`stream:coverage:1` lifetime was approximately 11.832s.
These are sampled states/job lifetimes, not CPU attribution.

## Incomplete cases

Essential binary 503/malformed input; optional GLB/manifest failure;
pending-load context loss; constructor failure; fallback persistence;
exact DPR2 gameplay/performance; five reloads per critical view; per-layer
draw attribution; exact generation slices and CPU/GPU profiling; physical
mobile/Safari; faithful-London recognition. None is certified by this run.

## Evidence

- [Production recording](https://app.devin.ai/attachments/1eb17217-4732-4bee-9e25-065a889c9dff/runway-e153df9-production-edited.mp4)
- [Matrix recording](https://app.devin.ai/attachments/5e9fe077-a12b-40a4-9c14-6556246fe48c/runway-e153df9-matrix-edited.mp4)
- [Measurements](https://app.devin.ai/attachments/cedb5f79-a9b0-4714-a15f-bdb67b704e3a/measurements.json)
- [Complete evidence bundle](https://app.devin.ai/attachments/046eb23e-a899-472a-9c81-398ca208ae09/evidence.zip)
- [Native runner results](https://app.devin.ai/attachments/8f2e92ba-135e-42ca-a263-c1c211f0f164/baseline.json)
- [Diagnostics](https://app.devin.ai/attachments/104e7b86-1c08-4416-89e2-187d55b97be6/events.jsonl)
- [Fitzrovia](https://app.devin.ai/attachments/58ae4a4b-85d7-4af1-80bc-e41be885e455/tour3-fitzrovia.png#w=1440&h=900)
- [Wide-view failure](https://app.devin.ai/attachments/f8d1987c-d02c-4b8f-9b5f-ad6ca0d281e2/B4-desktop-cold.png#w=1440&h=900)

Next: narrow startup/generation and draw-call corrections, independent review,
combined repository gates, then fresh production browser acceptance. Keep
PR #30 draft. Charlotte Street remains modelling NO-GO.
