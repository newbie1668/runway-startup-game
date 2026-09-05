# Execution status

Updated: 5 September 2026. Execution wave 1 is active on `build/runway-recovery` in an isolated worktree.

- Product direction: clarified — faithful virtual London in Three.js; real ordinary buildings and distinctive trees/signs recognizable during close street exploration; game preserved.
- Planning baseline: `4f76b634c2ae1201d939fa3ccff12f4724624b94`.
- Planning commit: `8408a8b6bc6d2ee048c6a6f45bdb823254b43fae`, verified against draft PR #29 before dispatch.
- Reviewed integration code: `53769297fc024a1364e034d8b91b62511747e414`. F1a data review and R0 runner code review passed. Full R0/G0 acceptance waits for the complete browser baseline below.
- Execution model: **Luna for specified small tasks**, per Foo's latest instruction. Terra produced the initial submissions and independent reviews; Luna completed the final runner corrections and command execution after usage-limit interruptions. The lead retains architecture and final acceptance. See [model discipline](agent-contract.md#model-and-token-discipline).
- Current frontier: **F1a reviewed and integrated; R0 full browser capture pending**. F1a covers mapped candidates only; source/photo/metric coverage and F1 GO remain pending. No app behavior has changed. R1–R10 and F2–F6 wait on their dependencies and reviewer decisions.
- Integration commands: all passed at `31b1d992b4dce272e6a1f2596dc9992e5c316d98`: 111 game checks, 8 UI checks, lint, production build and committed-binary verification. The game suite took 188.5 seconds; earlier silent output was not proof of a hang. The subsequent browser diagnostic-timeout helper changed only the test runner; independent focused checks and fresh lint passed at `5376929`.
- Visual reference: selected by Foo — workflow post `2090527551961940028`, detail post `2090527554310635552`. The [owner screenshot and F0 observations](evidence/F0/reference.md) are now preserved and inspected. They establish the workflow and static building-model benchmark. Motion footage and the complete SF scene remain unverified; they are not blockers for using the supplied reference.
- Waiting for Foo: **no**. The pilot source audit can use Charlotte Street as its working candidate. Later visual/release decisions concern concrete completed evidence.
- Release / merge / deployment: none performed. Worker branches are local submissions; the lead owns integration and PR publication.

The initial pilot candidate is Charlotte Street in Fitzrovia. [F1's checkpoint](evidence/F1/feasibility.md) identifies a 273 m Percy Street–Tottenham Street route, candidate references for 26/28 and a rejected address/photo match for 30. Full source coverage and modelling readiness are not yet established; a familiar public street nominated by Foo may replace the candidate.

| Task | Owner / isolated branch | Start SHA | Permitted tracked files | Submission / reviewer / acceptance |
| --- | --- | --- | --- | --- |
| F1a | Terra implementer + separate Terra reviewer / `task/runway-f1-map-inventory` | `8408a8b` | Two inventory files | `f8e16aa` PASS after correcting distances, source clipping and hash validation; integrated at `d96e774`; [review](evidence/F1/inventory-review.md) |
| R0a/c/d runner | Terra initial implementer/reviewer, then Luna corrections + independent lead checks / `task/runway-r0-browser` | `8408a8b` | Runner, fixtures, exact Playwright pin/lock, R0 evidence | Final worker `0d3e119` integrated at `5376929`; code-review findings resolved; full matrix pending |
| Integration checks | Luna / `build/runway-recovery` | `31b1d99` | Log output only | All five commands passed; [records](evidence/R0/integration-checks/results.json) |
| R0b baseline and handoff | Lead + Luna QA / `build/runway-recovery` | `5376929` | R0 capture evidence, interpretation, status and next packets | Four B8 smoke captures exist; all correctly fail for React #418; full baseline next |

The two workers have disjoint files and worktrees. Production builds and browser timing are coordinated to avoid contention. Workers may not spawn agents, broaden scope, publish, merge or deploy. Fresh independent review precedes exact-commit integration and the integration checks. The lead keeps the waiting state and next dependency-ready packet current here.
