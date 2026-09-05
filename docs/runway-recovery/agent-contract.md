# Orchestrator and worker operating contract

## Control and ownership

The orchestrator is the single tech lead. It keeps `docs/runway-recovery/status.md` current on the execution branch: accepted integration SHA, current task, assigned worker, allowed files, dependencies, evidence, reviewer decision, next task and whether Foo's input is required. Read it at the start of every session; do not restart from a PR body's latest anecdote.

Workers may execute only their assigned packet. They cannot broaden scope, change art direction, lower acceptance thresholds, rewrite the engine, merge PRs, deploy, close old experiments or send messages to people. A future worker's completion report is a submission for review, not authority to mark a milestone accepted.

Use one working branch per task and one writer per file. `CityRenderer3D.ts`, `cityBuilder.ts`, `landmarks.ts`, `geo.ts`, manifests and the integration branch are serialized. Parallel work is useful only for disjoint changes: for example the clock fix, pure index tests and preparation of reference cards. Two concurrent agents editing the runtime hot spots recreates the original failure mode.

The historical PR #27 body forbids a second agent and freezes assets while investigating crashes. This new owner-requested plan permits future **bounded delegation on new task branches**. It does not authorize competing edits to #27 or automatically unfreeze heroes. The tech lead records each scope unlock after its prerequisite evidence.

## Small-model task packet

Before dispatch, the orchestrator fills these fields with actual values and sends only the relevant task card plus required source excerpts. This template is not a ready-to-run assignment until its SHA and file ownership are resolved.

```text
Task: one ID from the execution plan.
Outcome: one independently reviewable player or engineering behavior.
Start commit: exact accepted integration SHA, verified with git cat-file.
Branch/worktree: one unique task branch in an isolated directory.
Read: AGENTS.md, product.md, this task card, named architecture contract,
      and the exact source files named below.
Allowed files: explicit paths. No files outside this list.
Must preserve: Scene/HitTarget/IMapRenderer, game/save rules, 2D fallback,
               SSR boundary, same-origin assets and current bbox.
Implement: numbered steps and acceptance examples from this card.
Validation: focused test, required repo gates, specified browser fixtures.
Evidence: commit SHA, commands/exit codes, screenshots/metrics, known gaps.
Stop: scope requires an unlisted file, an interface changes, the same
      symptom survives two attempts, evidence contradicts the hypothesis,
      or an external input is required. Report the smallest blocker.
Return: what changed and why, commit(s), checks, remaining failures,
        exact next decision needed. Do not self-certify the gate.
```

The tech lead must provide a concrete source-backed entity/area brief and the selected SFSIM reference frames for visual work. Use the fidelity plan for actual facade/tree/sign reconstruction; ordinary-building identity cannot be replaced by generic styling. “Make this more like SFSIM” is not a valid worker packet. If a task still needs architectural invention, assign it to the tech lead for decomposition first.

## Reviewer packet and acceptance

```text
Review task ID on the submitted SHA against its acceptance criteria.
Confirm allowed-file scope and preserved game/SSR/fallback contracts.
Run the relevant tests yourself and inspect current browser output.
Compare before/after using identical cameras, viewport and renderer mode.
Return PASS, FAIL or BLOCKED with evidence and a short concrete defect list.
PASS means this task meets its contract; it does not approve a later gate.
Do not fix the implementation while acting as its independent reviewer.
```

After a PASS, the tech lead reviews the diff, integrates the exact commit, runs the integration gate, records the new accepted SHA and dispatches the next dependency-ready task. Tests from a worker branch do not prove an untested merged result. If a prerequisite changed while a worker was running, rebase/cherry-pick in the isolated integration checkout and resolve the conflict with the original owner before revalidating.

## Preventing loops

- One symptom, one hypothesis, one smallest discriminating check, one change. Record what would falsify the hypothesis before editing.
- Two failed attempts on the same symptom trigger tech-lead reassessment. Preserve traces, revert only that task's own unsuccessful change if appropriate, and issue a revised packet. Do not open five new landmark fronts.
- Art review produces at most a few specific defects per pass, tied to named views and visible features. A new aesthetic is a product decision, not an extra task for the worker.
- Do not repair a failing assertion by weakening it unless evidence establishes that the assertion encodes an obsolete requirement. Record the replacement requirement and approval first.
- A source checksum proves identity; a geometry assertion proves structure; a browser image proves a rendered view; a user/reviewer decision proves acceptance. Keep these distinct.
- Report “active”, “waiting for worker/check”, or “waiting for Foo” with the actual blocker. Never make Foo repeat a pending request merely because a session restarted.

## Branch and handoff commands

At planning-PR completion, record its actual commit SHA in the dispatch packet. At execution start, use the verified local commit rather than a moving remote branch:

```bash
# Inspect first; do not alter the user's current branch.
git status --short
git worktree list
git cat-file -t "$RUNWAY_PLAN_SHA"
# RUNWAY_PLAN_SHA is supplied explicitly by the orchestrator's packet.
git worktree add ../runway-recovery-integration -b build/runway-recovery "$RUNWAY_PLAN_SHA"
```

For a worker, the orchestrator supplies `RUNWAY_ACCEPTED_SHA`, `RUNWAY_TASK_DIR` and `RUNWAY_TASK_BRANCH` explicitly, checks they are unused, and then runs:

```bash
git cat-file -t "$RUNWAY_ACCEPTED_SHA"
git worktree add "$RUNWAY_TASK_DIR" -b "$RUNWAY_TASK_BRANCH" "$RUNWAY_ACCEPTED_SHA"
```

Never force-push a protected/existing branch, clean another worker's files, or substitute a nearby commit if the requested object is absent. Capture the exact failure and recover provenance. Push only the branch authorized in the packet and verify its remote ref. The tech lead owns final PR consolidation and any release decision.
