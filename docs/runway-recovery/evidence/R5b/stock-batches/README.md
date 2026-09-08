# R5b-1: selected stock batches

Accepted production source `d3bd4eea426487f3a9d8da931cf65e2f51b45b15`, integrating reviewed submission `920a374` and correction `7ca3684`. [Scoped review](r5b1-review.md) passed after fixing the original major-building flag and topology-oracle defects.

The new selected-building API emits only the supplied original indices (at most 16), uses the caller's material and preserves stock exclusions and picks. It does not scan or copy the full city. The existing chunk renderer remains in use; scheduling, detail tiers and camera-driven coverage are subsequent work.

The accepted oracle expands indexed triangles into bound Float32 position, normal and colour tuples, preserves winding and ignores only mesh partition and triangle order. Saved output came from actual base `d51a42b` using committed indices `[45401, 71493, 71693, 72128]`; SHA-256 `34976db63c5adda68b52faaf40c35069edae9ce6cb594a99f88252de692a0a61`. The committed binary hash is asserted. Additional source `21216` proves small major-building parapets remain, and mixed/noncontiguous indices retain identity.

All four [required checks](integration-checks/results.json) passed on clean integrated source, as did stock-replacement, fallback-camera and cell-build tests. [Normal browser views](normal-views/map-diagnostics-browser.json) passed 2/2 on the new production build: 5,685 / 7,930 buildings and 205,648,046 / 283,261,360 geometry-array bytes, exactly matching the pre-extraction capture. First useful frames were 4,234 / 5,547.4 ms; these are local observations, not a performance improvement claim.

The largest 400 m owner cell is `14,10`, with 320 buildings. [Corrected batch measurement](r5b1-corrected-measure.json) recorded max 25.440 ms and p95 11.321 ms per 16-building batch; largest raw batch was 735,996 bytes. [Individual measurement](r5b1-individual-measure.json) recorded max 9.564 ms, p95 0.392 ms and largest raw geometry 119,616 bytes; slowest source index was `58384`. These profiles ran alongside the integration game test, so CPU contention and cold-start work affect timing. They establish that count alone is not a 4 ms guarantee, not calibrated device acceptance.

R5b-2 adds cheaper tiers before geometry allocation. Subsequent packets own time-based incremental generation, cover continuity and R6 runtime integration. Default full-city memory, camera-driven eviction, G1 performance and source-grounded street fidelity remain open. No merge or deployment.
