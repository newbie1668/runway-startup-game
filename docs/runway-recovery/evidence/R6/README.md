# R6 integration candidate

Candidate source: `8393133b3b39ff266247348a564e74a475005df3`.
Parent integration branch: `devin/1789676440-camera-stream`.
PR #30 remains draft; browser and release acceptance are open.

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
