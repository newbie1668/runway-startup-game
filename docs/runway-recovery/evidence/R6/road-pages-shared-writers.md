# Road cover shared page writers

Worker `fa951d0`, based on `6e1fcb1`; integrated locally as `104147c`.
Independent review: **PASS as a bounded source checkpoint**.

- [Worker report](https://app.devin.ai/attachments/ed71a731-9e10-45ac-aba3-6692d55a5be8/report-road-cover-shared-writers.md)
- [Independent review](https://app.devin.ai/attachments/c7325ec1-f8bc-4fcb-ae0a-d487ae984f6a/road-cover-shared-writers-review-fa951d0.md)

`createRoadCoverJob` uses one pavement writer and one asphalt writer per
cover-cell job. Tier order is unchanged within each material stream; crossing
stitches follow tier asphalt. Page capacities, marking generation, clipping,
materials, geography and renderer/scheduler logic are unchanged.

The removed cover `roadTier` group metadata has no runtime consumer. Focused
tests compare complete indexed attributes against unchanged `buildRoads`,
folding legacy groups by material while preserving triangle order. They also
cover all three road tiers, markings on/off, clipping, boundary pieces, page
limits, ownership and cancellation. The independent reviewer reproduced the
source metrics and found no material defect. The diff-only source comment was
removed during integration.

| CPU profile (`--overview --cover-cell=1600`) | Base | Candidate |
| --- | ---: | ---: |
| Cover calls | 957 | 530 |
| Cover triangles | 530,850 | 530,850 |
| Stock calls | 1,609 | 1,609 |
| Stock triangles | 2,089,716 | 2,089,716 |
| Peak tracked geometry, MiB | 122.6235 | 122.6235 |

Worker cover generation cost was 1,899.8→1,921.2 ms and coverage-stage elapsed
time was 4,015.6→4,025.8 ms. These isolated observations do not establish a
startup improvement. Profile stock triangles are not the browser's
draw-range-filtered workload.

The full repository gate is recorded in
[`integration-checks/104147c.log`](integration-checks/104147c.log).
The first lint run encountered the testing agent's untracked CommonJS browser
harness under the evidence directory. That harness was moved outside the
repository; no lint policy or application code was changed to bypass it.
Game/UI checks passed before that failure; resumed lint, TypeScript,
production build, committed-geodata verification and diff checks passed.
The parent also passed road-cover parity, cover pages, clipping, context
ownership, cover lifecycle and road-context parity after integration.

Browser measurement of this integrated candidate is pending. Different page
boundaries can affect frustum culling even with exact geometry parity. The
source reduction does not meet the total 300-call target, establish the
five-second startup target or justify release readiness. PR #30 stays draft.
