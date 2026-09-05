# Faithful London Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. External workers can use the repository's equivalent [worker/reviewer contract](../../runway-recovery/agent-contract.md).

**Goal:** Reproduce actual London streets and buildings at the owner's selected SFSIM visual standard, with recognizable individual trees, signs and street features.

**Architecture:** Enrich real geospatial objects with dated visual observations, generate reviewed instance-specific geometry using reusable kits, bake versioned cell assets and load them through the reliable Three.js renderer. Prove a complete ordinary street and a second contrasting area before expanding coverage.

**Tech Stack:** Existing Next.js/React/TypeScript/Three.js app and pnpm; offline OSM/reference processing; current bake tooling, with any additional data/imagery/model service chosen only after an evidence/cost review.

**Spec:** [Product P1–P12](../../runway-recovery/product.md), [fidelity contracts C6–C7](../../runway-recovery/fidelity.md), [runtime C1–C5](../../runway-recovery/architecture.md), [runtime plan](2026-09-05-runway-recovery.md).

## Global constraints

- Map/rendering and offline city reconstruction only; preserve game rules, balance, content, RNG, audio rules, save schema and action semantics.
- Three.js stays behind the dynamic factory boundary; no browser/WebGL side effects in SSR.
- New detail is based on traceable observations; inferred features stay identified as inferred. No random filler can pass as a real tree, sign or frontage.
- Existing bbox/binary stay fixed during R0–R6. F2 may add pilot sidecars/assets; preprocessing/codec changes need their own assigned and verified task.
- Keep same-origin play-time assets, automatic 2D fallback and separation from `londonstartupmap.com`.
- Every code/asset gate runs `pnpm test:game`, `pnpm test:ui`, `pnpm lint`, `pnpm build` and its focused checks. Data-pipeline changes also regenerate/verify affected committed data as required by `AGENTS.md`.
- No reconstruction worker has started in this planning PR. These cards define future assignments, not completed capabilities.

## Dependencies and dispatch

```mermaid
flowchart LR
  F0[F0 Inspect supplied reference media] --> G2[G2 Real street approval]
  F1[F1 Pilot data and source feasibility] --> F2[F2 Identity and detail schema]
  F2 --> F3[F3 Building reconstruction]
  F2 --> F4[F4 Trees and street features]
  F3 --> F5[F5 Continuous in-game exploration]
  F4 --> F5
  G1[G1 Runtime reliability] --> F5
  F5 --> G2
  G2 --> F6[F6 Repeatability and coverage rollout]
  F6 --> R9[R9 Area and game regression]
  R9 --> R10[R10 Candidate release]
```

R0 and F1 can start independently. F0 is an access-dependent reference-inspection task: it cannot claim success until the exact media is viewed. F3 and F4 can run in parallel only with disjoint asset recipes and one manifest integrator. Each F3/F4 worker gets one specific building or object family and a filled source/feature brief; never an open request to recreate an entire borough.

## F0 — Record the exact SFSIM reference

**Owner:** tech lead / visual reviewer. **Input:** owner's two post URLs. **Allowed files:** new `docs/runway-recovery/evidence/F0/reference.md` and referenced media permitted for review. No code or speculative tool setup.

- [ ] Access the workflow post `2090527551961940028` and visual/detail post `2090527554310635552`, or the same media provided by Foo. Keep blocked access explicit; do not treat a guessed summary as a viewed clip.
- [ ] Record visible workflow steps and separate creator claims from observed behavior. Map each step to a proposed London equivalent; an Exa/Devin/Blender claim requires actual source text, not the old PR's paraphrase alone.
- [ ] Extract a small reference set with timestamps: ordinary block, distinctive building, street object and camera movement where visible. Record camera scale, lighting, material treatment and geometry detail from those frames.
- [ ] Distinguish what the clip demonstrates from the owner's stronger city-wide recognition ambition. A detailed selection of SF buildings does not by itself demonstrate accurate coverage of every SF tree/sign.
- [ ] Commit the visual brief and accessible reference links/artifact hashes. No need to ask Foo to choose another style; these are the selected references.

**Acceptance:** another reviewer can inspect the same media and reproduce the visual/workflow description. Access failure keeps F0 pending while F1/R0 proceed.

## F1 — Prove pilot source coverage before building assets

**Owner:** geodata/reference worker, reviewed by tech lead. **Input:** public street nominated by Foo, otherwise Charlotte Street in Fitzrovia as a candidate. **Allowed files:** `docs/runway-recovery/evidence/F1/`, new `scripts/audit-street-sources.ts`, local source caches outside shipped assets. No whole-city refetch or renderer changes.

- [ ] Fix a 200–300 m continuous segment only after mapping actual junctions and reference availability. Record its exact bbox/endpoints and a walking-direction route; include both street sides and a junction. Do not use guessed house-level coordinates.
- [ ] Inventory every street-facing building and salient tree/sign/lamp/crossing along the route. Record source IDs, geometry, date, evidence links, rights/use basis, observed fields, inferred fields and missing fields. The inventory is complete even when information is missing.
- [ ] Query the bounded source area: OSM footprints/parts/paths/trees, candidate GLA tree records and height/surface evidence. Recover stable source feature IDs. Evaluate geolocated facade imagery with concrete sample coverage; do not assume Wikipedia covers ordinary frontages.
- [ ] Produce a coverage table: footprint/height/roof/facade/tree/sign evidence per entity. Record source CRS and transforms to the game's world coordinates. Inspect age and alignment against at least three distinct control points.
- [ ] Prepare two feasible acquisition/enrichment options if the imagery gap remains, with specific samples, use constraints, human/agent effort and monetary costs. Do all read-only/free feasibility work before asking for any paid setup.
- [ ] Commit a GO/NO-GO report and exact source package. GO requires credible evidence for the full pilot route and its salient features. Missing evidence cannot be replaced with randomized detail; propose a better-covered pilot or a bounded collection task.

**Acceptance:** the tech lead can supply source-backed entity packets to workers and explain how the source observations could meet P2/P10. No promise of London-wide coverage or cost based solely on the existence of a dataset.

## F2 — Preserve source identity and validate a detail sidecar

**Owner:** compact data worker. **Depends:** F1 GO. **Allowed files:** new `lib/game/cityDetail.ts`, new `scripts/test-city-detail.ts`, new `scripts/prepare-street-detail.ts`, `data/city-detail/pilot/`, new `public/map/detail/manifest.json`. Any change to `scripts/fetch-geodata.ts` or `render3d/format.ts` is a separate follow-up packet.

**Interfaces:** C6 `DetailArea`, `StreetEntity`, `BakedDetailTile`, `validateDetailArea(area): string[]`, `encodeDetailArea(area): string`.

- [ ] Implement C6's pure schema/validator with stable IDs and deterministic encoding. Tests must reject duplicate IDs, missing source references, invalid lat/lon, `observed` values without evidence and `unknown` values with fabricated non-null data.
- [ ] Include this minimum truthfulness example in the focused test:

```ts
const point = {
  value: { longitude: -0.1358, latitude: 51.5196 },
  state: 'observed' as const,
  sourceIds: [],
};
// A StreetEntity using point must fail validation: no observation source.
// Do not use this synthetic coordinate as evidence of a real tree or sign.
```

- [ ] Convert the actual F1 source package to the sidecar. Use original OSM/provider feature IDs, never old binary array offsets as identity. Store uncertain spatial joins for review; no automatic many-to-one stock suppression.
- [ ] Add deterministic round-trip/ordering and coordinate-transform tests using the actual control points. Keep original schema fixtures so later regeneration can be compared.
- [ ] Run `pnpm tsx scripts/test-city-detail.ts` and required gates. Store processed data provenance; do not commit reference imagery without the recorded right to do so.

**Acceptance:** a fresh agent can trace every observed pilot field to an inspected source and reproduce the same sidecar from its pinned inputs. Current binary remains usable as a baseline/fallback.

## F3 — Reconstruct ordinary buildings from instance evidence

**Owner:** one asset worker per bounded building/recipe packet; capable reviewer handles ambiguous geometry. **Depends:** F2; F0 needed before final appearance approval. **Allowed files:** new `scripts/city-detail/buildings/pilot-frontage.ts`, new `scripts/bake-city-detail.ts`, one pilot entity/asset entry, generated `public/map/detail/pilot/` assets, new `scripts/test-detail-buildings.ts`. The first worker owns this one recipe; later building batches receive their own exact paths and entity IDs.

- [ ] Start with two contrasting ordinary buildings from the preselected inventory. Each packet contains actual footprint/height/roof observations, facade orientation, storeys/bays/openings, materials, entrance/storefront and distinct shape features, with source IDs and unknowns.
- [ ] Implement reusable geometry operations for walls, openings, bays and roofs using measured instance parameters. A model may extract candidate features from imagery, but the reviewer verifies them before marking observed. Reuse the existing code/Three.js baker first; use Blender only when the specific form benefits from it.
- [ ] Bake a bounded GLB plus C6 metrics/hash. Validate that footprint bounds, height, front orientation and observed opening counts match the source record. Check a second viewpoint so a photo pasted on a box cannot substitute for 3D shape.
- [ ] A generic kit is acceptable only when that instance matches its actual reference. Features the kit cannot represent require a bounded recipe extension, not a generic approximation marked complete.
- [ ] Repeat in small batches covering every pilot frontage. Record manual corrections and cost per accepted building; a new worker must be able to use the recipe with another entity record.
- [ ] Run focused geometry and required gates; add before/reference/after captures. Real-world scale takes priority over the old runtime's tower/height exaggeration inside the faithful pilot.

**Acceptance:** preselected ordinary buildings are recognizable from their distinguishing source-backed shape and facade features. Names, occupant research, interiors and individual window-interior contents are unnecessary.

## F4 — Place actual trees and salient street objects

**Owner:** vegetation/streetscape worker with disjoint files from F3. **Depends:** F2. **Allowed files:** new `scripts/city-detail/street-objects.ts`, its assigned source records, generated pilot object assets and manifest entries, new `scripts/test-detail-objects.ts`.

- [ ] Consume observed positions/orientations from F1/F2. Join tree inventory records to current reference views; retain date/uncertainty when size or canopy is unobserved. Do not identify the tree from nearest-point matching alone if the match is ambiguous.
- [ ] Build reusable tree forms and object kits. Per-instance coordinates, scale, species/form, heading, sign dimensions/colour and visible salient text/design come from the record. Detailed branches/leaves are not required unless they materially affect reference resemblance.
- [ ] Verify local coordinate conversion, street side, orientation and dimensions. Test that unknown locations do not generate “observed” objects and that regeneration preserves source identity.
- [ ] Disable decorative random trees/lamps/signs within the accepted pilot detail area while its observed layer is active; coordinate this integration with F5's sole runtime owner. Do not create two overlapping layers.
- [ ] Capture the preselected small-object comparisons and whole-street context; run focused and required gates. Record source gaps as blockers for salient objects, not a reason to sprinkle plausible replacements.

**Acceptance:** the route's distinctive real tree/sign/object instances are placed and represented faithfully. Shared meshes keep the runtime economical; procedural placement does not establish truth.

## F5 — Integrate a continuous close street tour and G2 evidence

**Owner:** runtime integrator / tech lead. **Depends:** F3, F4 and runtime G1. **Allowed files:** `lib/game/render3d/CityRenderer3D.ts`, new `lib/game/render3d/detailTiles.ts`, new `lib/game/render3d/streetCameraRig.ts`, additive visual types in `lib/game/scene.ts`, `components/game/MapCanvas.tsx`, browser fixtures. No engine changes.

- [ ] Load versioned pilot tile assets through C1–C5 ownership, scheduling and eviction. Map accepted enriched footprints to their exact base replacements; ordinary stock stays when assets fail. Place detail with actual scale; blend LOD without duplicate footprints or random furniture.
- [ ] Demonstrate a street-facing close exploration camera and a pedestrian-eye-height variant. The legacy 48-degree orthographic camera remains the game overview while the comparison is evaluated; it cannot be used to rule out the street-level requirement. Keep map marker projection, focus and fallback behavior compatible.
- [ ] Use a deterministic geolocated route for repeatable motion. Proposed visual-only type in `scene.ts`:

```ts
export interface StreetViewPose {
  x: number;
  y: number; // existing ground/world convention
  eyeHeightM: number;
  headingRad: number;
}
```

- [ ] Record a continuous 200–300 m traversal in both directions in `/game`, plus ten building and observed-object comparisons from C7. Do not substitute an isolated mesh viewer or montage. Test pan/look/search/return-to-game and touch controls.
- [ ] Profile geometry and texture memory, asset transport, frame time and repeat-tour cleanup. Pilot detail may change asset budgets only after a recorded engineering review, never by hiding unknown coverage or lowering the visual bar.
- [ ] Apply the C7 recognition checklist with a reviewer familiar with the public area and Foo's reference comparison. F0's exact media must be accessible before claiming the clip's visual standard is met.

**Acceptance:** G2 requires both faithful place representation and stable runtime. A recognizable skyline, a generic attractive street, or screenshots from just one angle are insufficient.

## F6 — Prove the pipeline can scale beyond the pilot

**Owner:** tech lead, source worker and independent reviewer. **Depends:** G2. **Allowed files:** a second named area's source/detail package and asset recipes through bounded worker cards, coverage/cost reports and rollout plan. Core changes require their normal ownership/review lane.

- [ ] Select a contrasting ordinary area with verified sources. Repeat F1–F5 using the same schemas and reusable recipes, recording any required exceptions. Do not start with another famous landmark cluster.
- [ ] Compare source coverage, correction rate, person/agent hours, model/API/bake cost, asset bytes, visible quality and runtime budgets to the first area.
- [ ] Produce an explicit London coverage map and staged delivery estimate based on these measurements. Name the intended final geographic boundary, reference-device support, reference-data refresh policy and unresolved imagery gaps.
- [ ] Give Foo a concrete scope/cost choice if the desired coverage requires additional paid sources or substantial collection work. The pilot is evidence for that decision, not a substitute for the stated city ambition.
- [ ] Expand accepted areas in bounded batches and feed them to R9/R10 for regression/release review. Do not label a whole borough or all London faithful because a few selected streets passed.

**Acceptance:** a second ordinary area meets the same recognition bar with a repeatable, costed process; the remaining city rollout has defensible inputs and explicit coverage limits.
