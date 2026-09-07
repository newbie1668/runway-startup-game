# RUNWAY recovery: start here

Status: **planning handoff; implementation has not started**. Product direction confirmed by Foo on 5 September 2026: build a **faithful, explorable Three.js London at the selected SFSIM benchmark**, preserving game mechanics. Ordinary buildings and distinctive trees/signs must resemble their real counterparts.

The destination is a virtual London where people can recognize their actual streets and buildings during close exploration. The two owner-selected posts are fixed references. Runtime repair alone is insufficient; the [fidelity contract](fidelity.md) and [reconstruction track](../superpowers/plans/2026-09-05-london-fidelity.md) add source-backed shapes, facades and street objects. Passing a build or producing one flattering landmark screenshot is insufficient.

The [owner-supplied screenshot and F0 brief](evidence/F0/reference.md) establish the building-detail reference and the address → photos → physical features → Blender model workflow. Read this before visual work. The motion/complete-scene behavior of SF is not shown in the screenshot and remains unverified.

[F1's initial source checkpoint](evidence/F1/feasibility.md) records a real 273 m Charlotte Street candidate, two contrasting frontage references and an address/photo mismatch caught before modelling. This is partial feasibility evidence; full pilot coverage is still pending.

## Read only what your role needs

| Role                     | Required reading                                                                                    | Responsibility                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Foo / product owner      | This page, [product contract](product.md), gate evidence                                            | Approve faithful place reconstruction and the eventual release; the reference is already selected. |
| Orchestrator / tech lead | All documents here and the [execution plan](../superpowers/plans/2026-09-05-runway-recovery.md)     | Own architecture, task selection, branches, integration, evidence, and escalation.                 |
| Implementation worker    | Root `AGENTS.md`, product contract, assigned task card, relevant architecture contract              | Deliver one bounded change and its evidence. Never choose the next milestone.                      |
| Independent reviewer     | Task acceptance criteria, diff, [verification protocol](verification.md), relevant reference images | Reproduce checks on the submitted commit; return PASS, FAIL, or BLOCKED with evidence.             |

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

1. **G0 — runtime evidence:** reproduce the runtime baseline (R0) before reliability changes. In parallel, F1 establishes pilot source coverage using the recorded F0 workflow/static reference.
2. **G1 — reliable map:** default `/game`, overview, search and pan work with bounded resources; fallback remains playable.
3. **G2 — faithful street:** F2–F5 deliver one continuous real street with recognizable ordinary buildings, trees/signs and close exploration, reviewed against imagery and the SFSIM benchmark.
4. **G3 — repeatable coverage:** F6 proves a second ordinary area and a costed area-by-area London rollout; the eight hubs remain game-regression anchors.
5. **G4 — release candidate:** independent browser/gameplay/offline QA and all repository checks pass on the exact candidate commit.

Each gate requires a review record. `tests passed`, `Vercel Ready`, `mesh exists`, and an image hash are different forms of evidence; none alone means the map looks right and works.

## First dispatch

Give the orchestrator this prompt:

```text
Act as RUNWAY tech lead. Read AGENTS.md, docs/runway-recovery/README.md,
docs/runway-recovery/product.md, docs/runway-recovery/audit.md,
docs/runway-recovery/architecture.md, docs/runway-recovery/verification.md,
docs/runway-recovery/fidelity.md, docs/superpowers/plans/2026-09-05-runway-recovery.md,
and docs/superpowers/plans/2026-09-05-london-fidelity.md.
Create an isolated integration branch from the recorded planning commit.
Start R0 and continue the independent F1 source audit from its checkpoint. Use the
recorded F0 screenshot/brief; do not infer unseen SF camera behavior. Preserve
the game and protected branches; dispatch implementation only after review.
Do not send agents an open-ended request to make London look like SFSIM.
Do not merge or deploy. Report the active task and whether Foo's input is needed.
```

Use the [worker and reviewer templates](agent-contract.md) for subsequent dispatches. The task ledger records **F0 workflow/static reference captured; F1 initial checkpoint captured with full coverage/GO pending; R0 ready; all other tasks waiting on their stated dependencies. No owner input is pending for this start.**
