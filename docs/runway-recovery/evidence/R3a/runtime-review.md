# R3a-3 runtime integration review — 72fa307

Spec: FAIL. Quality: FAIL.

- HIGH `CityRenderer3D.ts:265-351`: constructor initialization has no rollback after `new THREE.WebGLRenderer(...)`. If `setPixelRatio` (including the L3 `devicePixelRatio` fixture), scene setup, resource retention, or listener setup throws, the constructor propagates without `renderer.dispose()`, pool disposal, controller abort, or listener removal. This violates the explicit constructor-failure ownership requirement and will leave the allocated renderer/context live before factory fallback. Wrap post-allocation initialization in a narrow `try/catch` that tears down only acquired resources/listeners/renderer, then rethrows.
- MEDIUM `scripts/test-renderer-disposal.ts:1-53`: the prototype fixture validates ordinary `dispose()` continuation but cannot exercise a failing constructor after WebGL allocation, so it misses the path above. Add a focused allocated-renderer/throwing-post-construction harness if it can be done without new production seams; browser L3 remains required after integration.
- PASS otherwise: `prefabLoad.ts` signal/current gates parsed late scenes and releases them; optional manifest/asset errors stay generation-gated; prefabs/clones and appended children are retained; ground handoff and replaced chunk materials release through the pool; dispose invalidates before abort, clears callbacks/CPU references, protects newer debug hooks, and continues teardown actions.

## Correction review — 72fa307..6a0927b

Spec: PASS. Quality: FAIL.

- PASS `lib/game/render3d/CityRenderer3D.ts:278-464`: post-`WebGLRenderer` initialization now catches synchronous construction failure, aborts/invalidate pending loads, removes the listener and owned debug hook, clears/disposes scene resources, renderer, tracker and diagnostics while retaining the original error. The new pixel-ratio fixture proves the allocated renderer is disposed and the original failure is rethrown.
- MEDIUM `scripts/test-renderer-disposal.ts:87-117`: the test replaces `three.WebGLRenderer` but restores it only after every assertion. A failed constructor/assertion leaves the shared Three module patched for later checks. Move that restoration into the existing `finally` (with `globalThis.window`) so a failing regression test cannot contaminate the process.

## Final correction review — 6a0927b..bc849d9

Spec: PASS. Quality: PASS.

- PASS `scripts/test-renderer-disposal.ts:8,118-121`: the original `WebGLRenderer` is captured before the fixture and restored in the existing `finally`, so every throw/assertion path restores both the shared Three constructor and `globalThis.window`. No regression is introduced by this two-line scope change.
