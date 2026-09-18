# R3a-1 independent review — 591c3a2

Spec: PASS. Quality: PASS.

- `sceneResources.ts:24-49` reference-counts by resource identity; each release is idempotent and deletes bookkeeping before the one final disposal, including a throwing disposer.
- `sceneResources.ts:52-68` closes and clears before callbacks, continues disposal after errors, reports one AggregateError only after cleanup, and cannot rethrow old errors on repeat disposal.
- `sceneResources.ts:18-27` marks identities disposed before callbacks and uses a WeakSet; late/reentrant retains cannot resurrect disposed resources, and new post-close resources are disposed once without retention.
- `test-scene-resources.ts:22-125` exercises final-release throws, shared/interleaved refs, duplicate release/close, old/new post-close retains, reentrancy, and aggregate cleanup. Scope is exactly the two permitted pure files.
