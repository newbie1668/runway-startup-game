# F1 full-route source feasibility — Charlotte Street pilot (Percy Street → Tottenham Street)

Decision: **NO-GO for modelling approval; bounded free acquisition continued and
partly complete.** This revision corrects the independent review of
`57f2a327` (evidence states, rights, C1 side, parent/parts, vacant pit, LiDAR
claims, date sorting, source accessibility), adds the verified bounded
acquisition (KartaView frames, Camden appraisal PDF, Commons original
inspection, EA DSM/DTM + survey provenance, 3-footprint raster sample), and
applies the second review of `9fb1c686` (rejected-photo aggregation, count
reconciliation, ~2 m scoping, KartaView licence/attribution). Every count
below is quoted from the regenerated `source-audit.json`; the script asserts
the quoted totals against the report and fails if they diverge.

The route-wide inventory is complete at the map level: 61 frontage **geometry
records** (52 buildings + 9 `building:part` ways linked to parents — not 61
independent structures or photo targets) and 41 street objects, all with
retained OSM/Camden/NHLE IDs. After manual inspection of Commons originals,
**9 geometry records (6 buildings + 3 parts of one building) have an
identity-verified dated photograph** that yields *observed* visible-facade
fields; 48 candidate-only geometry records have candidate images only
(uploader labels or camera proximity, not identity); 4 without any positive
candidate. 7 geometry records (4 buildings — Carousel 19–23, Vagabond 25, Italians 2,
Fitzroy Tavern 16 — + the 3 Carousel parts; see §6) have an
identity-verified photograph captured in 2025 or later, so **54/61 lack a
verified dated ≥ 2025 record**. Rejected photo labels are retained as fixtures
but never counted as positive or candidate evidence. No frontage has an
observed metric height, roof depth, or complete side/rear geometry. A correct NO-GO with a complete
inventory is a valid F1 submission; it is **not** product completion and does
not authorise modelling.

Generated companions (same commit):

- `source-audit/source-coverage.md` — per-entity/per-field tables (generated).
- `source-audit/source-audit.json` — machine-readable inventory, sources, control points, raster sample (generated).
- `source-audit/cache/` — every fetched response with URL, `retrievedAt`, HTTP status, SHA-256; binary payloads (`.pdf`, `.tif`, `.jpg`) with `.meta.json` sidecars. `--offline` rebuilds verify every hash.
- `source-audit/screenshots/` — full-page screenshots of source metadata (§11).
- `scripts/audit-street-sources.ts` — reproducible audit; `pnpm tsx scripts/audit-street-sources.ts` (fetch) or `--offline`.

## 1. Route and bounds

| Item | Value | Basis |
| --- | --- | --- |
| South endpoint | OSM node `25495441` (51.5180299, -0.1342984) Percy Street junction | pinned OSM extract |
| North endpoint | OSM node `107318` (51.5200969, -0.136436) Tottenham Street junction | pinned OSM extract |
| Centreline ways | `1301782548`, `4068454`, `30279582` (14 vertices) | pinned OSM extract |
| Length | 273.3 m haversine / 272.3 m local-equirectangular projection | computed |
| Travel direction | south → north; **west = left, east = right** | convention from `map-inventory.md` |
| Pinned OSM extract | `map-source.osm.xml.gz`, SHA-256 `17e8d0ca…3f9972` | committed F1 evidence |
| OSM supplement | `api.openstreetmap.org/api/0.6/map?bbox=-0.1352,51.5175,-0.1332,51.5185`, SHA-256 `9d0fee5b…f1873` | covers the building buffer south-east of Percy Street that the pinned extract clips |
| Frontage rule | building edge ≥ 2 m, within 16 m of centreline, ≤ 30° to nearest segment, chainage ± 6 m | map-geometry rule, not a survey |
| Object rule | nodes within 14 m of centreline | map-geometry rule |

OSM edit timestamps/versions are source metadata, not observation dates.
Positions carry OSM/Camden source resolution (metres), not survey precision.

## 2. Evidence states used throughout

| State | Meaning |
| --- | --- |
| `observed` | a dated source that shows or records the feature itself, and whose identity with the OSM entity was checked (visible house number / fascia / list-entry address) |
| `map-reported` | tag or coordinate from OSM / Camden / NHLE; not independently observed |
| `inferred` | derived or candidate: uploader address labels not yet checked against the image, camera-proximity images, positional NHLE joins, raster percentiles |
| `unknown` | no source found; **not** evidence of absence |

Photo matches carry `evidence: candidate | identity-verified | rejected`.
Only manually inspected files (§4) are `identity-verified`; they populate
observed fields **only for what is visible in the frame** and never for hidden
geometry, metric height or 2026 currentness.

## 3. Bounded source audit (2026-09-17, one fetch pass + bounded acquisition)

| Source | Access | Result | Rights / usage basis |
| --- | --- | --- | --- |
| Wikimedia Commons API (geosearch, category, imageinfo/extmetadata) | reachable; HTTP 429 handled by backoff | 278 files considered, 25 with camera ≤ 45 m of route, 8 Geograph mirrors; 7 originals manually inspected | per-file licence + author retained (CC BY-SA 2.0/4.0, CC BY 2.0). Reference use with attribution; **not** rights-free and not proposed as shipped textures |
| Geograph API direct | HTTP 200 but key-gated | Geograph images reached via Commons mirrors only | CC BY-SA 2.0 via Commons metadata |
| Camden *Trees In Camden* (Socrata `csqp-kdss`) + `api/views` metadata | reachable | 132 records in window; 15 within 14 m; 6 join OSM tree nodes, one of which is a **vacant pit** | **OGL v3**, attribution "London Borough of Camden" (from dataset metadata) |
| Historic England NHLE (ArcGIS FeatureServer) | reachable | 38 entries in window; **5 address-verified joins, 8 positional candidates** | NHLE open data, list-entry hyperlinks retained |
| KartaView / OpenStreetCam API | nearby query cached (HTTP 200); broad queries later 400/408 — cached metadata remains usable; sequence metadata fetched for the 3 frames | 3 frames' metadata + originals fetched and inspected (§5) | **CC BY-SA 4.0**, credit "© Grab and KartaView Contributors" (Terms of Use §4, verified 2026-09-17, §10); cached originals are attributed research copies, not game assets |
| Camden Charlotte Street conservation area appraisal (direct PDF) | **HTTP 200, public**, 491,541 B, 63 pp | text extracted; adopted July 2008, survey early 2007 | Camden publication; historical context only, no image reuse implied |
| EA LiDAR composite 1 m DSM/DTM (WCS GetCoverage) | **HTTP 200, public**, 2 × 4,194,755 B GeoTIFF (1000 × 1000, float32, tiled) | fetched 529000–530000 E / 181000–182000 N; 3-footprint sample analysed (§7) | OGL v3 |
| EA LiDAR survey extents (OGC Features) | HTTP 200 | 2018 (`P_10768`, flown 2017-12-07 → 2018-01-24) and 2020 (`P_12151`, 2020-12-12) polygons both cover the route; composite does not expose per-cell date | OGL v3 |
| Mapillary Graph API | HTTP 500 without token | not enumerated | optional free token; not required for the decision |

The earlier claims "appraisal 403 / not usable" and "EA tiles need the
interactive download step" were wrong and are withdrawn: both are public
read-only endpoints and were fetched by the script.

## 4. Identity-verified photographic observations (manual inspection of Commons originals)

| Frontage | OSM | File (author, licence) | Captured | Identity basis | Visible → observed | Not visible / limits |
| --- | --- | --- | --- | --- | --- | --- |
| W 19–23 (Carousel) | parent `226909126`; parts `425929635`, `425929632`, `425929636` | Carousel & No. 23, Fitzrovia, W1 (Ewan-M, CC BY-SA 4.0) | 2025-08-10 | numbers 21 and 23, Carousel fascia | pale frontage, shop signs, upper sash rows, dormers, sloping roof edge, chimneys/pots | oblique, occlusion; no roof depth, metric height, side/rear geometry, 2026 currentness |
| W 25 (Vagabond) | `226909130` | Vagabond, Fitzrovia, W1 – 2025-07-12 (Ewan-M, CC BY-SA 4.0) | 2025-07-12 | Vagabond fascia + adjoining visible no. 23 | shop sign, upper brick façade, window rows, parapet/chimneys | street-works occlusion; partial reliance on OSM occupier tag; no height/roof depth/side/rear |
| E 2 (Italians) | `122020336` | Italians, Fitzrovia, W1 (Ewan-M, CC BY-SA 4.0) | 2025-08-10 | fascia + Charlotte/Percy street plates + OSM occupier | white corner façade, shopfront, upper openings, parapet/chimneys, Percy Street side elevation | partial reliance on OSM occupier tag; no metric height/roof depth/rear |
| E 16 (Fitzroy Tavern) | `138339524` | Fitzroy Tavern, Fitzrovia, W1 (Ewan-M, CC BY-SA 4.0) | 2025-08-10 | "16 Charlotte Street" fascia, pub signs, street plates | corner shopfront, both street elevations, upper openings, ornate parapet/finials, partial side | tree occlusion; no roof depth/metric height/rear |
| E 26 | `138339533` | 26 Charlotte Street, Fitzrovia, May 2022 (No Swan So Fine, CC BY-SA 4.0) | 2022-05-28 | visible no. 26 + accepted F1 card | pale frontage, bays, arched openings, doors, railings, dormers, chimneys, roof edge | roof depth, metric height, side/rear, 2026 condition |
| E 28 | `138339551` | 28 Charlotte Street, Fitzrovia, May 2022 (No Swan So Fine, CC BY-SA 4.0) | 2022-05-28 | accepted F1 card + terrace context | brown three-bay brick façade, upper window rows, surrounds, shopfront, door, railings | roof depth/profile, metric height, rear, current shopfront |
| E 28 (ground floor) | `138339551` | Goode Flowers 2024-05-08 (Adrian Scottow, CC BY-SA 2.0) | 2024-05-08 | Goode Flowers fascia + visible adjoining 30a + OSM occupier | ground-floor shopfront, fascia, awning, pavement edge | upper façade and roof outside frame; display/refuse occlusion |

Rejected: "30 Charlotte Street, Fitzrovia, May 2023" — linked NHLE entry is
30 Tottenham Street and the geometry conflicts with the verified 28/30
context; kept as `rejected-by-review` (`evidence: rejected`). It is excluded
from every positive/candidate `frontageImage` source, value, fallback and
summary count; `assertRegressions()` in the script fails the run if the
fixture disappears, changes state, or is cited by any `frontageImage`.

E 30 Charlotte Street (`138339531`) therefore has no address-labelled or
identity-verified Commons match in this audit — only 4 camera-proximity
candidates (`inferred`), none labelled with this address. The accepted source card
(`frontage-source-cards.md`) retains a correct-address historical reference: a
[Fitzrovia News report (2022-02-15)](https://fitzrovianews.com/2022/02/15/licensing-application-lisboeta-30-charlotte-street/)
picturing the ground-floor Lisboeta frontage at that address. Its image
capture date, reuse rights and current (2026) appearance are **unverified /
not extracted** here — it is not entered as a photo match or an `observed`
field; the absence of an identity-verified 30 Charlotte Street view means not
found in the audited Commons / KartaView sources, not absent from all sources.

The earlier statement that the 2025 photographs show "roofs not" is withdrawn:
Carousel/No. 23, Fitzroy Tavern, Italians, Vagabond, 26 and 28 all show roof
edge / parapet / chimney / dormer evidence for the **street face**, which is
now recorded. Roof *depth* and rear slopes remain unknown for every frontage.

All other Commons matches (48 candidate-only geometry records) remain
**candidates**: an uploader's
address label or a camera within 30 m is not identity. Capture dates are
parsed and sorted independently of match tier; unparseable dates are kept as
strings and reported as unknown date.

## 5. KartaView frames (cached metadata + originals, inspected)

| Frame | Sequence | Shot (camera time) | Uploaded | Size | Heading | GPS acc. | Assessment |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `163252803` | 969223 | 2017-11-14 09:21:50 | 2017-11-14 | 3840 × 2160 | 45° | 16 | **rejected** — off-route courtyard / modern development; not Charlotte Street |
| `197918957` | 1123901 | 2018-01-17 11:35:30 | 2018-02-05 | 2592 × 1936 | 323° | 10 | Charlotte Street context: upper façades, lamps, trees, signs, BT Tower; heavy vehicle occlusion, no legible house number → route-context candidate, no entity identity |
| `1289673597` | 3556677 | 2018-12-30 15:38:45 | 2021-05-06 | 3000 × 2096 | 325° | null | Windmill Street / junction view; low light, blur, vehicles; no resolved Charlotte Street entity |

Shot dates are used; upload/processing dates are recorded separately and never
substituted. None of the three frames populates a frontage field.

Contributor attribution (sequence endpoint `api.openstreetcam.org/2.0/sequence/<id>`,
cached): 969223 → userId 12139; 1123901 → userId 53 (orgCode CMNT, iPhone6);
3556677 → userId 13127. The public API exposes numeric contributor ids only
(the user endpoint refuses numeric ids, HTTP 400 apiCode 418), so no display
names are retained; the licence credit is the required collective one,
"© Grab and KartaView Contributors", plus frame/sequence/userId (§10).

## 6. Coverage summary (from `source-audit.json` → `summary`)

Geometry-record totals and independent-building totals are labelled
separately. Photo columns count non-rejected matches only.

| Side | Geometry records | Buildings | Parts | Identity-verified (geometry records) | …of which buildings | …of which parts | Candidate only | No photo | Identity-verified ≥ 2025 (geometry records) | Any non-rejected match ≥ 2025 | `building:levels` | `height` | `roof:shape` | material | NHLE address-verified | NHLE positional candidate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| West | 29 | 23 | 6 | 5 | 2 | 3 | 21 | 3 | 5 | 5 | 23 | 0 | 0 | 18 | 1 | 0 |
| East | 32 | 29 | 3 | 4 | 4 | 0 | 27 | 1 | 2 | 2 | 29 | 0 | 4 | 24 | 4 | 8 |
| Total | 61 | 52 | 9 | 9 | 6 | 3 | 48 | 4 | 7 | 7 | 52 | 0 | 4 | 42 | 5 | 8 |

So 61 geometry records = 52 buildings + 9 parts; 9 + 48 + 4 = 61; 9 verified
= 6 buildings + 3 parts; 61 − 7 = 54 geometry records lack a verified dated
≥ 2025 record (per independent building: 52 − 4 = 48 lack one; the 26/28
verified images are 2022/2024). Rejected
labels counted in the inventory: 1 (`summary.total.rejectedPhotoLabels`).

Per-field state counts across the 61 geometry records:

| Field | observed | map-reported | inferred | unknown |
| --- | --- | --- | --- | --- |
| footprint | 0 | 61 | 0 | 0 |
| address | 0 | 47 | 0 | 14 |
| levels | 0 | 52 | 0 | 9 |
| height (m) | 0 | 0 | 0 | 61 |
| roof shape | 0 | 4 | 0 | 57 |
| roof levels | 0 | 10 | 0 | 51 |
| wall material | 0 | 42 | 0 | 19 |
| wall colour | 0 | 28 | 0 | 33 |
| building parts | 0 | 9 | 0 | 52 |
| facade bays / windows / doors | 0 | 0 | 0 | 61 |
| current shopfront | 0 | 0 | 0 | 61 |
| roof profile / depth | 0 | 0 | 0 | 61 |
| rear / side geometry | 0 | 0 | 0 | 61 |
| frontage image | 9 | 0 | 48 | 4 |
| heritage listing | 5 | 0 | 8 | 48 |

The `facadeBaysWindowsDoors`, `shopfrontCurrent` and `roofProfileDepth` fields
stay `unknown` as *measured* fields; the visible-façade observations in §4 are
recorded in the `frontageImage` field notes and per-photo `visible`/`limits`
text, not converted into counted bays or metric values.

Street objects (41): 15 trees (5 OSM↔Camden living trees, 9 Camden-only,
1 OSM-only), **1 vacant tree pit**, 12 crossings, 7 signs, 2 motorcycle
parking, 1 each bench / cycle parking / cycle hire / waste basket. **No lamp
posts are mapped** in either OSM source; lamp positions are `unknown`
route-wide, not absent (the 2018 KartaView frame shows lamps exist).

Vacant pit: OSM node `3531928739` (chainage 202.6 m, west, `natural=tree`)
joins Camden `00065182` "Vacant Tree Pit (planned: Tulip Tree)", inspected
2025-07-10, height/spread null. Encoded as `kind: vacant_tree_pit`,
`presenceAtInspection = absent (observed, 2025-07-10)`, `form = unknown`,
`currentPresence = unknown` (a 2025 inspection does not establish September
2026 state). The OSM provenance is retained; it is excluded from control
points.

Geometry records with no positive Commons candidate of any tier (4,
`frontageImage.state == "unknown"` in `source-audit.json`): west
`osm:way:346673943` (no address), west `osm:way:118808999` (no address), west
59 Charlotte Street (`osm:way:118808987`), east 54 Charlotte Street
(`osm:way:188549777`).

## 7. EA LiDAR: what was fetched and what it does and does not establish

Fetched via public WCS (OGL v3): DSM `aa699985…3abec`, DTM `bf5c40d5…9bdca7`,
each 1000 × 1000 float32 EPSG:27700 cells, 1 m spacing, bbox 529000–530000 E /
181000–182000 N. Survey-extent candidates covering every sample centroid:
2018 (`P_10768`) and 2020 (`P_12151`); the composite does not say which
survey supplied a given cell, so **no single observation date is assigned**.

Bounded sample (3 well-identified footprints, OSM ring → BNG via a 7-parameter
Helmert approximation). The **~2 m figure** (residual against 132 rounded
Camden E/N pairs: median 1.84 m, max 2.31 m) measures only that approximate
WGS84→BNG coordinate transform. It is **not** an OSM-footprint-to-EA-raster
registration figure and **not** a height or roof error bound; footprint-to-
raster registration was not measured.

| Footprint | DSM cells | DSM p20 / p50 / p80 (m AOD) | DTM p50 | p80 − terrain | Status |
| --- | --- | --- | --- | --- | --- |
| 11–13 Charlotte Street `226909133` | 151 | 41.06 / 42.79 / 43.06 | 27.08 | 15.97 m | inferred sample only |
| 26 Charlotte Street `138339533` | 78 | 36.66 / 42.55 / 42.61 | 26.20 | 16.41 m | inferred sample only |
| 28 Charlotte Street `138339551` | 132 | 31.39 / 36.36 / 42.54 | 25.62 | 16.92 m | inferred sample only |

What this establishes: the WCS path works, the grid is georeferenced and the
values are plausible for three/four-storey terraces. What it does **not**
establish, and the earlier text wrongly implied: 1 m is *grid spacing*, not
"±1 m accuracy for every frontage"; EA's stated vertical RMSE does not
propagate unchanged to eaves/ridge/roof-depth estimates once unmeasured
footprint-to-raster registration, mixed 2018/2020 survey dates, chimneys,
party walls, vegetation and rear extensions are involved (28 Charlotte
Street's p20 of 31.4 m vs p80 of 42.5 m shows how much within-footprint spread
there is). Derived dimensions stay `inferred` even after a survey date is
attributed, until field-specific uncertainty is validated against an
independent measurement. The sample values are **not** written into
`heightM`/`roofProfileDepth`, which remain `unknown`, and are not scaled to
the other 58 records.

## 8. Control points (positional joins only)

| # | Control | Source A | Source B | Offset | Verify |
| --- | --- | --- | --- | --- | --- |
| C1 | Tree, chainage 263.4 m, **east** | OSM node `3531897273` (51.5200629, -0.1362843), v1 | Camden `00003850` London plane, 19 m, spread 7 m, inspected 2025-07-10 | 0.4 m | `osm-node-3531897273-tree.jpg`, `camden-trees-controls-*.jpg` |
| C2 | Tree, chainage 251.6 m, west | OSM node `3531897253` | Camden `00003860` London plane, 16 m, spread 5 m, inspected 2025-07-10 | 1.5 m | same Camden query |
| C3 | Listed building, 11–13 Charlotte Street | OSM way `226909133` centroid | NHLE `1066260` "11 AND 13, CHARLOTTE STREET W1", Grade II, listed 1987-12-01 (address-verified) | 3.2 m | `nhle-1066260-11-13-charlotte-street.jpg` |
| C4 (reserve) | Listed, 26 Charlotte Street | OSM way `138339533` | NHLE `1242927` (address-verified) | 2.5 m | accepted F1 card |
| C5 (reserve) | Listed, 28 Charlotte Street | OSM way `138339551` | NHLE `1448458` (address-verified) | 2.7 m | accepted F1 card |

C1's side was previously reported as west; it is **east** (right-hand side
travelling north). These offsets show that two independently mapped points
agree at metre level; they say nothing about canopy, façade, roof or height
accuracy and do not establish route-wide survey accuracy. The NHLE record for
1066260 states district "City of Westminster" although the street is in
Camden; retained as-is. The 8 positional NHLE candidates (e.g. 2/4/6 ↔
`1113267`, 24 ↔ `1242927`, 30 ↔ `1448458`, 32/34/36 ↔ `1356775`) are
`inferred` — proximity alone is not identity.

## 9. Camden conservation area appraisal (historical context, not route evidence)

Direct PDF fetched (SHA-256 `5ce066aa…6defe6`, 63 pages, adopted July 2008,
field survey early 2007). Relevant text: mixed-use street of generally three
or four storeys; townhouses with shopfronts; parapets; yellow stock brick,
stucco and red brick; sash windows; chimneys; slate roofs; decorative pubs
(Fitzroy Tavern named); views along Percy Street. This is 2007 area-level
description and is kept separate from per-entity 2022–2025 observations; it
does not populate any current field and grants no image reuse.

## 10. Rights and usage basis

- OSM (pinned extract + supplement): ODbL 1.0, "© OpenStreetMap contributors".
- Commons files: licence and author retained per file (CC BY-SA 2.0/4.0, CC BY 2.0). Reference use for modelling with attribution; **not** rights-free, not proposed as shipped textures; images are not redistributed in-repo except that the §11 file-page screenshots are **reproductions** of the Commons pages including the pictured image, and are therefore attributed to the file author/licence listed in §11 (Ewan-M CC BY-SA 4.0; Adrian Scottow CC BY-SA 2.0).
- Camden Trees In Camden: OGL v3, attribution London Borough of Camden.
- Camden appraisal PDF: public Camden publication; text used for context only.
- Historic England NHLE: open data; list-entry hyperlinks retained.
- EA LiDAR DSM/DTM and survey extents: OGL v3, attribution Environment Agency.
- KartaView: Terms of Use §4 "Open Source License" (https://kartaview.org/terms, rendered 2026-09-17, screenshot `kartaview-terms-open-source-license.jpg`; the raw HTTP body is an SPA shell, cached as `kartaview-terms-shell`) licenses street images under **CC BY-SA 4.0** and requires the credit "© Grab and KartaView Contributors". https://kartaview.org/faq returns the SPA shell with "Cannot find requested page" — no FAQ licence statement is published at that route (cached `kartaview-faq-shell`). The three cached originals (`cache/kartaview-frame-*.jpg` with URL, retrieval time, SHA-256) are retained as **attributed research/evidence copies** under that licence with frame/sequence/userId provenance (§5). This is documentation use only: it is **not** an approval to derive game textures or shipped assets, and ShareAlike consequences for derived assets were not assessed.
- Geograph direct API and Mapillary: probed only, no content used.
- No paid provider or credential was used.

## 11. Screenshots (full-page captures of source pages, 2026-09-17)

The Commons rows are **reproductions** of the file pages and include the
pictured photograph; each is attributed to the listed author and licence
(source: the file page's Commons metadata). They are evidence exhibits, not
assets.

| File | URL | Shows | Image author / licence (reproduction) |
| --- | --- | --- | --- |
| `commons-carousel-no23-2025-08-10.jpg` | https://commons.wikimedia.org/wiki/File:Carousel_%26_No._23,_Fitzrovia,_W1.jpg | 19–23 Charlotte Street, 10 Aug 2025, camera location | Ewan-M, CC BY-SA 4.0 |
| `commons-italians-2-charlotte-2025-08-10.jpg` | https://commons.wikimedia.org/wiki/File:Italians,_Fitzrovia,_W1.jpg | 2 Charlotte Street, 10 Aug 2025 | Ewan-M, CC BY-SA 4.0 |
| `commons-fitzroy-tavern-2025-08-10.jpg` | https://commons.wikimedia.org/wiki/File:Fitzroy_Tavern,_Fitzrovia,_W1.jpg | 16 Charlotte Street, 10 Aug 2025 17:28, EXIF date | Ewan-M, CC BY-SA 4.0 |
| `commons-vagabond-25-charlotte-2025-07-12.jpg` | https://commons.wikimedia.org/wiki/File:Vagabond,_Fitzrovia,_W1_-_2025-07-12.jpg | 25 Charlotte Street, 12 Jul 2025 | Ewan-M, CC BY-SA 4.0 |
| `commons-goode-flowers-28-charlotte-2024-05-08.jpg` | https://commons.wikimedia.org/wiki/File:Goode_Flowers_2024-05-08.jpg | 28 Charlotte Street ground floor, 8 May 2024 | Adrian Scottow, CC BY-SA 2.0 |
| `kartaview-terms-open-source-license.jpg` | https://kartaview.org/terms | Terms of Use §4: street images CC BY-SA 4.0, credit "© Grab and KartaView Contributors" | text page (Grab) |
| `camden-trees-controls-00003850-00003860-00065182.jpg` | https://opendata.camden.gov.uk/resource/csqp-kdss.json?$where=identifier in('00003850','00003860','00065182') | C1/C2 trees and vacant pit 00065182, inspections 2025-07-10 |
| `camden-trees-metadata-ogl-v3.jpg` | https://opendata.camden.gov.uk/api/views/csqp-kdss | dataset licence OGL v3, attribution London Borough of Camden |
| `nhle-1066260-11-13-charlotte-street.jpg` | https://historicengland.org.uk/listing/the-list/list-entry/1066260 | C3, Grade II, listed 1987-12-01 |
| `osm-node-3531897273-tree.jpg` | https://www.openstreetmap.org/node/3531897273 | C1 OSM side, v1 |
| `ea-survey-index-dsm-charlotte-bbox.jpg` | https://environment.data.gov.uk/geoservices/datasets/9f0fa3fc-a860-4729-adc9-47fe53f658d0/ogc/features/v1/collections/LIDAR_Composite_1m_Last_Return_DSM_2022_extents/items?bbox=-0.1375,51.5172,-0.1330,51.5210&limit=20 | 2018 and 2020 survey polygons covering the route |
| `kartaview-frame-197918957-metadata.jpg` | https://api.openstreetcam.org/2.0/photo/197918957 | shot 2018-01-17 11:35:30 vs upload 2018-02-05, heading 323°, GPS acc. 10 |

## 12. Residual field-specific gaps

| Gap | Entities | Why still open |
| --- | --- | --- |
| Identity-verified current (≥ 2025) view | 54 of 61 geometry records (48 of 52 buildings) | the audited Commons/Geograph/KartaView sources yielded no identity-verified 2025+ view of them (not a claim that none exists anywhere) |
| Any identity-verified view | 52 of 61 geometry records (46 of 52 buildings) | 48 candidate-only, 4 without any positive candidate |
| Counted façade bays / window & door rhythm | 61 | §4 photos show rhythm but it has not been counted per storey and is oblique/occluded for several |
| Current shopfront / occupier | 61 | latest views are Jul–Aug 2025 for 4 frontages; nothing for the rest |
| Metric height | 61 | LiDAR sample gives inferred p80 − terrain for 3 footprints with unmeasured footprint-to-raster registration and unresolved 2018/2020 date; not an eaves/ridge measurement |
| Roof depth / profile | 61 | street faces show parapets/dormers/chimneys for 6 buildings; depth, rear slopes and ridges unobserved; DSM sample not yet decomposed into roof planes |
| Side / rear geometry | 61 (partial side visible for Fitzroy Tavern, Italians) | no rear views in any free source |
| Lamps | route-wide | none mapped; positions unknown |
| Crossing markings / sign faces | 12 / 7 | map-reported type only |
| Tree canopy form / current presence | 15 trees + 1 pit | Camden 2025-07 inspection gives height/spread; canopy shape and 2026 presence unobserved |

## 13. Bounded next steps (free, in order of information per effort)

1. **Scale the raster sample carefully**: apply the same DSM/DTM method to the
   remaining 49 building footprints (parts merged into parents), report
   per-footprint p20/p50/p80 with cell counts, flag footprints < 40 cells or
   with p80 − p20 > 5 m, and keep results `inferred` until a dated view or
   survey polygon per cell is resolved. Zero additional download.
2. **Count façade rhythm from the §4 originals** (bays per storey, storeys,
   shopfront type) for the 6 identity-verified buildings and record the
   frame-visible portion only, with the same identity basis.
3. **Optional geotagged street walk** (~40 min, both pavements): one square-on
   view per frontage, one oblique per block corner, crossings, signs, lamps.
   This yields observed values only for what is visible and identity-verified
   in each frame and is the most direct known route to `shopfrontCurrent` and
   lamp positions for all 61 records. Requires an operator decision; it is not
   a data-access barrier and is not a precondition for accepting this research
   packet.
4. **Optional free Mapillary token** to enumerate 2023–2026 sequences along
   ways `4068454`/`30279582`; may reduce item 3 for façade rhythm, not roofs.
5. **Rear/roof geometry**: EA DSM decomposition into roof planes per footprint
   is a free candidate once footprint-to-raster registration is measured;
   rear elevations will likely stay `unknown` — acceptable to declare for a
   street-facing pilot, but it must be declared, not assumed.

None of these steps has been executed; the decision stands at **NO-GO** until
items 1–2 are done and either item 3 or 4 delivers identity-verified current
views for the remaining frontages.

## 14. Validation run (this revision)

```
pnpm tsx scripts/audit-street-sources.ts            # fetch mode: all new sources HTTP 200, regression assertions pass, exit 0
pnpm tsx scripts/audit-street-sources.ts --offline  # cache-only rebuild incl. SHA-256 checks of every cache file, exit 0
# offline run twice → source-audit.json identical after removing recordedAt/mode
pnpm exec tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --skipLibCheck scripts/audit-street-sources.ts  # exit 0
pnpm exec eslint scripts/audit-street-sources.ts    # exit 0
pnpm exec prettier --check scripts/audit-street-sources.ts  # exit 0
```

Existing `evidence/F1/*.md|json` files already fail `prettier --check`; the
generated outputs follow that precedent and are not reformatted.
