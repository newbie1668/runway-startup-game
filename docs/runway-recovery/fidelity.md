# Faithful London reconstruction: data and quality contract

## Why the current approach is insufficient

The current implementation captures useful geography but discards or invents information the new acceptance bar needs. Verified at PR #27 head `4f76b634c2ae1201d939fa3ccff12f4724624b94`:

- `scripts/fetch-geodata.ts` skips `building:part`, simplifies geometry, caps the dataset and filters small footprints (the committed run used a 90 m² area floor). Small gardens/parks are also filtered. These choices can remove the buildings and street structure a resident recognizes.
- `CityBuilding` in `lib/game/render3d/format.ts` retains footprint, quantized height, broad style and colour, but no stable OSM ID, per-face observations, building-part structure or feature provenance. A durable building-specific override cannot rely on array position alone.
- `buildParkTrees` places park trees using a seeded distribution and street trees from road spacing. `buildStreetLamps` also uses procedural spacing. They are decorative approximations, not measured instances.
- Much facade material, window rhythm, massing and signage is selected from typology or a hash. This can make neighbouring buildings varied without making them accurate. Generated address text is also not a reliable address record.
- Named towers receive special treatment; most ordinary buildings do not have image-backed instance parameters. That allocation misses the owner's street-recognition test.

Three.js can display detailed real-place assets; renderer choice does not supply the missing observations. The new work therefore has two tracks: R0–R6 runtime reliability and F0–F6 evidence-backed reconstruction. No claim that the creator used a particular model/tool or achieved every-object fidelity is made without inspecting the supplied posts.

## Proposed layers

| Layer               | Required information                                                                             | How produced                                                                                                         | Acceptance                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Spatial base        | Real building footprints/parts, roads, paths, terrain, parks and water.                          | Offline GIS ingest, source IDs, coordinate transforms and topology checks.                                           | Correct block layout, building order and junctions; no omitted frontage hidden by decoration. |
| Building shape      | Heights, setbacks, roof shape, chimneys, dormers, entrances, orientation.                        | OSM building parts/attributes where available; measured elevation/reference images; reviewed instance overrides.     | Same source building from multiple views; actual silhouette/proportions.                      |
| Building appearance | Materials/colours, facade bay/window/door arrangement, storefront features.                      | Image-backed feature records mapped to each facade; reusable parameterized kits plus unique meshes where required.   | A reusable kit must still reproduce that particular building's distinguishing features.       |
| Streetscape         | Individual trees/canopies, signs, lamps, crossings, bollards, fences and other salient features. | Geolocated inventories and dated reference observations; species/form kits with instance position/orientation/scale. | Observed placement and recognizable type/form; no generated filler counted as evidence.       |
| Runtime delivery    | Versioned cell assets, geometry/texture LOD, seams and fallback.                                 | Offline validated baking to same-origin assets and bounded loading/eviction.                                         | Stable continuous tour with faithful near detail and recognizable distant massing.            |

Reuse a tree or sash-window mesh across instances; do not reuse one guessed placement or facade pattern indiscriminately. Unknown details may have an explicitly recorded approximate fallback until sourced. Such fallbacks remain visible in the coverage/QA ledger and do not pass the fidelity gate.

## Source candidates inspected for this revision

These are candidates, not ingested or approved pilot data. Source availability, geographic coverage and usage conditions must be checked for the actual pilot before relying on them.

| Candidate                                                                                                                | Useful contribution                                                                                                           | Known limitation / next check                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OSM Simple 3D Buildings](https://wiki.openstreetmap.org/wiki/Simple_3D_Buildings)                                       | Building parts describe sections with differing heights and attributes; current pipeline omits them.                          | Tag availability varies. Retain source IDs/parts and test the pilot; tags alone do not encode all facade detail.                                                            |
| [GLA London Public Realm Trees](https://data.london.gov.uk/dataset/london-public-realm-trees-2r45m)                      | Locations and species; some records include size/age. Dataset lists OGL v3.                                                   | Incomplete public-realm coverage, missing locations, differing borough scope and some old records. Does not identify every tree or supply its exact current canopy.         |
| [Environment Agency 1 m composite DSM](https://dsp.environment.data.gov.uk/dataset/9ba4d5ac-d596-445a-9056-dae3ddec0178) | Elevation surface including buildings/vegetation can support height/roof estimates when combined with terrain and footprints. | This metadata describes a 2022 composite of different survey dates. A raster is not a facade model; inspect local survey age, terrain counterpart and rights before use.    |
| [OS NGD Building Features](https://docs.os.uk/osngd/data-structure/buildings/building-features)                          | Candidate richer building/part geometry and height attribution.                                                               | Access/licensing must be evaluated; it is not an assumed free, redistributable input for this game. No subscription is authorized.                                          |
| Dated, geolocated street/facade imagery                                                                                  | Frontages, signs, roof details, local objects absent from map data.                                                           | Coverage and permissible reference/derived-asset use are unresolved. F1 must identify concrete sources; image access is not automatic permission to redistribute the image. |

The GLA tree catalogue demonstrates a practical way to place real tree instances. It does not establish complete city-wide observation. If a street has insufficient reference coverage, record the gap and collect suitable evidence or propose another pilot; do not silently substitute generic geometry and call it faithful.

## C6: provenance and object records

New schema planned for `lib/game/cityDetail.ts`; it must be pure TypeScript, SSR safe and independent of Three.js. Authoring records remain offline; the runtime manifest can be smaller. Proposed minimal contract:

```ts
export type DetailId = string;
export type EvidenceState = 'observed' | 'inferred' | 'unknown';
export interface DetailSource {
  id: string;
  url: string;
  observedAt: string | null;
  retrievedAt: string;
  useBasis: string;
}
export interface ObservedValue<T> {
  value: T | null;
  state: EvidenceState;
  sourceIds: string[];
}
export interface StreetEntity {
  id: DetailId;
  kind: 'building' | 'tree' | 'sign' | 'lamp' | 'crossing' | 'other';
  sourceFeatureId: string | null;
  position: ObservedValue<{ longitude: number; latitude: number }>;
  headingDeg: ObservedValue<number>;
  features: Record<string, ObservedValue<string | number | boolean>>;
}
export interface DetailArea {
  schemaVersion: 1;
  id: string;
  bbox: [number, number, number, number]; // west, south, east, north
  sources: DetailSource[];
  entities: StreetEntity[];
}
export interface BakedDetailTile {
  id: string;
  entityIds: DetailId[];
  bounds: [number, number, number, number]; // WGS84 west, south, east, north
  lod: 'overview' | 'neighbourhood' | 'street';
  assetPath: string;
  sha256: string;
  byteSize: number;
  triangleCount: number;
  geometryBytes: number;
  estimatedTextureBytes: number;
}
```

The F2 worker defines `validateDetailArea(area: DetailArea): string[]` and `encodeDetailArea(area: DetailArea): string` with stable ordering and validation of IDs, coordinates, source references and evidence state. Observed values require a non-null value and a known source. Unknown values are null. Inferred values retain their evidence/derivation and never become observed solely because an agent generated them.

This is an identity/evidence index, not the complete building recipe. F1's pinned geometry and facade observations remain inputs to F3. Before an asset worker starts, the tech lead supplies a typed recipe for that building family, including footprint/part geometry, facade-local coordinates, metric dimensions and source IDs for its parameters. Scalar `features` must not replace those detailed inputs or become an excuse to discard them. Authoring area bounds use WGS84; baking records the explicit transform into metric game coordinates.

Preserve original feature IDs during new ingest. Do not claim an arbitrary array index in the old binary is an OSM ID. Matching the old base to enriched objects needs a reviewed spatial/footprint join; ambiguous matches cannot suppress multiple neighbouring buildings. Baked manifests list the matched base footprint identities so only their replacements suppress stock.

## C7: visual and geographic acceptance

Choose the route and sample **before** reconstruction. The pilot inventory covers all street-facing buildings on both sides and all visually distinctive small objects observed along it. Every entity gets a source/unknown record, even if its occupant/name is omitted from the game.

At G2 require:

- A continuous 200–300 m in-game route, both directions, with at least one junction and a close exploration view. Include the wider context; no teleport-only montage.
- Real-reference comparisons for ten preselected ordinary buildings (or all if the segment has fewer), including different shapes/frontages. All distinctive features identified in their briefs must be matched or explicitly rejected as a blocker; generic stylistic similarity does not pass.
- At least five observed individual tree/street-furniture instances and the segment's salient signs/crossings where present. Judge position, side of street, orientation, broad dimensions and recognizable form. If the segment has fewer, inventory all; do not add imaginary objects to meet a count.
- Check building order, corner geometry, frontage breaks, entrance/bay placement and street width against dated sources. Derive positional tolerances from actual source resolution and document them before testing. Do not claim centimetre accuracy from metre-resolution data.
- A reviewer familiar with the area can identify the street and sampled buildings without in-game labels, then compare the source imagery. Record recognition and concrete mismatches; Foo approves the pilot against the selected SFSIM benchmark.
- Runtime gates remain green. Coarse/background regions and inferred objects are explicitly unverified in the authoring/QA ledger; one accepted block cannot certify London-wide fidelity.

The ten/five samples are minimum QA sampling proposals, not permission to make the rest of the route inaccurate. All salient source-backed pilot features remain part of acceptance.

## Repeatability and rollout

F6 repeats the pipeline in a contrasting ordinary area, records reference coverage, manual correction rate, machine/model cost, asset size, bake duration and rendering cost, and then estimates area-by-area London expansion. A spectacular hand-tuned block that takes unlimited manual exceptions is insufficient evidence of a scalable pipeline. The eight game hubs remain interaction regression anchors, not the boundary of the city vision.
