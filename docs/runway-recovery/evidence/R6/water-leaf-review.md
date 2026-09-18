# Review: water edge leaf coordinate cache

**Verdict: ACCEPT** (one non-blocking performance/memory nit with a measured 2-line improvement, two test nits).

- Candidate: `044ee1daa68dc6e91f47e97aba26a588f5ae20ca` (`origin/devin/water-edge-leaf-cache`, "Cache water edge coordinates in leaves")
- Base: `ed2203f7c762c6885d2d19f125ef3cee3352eeb1` (verified ancestor)
- Delta: `lib/game/render3d/waterEdgeIndex.ts` (+18/−12), `scripts/test-water-edge-index.ts` (+20/−3). Nothing else.
- Park baseline used for combined fixtures: `51c1b4b1803d1d9675a70068e00d0e47c543e411` (`origin/devin/park-cover-index`; parent integration `56bde734…` exists but was not used). `51c1b4b` is not an ancestor of the candidate; both sit on `ed2203f`.
- Read-only: no tracked edits in the main checkout, no branches/commits/PR. Two detached scratch worktrees under `~/water-edge-leaf-review/` (removed after use). Node v24.20.0, macOS, CPU-only; no browser evidence.
- The worker report attachment was not present on disk (`~/attachments/b846…/` empty); review done from the diff.

## What changed

Leaf nodes (≤4 edges) now store `edges: readonly number[]` = `[xi, zi, xj, zj]` per edge, decoded once during `buildWaterEdgeIndex` (`waterEdgeIndex.ts:30-45`) and frozen. `indexedPointInRingSteps` (`:79-87`) reads only the cache; the crossing predicate `zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi` and the 16-node/yield traversal are byte-identical to before. Direct callers (`waterQuery.ts:129, :217`; park `cityBuilder.ts` in `51c1b4b`) pass through unchanged.

## Findings

### Geometry parity — exact
- Cached values are the same doubles `.at()` previously returned each query; edge pairing `(i, i===0 ? length-1 : i-1)` is unchanged, so leaf edge set = old leaf edge set. Arithmetic order unchanged → bit-identical results.
- Evidence: `test-water-edge-index` (10,028 boundary cases + 2,000 `pointOverWater` cases) passes; my fixture: 250,000 random queries over the water bbox, indexed vs legacy `pointOverWater`, **0 mismatches**, hash `fbfd52e723409e2f` identical across nocache/cache; cold `riverCrossingSpans` hash `449a9b5a9274067f` identical; `test-cover-sequence` accepted context hash preserved; whole-city park cover job geometry hash `f096acc79145b688` and 118,125 triangles identical.

### Immutable-source assumption — holds
Cache is valid only if the source ring does not change after build. Sources are `sourcePointSequence(Uint16Array)` over frozen `CityData` (and the frozen dequantized legacy rings); `test-cover-context-ownership` passes. The leaf still retains `points/start/end` (now unused by the query); no extra retention since the ring already owns `points`. Nit: dead fields, keep or drop at parent's discretion.

### Leaf capacity — frozen and bounded
`end - start <= 4` unchanged → `edges.length ≤ 16`; empty ring yields one leaf with `edges=[]`, `minZ=+∞` so every query rejects (same as before; `length 0` test case). `Object.freeze` makes the tuple immutable at runtime; the leaf object itself is not frozen (unchanged from before, typed readonly).

### Per-step work
- Build: still one `yield` per edge; each step now does 4 source reads (previously 4 `z` reads via two `.at()` per endpoint); test asserts `reads === length*4` and `units <= 2*length+1`.
- Query: 16 nodes/yield × ≤4 edges = ≤64 predicate evaluations and **0** source reads per resumption (was ≤256 coordinate reads). Test tightened from `reads <= 256` to `reads === 0`; the `units <= 2*length+1` bound is retained. Nit: the ≤16-number leaf capacity is only implied (total count asserted), not asserted per leaf — a one-line `assert(leaf.edges.length <= 16)` in `cachedEdgeCount` would pin it.

### Cancellation / publication
Unchanged shape: `buildWaterEdgeIndex` is a generator; a cancelled build drops partial `edges` arrays as garbage, nothing is published until `return`, and `incrementalEdges.set(ring, …)` (`waterQuery.ts:217`) / `parkInfoCache.set` run only after the full build completes. No shared mutable state.

### Retained references / memory (CPU heap, not the 128 MiB geometry tracker)
Measured after `gc()` (see fixture table): water index heap +0.50 MiB (0.68 → 1.18 MiB); whole-city park job heap +2.2 MiB (1.91 → 4.12 MiB, retained for the `CityData` lifetime via `parkInfoCache`). ~2.7 MiB total, acceptable, but ~2.7× the ideal 32 B/edge because of the nit below.

### Non-blocking nit (explains the worker's query regression): `Object.freeze` on a number array
In V8, `Object.freeze` of a `PACKED_DOUBLE_ELEMENTS` array transitions it to `PACKED_FROZEN_ELEMENTS`, i.e. generic tagged elements — every double is boxed as a HeapNumber (8 B pointer + 16 B object instead of 8 B inline). Verified with `%DebugPrint` on Node 24 and an isolated micro-fixture (`micro2.mjs`, separate processes): frozen 104–111 ms vs plain 24–33 ms vs `Float64Array` 26–35 ms per 300 sweeps of 16k edges; heap for 200×64k numbers: frozen 311.7 MiB vs plain/Float64Array 116.4 MiB. This is the most plausible mechanism for the worker's 250k-query regression (37/51/36 → 44–71 ms): their fixture is dominated by leaf reads, and the ring/AABB rejection work is unchanged, so only the leaf reads could regress; the wide spread (44–71) also indicates GC/JIT noise from the extra HeapNumber allocation. End-to-end it is still a net win here (below) because it removes the `.at()` proxy/dequantize path.

Smallest fix (2 lines, keeps immutability intent, typed arrays are fixed-length and the field is `readonly`):
```ts
readonly edges: Float64Array;              // waterEdgeIndex.ts:17
…
edges: Float64Array.from(edges) }          // waterEdgeIndex.ts:45  (instead of Object.freeze(edges))
```
The existing test helpers (`edges.length`) keep working. Measured on park baseline + cache: queries 122 → ~100 ms, context 870 → ~795 ms, park job 497 → ~445 ms, water index heap 1.18 → 0.95 MiB, park heap 4.12 → 3.11 MiB; all hashes unchanged. Not blocking.

### Other nits
- `scripts/test-water-edge-index.ts:93` is not Prettier-formatted (`npx prettier --check` warns; ESLint and strict tsc pass).

## Combined CPU fixtures (park baseline `51c1b4b`, with/without `044ee1d`)

Fixture: `~/water-edge-leaf-review/bench.ts` (copied to `<worktree>/scripts/_bench.ts`, `node --expose-gc … tsx`), fresh `CityData` per section, 3 alternating runs each.

| metric | nocache (51c1b4b) | cache (51c1b4b + 044ee1d) | Float64Array variant |
|---|---|---|---|
| water index build ms | 5.0 / 5.6 / 5.5 | 5.3 / 5.3 / 5.9 | 6.6–13.3 |
| water index heap Δ MiB | 0.68 | 1.18 | 0.95 |
| 250k `pointOverWaterSteps` ms (warm, 3 reps) | 180–188 | 115–135 | 94–131 |
| cold `riverCrossingSpans` ms | 1065 / 1104 / 1049 | 842 / 891 / 872 | 819 / 795 / 775 |
| whole-city park job ms (5,888 steps) | 651 / 687 / 676 | 503 / 488 / 500 | 473 / 428 / 437 |
| park job heap Δ MiB | 1.91 | 4.12 | 3.11 |
| query mismatches vs legacy / hashes | 0 / identical | 0 / identical | 0 / identical |

Combined benefit is real, not just fewer source reads: ~33% faster water queries, ~19% faster cold road context, ~26% faster park cover job, with identical resumption counts (`queryUnits` 373,104, park steps 5,888) and identical output.

## Commands run
```
git fetch origin devin/water-edge-leaf-cache devin/park-cover-index
git rev-parse 044ee1d ed2203f 51c1b4b; git diff ed2203f 044ee1d; git checkout 044ee1d
pnpm tsx scripts/test-water-edge-index.ts           # pass
pnpm tsx scripts/test-water-query.ts                # pass
pnpm tsx scripts/test-cover-context-ownership.ts    # pass
pnpm tsx scripts/test-cover-sequence.ts             # pass, accepted context hash, 1029 ms CPU
pnpm tsx scripts/test-water-cover-job.ts            # pass
npx eslint lib/game/render3d/waterEdgeIndex.ts scripts/test-water-edge-index.ts   # clean
npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --skipLibCheck --esModuleInterop --types node lib/game/render3d/waterEdgeIndex.ts scripts/test-water-edge-index.ts   # clean
npx prettier --check …                              # warns on test script only
# worktrees (detached, local only): 51c1b4b and 51c1b4b + `git cherry-pick --no-commit 044ee1d`
tsx scripts/test-water-edge-index.ts / test-park-cover-job.ts / test-park-cover-eligibility.ts / test-water-query.ts   # all pass on park+cache
NODE_OPTIONS=--expose-gc tsx scripts/_bench.ts <label>   # ×3 each, results in ~/water-edge-leaf-review/results.jsonl
```

## Limitations
- CPU-only (Node 24, macOS); browser main-thread timing, GPU/geometry budget and G1 remain the parent's combined gates. The added heap is JS heap, not tracked by the geometry byte tracker.
- Micro-fixture numbers for frozen vs typed arrays are engine-specific (V8 24.x); the relative ordering should hold in Chromium but was not measured there.
- Park+cache combination was evaluated as a local cherry-pick onto `51c1b4b`, not against the parent's `56bde73` integration.
