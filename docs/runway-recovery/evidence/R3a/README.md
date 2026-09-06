# R3a-1 ownership primitive

Only the pure `createResourcePool` primitive is implemented and reviewed (`591c3a2`, integrated `bcbe069`). It counts ownership by object identity, makes release/dispose idempotent, prevents resurrection, handles late retained resources after closure, and cleans other resources even when a disposer throws. Focused tests cover shared refs, interleaved releases, reentrancy, late cleanup and aggregated failures. [Review](review.md).

This is groundwork, **not completion of R3a**. The renderer, GLTF loaders, converted materials/textures, pending jobs and CPU references have not been wired to the pool yet. Their integration and actual late-load/context-loss/resource-retention verification remain required. No runtime memory improvement is claimed by this unit test.
