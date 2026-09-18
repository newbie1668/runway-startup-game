# Replacement-anchor broad phase — CPU evidence

Base: `ce8716a72d1e5631b49ffac6c479d5ec4e9cea89`.
Runtime candidate: `227b85e6520d736abd61d8391348afc891bcadc8`.
Final test revision: `b77f6aea851af84bcfeec61bb77b72d5c0175240`.
Status: independently accepted; integrated through
`70b4cc2d656df636c2045038708cc2665d4d337b`. This is not browser acceptance.

The [worker report](https://app.devin.ai/attachments/602407ac-ead4-4aad-963f-b8b4a89bbb1e/report.md)
records per-call decoded footprint bounds before the unchanged exact
boundary-inclusive predicate. Original building indices and anchor order remain
the mapping keys. The implementation retains synchronous work and allocates an
array plus a bounds object per valid footprint; no persistent cache is added.

The benchmark compares an in-test copy of the previous predicate and mapper
against the candidate in one Node process, using identical committed binary
data and the renderer's 70 landmark/noticed anchors. Each receives two warmups,
then three measured calls. Output remains 53 mapped, 16 unmatched and one
ambiguous anchor.

| Worker run | Original, three calls | Candidate, three calls |
| --- | ---: | ---: |
| 1 | 2114.6ms | 157.5ms |
| 2 | 2874.2ms | 170.9ms |

These are elapsed synchronous function measurements. They exclude browser
startup, network, scheduling, rendering and GPU costs; they do not establish
first-frame timing or slice compliance. The bounds scan and candidate ring
decoding remain synchronous.

The worker reports exit 0 for the focused stock-replacement script, scoped
ESLint, project TypeScript, formatting and whitespace checks. The lead's
allowed-file inspection confirms only `stockReplacements.ts` and its test
changed. Test-only follow-ups `302758b` and `b77f6ae` add empty, short, odd
and zero-area footprints and empty anchors. The final odd fixture contains
seven elements, exercising the nonfinite decode guard rather than only the
short-ring guard. The
[final report](https://app.devin.ai/attachments/67c55b5b-accf-4b9e-af49-55e5809b237d/report.md)
records nine passing checks and scoped lint at the final test revision.

The [independent review](https://app.devin.ai/attachments/1188e03e-012a-464d-a19b-9d89beabb2c2/anchor-bounds-review.md)
accepts the exact final candidate with no material findings. It verified the
oracle against the old implementation, byte-identical exact predicate,
inclusive decoded bounds, malformed/degenerate behavior, original ordering,
committed renderer anchors and absence of persistent caches. All nine focused
checks, scoped lint and project TypeScript exited 0 in the reviewer checkout.

Parent integration preserves both reviewed files byte for byte. All six combined
repository gates and affected focused checks passed on `70b4cc2`; see the
[integration output](integration-checks/70b4cc2.log) and
[focused output](integration-checks/70b4cc2-focused.log).
Production-browser acceptance remains pending.
