# R1: actual renderer state and measured loading costs

**R1 observability is accepted. 3D reliability remains failing.** A clean production capture on 6 September 2026 at `94e485463e91379d5c7b8863c9597f03a77b9c87` completed all six targeted cases in 111 seconds: the three diagnostic/fallback cases passed; B1–B3 failed readiness and screenshot capture. The runner correctly exited 1. [Raw snapshots, assertions and events](browser/map-diagnostics-browser.json), [command outcome](browser/run-outcome.json).

## What changed

The host reports the renderer actually selected, exposes a detached frozen QA snapshot only with `qa=1`, and waits for an actual frame before dismissing loading. Named load/build jobs report errors and timings. Ordinary stock geometry must draw after essential jobs complete before 3D can become ready. Ground or a landmark alone does not qualify. Essential failures switch to the preserved 2D fallback with a reason; optional failures remain visible as degraded state. Geometry backing buffers are counted once across shared owners and released from accounting on disposal. Late callbacks respect renderer disposal.

Geometry recipes, city data, GLBs, queue order/budgets, game mechanics and the dynamic Three.js boundary were preserved. No asset rebake or binary regeneration was required. Individual GLB loader failures still need R3; existing per-asset loader internals are outside this aggregate-load instrumentation.

[Pure reporter review](state-review.md), [host review](host-review.md), [renderer correction review](renderer-review.md), [runner review](browser-runner-review.md). Luna implemented the packets and ran commands; Terra reviewed the asynchronous renderer/host seam; the lead owned integration and acceptance. Worker usage limits interrupted final reporting after code/logs were already saved. The lead recovered them, fixed one runner capture guard and completed the capture without relaunching workers.

## Verified behavior and remaining failures

| Case | Result |
| --- | --- |
| D1 explicit 2D and QA URL toggle | Ready after a real 2D frame; bridge absent initially, frozen when enabled, removed when disabled; no errors |
| D2 unavailable WebGL2 | Actual 2D fallback, explicit capability reason, first frame 17 ms; no errors |
| D3 injected city HTTP 503 | Actual 2D fallback, essential `load:city` error retained, first frame 270 ms; only the two injected endpoint events occurred |
| B1 default `/game` | Actual 3D, still loading; last snapshot had 97 essential jobs pending and zero stock buildings drawn |
| B2 street view | Actual 3D; stock drawing but 9 essential jobs remained, so readiness correctly stayed false |
| B3 neighbourhood view | Actual 3D; stock drawing but 2 essential jobs remained, so readiness correctly stayed false |

| Last available measurement | B1 default | B2 street | B3 neighbourhood |
| --- | ---: | ---: | ---: |
| City planning job | 16,772 ms | 16,740 ms | 16,720 ms |
| Queued jobs / essential pending | 168 / 97 | 21 / 9 | 8 / 2 |
| Stock buildings emitted | 0 | 4,517 | 7,844 |
| Unique geometry backing bytes | 22,059,100 | 159,341,706 | 278,807,456 |
| Draw calls / triangles | 9 / 2,113,003 | 14 / 421,018 | 75 / 1,814,244 |
| Adapter-frame p95 | 1,007 ms | 1,322 ms | 879 ms |

These are partial snapshots before timeouts, not settled budgets. Adapter-frame duration includes synchronous work and rendering; it is not a 30-second panning frame-interval trace. Geometry bytes are neither total GPU memory nor process RAM. Neighbourhood geometry reached about 266 MiB, exceeding the current proposed 128 MiB budget. All six B1–B3 screenshots timed out and 18 snapshot evaluations timed out. No unexpected console/page/crash/network errors were recorded. Absence of such events does not negate the measured unresponsiveness.

The earlier [R0](../R0/result.md) B1–B3 readiness failures remain red. R2 eliminated its separately observed hydration error. R1 now shows actual mode, incomplete essential work and measured setup/geometry costs; this is sufficient to assign the next runtime fix, not to approve navigation, visual quality or release.

## Narrow profile and next task

An offline call to the existing `riverCrossingSpans` on the committed city took **17,915 ms** and returned 15 spans. [Profile and source/output hashes](crossings-profile.json). This closely matches the browser's city-planning delay. Source inspection shows the calculation is also invoked by road and lamp builders. `pointOverWater` currently scans every water polygon's vertices for each query without an inexpensive boundary rejection. The specific optimization is a hypothesis to verify against unchanged output, not an already implemented speedup.

The [next bounded packet](next-task.md) targets this measured CPU cost. R3 resource ownership, R4/R5 cell budgets/scheduling, R6 navigation including the missing Fitzrovia search entry, and F1's full pilot reference coverage remain open. No London street-recognition or release gate is approved.

## Verification and reproduction

All four required app gates passed at runtime `fe64aa0493f7a337b0a5224d94073d4b5fc897a3`: 111 game checks, 9 UI checks, lint and production build. [Timestamped logs and actual exits](integration-checks/results.json). Subsequent edits only changed the browser script and documentation; integration script lint and syntax checks also passed. Focused reporter and geometry/queue checks passed during worker review.

Environment: Apple M1, macOS Darwin 25.6.0, Node 26.5.0, pnpm 10.33.0, Playwright 1.63.0, headless Chromium 153.0.8010.12; desktop 1440×900/DPR1. This is headless diagnostic evidence, not real iPhone/GPU performance certification.

```sh
pnpm build
pnpm start --hostname 127.0.0.1 --port 4318
# Separate terminal:
node scripts/test-map-diagnostics-browser.mjs
# Expected on this checkpoint: six cases, three failures, exit 1.
```

Use `RUNWAY_EVIDENCE_DIR` for a new output directory when retaining the baseline. `RUNWAY_CASES=B1-3d-default,B2-3d-citystreet,B3-3d-mid` selects only the three production views after the next relevant change. Invalid selections fail. No merge, deployment or domain attachment was performed.
