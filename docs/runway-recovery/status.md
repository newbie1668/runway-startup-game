# Execution status

Updated: 6 September 2026. Execution wave 3 (R1 observability) is complete on `build/runway-recovery` in an isolated worktree.

- Product direction: clarified — faithful virtual London in Three.js; real ordinary buildings and distinctive trees/signs recognizable during close street exploration; game preserved.
- Planning baseline: `4f76b634c2ae1201d939fa3ccff12f4724624b94`.
- Planning commit: `8408a8b6bc6d2ee048c6a6f45bdb823254b43fae`, verified against draft PR #29 before dispatch.
- Earlier reviewed integration runtime/runner: `2446254`; clean final R2 capture: `f75d35b98be8a315e6c69e44b0caf4f9b36b76b5`. [R2](evidence/R2/README.md) passed 12/12 hydration phases with zero browser errors. [R0](evidence/R0/result.md) remains the failing 3D baseline; reliability, visual quality and navigation/performance measurements are still open.
- Execution model: **Luna for specified small tasks**, per Foo's latest instruction. Terra produced the initial submissions and independent reviews; Luna completed the final runner corrections and command execution after usage-limit interruptions. The lead retains architecture and final acceptance. See [model discipline](agent-contract.md#model-and-token-discipline).
- Current frontier: **R2 and R1 accepted; R4 pure index accepted; R5a-0 river-query optimization accepted; R3a-1 pool primitive accepted**. [R5a-0](evidence/R5a-0/README.md) now brings B2 street/B3 neighbourhood to actual 3D readiness in 3.45/4.46 seconds. Default B1 remains red with approximately 1.6 GiB of geometry buffers. G1 reliability, F1 GO and visual recognition remain open.
- Integration commands: all four app gates and four focused commands passed at `655ca6c5e14af6d438560b22c7e2a0929954f4cb`. Clean browser capture `ab41bc8293ffa82610c04ce812d83cdac8e96efd` tested unchanged app/assets and passed 2/3 production views. [Evidence](evidence/R5a-0/README.md).
- Next work: R5a bounded scheduler and R3a resource lifecycle, followed by R3b stock-replacement correctness and R5b/R6 generation by visible cells/detail tier. The old [water-query packet](evidence/R1/next-task.md) is complete; do not redispatch it. R4 and the R3a-1 primitive are not yet wired to rendering or eviction.
- Model discipline: Luna for bounded implementation/corrections, Luna Low for command execution, one reused Terra reviewer for geometry precision, units and lifecycle. Existing work was recovered after usage limits; completed baselines were not rerun.
- Visual reference: selected by Foo — workflow post `2090527551961940028`, detail post `2090527554310635552`. The [owner screenshot and F0 observations](evidence/F0/reference.md) are now preserved and inspected. They establish the workflow and static building-model benchmark. Motion footage and the complete SF scene remain unverified; they are not blockers for using the supplied reference.
- Waiting for Foo: **no**. The pilot source audit can use Charlotte Street as its working candidate. Later visual/release decisions concern concrete completed evidence.
- Release / merge / deployment: none performed. Worker branches are local submissions; the lead owns integration and PR publication.

The initial pilot candidate is Charlotte Street in Fitzrovia. [F1's checkpoint](evidence/F1/feasibility.md) identifies a 273 m Percy Street–Tottenham Street route, candidate references for 26/28 and a rejected address/photo match for 30. Full source coverage and modelling readiness are not yet established; a familiar public street nominated by Foo may replace the candidate.

| Task | Owner / isolated branch | Start SHA | Permitted tracked files | Submission / reviewer / acceptance |
| --- | --- | --- | --- | --- |
| F1a | Terra implementer + separate Terra reviewer / `task/runway-f1-map-inventory` | `8408a8b` | Two inventory files | `f8e16aa` PASS after correcting distances, source clipping and hash validation; integrated at `d96e774`; [review](evidence/F1/inventory-review.md) |
| R0a/c/d runner | Terra initial implementer/reviewer, then Luna corrections + independent lead checks / `task/runway-r0-browser` | `8408a8b` | Runner, fixtures, exact Playwright pin/lock, R0 evidence | Final worker `0d3e119` integrated at `5376929`; [code review](evidence/R0/runner-review.md) PASS |
| Integration checks | Luna / `build/runway-recovery` | `31b1d99` | Log output only | All five commands passed; [records](evidence/R0/integration-checks/results.json) |
| R2a / R2b | Luna implementers + separate Luna reviewer, lead acceptance / `task/runway-r2-hydration`, `task/runway-r2-browser` | `b8724e4` | CityHud, UI regression, new focused browser runner | R2a `5c06dbd` and R2b `0af8ef3` reviewed PASS; integrated `2446254`; four app gates, fresh lint and final 12/12 browser phases passed; [evidence](evidence/R2/README.md) |
| R0b baseline and handoff | Lead + Luna QA / `build/runway-recovery` | `e0080a8` | R0 capture evidence, interpretation, status and next packets | 24 records, all red; 4 ready, 18 ready-wait timeouts, 2 diagnostic timeouts; 20 screenshots; B6 actions/trace blocked; [results](evidence/R0/result.md) |
| R1 diagnostics | Luna implementers, Terra async review, lead runner review/acceptance | `36db827` / `783a204` | Reporter, host/factory, renderer tracker, focused scripts and R1 evidence | Runtime `fe64aa0`, capture `94e4854`; four app gates passed; diagnostics/fallback passed 3/3, real 3D readiness remains red 3/3; [evidence](evidence/R1/README.md) |

R2 used Luna for implementation, scoped review and command runs; the lead owned diagnosis, the test brief, integration and final acceptance. A worker usage-limit interruption occurred after its last commit was already complete, so the lead recovered the committed work without reimplementing it. No worker is waiting for Foo.

R1a pure reporting was reviewed and integrated at `dd33fdb`; host/factory at `d1643d4`; renderer correction at `fe64aa0`; corrected browser runner at `44275fb`. The renderer worker initially wrote only its assigned files directly in integration; the lead verified the clean diff and serialized its correction there. Independent review caught and resolved late load callbacks after disposal. Review records, evidence and precise limitations are in [R1](evidence/R1/README.md).

The missing Fitzrovia search entry remains an open B6/R6 pilot-navigation defect. R2 verified the existing Farringdon result; it did not remove the Fitzrovia requirement. The user does not need to repeat their vision or approve another abstract plan. The next work is the bounded runtime optimization, then its actual browser evidence.

Use disjoint files and worktrees with at most two execution workers. Coordinate builds and browser timing. Do not replay interrupted launches or repeat the full baseline merely because a session resumed. Workers cannot spawn agents, broaden scope, publish, merge or deploy. The lead owns integration, PR publication and the next dependency-ready packet. No release gate is approved by R2.
