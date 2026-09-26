# Native startup diagnosis on ce8716a

Runtime/build source: `2ce587cf2d7d8bfe80775f1c8e770cd5d8ed666d`.
Published source including documentation: `ce8716a72d1e5631b49ffac6c479d5ec4e9cea89`.
PR #30 remains draft. This is diagnostic evidence, not runtime acceptance.

Native production measurements reported useful 3D at **7.23s cold / 5.43s
reload**, still above the five-second desktop target. The follow-up bounded
CPU/GPU trace below observed **6267.5ms** with actual city pixels, ready 3D,
5634 buildings, 29 draw calls, 368444 triangles and zero diagnostic errors.
The traced run is not an uninstrumented timing comparison.

## Conditions

- Chrome 153.0.8010.48, native ANGLE / Apple Paravirtual Metal.
- Apple M4 Pro Virtual, 12 cores, 16 GiB, 1440×900, DPR1.
- Local production `/game?qa=1`, HTTP cache disabled.
- Fresh browser process and disposable profile; OS/driver/compiler and file
  caches were not reset. Do not label this compiler-cold.
- No simultaneous build. The tester stopped this bounded diagnostic before
  the next source edits.

## Attribution and limits

The trace attributes a **348.8ms task / 344.7ms thread CPU** to
`onCityData → mapReplacementAnchors → containsPoint`. Every anchor decoded
every footprint before its bounds rejection. Exact per-call footprint bounds
are the next narrow optimization.

Matched road-context source includes `roadCoverContextSteps`, `pointOverWaterSteps` and
`indexedPointInRingSteps`. Lifetime is not a single slice duration. The lead
candidate reuses water classifications within one road split, avoiding repeated
queries without changing predicates or adding a persistent cache.

`slowestJob.ms` is job lifetime. Diagnostic `frameP95Ms` measures renderer CPU
duration, not continuous animation-frame intervals. Neither proves the slice
or interaction budget.

The trace did not rerun wide view, hub draw-call budgets, gameplay, mobile,
faults, repeated tours or the complete reload matrix. Those remain open on this
source, alongside the five-second startup gate. Physical mobile/Safari remains
unavailable on this machine.

## Durable artifacts

- [Native recording](https://app.devin.ai/attachments/9e45cffb-a537-4c8b-8fda-cc73147b938a/runway-ce8716a-startup-profile-edited.mp4)
- [Rendered useful frame](https://app.devin.ai/attachments/b21e1076-36d0-4b44-8419-d456be2cf706/useful3d.png)
- [CPU profile](https://app.devin.ai/attachments/ed0178f3-e37c-416b-acff-55b7baa25f68/startup.cpuprofile)
- [Compressed trace](https://app.devin.ai/attachments/6e73d98b-bdc3-4ec1-98f3-5582aa81142d/trace.json.gz)
- [Attribution](https://app.devin.ai/attachments/8fb73488-1f64-428a-a293-cbd367fd149b/attribution.json)
- [Source contexts](https://app.devin.ai/attachments/3a4b1d9d-0c02-4b6d-9176-b35e805e79cc/hot-source-contexts.json)
- [Script provenance](https://app.devin.ai/attachments/aa3e8f09-1015-45d9-8d4d-950c33529496/scripts.json)
- [Diagnostics](https://app.devin.ai/attachments/64e23836-e179-4112-b301-260dc6ca220f/diagnostics.json)
- [Environment](https://app.devin.ai/attachments/8bac5f89-f2be-4e99-84a1-c0c9ec55aecb/environment.json)
- [Network](https://app.devin.ai/attachments/0d4b80a7-b5ec-444b-8a92-6b5982754f67/network.json)
- [Camera bounds](https://app.devin.ai/attachments/2c5e20a5-df8c-4014-844f-fedf13299aeb/camera-bounds.json)
