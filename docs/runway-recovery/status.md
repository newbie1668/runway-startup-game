# Execution status

Updated: 24 September 2026 UTC. Branch `build/runway-recovery`, draft PR #30.
**Read this page first. It replaces the long running log**, which is archived
unchanged in [history/status-2026-09-21.md](history/status-2026-09-21.md) and
[history/handoff-2026-09-21.md](history/handoff-2026-09-21.md). Do not
reconstruct the current state from the PR body or from the archive.

## Why earlier sessions looped (corrected here)

1. **No reachable finish line.** PR #30 carries runtime recovery (R0–R6), but
   its "remaining acceptance" section kept listing the G2–G4 release gates:
   physical iPhone Safari, Foo's place-recognition approval, the Charlotte
   Street photo pass and a second reconstructed area. No agent can close those,
   so every session started another optimization and another evidence pass.
2. **Repeated re-measurement.** Each small change triggered a full native A/B
   with small N and ended "does not establish causal improvement". That
   result was then re-run instead of acted on. About 85% of the PR diff is
   evidence (roughly 61 MB).
3. **Blocked on sessions a new agent cannot reach.** The last candidate
   (`cf6f514`) sat "awaiting independent review" in an external Devin
   session. A missing reviewer is now a reason to review the change yourself,
   not a reason to wait.
4. **Wide-view draw calls became a blocker.** The verification contract sets
   ≤300 draw calls for a *typical desktop view*. The default and hub views
   already meet it. Only the whole-city wide view (593) exceeds it.

## PR #30 exit checklist (runtime recovery only)

PR #30 is complete when every row below is PASS on one exact commit. The
F-track and G2–G4 items in the next section do not block PR #30.
The thresholds in [verification.md](verification.md) are unchanged.

| # | Gate | State | Evidence / next action |
|---|---|---|---|
| E1 | `pnpm test:game`, `test:ui`, `lint`, `build`, `fetch-geodata --verify` | **PASS** on `77fdd79` | [log](evidence/R6/integration-checks/77fdd79.log) |
| E2 | Game/save/2D fallback/context-loss preserved (B7–B9) | **PASS** (native: pick/Build/save on `7539c58`, fallback on `cc0d2d2`; no game/fallback code changed since) | [browser-cover-7539c58](evidence/R6/browser-cover-7539c58.md), [browser-overview-stock-cc0d2d2](evidence/R6/browser-overview-stock-cc0d2d2.md) |
| E3 | Typical desktop view: ≤2M triangles, ≤128 MiB geometry, ≤300 calls | **PASS**: default 128 calls; hubs 192/93/123; later changes only lowered calls | [browser-03e5f02](evidence/R6/browser-03e5f02.md), [road-context](evidence/R6/browser-road-context-6e1fcb1.md) |
| E4 | Wide view renders all hubs within 128 MiB / 2M triangles (B4) | **PASS** at 3 azimuths; 593 calls recorded, not a PR #30 blocker | [browser-cover-7539c58](evidence/R6/browser-cover-7539c58.md) |
| E5 | Reverse zoom keeps the city visible (no 113k→20k stock drop) | **Source PASS on `77fdd79`**; needs one native confirmation | see "Continuity" below |
| E6 | Desktop first useful frame ≤5 s, `/game` default, cold | **FAIL** (5.8–8.4 s cold on the Apple-virtual test machine) | only open engineering item; see "Startup" below |

Run the native checks (E5, E6) **once** on the final candidate. Record five cold samples and the median.
State the machine. Do not repeat the run to improve the statistics.

## Not part of PR #30 (tracked separately, owner/human input required)

- **G2 faithful street / F1–F5:** Charlotte Street has a modelling **NO-GO**.
  The next step is a dated daylight photo pass
  ([recommendation](evidence/F1/acquisition-recommendation.md)), and it needs a
  person on site. After that, Foo reviews recognition.
- **Physical iPhone Safari and reference-mobile timing (G4):** these need a device.
- **Wide-view ≤300 calls:** attribution is 124 stock, 218 cover, 242
  landmarks/replacements and 9 other. Reaching 300 means batching landmarks
  and cover. It is an optional follow-up, not a PR #30 gate, unless Foo decides
  otherwise.
- **SwiftShader/headless readiness, physical GPU memory reclamation:** these are
  diagnostic limits, not PR #30 gates.

## Continuity (E5), integrated this session

- `ead3fb5` is worker candidate `cf6f514`, cherry-picked unchanged onto
  `01c0575`. Overview stock outside the new retain ring stays resident and
  visible until its bytes are needed or the new coverage settles. Stock jobs
  reserve bytes before growing, so the 128 MiB ceiling still holds.
- `77fdd79` is a review fix. With that change, a *background* stock job
  refused for room was recorded as a map error, which marked a ready map
  "degraded". Refused prefetch now cancels quietly, the same outcome as the
  existing background gate. A new tight-ceiling test fails without the fix.
- Focused stream tests at 400/1600/3200 m cover cells and the cell-stock-job
  tests pass. These include a per-frame reversal sweep: every reversal before
  the cutover keeps all stock and regenerates nothing.
- Native confirmation still needed: repeat the early-reversal check from
  [browser-cover-7539c58](evidence/R6/browser-cover-7539c58.md) once.

## Startup (E6): next bounded task

Step 1 is done (CPU-only profile on `77fdd79`, Fitzrovia camera, 3200 m cover
cells; [job lifetimes](evidence/R6/startup-path-77fdd79/jobs.jsonl)).
Command: `pnpm exec tsx scripts/profile-city-stream.ts --cover-cell=3200`.

| Milestone | Synthetic 4 ms frames | CPU ms |
|---|---:|---:|
| All visible stock resident | 126 | ~500 |
| Whole-city `stream:road-context` done | 556 | 1,751 (job lifetime) |
| Essential coverage settled (readiness) | 661 | 2,764 |

Readiness is **frame-bound, not CPU-bound**. `CityStream.drain()` runs one
4 ms budget per animation frame, plus one idle drain. The road context only
gets leftover time, so about 430 of the 661 frames wait on a single
whole-city job. At 60 Hz, 661 frames is about 11 s of wall time; the idle
drains roughly halve that. This is consistent with the measured 5.8–8.4 s
native cold starts.

Next task, done once (pick one lever and measure it):

1. **Preferred:** until the first useful frame (the map is not yet interactive
   and the title UI is DOM), let the stream use a larger per-frame budget.
   One example: several 4 ms slices up to ~12 ms per frame. Individual slices stay ≤4 ms,
   so the generation-slice gate is unchanged, and interaction frames after
   readiness keep the 4 ms budget.
2. Alternatively, restrict the road context to the visible cover cells first
   and complete the rest in the background. This is larger and must keep
   exact geometry parity.
3. Run the repository gates, then one native five-sample cold run.
   Record PASS or FAIL.

If E6 still fails after that one change, report the stage timings to Foo. Ask
for a decision: accept the measured startup for this PR, or fund a
precomputed (baked) road/cover context. Do not start another optimization
round without that decision.

## Rules that stay in force

- Preserve game rules, saves, audio, UI, the 2D fallback, the dynamic
  `three` import boundary, and the committed bbox/binary/GLBs.
- No merge, no deployment, no attachment to londonstartupmap.com.
- Keep evidence small: `result.md` plus numbers. No new multi-MB JSON or
  screenshot sets unless a gate needs them.
- Update this page in place, keeping it short. Put history in the archive,
  not here.
