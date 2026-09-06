# Next worker packet: R5a-0 river/road setup cost

Status: **completed and accepted**; see [R5a-0 results](../R5a-0/README.md). The original dispatch recipe below is retained as history; do not rerun it. No product input is required. R1's measured diagnostics prerequisite is available; the next implementation worker should be Luna Medium with fresh task-only context when capacity is available. The lead supplies the exact newly verified HEAD and creates an isolated `task/runway-r5a-water-query` worktree before dispatch. Never point a worker at a moving PR alone.

## Outcome and evidence

Reduce the measured synchronous river/road setup cost while preserving all current crossing/road geometry and the London source data. [R1](README.md) measured `plan:city` at about 16.7 s in all three views; an offline `riverCrossingSpans` call took 17.9 s. Geometry budgets and later scheduler integration are separate unfinished tasks.

Read only AGENTS.md, C4 in architecture.md, the R5a plan card, R1's result/profile and the relevant functions below. Allowed files: `lib/game/render3d/cityBuilder.ts`, new `scripts/test-water-query.ts`, new `scripts/profile-water-query.ts`. If a helper extraction is needed, request the lead's explicit file ownership assignment before editing another module. No UI, camera, asset, binary, dependency or game changes. No push, deploy, agents or concurrent cityBuilder writer.

## Bounded implementation recipe

1. Start with `waterRings`, `pointOverWater`, `pointInRing`, `riverCrossingSpans`, `buildRoads`, `buildStreetLamps` in cityBuilder. Profile the unchanged committed binary once; preserve the source SHA/hash and crossing-output hash. Do not run the whole historical browser matrix.
2. Add cheap precomputed water-ring bounds before expensive ray tests. Keep existing point-in-ring/boundary and deterministic traversal semantics. Treat this as broad-phase rejection only: it must not simplify, snap, drop or reorder geometry. If a more involved spatial index is necessary, stop and let the lead revise the packet.
3. Avoid recomputing identical crossing spans for the same immutable CityData instance in planning/roads/lamps. Check consumers for mutation before choosing immutable cached results or defensive copies. Use weak ownership so disposed city data is not retained by a global cache. Distinct decoded city instances must not share stale results.
4. Verify coastal/river crossings, narrow channels, dry endpoints with a wet interior, exact/near-edge points and independent CityData instances. Compare the entire 15-span output on the real binary to R1's hash: `449a9b5a9274067f4dfe75f93598a000557c6abbb30c2c777d00d07019abf6a1`, source binary hash `6375dd81dfb23a7ef6e312b888c1b0bcf9e26b67978081a48403429221a2a2c0`. A different hash requires explanation and lead review; do not update expected values to hide a changed bridge.
5. Supply a small reproducible before/after profiler. Record cold calculation and repeated same-instance lookup separately; a fast cached lookup does not prove the first 17-second block is solved. Avoid brittle wall-clock unit-test thresholds. Target a material cold-path improvement; report the measured ratio on the same hardware.

Focused checks: new semantic tests and profiler, existing street-camera/crossing regressions, TypeScript and lint. The lead runs the four required app gates once after independent review and then B1–B3 with the existing runner. Keep both failing and improved captures. Readiness, screenshot availability, setup costs and retained geometry are separate outcomes; no budget or fidelity waiver.

Stop after two failed attempts at the same symptom or if geometry identity changes. Report exact commit, checks/exits, cold/warm timing and remaining stalls. This packet does not complete R5a's time-sliced scheduler or R3 resource ownership. No broader river/road redesign is authorized.
