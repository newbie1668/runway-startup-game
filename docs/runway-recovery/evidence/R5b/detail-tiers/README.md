# R5b-2 detail tier evidence

The reviewed API creates overview walls/caps, neighbourhood facades and existing street detail before allocating geometry. The renderer does not consume these tiers yet. Worker correction `65e9edc` passed independent review and was integrated at `11a5803`. Combined application checks are pending the R5b-3 cell job correction.

The standalone comparison was captured on clean source `52a07f8350c7d648545a758c7d4f21054f730ef3` on 9 September 2026. The same first 16 original building records of the densest 400 m owner cell `14,10` appear in each panel, with identical camera, lighting and material. The committed binary SHA-256 is `6375dd81dfb23a7ef6e312b888c1b0bcf9e26b67978081a48403429221a2a2c0`.

| Tier | Sources | Triangles | Raw geometry bytes |
| --- | ---: | ---: | ---: |
| Overview | 16 | 223 | 19,302 |
| Neighbourhood | 16 | 1,705 | 134,898 |
| Street | 16 | 6,890 | 539,724 |

[Comparison image](stock-tier-comparison.png) · [Capture metadata](stock-tier-comparison.json)

The command exited 0, all three canvases drew geometry and no browser errors were reported. The lead inspected the final image: emitted forms remain framed, original footprint arrangement is consistent and the detail levels are distinguishable. The runner records actual source/dirty state, timestamps, selected IDs, pick metadata and runtime versions. No full-city or in-game performance/fidelity claim is made from this bounded preview. Roads, water, parks, heroes and game UI are absent.

Reproduce from the repository root:

```sh
RUNWAY_EVIDENCE_DIR=/tmp/runway-stock-tiers pnpm exec tsx scripts/render-stock-tiers.ts
```

The runner serves only bounded fixture routes from a temporary loopback server using installed Three.js and Playwright, with no external asset calls or dependency changes. Script review found and corrected an unusable fixed-HEAD assertion and duplicate/exceptional cleanup before this final capture.
