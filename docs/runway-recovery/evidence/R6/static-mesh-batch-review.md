# Static mesh batching — independent read-only review

**Verdict: ACCEPT** `95041a9c4f1da6b32118d09f5377d65749445d1e`
(`origin/devin/1789688019-static-mesh-batch`; history `ed2203f7 → 8cb94bf → 3e5bc0f → 95041a9`,
merge-base with `ed2203f7c762c6885d2d19f125ef3cee3352eeb1` confirmed). No blocking findings remain.
Diff vs base: exactly the 5 scoped files (`staticMeshBatch.ts`, `landmarkPrefabs.ts`, `noticedPrefabs.ts`,
`prefabLoad.ts`, `scripts/test-static-mesh-batch.ts`), 1151+/2−. No asset/geography changes.

Reviewed in a detached worktree (`/Users/devin/repos/smb-review`); no code changed, nothing pushed.
Probe scripts were written temporarily under `scripts/_probe*.ts` and deleted; `git status` clean.

## Findings on 8cb94bf (all reproduced, all fixed by the two follow-ups)
| # | Finding | Repro on 8cb94bf | State on 95041a9 |
|---|---|---|---|
| 1 | Grouping keyed by `material.uuid`, not object identity | two distinct materials with equal uuid merged (1 batch) | `Map<Material, …>`; 0 batches |
| 2 | Output `BufferAttribute` reset `gpuType` to `FloatType` (signature included it, output dropped it) | `IntType` (1013) in → 1015 out | 1013 out, `Int32Array` kept |
| 3 | Custom `Mesh` subclass without callback override, and instance `raycast` override, were merged into plain `Mesh` | `class Marker extends Mesh` → 1 batch, ctor `Mesh` | `isPlainMesh` prototype-shape check (Mesh→Object3D→EventDispatcher→Object.prototype, own `raycast`/`getVertexPosition`, `type==='Mesh'`); 0 batches for empty subclass and instance `raycast` |
| 4 | `maxBytes` compared input bytes; output could exceed via generated indices for non-indexed members, Uint8→Uint16 and Uint16→Uint32 promotion | mixed 3144→3288; Uint8 1608→1680; Uint32 (maxVertices raised) 2.90 MB→3.68 MB | `plannedOutputBytes` with cumulative indexed flag; mixed page split to 2064+1152, promotions refused at exact cap, merge again when cap has room |

Note on (4): at defaults (65 535 vertices / 8 MiB) the overshoot was unreachable; it mattered only for callers raising `maxVertices`.

## Verified behaviour (95041a9)
- `pnpm`/`npx tsx scripts/test-static-mesh-batch.ts` — 17/17 pass; procedural meshes 1356→158, exact triangle/vertex parity, 7.4 ms total, max 1.4 ms/asset (node/V8, not browser).
- GLB parity probe (my own, ad hoc, deleted): all 36 landmark GLBs 3624→167 meshes and 33 noticed GLBs 381→216, order-insensitive world-space triangle count/centroid-sum/bbox parity and material-count non-increase on every file, 0 failures, 80 ms / 6 ms total.
- Transform baking: normals via normal matrix + renormalise, tangents via `transformDirection` with w kept; `matrixAutoUpdate=false` uses `mesh.matrix` as the renderer would (probe: bbox matches identity, not stale `position`). det ≤ 1e-12 / non-finite → skipped.
- Skips confirmed: transparent material, invisible material, subclass `onBeforeRender` override, skinned/instanced/batched flags, morphs, material arrays, drawRange, interleaved/instanced attributes, `index%3≠0`, singletons. Invisible mesh pairs merge into an invisible batch (flag-consistent).
- Rollback: failure path disposes only newly built geometries once; tree untouched; idempotent (covered by committed test). Superseded geometries disposed only if unreferenced under `root`. Materials/textures never disposed.
- `prefabLoad.ts`: batch runs after parse, before `retainMatteScene`, wrapped in its own try; failure reports `${id}:batch` through `onAssetError → diagnostics.recordError` (non-essential, unknown job ids are accepted) and keeps the parsed scene. Cancellation/obsolete paths unchanged; on error the scene is released as before. `landmarkPrefabs`/`noticedPrefabs`: ordinary-stock fallback (`!prefab → buildBatchedLandmark`) preserved; `keepUniquelyNamed` keeps `getObjectByName` anchors and the eyeWheel group.
- Scoped gates on the branch: `test-landmarks` 16/16, `test-noticed` 22/22, `test-prefab-lifecycle` pass, `eslint` on the 5 files clean, `tsc --noEmit` clean (landmarks/noticed/lifecycle run at 8cb94bf; those files unchanged since).

## Non-blocking observations (parent's call)
- Instance-level `onBeforeShadow`/`onAfterShadow` overrides (Object3D r165+) are not in `INSTANCE_OVERRIDES`; a mesh with one still merges (probe: 1 batch). No such override exists in this repo.
- Geometry shared with a mesh *outside* `root` is disposed after merge (probe). `dispose()` only drops GPU buffers and three re-uploads on next render, and both procedural builders and per-parse GLB scenes create fresh geometry, so no repo impact.
- Output attributes do not carry `name`/`usage` of the source attribute (cosmetic; none set in repo).
- `makeMatteLambert` already disposes a shared material once per mesh referencing it (pre-existing); batching reduces, not worsens, this.
- Loss of per-mesh frustum culling granularity and raycast hitting the batch are as documented by the worker.

## Caveats
- All measurements are node CPU estimates; browser draw-call/shadow/slice-budget acceptance is the parent's combined gate.
- Full `pnpm test:game`, `test:ui`, `build` not run here (out of scope per instruction).

Commands (in `/Users/devin/repos/smb-review`, detached at each SHA):
```
pnpm install --frozen-lockfile
npx tsx scripts/test-static-mesh-batch.ts
npx tsx scripts/test-landmarks.ts && npx tsx scripts/test-noticed.ts && npx tsx scripts/test-prefab-lifecycle.ts
npx eslint lib/game/render3d/staticMeshBatch.ts lib/game/render3d/landmarkPrefabs.ts lib/game/render3d/noticedPrefabs.ts lib/game/render3d/prefabLoad.ts scripts/test-static-mesh-batch.ts
npx tsc --noEmit -p tsconfig.json
git diff --stat ed2203f7 95041a9
```
