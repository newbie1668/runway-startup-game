# R3a resource ownership and recovery

The renderer now owns its geometry, materials, textures, prefab sources/clones and pending loads. Teardown invalidates the generation before aborting; late parsed scenes are released, shared resources survive another clone's release, and constructor failures roll back allocated resources. Optional asset failures carry stable diagnostic IDs. A reporter supplied by the host survives the 3D-to-2D renderer swap.

Implementation is reviewed through worker `fc7349c` and integrated `de4165d`. The final app/runner checkpoint is `cf614a597d647f69dcb3a616e34c79b44a831706`. All four required app gates plus the two affected lifecycle scripts passed there; the game suite completed 111 checks in 78.2 seconds, and UI completed 9 checks. [Final command evidence](final-checks/results.json), [runtime review](runtime-review.md), [tree ownership review](tree-review.md).

## Production browser evidence

The final failure suite captured clean commit `94d9b94`: **3/3 cases, 23 assertions, zero unexpected browser errors**, with one final screenshot per case. [Results](browser-final/map-lifecycle-browser.json), [runner review](browser-runner-review.md).

| Case | Observed result |
| --- | --- |
| Optional noticed manifest HTTP503 | Useful 3D stock remains, with degraded state and exact optional asset error; first useful frame 3.87s. |
| Context loss while city data is pending | City fetch signal aborts, debug hook is removed, 2D reports fallback/ready, delayed response cannot revive 3D. |
| Constructor throws after WebGL allocation | Failed renderer listeners are removed; host records initialization error and ready 2D fallback. |

The earlier [failed capture](browser/map-lifecycle-browser.json) is retained: it exposed premature disposal of the shared host reporter. The corrected ownership test and final capture prove that failure was addressed.

Normal production views captured clean commit `ea6af67` passed **2/2 readiness cases** with no unexpected errors. [Results](normal-views/map-diagnostics-browser.json).

| View | First useful frame | Stock buildings | Geometry bytes |
| --- | ---: | ---: | ---: |
| B2 street | 3.66s | 5,595 | 201,890,780 |
| B3 neighbourhood | 5.09s | 7,844 | 280,651,096 |

Both geometry totals exactly match the R5a-0 baseline. This work fixes lifetime and recovery; it does not reduce resident geometry. Lead inspection confirms the procedural 3D views remain present, without certifying London recognition quality.

## Remaining gates

- The L2 screenshot exposes an existing camera mismatch: the host copies the close 3D zoom into 2D (`MapRenderer.setCamera` does not clamp zoom), producing an over-zoomed fallback. Lifecycle assertions pass; fallback framing still needs correction in R6 navigation, followed by visual verification. [Screenshot](browser-final/screenshots/l2-context-loss-pending-load-final.png).
- Default B1's approximately 1.6 GiB geometry problem remains open. B2/B3 still exceed the 128 MiB target; B3's single 5.09s result is not a latency-budget pass.
- Repeated-tour/eviction resource checks depend on R6. They are not certified by these teardown tests; G1 remains open.
- No merge, deployment or main-domain attachment was performed. F1 GO and visual recognition are separate gates.

The earlier pure pool primitive and its [review](review.md) remain part of this ownership implementation. Initial combined checks are also [preserved](integration-checks/results.json); their game timing was unmeasured and overlapped other checks. Final checks above ran sequentially with monotonic durations and authoritative process exits.
