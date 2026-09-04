# RUNWAY recovery: start here

Status: **planning handoff; implementation has not started**. Product direction confirmed by Foo on 5 September 2026: recover the **daytime SFSIM-style London map inside the existing game**, preserving game mechanics.

The destination is a London startup game with a city worth exploring: recognizable neighbourhoods, readable ordinary streets and landmarks, reliable navigation, and a playable map on desktop and mobile. Passing a build or producing one flattering landmark screenshot is insufficient.

## Read only what your role needs

| Role                     | Required reading                                                                                    | Responsibility                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Foo / product owner      | This page, [product contract](product.md), gate evidence                                            | Confirm the visual reference and approve the representative scene and release.         |
| Orchestrator / tech lead | All documents here and the [execution plan](../superpowers/plans/2026-09-05-runway-recovery.md)     | Own architecture, task selection, branches, integration, evidence, and escalation.     |
| Implementation worker    | Root `AGENTS.md`, product contract, assigned task card, relevant architecture contract              | Deliver one bounded change and its evidence. Never choose the next milestone.          |
| Independent reviewer     | Task acceptance criteria, diff, [verification protocol](verification.md), relevant reference images | Reproduce checks on the submitted commit; return PASS, FAIL, or BLOCKED with evidence. |

A compact model is suitable for a well-specified fixture, documentation change, pure helper, or isolated asset recipe. Profiling, lifecycle/concurrency design, cross-module changes, and ambiguous visual judgment stay with the tech lead or a capable reviewer. No model tier is assumed to be an art director.

## Source and branch contract

This planning branch starts at PR #27's **exact** head `4f76b634c2ae1201d939fa3ccff12f4724624b94`. Its PR targets `cursor/sfsim-street-camera-61eb`, so the review diff is documentation only. It does not certify that implementation as stable.

The active implementation ancestry is:

```text
main 1145af5
  └─ PR #24 / worktree-3d-london-map / d36b8a4
       └─ PR #26 / cursor/sfsim-aesthetic-6e3a / fcec93d
            └─ PR #27 / cursor/sfsim-street-camera-61eb / 4f76b63
                 └─ this documentation branch / docs/runway-recovery-plan
```

PRs #10, #21, #22, and #23 are separate experiments, not prerequisites. Do not merge or cherry-pick them wholesale. Details and pinned sources are in [the audit](audit.md).

For execution, the tech lead creates `build/runway-recovery` from this plan's recorded commit, then gives workers task branches from the current **accepted integration SHA**. Workers must not branch from a moving PR head. This planning PR remains documentation only. A later implementation PR can target `main` once the full stack is reviewable; no automatic merge, closing of earlier PRs, or deployment is authorized by this plan.

## Milestones

1. **G0 — evidence:** reproduce the pinned build, record the actual renderer, failure modes, costs, and reference views.
2. **G1 — reliable map:** default `/game`, overview, search and pan work with bounded resources; fallback remains playable.
3. **G2 — approved street:** Foo approves one ordinary street and its surrounding skyline using fixed captures at desktop and mobile sizes.
4. **G3 — London coverage:** extend the approved rules to all eight hubs and repair named landmarks one at a time.
5. **G4 — release candidate:** independent browser/gameplay/offline QA and all repository checks pass on the exact candidate commit.

Each gate requires a review record. `tests passed`, `Vercel Ready`, `mesh exists`, and an image hash are different forms of evidence; none alone means the map looks right and works.

## First dispatch

Give the orchestrator this prompt:

```text
Act as RUNWAY tech lead. Read AGENTS.md, docs/runway-recovery/README.md,
docs/runway-recovery/product.md, docs/runway-recovery/audit.md,
docs/runway-recovery/architecture.md, docs/runway-recovery/verification.md,
and docs/superpowers/plans/2026-09-05-runway-recovery.md.
Create an isolated integration branch from the recorded planning commit.
Start task R0 only. Preserve the game and protected branches. Record a
baseline and issue the next bounded packet after reviewing the evidence.
Do not send agents an open-ended request to make London look like SFSIM.
Do not merge or deploy. Report the active task and whether Foo's input is needed.
```

Use the [worker and reviewer templates](agent-contract.md) for subsequent dispatches. The task ledger starts with **R0 ready; every implementation task waiting on its stated dependencies**.
