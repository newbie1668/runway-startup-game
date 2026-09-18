# R6 integration candidate

Candidate source: `8393133b3b39ff266247348a564e74a475005df3`.
Parent integration branch: `devin/1789676440-camera-stream`.
PR #30 remains draft; browser and release acceptance are open.

## Production findings and subsequent runtime corrections

The [native production run on `e153df9`](browser-e153df9.md) restored 3D
navigation and game/save continuity. It still fails 5-second startup
(13.35 s cold / 12.62 s reload), wide-view readiness (>30 s) and three hub
draw-call budgets. Later source has not yet had a production browser run.

Independent review accepted [stream admission `9573562`](admission-review.md)
and [park containment `51c1b4b`](park-index-review.md), integrated as `56bde73`.
The first correction refills completed batches within the elapsed budget;
the second reuses the bounded edge index for exact park/tree predicates.
The lead reran park/tree eligibility and geometry parity, water/context,
road-cover, cover-cell/pages/lifecycle, stream/coverage, scheduler and index
checks plus project TypeScript, scoped ESLint and whitespace checks; all pass.
Full app gates await the combined candidate with the remaining isolated work.

Water leaf cache `044ee1d`, integrated as `a22118e`, also passed
[independent review](water-leaf-review.md). Exact edge coordinates are frozen
inside existing four-edge leaves; traversal, predicates, bounds and source
identities remain intact. Parent water-edge/query/context/sequence/water-cover/
park-cover/park-eligibility checks passed after integration, followed by the
`2a61884` test-only capacity/context regressions, scoped lint and project
TypeScript. The measured frozen-array cost is ~2.7 MiB of JavaScript heap;
the optional mutable typed-array experiment is not integrated.

Sequential CPU-only overview profiles (`pnpm tsx scripts/profile-city-stream.ts --overview`):

| Source | Elapsed | Synthetic drains | Max drain | Unique geometry |
| --- | ---: | ---: | ---: | ---: |
| `ed2203f` | 15.56 s | 3,590 | 9.30 ms | 127.544649 MiB |
| `9573562` | 14.37 s | 3,520 | 5.41 ms | 127.544649 MiB |
| `56bde73` | 7.75 s | 1,850 | 8.28 ms | 127.544649 MiB |
| `a22118e` (tests at `2a61884`) | 6.20 s | 1,490 | 5.80 ms | 127.544649 MiB |

All retain 113,563 buildings and 3,233 residents. On `56bde73`, the default
Fitzrovia CPU profile took 2.23 s / 515 drains, first essential coverage at
drain 460, maximum drain 8.96 ms and 31.723177 MiB. These are CPU observations,
not native first-frame timings; they exclude heroes, GPU work and frame waits.
The CPU draw estimate still exposes high overview counts (1,609 stock and
9,650 cover calls), so lower generation time does not imply a draw-call pass.

After the leaf cache, the same default Fitzrovia CPU profile measured 1.78 s,
410 drains (first essential coverage at 363), maximum drain 7.56 ms, the same
5,983 buildings and 31.723177 MiB. Both new profiles used the unchanged 400m
cover grid, ran sequentially with no build/browser workload, and retain the
exclusions above. Cover-grid `eed997d`, static batching `8cb94bf` and idle
generation `6309990` are under independent review and are not in these results.

A conservative road/water bounds bypass was rejected: isolated cold runs
slowed from 1.398/1.429/1.432 s to 1.539/1.529/1.525 s despite 13% fewer
resumptions. The experiment's production changes were removed. Only its
independently measured full road-context parity digest remains as a stronger
regression assertion.

## Scheduler correction after the first browser run

Production checkpoint `7a72081` failed startup in Chrome 153.0.8010.48 at
1440×900 DPR1: loading remained at 5 and 35.4 seconds, cover indexing finished
at 60.4 seconds, and no useful 3D frame existed by 74.3 seconds. The index
duration is elapsed job lifetime, not CPU slice cost or proof of deadlock.

Correction `e153df91bd2fa8b50d8b0e26c6baea2bcd8f1845` replaces the scheduler's
equal-clock early exit with a 4,096-step maximum per drain, retaining the
elapsed-time budget. A rounded 100 µs/1 ms clock regression fails on base and
passes on the correction. Constant clocks remain bounded across repeated
drains; a 300,000-coordinate-pair index fixture still requires multiple
drains and yields the expected final selection.

The real binary under rounded clocks needed 4,458/4,647 synthetic drains on
base despite only approximately 22/20 ms CPU indexing. The correction needed
6/7 drains, about 21/29 ms CPU, with maximum observed drains of 4.03/6.71 ms.
These probes explain starvation; they are not browser acceptance.

All eleven scheduler checks, 26 index checks, stream, stock-cell and cover
lifecycle checks, project TypeScript, focused lint and diff checks passed.
[Required app gates](integration-checks/e153df9.log) also passed sequentially:
111 game checks, nine UI checks, lint, production build, offline city-binary
verification and whitespace checks. No browser measurement overlapped the build.

[Independent review](scheduler-review.md) **accepted** this exact correction
with no required fixes. It independently verified the failing regression on
base, bounded backwards clocks, FIFO, cancellation and error cleanup. A fresh
production-browser matrix remains required for runtime acceptance.

## Repository checks

On 17 September 2026, the following sequential command completed with exit 0
on candidate source `8393133`; only `status.md` was dirty:

```sh
pnpm test:game &&
pnpm test:ui &&
pnpm lint &&
pnpm build &&
pnpm tsx scripts/fetch-geodata.ts --verify &&
git diff --check
```

[Full command output](integration-checks/8393133.log): 111 game checks, nine UI
checks, lint, production build, offline binary verification and whitespace check
passed. Platform: macOS 26.5.2 (25F84), arm64. The build finished before any new
browser performance run. Scoped reviews were still running when these gates
completed; passing commands alone do not accept the implementation.

Committed city binary SHA-256:
`6375dd81dfb23a7ef6e312b888c1b0bcf9e26b67978081a48403429221a2a2c0`.

The integration owner also ran the focused coverage, resident-store, cell,
road/water/park/tree, lifecycle, clipping, page, source-sequence, context,
street-mark and search checks, project TypeScript and explicit strict
TypeScript over the changed test files. These passed; independent reports
will record their own scoped verification separately.

## CPU-only overview profile

Command: `pnpm tsx scripts/profile-city-stream.ts --overview`.
Measured source: `2a5b3d0d80c323c97a1e65b668c240c354dfcf99`.
The subsequent `8393133` delta changes only a park parity test.

[Per-job output and final measurement](overview-cpu.jsonl):

| Metric | Result |
| --- | ---: |
| City decode | 47.51 ms |
| Stock indexing | 17.83 ms |
| Total elapsed | 14,376.30 ms |
| Synthetic four-millisecond drains to visible coverage | 3,359 |
| Maximum measured drain | 7.19 ms |
| Resident geometry / peak | 127.54 MiB |
| Resident cells | 3,233 |
| Emitted buildings | 113,563 |

This accounts for unique stock and cover geometry buffers. It excludes
landmarks, GPU upload/rendering, textures, frame waits, browser/process
overhead and real frame readiness. It does not prove a useful-frame,
draw-call, triangle or browser memory pass. No budget has been raised.

## Independent acceptance and remaining browser gate

[Cover review](cover-review.md) and [renderer/stream review](stream-review.md)
both accepted exact candidate `8393133` with no blocking findings. Their
non-blocking notes include the expected empty Node decor group, existing
formatting drift and thin overview memory headroom. No source changed after
the recorded full repository gates.

The actual production-game matrix in `verification.md` remains required.
The earlier 21-second useful 3D
frame is unresolved until measured under comparable conditions. Repeated tours,
failure recovery, visible coverage and game/save continuity require fresh
browser evidence. Charlotte Street remains a separate source-audit NO-GO;
no modelling, merge or deployment is authorized.
