# R5a-0: river-query optimization accepted

The same street and neighbourhood views that timed out at R1 now reach actual 3D readiness in **3.45 s and 4.46 s**. Default `/game` still fails because it generates excessive detailed geometry outside the view. This is a loading improvement, not G1 reliability or street-recognition approval.

The pure water lookup now rejects distant rings using precomputed bounds compatible with the existing epsilon-biased ray predicate. Crossing spans are cached weakly by immutable CityData identity and returned as defensive copies. The complete raw 15-span output and committed binary SHA-256 remain identical to R1. No building recipe, landmark, source geometry, camera, queue ordering or asset was changed. Boundary regression tests use the actual optimized lookup, including a tiny sliver outside the geometric bounds accepted by the old predicate.

Independent [review](review.md) passed after one bounded correction. Luna implemented and corrected the packet; Terra reviewed the precision/cache seam; Luna Low ran the combined commands. The lead handled integration and browser evidence. Saved partial work was resumed after usage-limit interruptions instead of rebuilt.

## Measurements

Final integrated [profile](profile.json), same Apple M1 and Node 26.5.0: cold crossing calculation **1,146 ms versus 17,915 ms**, a **15.6× improvement**. Repeated same-city lookup takes 0.017 ms. This cached timing is separate from cold-path speed. The required game suite also fell from 180 s to 61.6 s; it is not a renderer performance benchmark.

| View | R1 | This capture | Current geometry backing bytes |
| --- | --- | --- | ---: |
| B1 default | Not ready; screenshots timed out | Still not ready; 64 essential jobs pending, 49,126 buildings emitted | 1,726,080,274 |
| B2 street | Not ready; screenshots timed out | Ready at 3,447 ms; 5-second and final screenshots saved | 201,890,780 |
| B3 neighbourhood | Not ready; screenshots timed out | Ready at 4,457 ms; 5-second and final screenshots saved | 280,651,096 |

[Raw snapshots/errors](browser/map-diagnostics-browser.json), [command and real exit](browser/run-outcome.json), [street image](browser/screenshots/b2-3d-citystreet-final.png), [neighbourhood image](browser/screenshots/b3-3d-mid-final.png). The lead inspected both final images: stock buildings and streets are drawing; no facade, real-place resemblance or continuous-navigation approval is inferred from them.

The three selected cases finished in 51 seconds, with **2 pass / 1 fail**, exit 1, and no unexpected browser events. B1 still incurred four diagnostic timeouts and two failed screenshots. B1's last snapshot contains about **1.6 GiB** of unique geometry buffers and 3.1 million drawn triangles. B2/B3 geometry is about 193/268 MiB, still above the proposed 128 MiB ceiling. Their load-inclusive adapter-frame p95 values are 150/757 ms; these are not settled interaction-frame intervals. The successful readiness cases do not certify overall performance.

Capture: clean `ab41bc8293ffa82610c04ce812d83cdac8e96efd`; production runtime/build: `655ca6c5e14af6d438560b22c7e2a0929954f4cb`, with unchanged app/assets between them. Headless Chromium 153.0.8010.12, Playwright 1.63.0, 1440×900/DPR1. No mobile or real-GPU certification is claimed.

## Gates and next work

All four required app gates and all four focused commands passed once on the combined integration: [logs and exits](integration-checks/results.json). R4's pure coverage index and R3a-1's resource-pool primitive are also integrated and tested, but neither is wired to runtime loading/eviction yet. These are prerequisites, not claimed memory savings.

Next: finish the bounded scheduler and resource lifecycle, then use the reviewed cell index to emit appropriate detail only for the needed area. Preserve ordinary-building massing and cover continuity. Default-view recovery requires reducing generation at its source; lowering readiness requirements or hiding already-built geometry is not an acceptable fix. R3b's replacement/stock coverage corrections remain required before R5b geometry integration. Full pilot source coverage and the faithful London visual gate remain open.
