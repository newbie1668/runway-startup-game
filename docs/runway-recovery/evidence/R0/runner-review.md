# R0 runner review

The runner is development tooling. This packet changes no app component, renderer, engine, save rule, binary or GLB.

The initial independent Terra review rejected ambiguous hub selection, missing failure artifacts, incomplete context cleanup and missing OS metadata. A correction also exposed a filtered-smoke scope mismatch. These findings were returned to the implementer; interrupted draft runs were not accepted as app baseline evidence.

Luna completed the final small fixes from exact lead-supplied instructions:

- `37a20a529e6b0078db36dc823af3350b8966ab69` retains the owned page through navigation/readiness errors, attempts the failure screenshot, and fails an observation when context cleanup fails. The existing smoke directory was moved beneath R0 with all contents unchanged.
- `0d3e11950b642fa1baedf9592d542b81931ec440` bounds each page diagnostic evaluation to 3 seconds. A blocked page cannot indefinitely hold up that read after the readiness timeout. This does not change the 30-second readiness threshold.

Independent lead verification passed six failure/cleanup cases (navigation failure, page-creation failure, and close failure for both observations) and three evaluation cases (successful value, original rejection, and a never-resolving evaluation). Source/byte scope and syntax checks passed. Fresh lint passed after the helper change. The [integration logs](integration-checks/results.json) record the full repository commands on the merged worktree.

**Code-review verdict: PASS for baseline collection.** Browser acceptance is separate. The [B8 smoke](smoke/baseline.json) contains exactly four desktop/mobile cold/reload records and no B6 observations. The lead inspected desktop and mobile screenshots: the existing 2D title renders; all four records correctly fail because React error #418 was captured. They do not prove the 3D renderer works.

The runner intentionally cannot establish actual renderer mode, first useful 3D frame, loaded geographic coverage, draw calls or unique geometry memory before R1. A requested `map=3d` and `data-map-ready=1` are not substituted for those measurements. Full browser-baseline results and the G0 decision are recorded separately.
