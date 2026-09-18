# R5b-4a: incremental cover index acceptance

Accepted source: worker `16339645ba36396a3a176215d80aa68a40b8b3b5`,
based on `81946c1df1a3ade43222a222271cc8fa45021312`.
Integrated as `38ffb02` and `e60eb1d1247d03c0627c72c13b1ef4fc05597c1d`.

The independent [reviewer](https://app.devin.ai/sessions/84a473313f51438b814292719bc37707)
rejected the first submission (`f4c75b1`) for strict TypeScript narrowing in
the test's publication callback. The test-only correction uses a typed holder
and preserves every assertion. Review accepted the corrected SHA; no
production defect was reproduced. The [initial review](https://app.devin.ai/attachments/cc604119-b68a-4921-b9d5-22af711534a1/review.md)
and [correction test output](https://app.devin.ai/attachments/b3abe9bc-b36e-45f4-b8fa-a7aef78fd896/1633964-focused.log)
retain the independent evidence.

The cover index uses a separate 400 m origin-aligned grid, original feature
indices and full immutable `CityData`. Construction incrementally reads
coordinates and inserts buckets; publication transfers the completed state
without a whole-index copy. Queries clamp the bucket range, filter inclusive
feature AABBs, and return fresh sorted selections.

## Checks

On 17 September 2026, the lead ran these sequentially on integrated source
`e60eb1d`. Only the execution-status documentation was dirty; runtime/test
source matched that SHA.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm tsx scripts/test-cover-index.ts` | 0 | 26 checks, including full binary and brute-force query comparison |
| `pnpm test:game` | 0 | Engine, colour, noticed, landmark and street-camera suites |
| `pnpm test:ui` | 0 | 9 SSR/UI regression checks |
| `pnpm lint` | 0 | ESLint |
| `pnpm build` | 0 | Next.js production build and project TypeScript |
| `pnpm tsx scripts/fetch-geodata.ts --verify` | 0 | Offline decode; 113,569 buildings, 56,793 roads, 769 parks, 62 water records |
| `git diff --check` | 0 | No whitespace errors |

The worker and independent reviewer also passed the explicit strict script
typecheck; project TypeScript excludes scripts:

```sh
pnpm exec tsc --noEmit --strict --skipLibCheck --esModuleInterop \
  --moduleResolution bundler --module esnext --target es2017 \
  --lib dom,dom.iterable,esnext scripts/test-cover-index.ts
```

## Scope

This accepts the pure cover index and query contract only. No renderer hookup,
new browser performance result, fidelity approval, merge or deployment is
claimed. Bounded emission is in separate review; R6 and the product gates
remain open.
