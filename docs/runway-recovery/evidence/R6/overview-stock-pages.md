# Overview stock pages — reviewed source checkpoint

21 September 2026. Integrated source `cc0d2d2`; native browser validation is next.
This is not runtime release acceptance.

## Integration and review

Worker `9867e31` / correction `b4e90c3`, based on accepted `0e3a314`, were
integrated as `01a171f` / `71b27bd`. The [independent review](overview-stock-pages-review.md)
accepts the source conditional on F1 (detach on a throwing eviction callback)
and D2 (disclose partial staging accounting). `cc0d2d2` resolves both: detach
before the host callback in cell and tile residents, test both cutover directions
with a throwing callback, and document excluded staging in the public getter.
The tests assert scene detachment, fatal notification, exactly-once disposal,
zero tracked bytes/picks/building counts after teardown and repeatable disposal.

World-origin 1600m tiles combine 4×4 existing 400m source cells. Bounded pages
preserve ordered indexed geometry, attributes, source IDs, picks and exclusions.
Dense cells split at building boundaries; legacy single-cell jobs retain their
previous behavior. Individual buildings over a page cap fail explicitly.
The review found the latter unreachable on committed data (largest footprint:
152 points). Assets, geography, material semantics, dependencies and the
dynamic Three.js import boundary are unchanged.

## Checks on the integrated candidate

- `pnpm test:game`, `pnpm test:ui`, `pnpm lint`, `pnpm exec tsc --noEmit`,
  `pnpm build`, `pnpm tsx scripts/fetch-geodata.ts --verify`, `git diff --check`: pass.
- `test-cell-stock-job`, `test-city-stream` with 400m and 1600m cover grids,
  `test-stock-draw-ranges`, `test-stream-resident-store`: pass.
- `test-road-cover-job`, `test-cover-pages`, `test-cover-clipping`,
  `test-cover-context-ownership`, `test-cover-job-lifecycle`,
  `test-road-context-parity`: pass.
- [Combined gate log](integration-checks/cc0d2d2.log) contains game/UI,
  focused stock/cover, geodata and build output. Lint, TypeScript, stream tests
  and diff checks ran separately and exited 0.

## CPU profiles (not browser/GPU measurements)

Commands: `pnpm tsx scripts/profile-city-stream.ts --overview --cover-cell=1600
--draw-ranges`, then the same command with `--transitions`, sequentially after
the build, with no browser performance run active.

[Overview output](stock-pages-overview-cpu.jsonl):
124 stock calls (previously 1609), 1,338,712 stock triangles, 113,563 buildings,
105 tiles / 124 pages. Settled stock + cover geometry: 122.623495 MiB, unchanged.
Maximum page: 65,268 vertices / 172,080 index bytes, all Uint16.
530 cover calls remain. CPU first coverage: 4.120s / 988 synthetic drains;
maximum drain: 5.930ms. These timings exclude frame waits, GPU uploads and rendering.

[Transition output](stock-pages-transitions-cpu.jsonl):

| Phase | Peak resident MiB | Peak tracked staging MiB | Peak combined MiB | Maximum drain ms |
| --- | ---: | ---: | ---: | ---: |
| Overview | 122.62 | 4.45 | 122.62 | 5.65 |
| Overview → neighbourhood | 43.92 | 13.99 | 45.47 | 6.50 |
| Neighbourhood → overview | 122.62 | 3.64 | 122.62 | 6.62 |
| Overview → search | 17.51 | 3.36 | 17.68 | 6.52 |
| Search → overview | 122.62 | 4.02 | 122.62 | 8.13 |

Peaks occur at different times; do not add the individual peak columns.
All idle phases release stock staging and preserve unique source/pick identities.
One return-to-overview drain exceeded 8ms; exact slice compliance is not established.

## Limits that remain open

- Combined bytes count resident stream geometry plus stock-job and draw-range
  staging only. They exclude heroes and cover/tree/decoration staging, and are
  sampled after drains and tracker attachments rather than every allocation.
  This is not proof of a total 128 MiB peak or an enforced runtime byte budget.
- Early trimming trades retention outside the new view for lower overlap.
  The review's synthetic reversal within three frames lost half the prior
  exposed sources for 15 recovery frames; from frame four both candidates behaved
  identically. Current-view coverage and atomic cutovers remain intact.
  Native reversal behavior must be observed.
- Existing native inventory measured 781 non-stock calls. Stock pages alone
  cannot satisfy 300 total calls with the other layers unchanged.
- Startup, native draw counts, transitions, frame intervals, memory, tours,
  picks, saves, fallback, cleanup and mobile emulation still need candidate
  browser evidence. Physical Safari and faithful-street acceptance remain open.
