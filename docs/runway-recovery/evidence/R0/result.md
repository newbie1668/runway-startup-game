# R0 baseline findings

The reviewed runner completed one full capture on 5 September 2026, 17:54–18:08 UTC. **This is a reproducible failing baseline, not a reliability or visual-quality pass.** [Structured results](full/baseline.json), [command and exit](full/run-outcome.json), [console output](full/full-matrix-console.log) and [repository checks](integration-checks/results.json) are retained.

Capture: clean `e0080a898a5fed4bf28f4b2975d8693b72c646c3`. Production build: `31b1d992b4dce272e6a1f2596dc9992e5c316d98`; app, component, renderer, map-asset and dependency trees were unchanged between build and capture. Environment: Apple M1, 8 GiB RAM, macOS 26.6.2, Node 26.5.0, pnpm 10.33.0, Playwright 1.63.0, headless Chromium 153.0.8010.12. Desktop was 1440×900/DPR1/fine pointer; mobile emulation was 390×844/DPR2/touch/coarse. This is not real iPhone performance evidence.

| Observation | Result |
| --- | --- |
| B1–B5/B8, both viewports, cold and reload | 24 records; all failed; process exit 1 |
| B8 forced 2D | All 4 reached legacy readiness, but each captured React #418 |
| Other 20 records | 18 timed out waiting 30 seconds for readiness; 2 default-view reload preparations hit the 3-second diagnostic-evaluation timeout |
| Hydration | React #418 captured in 22 of 24 matrix records and both B6 observations |
| Screenshots | 20 matrix screenshots saved; 4 matrix attempts and both B6 failure-screenshot attempts timed out |
| All-hub search observation | Could not start: readiness timed out; 0 navigation actions completed |
| 30-second pan observation | Could not start: readiness timed out; 0 frame samples collected |
| Page crashes | No page-crash event captured in this bounded run; this does not negate the observed unresponsiveness |

The lead inspected the [B2 street view](full/screenshots/B2-desktop-cold.png) and [B3 neighbourhood view](full/screenshots/B3-desktop-cold.png): buildings and roads are drawing even though the legacy completion signal times out. The existing [2D desktop](smoke/screenshots/B8-desktop-cold.png) and [mobile](smoke/screenshots/B8-mobile-cold.png) title screenshots also render. These images establish drawn output at capture time, not source accuracy, actual-mode instrumentation, continuous geographic coverage or first-useful-frame timing.

## Decisions and next packets

Accept the source inventory and baseline tooling as reviewed submissions. Preserve this red baseline. **The blocked B6 navigation and pan measurements remain open**; their failure is recorded rather than replaced by a 2D timing result. This evidence is sufficient to start the targeted R2/R1 fixes, while G1 reliability and G2 recognition remain unapproved.

The first two runtime packets are prepared in [next-tasks.md](next-tasks.md). R2 addresses the observed hydration error; R1 distinguishes active renderer, useful output, job failures and background completion. Do not start another landmark or whole-city rebuild to address these symptoms. The complete intended interfaces and acceptance criteria remain in the linked execution plan.

The proposed performance budgets remain uncalibrated. First useful 3D frame, frame p95, generation slices, draw calls, unique geometry bytes and resource retention are unmeasured here. R1 instrumentation and a runnable tour are prerequisites. The [asset inventory](asset-inventory.json) is 18,561,132 committed map bytes across 73 files; this is not an initial network payload or GPU-memory measurement.

All 111 game checks, 8 UI checks, lint, production build and binary verification passed on integration. The game suite took 188.5 seconds. Its earlier interrupted/ambiguous worker runs were superseded by a complete logged run; no game assertion was weakened.

## Reproduction

From the execution branch, install with its frozen lockfile and build. Start `pnpm start --hostname 127.0.0.1 --port 4317`, then in another terminal run `RUNWAY_EVIDENCE_DIR=/tmp/runway-r0-repeat pnpm test:map:browser`. A separate output directory preserves this captured baseline. The runner should write all results before returning nonzero. Do not interpret its requested mode or legacy readiness as R1's future diagnostics.
