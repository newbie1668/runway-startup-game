# F1 full-route source feasibility — Charlotte Street pilot (Percy Street → Tottenham Street)

Decision: **NO-GO for modelling approval; GO for continuing bounded acquisition.**
The route-wide inventory is complete at the entity level (61 street-facing
frontages, 41 street objects, all with retained OSM/Camden/NHLE IDs), but the
free/public sources audited on 2026-09-17 do not provide dated, geolocated,
identity-verified views of every frontage. 12 of 61 frontages have an
address-labelled Commons photograph; 4 of those are dated 2025. Facade rhythm,
shopfront state, roof depth, height and rear/side geometry are `unknown` for
every frontage. A correct NO-GO with a complete inventory is a valid F1
submission; it is **not** product completion and does not authorise modelling.

Generated companions (same commit):

- `source-audit/source-coverage.md` — human-readable per-entity/per-field tables.
- `source-audit/source-audit.json` — machine-readable inventory (frontages, objects, control points, sources, probes).
- `source-audit/cache/` — every fetched response with URL, `retrievedAt`, HTTP status and SHA-256.
- `source-audit/screenshots/` — full screenshots of new source evidence (listed below).
- `scripts/audit-street-sources.ts` — reproducible audit; `pnpm tsx scripts/audit-street-sources.ts` (fetch) or `--offline` (cache only).

## 1. Route and bounds

| Item | Value | Basis |
| --- | --- | --- |
| South endpoint | OSM node `25495441` (51.5180299, -0.1342984) Percy Street junction | pinned OSM extract |
| North endpoint | OSM node `107318` (51.5200969, -0.136436) Tottenham Street junction | pinned OSM extract |
| Centreline ways | `1301782548`, `4068454`, `30279582` (14 vertices) | pinned OSM extract |
| Length | 273.3 m haversine / 272.3 m local-equirectangular projection | computed |
| Travel direction | south → north; west = left, east = right | convention from `map-inventory.md` |
| Pinned OSM extract | `map-source.osm.xml.gz`, SHA-256 `17e8d0ca…3f9972` | committed F1 evidence |
| OSM supplement | `api.openstreetmap.org/api/0.6/map?bbox=-0.1352,51.5175,-0.1332,51.5185`, 2026-09-17T19:13Z, SHA-256 `9d0fee5b…f1873` | covers the 35 m building buffer south-east of Percy Street that the pinned extract clips |
| Frontage rule | building edge ≥ 2 m, within 16 m of centreline, ≤ 30° to nearest segment, chainage ± 6 m; side by facing length | map-geometry rule, not a survey |
| Object rule | nodes within 14 m of centreline (between building lines) | map-geometry rule |

OSM edit timestamps/versions are source metadata, not observation dates. All
positions carry OSM/Camden source resolution (metres), not survey precision.

## 2. Bounded source audit (one pass, 2026-09-17)

| Source | Access | Result | Rights / usage basis |
| --- | --- | --- | --- |
| Wikimedia Commons API (geosearch 8 × r=60 m along centreline, category `Charlotte Street, London`, imageinfo/extmetadata) | reachable; HTTP 429 handled by backoff | 278 files considered, 25 with camera within 45 m of route, 8 Geograph mirrors | per-file licence retained (CC BY-SA 2.0 / 4.0, CC BY 2.0); attribution required |
| Geograph API direct | HTTP 200 but key-gated | not enumerated; Geograph images reached via Commons mirrors only | CC BY-SA 2.0 via Commons metadata |
| Camden *Trees In Camden* (Socrata `csqp-kdss`) | reachable | 132 records in window; 15 within 14 m of route; 6 join OSM tree nodes | Camden open data (OGL-style terms on dataset page); inspection dates 2025-07 |
| Historic England NHLE (ArcGIS FeatureServer) | reachable | 38 entries in window; 5 address-verified joins to route frontages | NHLE open data, list-entry hyperlinks retained |
| Mapillary Graph API | HTTP 500 without token | not enumerated | needs free developer token (external decision) |
| KartaView nearby | HTTP 200, 6.9 kB | probe only; coverage not resolved into frontage matches in this pass | CC BY-SA 4.0 imagery (per KartaView terms; not used) |
| Environment Agency LiDAR 1 m DSM | landing page HTTP 200 | tiles need the interactive survey-download step; not fetched | OGL v3 |
| Camden Charlotte Street conservation area appraisal PDF | HTTP 403 | not usable programmatically | — |

Limits: Commons has no capture-date filter, so dates are per-file
`DateTimeOriginal`/description text; "Taken on 21 May 2009" style strings are
kept verbatim. Title/description address matches are **labels supplied by
uploaders**, not visual identity confirmation — every photo match carries
`needsVisualVerification: true`.

## 3. Coverage summary (from `source-audit.json` → `summary`)

| Side | Frontages | Address-labelled photo | Camera-within-30 m only | No photo | Photo dated ≥ 2025 | `building:levels` | `height` | `roof:shape` | material | NHLE listed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| West | 29 | 7 | 19 | 3 | 2 | 23 | 0 | 0 | 18 | 1 |
| East | 32 | 5 | 26 | 1 | 2 | 29 | 0 | 4 | 24 | 12 |
| Total | 61 | 12 | 45 | 4 | 4 | 52 | 0 | 4 | 42 | 13 |

Per-field state counts across the 61 frontages:

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
| frontage image | 12 | 0 | 45 | 4 |
| heritage listing | 5 | 0 | 8 | 48 |

Street objects (41): 16 trees (6 OSM↔Camden joined, 9 Camden-only, 1 OSM-only),
12 crossings, 7 signs, 2 motorcycle parking, 1 each bench / cycle parking /
cycle hire / waste basket. **No lamp posts are mapped** within the buffer in
either OSM source; lamp positions are therefore `unknown` route-wide, not
absent. Object `form` and `currentPresence` are `observed` only for the 15
Camden-inspected trees; crossings and signs are `map-reported` for
position/type and `unknown` for form.

Frontages with no photograph of any tier: west `osm:way:346673943` (no
address), west `osm:way:118808999` (no address), west 59 Charlotte Street
(`osm:way:118808987`), east 54 Charlotte Street (`osm:way:188549777`).

## 4. Address-labelled photographic evidence (needs visual verification)

| Frontage | File | Capture date | Licence | Tier |
| --- | --- | --- | --- | --- |
| W 5 | Rasa Samudra, 5 Charlotte Street W1 (geograph 1824137) | 2010-04-20 | CC BY-SA 2.0 | title |
| W 11–13 | 11 and 13 Charlotte Street, Fitzrovia, August 2023 | 2023-08-09 | CC BY-SA 4.0 | title |
| W 15–17 | Oscar's, Fitzrovia, W1; Charlotte Street Hotel ×3 | 2012 / 2008–2019 | CC BY-SA 2.0 | description / name |
| W 19–23 | Carousel & No. 23, Fitzrovia, W1 | **2025-08-10** | CC BY-SA 4.0 | description |
| W 25 | Vagabond, Fitzrovia, W1 - 2025-07-12 (+2014) | **2025-07-12** | CC BY-SA 4.0 | description |
| W 33 | Fino, Fitzrovia, W1 | 2009-11-10 | CC BY-SA 2.0 | description |
| W 69 | Squat and Gobble; Blu Soul | 2010 / 2009 | CC BY 2.0 / BY-SA 2.0 | description |
| E 2 | Italians, Fitzrovia, W1 | **2025-08-10** | CC BY-SA 4.0 | description |
| E 16 | Fitzroy Tavern ×8 | **2025-08-10**, 2019, 2012, 2009, 2008 | CC BY-SA 2.0/4.0 | description / name |
| E 26 | 26 Charlotte Street, Fitzrovia, May 2022 | 2022-05-28 | CC BY-SA 4.0 | title (accepted card) |
| E 28 | 28 Charlotte Street, May 2022; Goode Flowers 2024-05-08 | 2022 / 2024 | CC BY-SA 4.0 / 2.0 | title / description |
| E 40 | Andreas, Fitzrovia, W1 | 2012-05-31 | CC BY-SA 2.0 | description |
| E 30 | 30 Charlotte Street, Fitzrovia, May 2023 | 2023-05-26 | CC BY-SA 4.0 | **rejected-by-review** (shows 30 Tottenham Street, NHLE 1379038) |

The 2010–2014 Flickr-derived files are shopfront-era records, useful for
persistent upper-facade rhythm only after comparison with a current view.

## 5. Control points (independently verifiable)

Three independent controls are available now; three more tree pairs are listed
in `controlPoints.treePairs`.

| # | Control | Source A | Source B | Offset | Verify |
| --- | --- | --- | --- | --- | --- |
| C1 | Tree, chainage 263.4 m, west | OSM node `3531897273` (51.5200629, -0.1362843), v1 | Camden `00003850` London plane, 19 m tall, spread 7 m, inspected 2025-07-10, "Captured By Camden Officer" (51.52006, -0.13628) | 0.4 m | screenshots `osm-node-3531897273-tree.jpg`, `camden-trees-controls-*.jpg` |
| C2 | Tree, chainage 251.6 m, west | OSM node `3531897253` | Camden `00003860` London plane, 16 m, spread 5 m, inspected 2025-07-10 | 1.5 m | same Camden query |
| C3 | Listed building, 11–13 Charlotte Street | OSM way `226909133` (addr 11–13 Charlotte Street) centroid | NHLE `1066260` "11 AND 13, CHARLOTTE STREET W1", Grade II, listed 1987-12-01 | 3.2 m centroid→NHLE point | screenshot `nhle-1066260-11-13-charlotte-street.jpg` |
| C4 (reserve) | Listed, 26 Charlotte Street | OSM way `138339533` | NHLE `1242927` | 2.5 m | accepted F1 card |
| C5 (reserve) | Listed, 28 Charlotte Street | OSM way `138339551` | NHLE `1448458` | 2.7 m | accepted F1 card |

Caveats: offsets are between two mapped points at metre-level resolution and
say nothing about canopy or facade geometry. OSM node `3531928739` (chainage
202.6 m) joins Camden `00065182`, which is a **vacant tree pit (planned Tulip
Tree)** as of 2025-07-10 — the OSM tree tag is stale there; do not model a
mature tree at that position. The NHLE record for 1066260 states district
"City of Westminster" although the street is in Camden; retained as-is.

## 6. Missing source views (per entity: "Missing views" column in the `source-coverage.md` frontage tables)

Route-wide: no current (2025–2026) full-elevation view for 57 of 61 frontages;
no oblique/roof view for any frontage; no rear/side view for any frontage; no
lamp inventory; no crossing marking/form record; no sign face record for 7
signs; no dated view confirming current occupier/shopfront for any of the 61.
The four Aug 2025 photographs (Carousel/No. 23, Vagabond, Italians, Fitzroy
Tavern) are ground-floor-centred pub/restaurant shots — upper floors partially
visible, roofs not.

## 7. Rights and usage basis

- OSM (pinned extract + supplement): ODbL 1.0, attribution "© OpenStreetMap contributors".
- Commons files: licence per file (retained in JSON); CC BY-SA 2.0/4.0 and CC BY 2.0 present. Use as reference for modelling is permitted with attribution; redistributing the images in-repo is **not** done — only URLs, dates, authors and licences are stored. Screenshots of Commons file pages are retained as evidence of the metadata, not as image assets.
- Camden Trees In Camden: open data under the dataset's stated Camden terms; IDs and inspection dates retained.
- Historic England NHLE: open data; list-entry hyperlinks retained.
- Geograph direct API, Mapillary, KartaView, EA DSM: probed only, no content used.
- No paid provider or credential was used.

## 8. Research evidence vs modelling approval

| Question | Answer |
| --- | --- |
| Is the entity inventory complete for the route? | Yes at map level: 61 frontages, 41 objects, retained IDs and chainage. |
| Is every frontage identity-verified with a dated view? | No — 12/61 have address-labelled photos pending visual check; 45 rely on camera proximity only; 4 have none. |
| Are heights/roofs/facade rhythm observed? | No — 0/61 for each; `building:levels` is map-reported for 52. |
| Are salient street objects observed? | Trees: 15/16 Camden-inspected (2025-07). Crossings/signs: map-reported only. Lamps: none mapped. |
| Three verifiable control points? | Yes (C1–C3 above, plus reserves). |
| F1 GO for modelling? | **NO-GO.** |

## 9. Smallest data package to flip to GO (bounded, free)

1. **One ~40-minute street walk** with a phone camera, GPS on, both pavements,
   south → north: one square-on elevation per frontage (61), one oblique per
   block corner (4), one shot per crossing (12) and sign (7), lamp positions
   noted. Output: ~110 geotagged JPEGs with EXIF dates. This alone resolves
   `facadeBaysWindowsDoors`, `shopfrontCurrent`, `currentPresence` and lamp
   positions for the whole route.
2. **Mapillary free developer token** (external decision) — enumerate existing
   2023–2026 street-level sequences along ways `4068454`/`30279582`; may replace
   item 1 for frontage rhythm but not for roofs.
3. **EA LiDAR 1 m DSM/DTM tile** for TQ2981 via the survey-download UI (OGL) —
   resolves `heightM` and `roofProfileDepth` for all 61 frontages to ±1 m.
4. Optional: Camden conservation-area appraisal PDF obtained by a person (403
   to scripts) for storey counts/roof notes on listed groups.

With items 1 + 3, every field in §3 moves to `observed` or `inferred-from-DSM`
except rear geometry (acceptable `unknown` for a street-facing pilot).

## 10. Validation run

```
pnpm tsx scripts/audit-street-sources.ts            # fetch mode, exit 0
pnpm tsx scripts/audit-street-sources.ts --offline  # cache-only rebuild, exit 0
pnpm exec tsc --noEmit --strict … scripts/audit-street-sources.ts  # exit 0 (scripts/ is excluded from tsconfig)
pnpm exec eslint scripts/audit-street-sources.ts    # exit 0
pnpm exec prettier --write scripts/audit-street-sources.ts
```

Existing `evidence/F1/*.md|json` files already fail `prettier --check`; the
generated outputs follow that precedent and are not reformatted.

## 11. Screenshots (evidence of new source metadata, captured 2026-09-17)

| File | URL | Shows |
| --- | --- | --- |
| `source-audit/screenshots/commons-carousel-no23-2025-08-10.jpg` | https://commons.wikimedia.org/wiki/File:Carousel_%26_No._23,_Fitzrovia,_W1.jpg | 19–23 Charlotte Street, 10 Aug 2025, CC BY-SA 4.0, camera location |
| `source-audit/screenshots/commons-italians-2-charlotte-2025-08-10.jpg` | https://commons.wikimedia.org/wiki/File:Italians,_Fitzrovia,_W1.jpg | 2 Charlotte Street, 10 Aug 2025, CC BY-SA 4.0 |
| `source-audit/screenshots/camden-trees-controls-00003850-00003860-00065182.jpg` | https://opendata.camden.gov.uk/resource/csqp-kdss.json?$where=identifier in('00003850','00003860','00065182') | control trees C1/C2 and the vacant pit 00065182, inspections 2025-07-10 |
| `source-audit/screenshots/nhle-1066260-11-13-charlotte-street.jpg` | https://historicengland.org.uk/listing/the-list/list-entry/1066260 | control C3, Grade II, listed 1987-12-01 |
| `source-audit/screenshots/osm-node-3531897273-tree.jpg` | https://www.openstreetmap.org/node/3531897273 | control C1 OSM side, v1, 51.5200629 / -0.1362843 |

## 12. Remaining external decisions

- Approve the street-walk capture (item 9.1) or provide a Mapillary token (9.2).
- Confirm whether EA DSM download (9.3) is in scope for the pilot.
- Confirm that the rejected "30 Charlotte Street" Commons file stays excluded.
