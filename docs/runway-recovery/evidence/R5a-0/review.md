# R5a-0 correction review — 7ff6189..3c8899f

Spec: PASS. Quality: PASS.

- `waterQuery.ts:38-60` computes the historic epsilon-biased x intersections at both edge endpoints, retains geometric z bounds, and disables x rejection when unsafe. The direct sliver assertion (`test-water-query.ts:47-58`) proves the former strict-AABB counterexample reaches the unchanged predicate.
- `test-water-query.ts:30-79` compares actual `waterRings`/`pointOverWater` against the prior predicate over a deterministic decoded-ring grid, AABB-edge points, wet-interior and narrow-channel traversal. `pnpm exec tsx scripts/test-water-query.ts` passed: 15 spans, 6,698,590-byte source.
- `cityBuilder.ts:2695-2701` restores `{ pts, tier }`; raw returned spans now carry the preserved R1 SHA in test and profiler (`test-water-query.ts:15-17`, `profile-water-query.ts:43`).
- `profile-water-query.ts:24-43` separately reports cold/warm, committed 17,915.150917 ms R1 baseline, CPU provenance and cold ratio. It makes no unsupported whole-renderer claim.
