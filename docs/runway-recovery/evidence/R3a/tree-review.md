# R3a-2 tree-resource review — d6d5c0d

Spec: FAIL. Quality: FAIL.

- HIGH `sceneResourceTree.ts:72-80`: the collector retains geometry/materials/textures only for `Mesh`/`isMesh`. Runtime-relevant `Line`/`LineSegments` and `Sprite` nodes are skipped, so their GPU resources receive no pool reference and leak on the normal release path. Extend the same collection path to `isLine` and `isSprite` (with their geometry where present), then retain their material arrays/textures.
- MEDIUM `test-scene-resource-tree.ts:8-74`: the focused test has no Line/Sprite fixture, so this leak is not observable. It also omits required `keepMaps:false` disposal, throwing-conversion partial cleanup, and guarded/shared `ImageBitmap` ownership tests from the brief; add those before accepting the error and bitmap paths.
- PASS otherwise: mesh, InstancedMesh owner, material-array/direct/shader-uniform texture identity collection, no-op conversion disposal, raw-before-converted handoff, and release aggregation match the assigned helper scope.

## Correction review — d6d5c0d..c0566f6

Spec: FAIL. Quality: FAIL.

- PASS `sceneResourceTree.ts:68-81`: the collector now includes `isLine` and `isSprite` along with Mesh, retaining available geometry, material arrays and textures. `test-scene-resource-tree.ts:49-60` executes both paths; `:80-103` adds `keepMaps:false` and shared guarded bitmap cases.
- PASS `sceneResourceTree.ts:95-103`: retention attempts continue after an individual `pool.retain` failure, then release every acquired token and aggregate errors. The closed-pool throwing-disposer fixture (`test-scene-resource-tree.ts:106-112`) covers that continuation path.
- MEDIUM `test-scene-resource-tree.ts:1-115`: the required throwing matte-conversion partial-cleanup case remains absent. There is no injected conversion throw after an earlier mesh has received a new Lambert material, so `retainMatteScene`'s `:118-127` partial-tree cleanup cannot be accepted. Add the specified later-mesh/property-setter failure fixture and assert raw plus already-converted resources each dispose once.

## Correction review — c0566f6..0553668

Spec: FAIL. Quality: FAIL.

- PASS `matteGltf.ts:81-87`: assignment rollback directly disposes newly-created, unreachable Lambert material(s); the injected later-mesh setter at `test-scene-resource-tree.ts:99-117` exercises the intended partial-conversion path while `retainMatteScene` releases its raw and attached converted scopes.
- MEDIUM `test-scene-resource-tree.ts:105-121`: `orphanDisposals` spies `MeshLambertMaterial.prototype.dispose`, so it counts both the failing mesh's orphan at `matteGltf.ts:86` and the first mesh's already-attached Lambert released by `retainMatteScene` rollback. With two converted meshes it cannot correctly assert `orphanDisposals === 1`; the reported pass is therefore not credible evidence of exact-once ownership. Split spies by material identity and assert both the orphan and attached converted Lambert dispose once, independently of raw geometry/material/map.
- PASS appearance scope: map detection still accepts real Three textures and all colour/map selection rules are unchanged; the submitted noticed-factory check is the appropriate focused regression.

## Correction review — 0553668..b6ff13c

Spec: FAIL. Quality: FAIL.

- PASS `test-scene-resource-tree.ts:92-134`: `createRequire(__filename)` shares the helper's Three class family; identity-keyed counts now separately prove the captured orphan and already-attached converted Lambert each dispose once, while raw and failing resources clean up. Prototype and ImageBitmap-global restoration use `finally`; `matteGltf.ts:52-78` restores the original Mesh/Color/map appearance rules.
- MEDIUM `matteGltf.ts:82`: rollback disposes mapped orphan materials in a plain `for` loop. If one orphan `dispose()` throws, later orphans are skipped and the original assignment error is masked, contrary to the retained-tree cleanup rule to attempt all releases before reporting errors. Continue through all orphan disposals and aggregate cleanup errors with the assignment error; add a two-material throwing-orphan fixture.

## Correction review — b6ff13c..a5bd662

Spec: PASS. Quality: PASS.

- `matteGltf.ts:82-92` attempts every orphan disposer, retains the original assignment error, and raises ordered aggregate cleanup evidence only after all attempts.
- `test-scene-resource-tree.ts:104-152` creates two orphan Lamberts, makes the first throw after disposal, proves the second still disposes, checks the exact aggregate `[assignmentError, orphanCleanupError]`, and verifies attached/raw/failing resources release once with no later pool double-disposal.
- The change is limited to rollback error handling; colour, map and Mesh appearance semantics remain unchanged.
