# Single-pass road context source checkpoint

Base: published `bff439cd92ee0a8fc96502683e1078b2d788eb90`.
Worker: `294d3bf`, cherry-picked locally as `30fde9f`.
Independent source review passes with no material defects. No browser
performance pass is claimed.

## Independent review

[Reviewer report](https://app.devin.ai/attachments/b62bf4f0-2382-40cb-8709-59901dad0d4f/report-road-context.md)
compares exact worker `294d3bf` against `bff439cd`. The reviewer reproduced
the pinned public-output digest from the base revision and confirmed exact
cross-revision parity for public functions and cold/warm/interleaved/cancelled
contexts. Cancellation at 200,000 steps publishes no partial context.
Ordering, defensive copies, cache ownership, frozen output and bounded yields
remain intact. Focused tests, TypeScript, scoped ESLint and diff checks pass.
The review accepts a bounded source checkpoint only.

The context now collects crossing approaches, run ends and tier-0 crosswalk
endpoints from the same road/water traversal. Crossing selection and crosswalk
clustering retain their existing algorithms and deterministic order. Public
crossing and crosswalk functions remain available. No roads are filtered by
distance from named crossing seeds.

The committed binary still produces 15 crossings and 374 crosswalks. The
existing water-query digests and new combined-output digest remain unchanged.
The focused test covers cold/warm caches, defensive public copies, frozen
context output and cancellation followed by regeneration.

## CPU observations

The worker measured these fresh-process samples on the same machine:

| Context | CPU milliseconds | Generator yields |
| --- | ---: | ---: |
| Base | 1,102.8 | 3,711,954 |
| Single pass | 953.6 | 3,324,819 |

This single sample suggests approximately 13.5% less CPU and 10.4% fewer
yields. It is not a browser A/B result or a timing threshold. The parent
profile run measured 874.3ms CPU and the same 3,324,819 yields; differences
between machines/runs must not be interpreted as additional improvement.
Use `pnpm tsx scripts/profile-road-context.ts` for a repeatable local probe.
It reports process CPU time and has no brittle timing assertion. Its two
lines compare the current public functions and current combined context in
one process, with JIT/order bias; neither line is a base-revision measurement.
The table above comes from the worker's separate fresh-process comparison.

A separate parent experiment used padded road bounds to certify dry roads.
It retained geometry parity and reduced yields to 2,680,405, but all five
alternating observations were slower than single-pass alone (candidate
819.9–868.5ms versus control 787.6–822.5ms elapsed CPU-only execution).
The experiment was removed; it is not part of this candidate.

## Checks and limits

The [combined integration log](integration-checks/30fde9f.log) records game,
UI, lint, project TypeScript, production build, offline geodata verification
and diff checks, all successful. Parent focused water-query, road-context
parity, context ownership and road-cover-job checks pass. Only a source
comment was removed after the worker commit; runtime semantics are identical.

Existing wide startup, mobile readiness and 2,817-call failures remain open.
The candidate does not change draw ranges, geometry budgets, stock jobs,
cover paging, gameplay, assets or source geography.
