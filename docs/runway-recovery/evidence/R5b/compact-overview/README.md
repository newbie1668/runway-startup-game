# R5b-3a compact overview acceptance

Accepted 10 September 2026 at source `f1af3e85e763e3d06a412f5df9912ef0affd0454`, after independent scoped [review](review.md), paired browser previews and all eight [sequential integration checks](integration-checks/results.json) passed. This is API-only storage acceptance; the new cell job is not connected to `CityRenderer3D` yet.

## Storage and coverage

Actual final overview buffer accounting is **97,580,844 bytes (93.06 MiB)**, down exactly 50% from 195,161,688 bytes (186.12 MiB). All 1,609 cells remain nonempty and the same 113,563 original buildings emit. The six pre-existing omissions are unchanged. Maximum cell storage is 261,480 bytes. [Raw accounting](overview-budget.json) ran on clean `7610f9f`; the later two-script browser correction did not alter the job source.

Positions remain Float32. Overview normals are normalized Int8 and linear colours normalized Uint8; indices use Uint16 when the vertex count fits, otherwise Uint32. Neighbourhood/street retain Float32 attributes and Uint32 job indices. The focused tests verify exact positions, bounds and winding, component rounding bounds, a real high-index overflow fixture, and existing cancellation/error ownership.

This accounting builds and immediately disposes one cell at a time. It sums possible resident geometry buffers, not measured whole-city GPU/process memory. Cover, heroes, detailed cells and overhead still have to fit the proposed 128 MiB geometry ceiling. The 1,609 mesh count also requires actual visible draw-call measurement during R6.

## Render comparison

Both clean-source browser runs on `f1af3e8` completed with positive draw counts and no console/page errors. They use the same 16 original records from cell 14,10 and identical 800 by 600 panel cameras, materials and lighting. The HTML reconstructs the real normalized GPU attributes.

- [Batch image](batch/stock-tier-comparison.png), [metadata](batch/stock-tier-comparison.json).
- [Cell-job image](cell-job/stock-tier-comparison.png), [metadata](cell-job/stock-tier-comparison.json).
- [Pixel comparison](pixel-comparison.json): neighbourhood and street are pixel-identical. Overview maximum RGB differences are 1/2/2 out of 255, with mean absolute channel differences 0.012/0.041/0.057. Lead visual inspection confirms unchanged geometry/framing in this bounded sample.

The first batch preview timed out because the HTML passed raw typed indices to Three instead of a BufferAttribute. The [failed log](preview-first-failure.log) is retained; the corrected index wrapper and timeout error reporting passed review and both final browser runs. The small batch already used Uint16 indices, so its 19,302 to 10,320 byte reduction differs from the city-wide job ratio.

## Indicative timing and checks

A single instrumented Node process on clean `f1af3e8` profiled the 320-record densest cell, first then repeat for each tier. Overview totals were 19.46/11.51 ms, with maximum steps 4.051/0.890 ms. Neighbourhood maxima were 2.691/1.246 ms; street 4.024/3.975 ms. Overview copy-unit maximum was 1.600 ms first and 0.043 ms repeat. Four steps across the six runs slightly exceeded 4 ms. These variable process/JIT timings are indicative, not a browser or phone guarantee, and do not erase earlier slower measurements. [Summary](profile-summary.json), [raw compressed record](profile-cell-jobs.json.gz); the unchanged harness is preserved in the preceding cell-job evidence.

All eight commands passed sequentially: game (70.660 s), UI (0.702 s), lint (4.494 s), build (13.424 s), cell-build (0.663 s), cell-stock-job (0.836 s), scheduler (0.446 s), offline geodata verify (0.615 s). The initial source checkout was clean. No binary/assets, game behavior, renderer hookup, release or deployment changed.

Next: bounded cover selection/emission, then R6 camera-driven generation and eviction. Full R5b, G1 and London fidelity remain open.
