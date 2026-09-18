# Road-classification candidate: CPU evidence

Candidate `9c7e1879f6c3b6c3a8b3d1b21e502bb3ae0b98b8`, base
`ce8716a72d1e5631b49ffac6c479d5ec4e9cea89`. Independent review is pending.
This does not establish browser timing, slice compliance or acceptance.

The private road split now carries each source vertex's exact water result
alongside its existing point page. Inserted markers retain the true result
already established by channel sampling. Geometry, predicates, page capacities,
ownership, scheduler limits and readiness are unchanged. No persistent cache.

## Comparable isolated measurements

macOS, M4 Pro Virtual, Node v24.20.0. Three sequential alternating cold-process
runs, no concurrent build/browser measurement. Each run decodes the same
committed binary, then measures only `roadCoverContextSteps` consumed through
the unchanged `createCoverJob` and `createBuildScheduler` with 4ms budgets.
No frame waits, rendering, GPU upload or landmark generation.

| Run | Base elapsed | Candidate elapsed | Base CPU | Candidate CPU |
| --- | ---: | ---: | ---: | ---: |
| 1 | 1254.04ms | 1068.22ms | 1502.13ms | 1297.66ms |
| 2 | 1294.63ms | 1098.28ms | 1555.18ms | 1348.83ms |
| 3 | 1318.22ms | 1135.93ms | 1582.22ms | 1376.02ms |

Median elapsed falls approximately 15.2%. Generator resumes fall from
4,188,912 to 3,711,954. All six context digests remain
`2fe9c9ece69868c64047030ba99480b2e5a754c84c4b8de6998a6376c874b7ba`.
Maximum drains ranged 6.33–6.89ms on base and 7.82–11.60ms on candidate;
the approximate 4ms budget remains a browser measurement requirement.

[Exact benchmark script](https://app.devin.ai/attachments/749b8e19-c675-4078-baa8-111d70200f36/runway-road-benchmark.ts)
and [raw paired output](https://app.devin.ai/attachments/f172287b-bd80-434f-96be-096595a8c8c4/runway-road-classification-benchmark.jsonl).
Run the downloaded script from a provisioned checkout using
`pnpm exec tsx <script> <absolute-worktree>`, alternating isolated base and
candidate checkouts. Imports and binary decoding occur before timing.

## Focused checks

All exited 0 on the candidate:

```sh
pnpm exec tsx scripts/test-water-query.ts
pnpm exec tsx scripts/test-road-cover-job.ts
pnpm exec tsx scripts/test-cover-context-ownership.ts
pnpm exec tsx scripts/test-cover-sequence.ts
pnpm exec tsx scripts/test-cover-job-lifecycle.ts
pnpm exec tsc --noEmit
pnpm exec eslint lib/game/render3d/cityBuilder.ts scripts/test-water-query.ts
git diff --check
```

The new dry/wet 1024-vertex regression checks both exact output and avoiding
repeated classification. Copying the test onto the isolated base reproduces
the intended failure: 3070 dry queries instead of 1024 (exit 1).
Full-city crossings and road-context hashes, geometry parity, boundary
crossings, defensive copies, cache ownership and cancellation still pass.

[Focused output](https://app.devin.ai/attachments/972cf066-6a91-449c-9d91-5cda2a7590a0/runway-road-classification-checks.log)
also preserves a mistaken invocation of nonexistent `test-cover-lifecycle.ts`
(exit 1). The correct `test-cover-job-lifecycle.ts` then passed; no failing
assertion was removed or weakened. Full repository gates await acceptance
and integration of the replacement-anchor packet.
