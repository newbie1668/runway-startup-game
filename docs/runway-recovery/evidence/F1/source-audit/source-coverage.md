# Charlotte Street pilot: per-entity source coverage (generated)

Generated 2026-09-17T20:59:08.215Z by `pnpm tsx scripts/audit-street-sources.ts --offline`. Do not edit by hand; see [source-audit.json](source-audit.json) for every field, source URL and match tier. "map" = OpenStreetMap tag (edit metadata, not an observation); "observed" = a dated source manually tied to this entity; "inferred" = a candidate label/position join; "—" = unknown. Each photo match states whether identity was verified, remains a candidate, or was rejected.

## Route, sources and rule

- Route length 272.3 m projected (273.3 m haversine in the pinned inventory). Pinned OSM SHA-256 `17e8d0ca27890f094414bf7d780d4508d5468089b8ee78f862af2feb6faf9972`.
- Supplementary OSM extract for the southern boundary gap: https://api.openstreetmap.org/api/0.6/map?bbox=-0.1352,51.5175,-0.1332,51.5185 (HTTP 200, retrieved 2026-09-17T19:13:10.238Z, SHA-256 `9d0fee5bb49aa2323bdcc0ad477b2ac29727fb89c9b1c13b431d3dfee87f1873`).
- Building ways considered: 563. Building multipolygon relations near the route left unresolved: none.
- Camden trees: 132 records in the window, retrieved 2026-09-17T19:15:23.940Z. NHLE: 38 listed entries in the window, retrieved 2026-09-17T19:15:26.643Z.

| Summary | West side | East side | Total |
| --- | ---: | ---: | ---: |
| frontageGeometryRecords | 29 | 32 | 61 |
| buildingRecords | 23 | 29 | 52 |
| buildingPartRecords | 6 | 3 | 9 |
| identityVerifiedPhoto | 5 | 4 | 9 |
| candidatePhotoOnly | 21 | 27 | 48 |
| noPhoto | 3 | 1 | 4 |
| photoDated2025Plus | 5 | 2 | 7 |
| identityVerifiedPhoto2025Plus | 5 | 2 | 7 |
| buildingsIdentityVerifiedPhoto | 2 | 4 | 6 |
| buildingPartsIdentityVerifiedPhoto | 3 | 0 | 3 |
| rejectedPhotoLabels | 0 | 1 | 1 |
| levelsTagged | 23 | 29 | 52 |
| heightTagged | 0 | 0 | 0 |
| roofShapeTagged | 0 | 4 | 4 |
| materialTagged | 18 | 24 | 42 |
| nhleAddressVerified | 1 | 4 | 5 |
| nhlePositionalCandidate | 0 | 8 | 8 |

## Source probes

| Source | HTTP | Verdict |
| --- | --- | --- |
| [mapillary-no-token](https://graph.mapillary.com/images?fields=id,captured_at,geometry&bbox=-0.1366,51.5178,-0.1340,51.5203&limit=1) | 500 | HTTP 500 without an access token; a free Mapillary developer token is required to enumerate street-level coverage |
| [kartaview-nearby](https://api.openstreetcam.org/2.0/photo/?lat=51.5191&lng=-0.1354&radius=150) | 200 | public API returned three frames; originals inspected individually below (radius inclusion is not an identity match) |
| [geograph-api-key-required](https://api.geograph.org.uk/api/photo/3033698/?format=json) | 200 | HTTP 200 |
| [ea-lidar-dsm-dtm-wcs](https://environment.data.gov.uk/geoservices/datasets/9ba4d5ac-d596-445a-9056-dae3ddec0178/wcs?service=WCS&version=2.0.1&request=GetCoverage&coverageId=9ba4d5ac-d596-445a-9056-dae3ddec0178__Lidar_Composite_Elevation_LZ_DSM_1m&subset=E(529000,530000)&subset=N(181000,182000)&format=image/tiff) | 200 | public WCS acquired 1 km² 1 m DSM and DTM GeoTIFFs (8389510 bytes total); grid spacing is not positional or height accuracy |
| [camden-conservation-appraisal](https://www.camden.gov.uk/documents/20142/7323179/Charlotte+Street.pdf) | 200 | direct public PDF acquired (491541 bytes); July 2008 appraisal based on early-2007 field survey, historical context rather than current entity condition |

## Control points

Cross-source positional checks (OSM mapper vs Camden tree officer; OSM footprint centroid vs Historic England list point). These offsets show join consistency for the named pairs only; they are not survey accuracy, do not bound route-wide tolerance, and say nothing about canopy, façade or height accuracy.

| Pair | Source A | Source B | Offset (m) | Chainage (m) |
| --- | --- | --- | ---: | ---: |
| tree (west) | osm:node:3531928742 | camden:tree:00003855 | 3.8 | 208.3 |
| tree (east) | osm:node:3531897248 | camden:tree:00003851 | 4.4 | 240.3 |
| tree (west) | osm:node:3531928772 | camden:tree:00003858 | 3.1 | 242.5 |
| tree (west) | osm:node:3531897253 | camden:tree:00003860 | 1.5 | 251.6 |
| tree (east) | osm:node:3531897273 | camden:tree:00003850 | 0.4 | 263.4 |
| listed building 11-13 Charlotte Street | osm:way:226909133 centroid | NHLE 1066260 point | 3.2 | — |
| listed building 37 Percy Street | osm:way:425442609 centroid | NHLE 1113267 point | 0.4 | — |
| listed building 26 Charlotte Street | osm:way:138339533 centroid | NHLE 1242927 point | 2.5 | — |
| listed building 28 Charlotte Street | osm:way:138339551 centroid | NHLE 1448458 point | 2.7 | — |
| listed building 13 Colville Place | osm:way:349295177 centroid | NHLE 1356774 point | 11.7 | — |

## West side frontages (south → north)

| Chainage (m) | OSM way | Address / name | Levels | Height | Roof | Material / colour | Listed | Frontage image | Newest dated view | Missing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 6.8–14.2 | [226909125](https://www.openstreetmap.org/way/226909125) v5 | 1-3 Charlotte Street | map: 5 | — | — | brick / — | — | inferred: 0 addr / 0 name / 9 total | 2013-08-27 20:20 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 15.8–22.4 | [226909124](https://www.openstreetmap.org/way/226909124) v15 | 5 Charlotte Street / Mowgli Street Food | map: 4 | — | — | plaster / white | — | inferred: 1 addr / 0 name / 10 total | 2013-08-27 20:20 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 22.4–33.4 | [226909131](https://www.openstreetmap.org/way/226909131) v15 | 7-9 Charlotte Street / Where the pancakes are | map: 5 | — | — | — / — | — | inferred: 0 addr / 0 name / 11 total | 2013-08-29 22:37 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 33.4–45.9 | [226909133](https://www.openstreetmap.org/way/226909133) v13 | 11-13 Charlotte Street | map: 5 | — | — | plaster / white | [1066260](https://historicengland.org.uk/listing/the-list/list-entry/1066260) II | inferred: 2 addr / 0 name / 5 total | 2023-08-09 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 47.6–70.8 | [226909123](https://www.openstreetmap.org/way/226909123) v12 | 15-17 Charlotte Street / Charlotte Street Hotel | map: 5 | — | — | — / — | — | inferred: 1 addr / 3 name / 7 total | 2019-03-30 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 70.8–89.6 | [226909126](https://www.openstreetmap.org/way/226909126) v17 | 19-23 Charlotte Street / Carousel | — | — | — | — / — | — | observed: 1 addr / 0 name / 6 total | 2025-08-10 17:29:18 | metric roof depth/profile and height evidence; rear/side elevation (not required for street view; record as unknown) |
| 70.8–77.6 | [425929635](https://www.openstreetmap.org/way/425929635) v1 (part of osm:way:226909126) | — | map: 3 | — | — | brick / #5DA5B4 | — | observed: 0 addr / 0 name / 6 total | 2025-08-10 17:29:18 | metric roof depth/profile and height evidence; rear/side elevation (not required for street view; record as unknown) |
| 77.6–84 | [425929632](https://www.openstreetmap.org/way/425929632) v1 (part of osm:way:226909126) | — | map: 3 | — | — | brick / #AFCBCE | — | observed: 0 addr / 0 name / 6 total | 2025-08-10 17:29:18 | metric roof depth/profile and height evidence; rear/side elevation (not required for street view; record as unknown) |
| 84–89.6 | [425929636](https://www.openstreetmap.org/way/425929636) v1 (part of osm:way:226909126) | — | map: 3 | — | — | brick / white | — | observed: 0 addr / 0 name / 6 total | 2025-08-10 17:29:18 | metric roof depth/profile and height evidence; rear/side elevation (not required for street view; record as unknown) |
| 89.6–95.9 | [226909130](https://www.openstreetmap.org/way/226909130) v12 | 25 Charlotte Street / Vagabond | map: 4 | — | — | brick / brown | — | observed: 2 addr / 0 name / 5 total | 2025-07-12 18:42:25 | metric roof depth/profile and height evidence; rear/side elevation (not required for street view; record as unknown) |
| 96.9–110.5 | [226909122](https://www.openstreetmap.org/way/226909122) v8 (part of osm:way:226909132) | 27-31 Charlotte Street | map: 1 | — | — | — / — | — | inferred: 0 addr / 0 name / 4 total | 2012-10-22 08:44 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 96.9–110.5 | [226909132](https://www.openstreetmap.org/way/226909132) v11 | 30 Rathbone Street / Rathbone Hotel | map: 6 | — | — | brick / — | — | inferred: 0 addr / 0 name / 4 total | 2012-10-22 08:44 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 122.5–140.7 | [425929638](https://www.openstreetmap.org/way/425929638) v1 | 33 Charlotte Street | map: 5 | — | — | — / — | — | inferred: 1 addr / 0 name / 9 total | 2012-05-31 13:33 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 140.7–146.4 | [425929641](https://www.openstreetmap.org/way/425929641) v3 | — | — | — | — | — / — | — | inferred: 0 addr / 0 name / 8 total | 2012-05-31 13:33 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 146.4–152.6 | [182651296](https://www.openstreetmap.org/way/182651296) v16 | 41 Charlotte Street / Six by Nico | — | — | — | — / — | — | inferred: 0 addr / 0 name / 8 total | 2012-05-31 13:33 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 152.6–163.3 | [425929639](https://www.openstreetmap.org/way/425929639) v1 | — | — | — | — | — / — | — | inferred: 0 addr / 0 name / 8 total | 2012-05-31 13:33 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 163.3–169.2 | [98535852](https://www.openstreetmap.org/way/98535852) v13 | 43 Goodge Street / The Queen Charlotte | map: 4 | — | — | brick / — | — | inferred: 0 addr / 1 name / 8 total | 2019-11-28 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 185.4–205.2 | [118808964](https://www.openstreetmap.org/way/118808964) v4 | — | — | — | — | — / — | — | inferred: 0 addr / 0 name / 2 total | 2017-09-09 18:07:45 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 205.1–212.5 | [118808984](https://www.openstreetmap.org/way/118808984) v5 | 53 Charlotte Street / Reynolds | map: 4 | — | — | brick / — | — | inferred: 0 addr / 0 name / 1 total | 2017-09-09 18:07:45 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 212.5–218.7 | [118808969](https://www.openstreetmap.org/way/118808969) v2 (part of osm:way:346673943) | — | — | — | — | — / — | — | inferred: 0 addr / 0 name / 1 total | 2017-09-09 18:07:45 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 212.5–225.4 | [346673943](https://www.openstreetmap.org/way/346673943) v2 | — | map: 5 | — | — | brick / — | — | — | — | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 218.7–225.4 | [118808999](https://www.openstreetmap.org/way/118808999) v2 (part of osm:way:346673943) | — | map: 4 | — | — | brick / — | — | — | — | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 225.4–231.5 | [118808987](https://www.openstreetmap.org/way/118808987) v5 | 59 Charlotte Street / The Space | map: 4 | — | — | brick / — | — | — | — | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 232.4–238.7 | [118808970](https://www.openstreetmap.org/way/118808970) v3 | 61 Charlotte Street | map: 4 | — | — | brick / — | — | inferred: 0 addr / 0 name / 1 total | 2009-07-21 14:19 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 239.2–244.8 | [118808979](https://www.openstreetmap.org/way/118808979) v5 | 63 Charlotte Street / Casual Fitters | map: 4 | — | — | brick / — | — | inferred: 0 addr / 0 name / 1 total | 2009-07-21 14:19 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 246.8–251 | [118808972](https://www.openstreetmap.org/way/118808972) v6 | 65 Charlotte Street / Benny's Kitchen | map: 4 | — | — | brick / — | — | inferred: 0 addr / 0 name / 2 total | 2009-07-21 14:19 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 251.8–258.2 | [118808974](https://www.openstreetmap.org/way/118808974) v7 | 67 Charlotte Street / Agrodolce | map: 4 | — | — | brick / — | — | inferred: 0 addr / 0 name / 2 total | 2009-07-21 14:19 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 258.3–266.4 | [118808965](https://www.openstreetmap.org/way/118808965) v5 | 69 Charlotte Street | map: 4 | — | — | — / — | — | inferred: 2 addr / 0 name / 3 total | 2010-02-19 17:01:35 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 258.3–266.4 | [118808975](https://www.openstreetmap.org/way/118808975) v7 | 27 Tottenham Street | map: 4 | — | — | brick / — | — | inferred: 0 addr / 0 name / 2 total | 2009-07-21 14:19 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |

## East side frontages (south → north)

| Chainage (m) | OSM way | Address / name | Levels | Height | Roof | Material / colour | Listed | Frontage image | Newest dated view | Missing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 8.1–17.8 | [122020336](https://www.openstreetmap.org/way/122020336) v13 | 2 Charlotte Street / The Italians | map: 4 | — | — | plaster / white | [1113267](https://historicengland.org.uk/listing/the-list/list-entry/1113267) II | observed: 1 addr / 0 name / 10 total | 2025-08-10 17:27:53 | metric roof depth/profile and height evidence; unoccluded/complete side and rear geometry (record hidden parts unknown) |
| 8.1–17.8 | [425442609](https://www.openstreetmap.org/way/425442609) v8 | 37 Percy Street | map: 3 | — | map: gambrel | brick / brown | [1113267](https://historicengland.org.uk/listing/the-list/list-entry/1113267) II | inferred: 0 addr / 0 name / 9 total | 2013-08-27 20:20 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 17.8–23.7 | [122020339](https://www.openstreetmap.org/way/122020339) v12 | 4 Charlotte Street / Bliss Bite | map: 4 | — | — | plaster / white | [1113267](https://historicengland.org.uk/listing/the-list/list-entry/1113267) II | inferred: 0 addr / 0 name / 9 total | 2013-08-27 20:20 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 23.7–28.9 | [122020340](https://www.openstreetmap.org/way/122020340) v7 | 6 Charlotte Street | map: 4 | — | — | plaster / white | [1113267](https://historicengland.org.uk/listing/the-list/list-entry/1113267) II | inferred: 0 addr / 0 name / 9 total | 2013-08-27 20:20 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 28.9–34.7 | [122020337](https://www.openstreetmap.org/way/122020337) v17 | 8 Charlotte Street / Norma | map: 4 | — | — | plaster / yellow | — | inferred: 0 addr / 0 name / 6 total | 2013-08-29 22:37 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 34.7–40.1 | [122020338](https://www.openstreetmap.org/way/122020338) v15 | 10 Charlotte Street / Elsa Bistro and Wine House | map: 4 | — | map: gambrel | plaster / white | — | inferred: 0 addr / 0 name / 4 total | 2013-08-29 22:37 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 40.1–47.4 | [122020341](https://www.openstreetmap.org/way/122020341) v14 | 12 Charlotte Street | map: 5 | — | — | plaster / cream | — | inferred: 0 addr / 0 name / 5 total | 2013-08-29 22:37 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 47.4–51.5 | [122020342](https://www.openstreetmap.org/way/122020342) v13 | 14 Charlotte Street | map: 4 | — | — | brick / brown | — | inferred: 0 addr / 0 name / 5 total | 2013-08-29 22:37 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 65–76 | [138339524](https://www.openstreetmap.org/way/138339524) v9 | 16 Charlotte Street / Fitzroy Tavern | — | — | — | — / — | — | observed: 4 addr / 4 name / 11 total | 2025-08-10 17:28:39 | metric roof depth/profile and height evidence; rear/side elevation (not required for street view; record as unknown) |
| 76–82 | [138339520](https://www.openstreetmap.org/way/138339520) v11 | 18 Charlotte Street | map: 4 | — | — | brick / brown | — | inferred: 0 addr / 0 name / 5 total | 2013-08-29 22:37 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 82–88.5 | [138339556](https://www.openstreetmap.org/way/138339556) v6 | 20 Charlotte Street / Ted's Grooming Room | map: 4 | — | — | brick / brown | — | inferred: 0 addr / 0 name / 5 total | 2013-08-29 22:37 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 88.5–94.2 | [138339514](https://www.openstreetmap.org/way/138339514) v8 | 22 Charlotte Street / The Ninth | map: 4 | — | — | plaster / white | — | inferred: 0 addr / 0 name / 3 total | 2012-10-22 08:44 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 95.7–100.4 | [138339541](https://www.openstreetmap.org/way/138339541) v7 | 24 Charlotte Street / Hudsons | map: 4 | — | map: gambrel | plaster / white | [1242927](https://historicengland.org.uk/listing/the-list/list-entry/1242927) II | inferred: 0 addr / 0 name / 3 total | 2012-10-22 08:44 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 101.7–106.4 | [138339533](https://www.openstreetmap.org/way/138339533) v8 | 26 Charlotte Street | map: 4 | — | map: double_saltbox | plaster / white | [1242927](https://historicengland.org.uk/listing/the-list/list-entry/1242927) II | observed: 1 addr / 0 name / 5 total | 2022-05-28 | dated 2025–2026 ground-floor/shopfront view; metric roof depth/profile and height evidence |
| 106.4–112.9 | [138339551](https://www.openstreetmap.org/way/138339551) v8 | 28 Charlotte Street / Goode Flowers | map: 4 | — | — | brick / brown | [1448458](https://historicengland.org.uk/listing/the-list/list-entry/1448458) II | observed: 2 addr / 0 name / 6 total | 2024-05-08 16:21:57 | dated 2025–2026 ground-floor/shopfront view; metric roof depth/profile and height evidence |
| 112.9–119.2 | [138339531](https://www.openstreetmap.org/way/138339531) v7 | 30 Charlotte Street / Luso | map: 5 | — | — | plaster / white | [1448458](https://historicengland.org.uk/listing/the-list/list-entry/1448458) II | inferred: 0 addr / 0 name / 5 total | 2012-10-22 08:44 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 119.2–126.3 | [138339548](https://www.openstreetmap.org/way/138339548) v12 | 32 Charlotte Street / Tofu Vegan | map: 4 | — | — | plaster / white | [1356775](https://historicengland.org.uk/listing/the-list/list-entry/1356775) II | inferred: 0 addr / 0 name / 8 total | 2012-10-22 08:44 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 126.3–132.2 | [138339566](https://www.openstreetmap.org/way/138339566) v9 | 34 Charlotte Street / Pied a Terre | map: 4 | — | — | plaster / white | [1356775](https://historicengland.org.uk/listing/the-list/list-entry/1356775) II | inferred: 0 addr / 0 name / 8 total | 2012-05-31 13:33 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 132.2–138.8 | [138339516](https://www.openstreetmap.org/way/138339516) v8 | 36 Charlotte Street | map: 4 | — | — | brick / brown | [1356775](https://historicengland.org.uk/listing/the-list/list-entry/1356775) II | inferred: 0 addr / 0 name / 7 total | 2012-05-31 13:33 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 144.1–152 | [349295177](https://www.openstreetmap.org/way/349295177) v5 | 13 Colville Place | map: 3 | — | — | brick / brown | [1356774](https://historicengland.org.uk/listing/the-list/list-entry/1356774) II | inferred: 0 addr / 0 name / 8 total | 2012-05-31 13:33 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 144.1–154 | [349295183](https://www.openstreetmap.org/way/349295183) v8 | 38 Charlotte Street / Thai Metro | map: 4 | — | — | brick / brown | — | inferred: 0 addr / 0 name / 8 total | 2012-05-31 13:33 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 154–159 | [349295184](https://www.openstreetmap.org/way/349295184) v7 | 40 Charlotte Street / Ousia | map: 4 | — | — | plaster / white | — | inferred: 1 addr / 0 name / 8 total | 2012-05-31 13:33 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 158.9–169.7 | [349295162](https://www.openstreetmap.org/way/349295162) v2 | 41 Goodge Street | map: 4 | — | — | brick / — | — | inferred: 0 addr / 0 name / 7 total | 2017-09-09 18:07:45 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 158.9–169.7 | [349295169](https://www.openstreetmap.org/way/349295169) v6 | — / Snappy Snaps | map: 4 | — | — | brick / — | — | inferred: 0 addr / 0 name / 7 total | 2017-09-09 18:07:45 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 187.9–196.3 | [188549793](https://www.openstreetmap.org/way/188549793) v8 | 44 Charlotte Street | map: 4 | — | — | — / lime | — | inferred: 0 addr / 0 name / 2 total | 2017-09-09 18:07:45 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 196.3–202 | [188549785](https://www.openstreetmap.org/way/188549785) v4 | 46 Charlotte Street | — | — | — | — / — | — | inferred: 0 addr / 0 name / 2 total | 2017-09-09 18:07:45 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 202–210.8 | [188549778](https://www.openstreetmap.org/way/188549778) v3 | 48 Charlotte Street | — | — | — | — / — | — | inferred: 0 addr / 0 name / 1 total | 2017-09-09 18:07:45 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 210.8–228.9 | [188549777](https://www.openstreetmap.org/way/188549777) v6 | 54 Charlotte Street | map: 5 | — | — | brick / — | — | — | — | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 242.6–250.8 | [346670639](https://www.openstreetmap.org/way/346670639) v1 (part of osm:way:348812078) | — | map: 3 | — | — | — / — | — | inferred: 0 addr / 0 name / 2 total | 2009-07-21 14:19 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 242.6–266.5 | [348812078](https://www.openstreetmap.org/way/348812078) v1 | — | map: 2 | — | — | — / — | — | inferred: 0 addr / 0 name / 2 total | 2009-07-21 14:19 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 247.7–259.3 | [261548035](https://www.openstreetmap.org/way/261548035) v2 (part of osm:way:348812078) | — | map: 7 | — | — | — / — | — | inferred: 0 addr / 0 name / 2 total | 2009-07-21 14:19 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |
| 256.4–266.5 | [346670642](https://www.openstreetmap.org/way/346670642) v1 (part of osm:way:348812078) | — | map: 3 | — | — | — / — | — | inferred: 0 addr / 0 name / 2 total | 2009-07-21 14:19 | identity-verified street-level frontage view; dated 2025–2026 ground-floor/shopfront view |

## Commons photo matches (identity state and per-file rights)

| Frontage | File / author | Capture date | Licence | Identity / tier |
| --- | --- | --- | --- | --- |
| 5 Charlotte Street | [Rasa Samudra, 5 Charlotte Street W1 - geograph.org.uk - 1824137.jpg](https://commons.wikimedia.org/wiki/File:Rasa_Samudra,_5_Charlotte_Street_W1_-_geograph.org.uk_-_1824137.jpg) / Robin Sones | 2010-04-20 | CC BY-SA 2.0 | candidate; title-address |
| 11-13 Charlotte Street | [11 and 13 Charlotte Street, Fitzrovia, August 2023.jpg](https://commons.wikimedia.org/wiki/File:11_and_13_Charlotte_Street,_Fitzrovia,_August_2023.jpg) / No Swan So Fine | 2023-08-09 | CC BY-SA 4.0 | candidate; title-address |
| 11-13 Charlotte Street | [La Perla, Fitzrovia, W1 (4337906919).jpg](https://commons.wikimedia.org/wiki/File:La_Perla,_Fitzrovia,_W1_(4337906919).jpg) / Ewan Munro from London, UK | 2010-01-19 13:24 | CC BY-SA 2.0 | candidate; description-address |
| 15-17 Charlotte Street | [Charlotte Street Hotel - geograph.org.uk - 6466404.jpg](https://commons.wikimedia.org/wiki/File:Charlotte_Street_Hotel_-_geograph.org.uk_-_6466404.jpg) / N Chadwick | 2019-03-30 | CC BY-SA 2.0 | candidate; name-match |
| 15-17 Charlotte Street | [Charlotte Street Hotel (18876711860).jpg](https://commons.wikimedia.org/wiki/File:Charlotte_Street_Hotel_(18876711860).jpg) / Jim Killock | 2015-06-18 17:08 | CC BY-SA 2.0 | candidate; name-match |
| 15-17 Charlotte Street | [Oscar's, Fitzrovia, W1 (6987016723).jpg](https://commons.wikimedia.org/wiki/File:Oscar%27s,_Fitzrovia,_W1_(6987016723).jpg) / Ewan Munro from London, UK | 2012-03-13 08:48 | CC BY-SA 2.0 | candidate; description-address |
| 15-17 Charlotte Street | [Charlotte Street Hotel, Fitzrovia - geograph.org.uk - 922401.jpg](https://commons.wikimedia.org/wiki/File:Charlotte_Street_Hotel,_Fitzrovia_-_geograph.org.uk_-_922401.jpg) / Stephen McKay | 2008-08-14 | CC BY-SA 2.0 | candidate; name-match |
| 19-23 Charlotte Street | [Carousel & No. 23, Fitzrovia, W1.jpg](https://commons.wikimedia.org/wiki/File:Carousel_%26_No._23,_Fitzrovia,_W1.jpg) / Ewan-M | 2025-08-10 17:29:18 | CC BY-SA 4.0 | identity-verified; description-address; numbers 21 and 23 are visible; file title and Carousel fascia identify the 19–23 group |
| osm:way:425929635 | [Carousel & No. 23, Fitzrovia, W1.jpg](https://commons.wikimedia.org/wiki/File:Carousel_%26_No._23,_Fitzrovia,_W1.jpg) / Ewan-M | 2025-08-10 17:29:18 | CC BY-SA 4.0 | identity-verified; curated-review; numbers 21 and 23 are visible; file title and Carousel fascia identify the 19–23 group |
| osm:way:425929632 | [Carousel & No. 23, Fitzrovia, W1.jpg](https://commons.wikimedia.org/wiki/File:Carousel_%26_No._23,_Fitzrovia,_W1.jpg) / Ewan-M | 2025-08-10 17:29:18 | CC BY-SA 4.0 | identity-verified; curated-review; numbers 21 and 23 are visible; file title and Carousel fascia identify the 19–23 group |
| osm:way:425929636 | [Carousel & No. 23, Fitzrovia, W1.jpg](https://commons.wikimedia.org/wiki/File:Carousel_%26_No._23,_Fitzrovia,_W1.jpg) / Ewan-M | 2025-08-10 17:29:18 | CC BY-SA 4.0 | identity-verified; curated-review; numbers 21 and 23 are visible; file title and Carousel fascia identify the 19–23 group |
| 25 Charlotte Street | [Vagabond, Fitzrovia, W1 - 2025-07-12.jpg](https://commons.wikimedia.org/wiki/File:Vagabond,_Fitzrovia,_W1_-_2025-07-12.jpg) / Ewan-M | 2025-07-12 18:42:25 | CC BY-SA 4.0 | identity-verified; description-address; Vagabond fascia and adjoining visible number 23 locate the photographed 25 Charlotte Street frontage |
| 25 Charlotte Street | [Vagabond, Fitzrovia, W1.jpg](https://commons.wikimedia.org/wiki/File:Vagabond,_Fitzrovia,_W1.jpg) / Ewan-M | 2014-01-07 14:32:34 | CC BY-SA 2.0 | candidate; description-address |
| 33 Charlotte Street | [Fino, Fitzrovia, W1 (4093339969).jpg](https://commons.wikimedia.org/wiki/File:Fino,_Fitzrovia,_W1_(4093339969).jpg) / Ewan Munro from London, UK | 2009-11-10 12:17 | CC BY-SA 2.0 | candidate; description-address |
| 43 Goodge Street | [The Queen Charlotte - geograph.org.uk - 6747824.jpg](https://commons.wikimedia.org/wiki/File:The_Queen_Charlotte_-_geograph.org.uk_-_6747824.jpg) / N Chadwick | 2019-11-28 | CC BY-SA 2.0 | candidate; name-match |
| 69 Charlotte Street | [Squat and Gobble.jpg](https://commons.wikimedia.org/wiki/File:Squat_and_Gobble.jpg) / morebyless | 2010-02-19 17:01:35 | CC BY 2.0 | candidate; description-address |
| 69 Charlotte Street | [Blu Soul, Fitzrovia, W1 (4029157247).jpg](https://commons.wikimedia.org/wiki/File:Blu_Soul,_Fitzrovia,_W1_(4029157247).jpg) / Ewan Munro from London, UK | 2009-07-21 14:19 | CC BY-SA 2.0 | candidate; description-address |
| 2 Charlotte Street | [Italians, Fitzrovia, W1.jpg](https://commons.wikimedia.org/wiki/File:Italians,_Fitzrovia,_W1.jpg) / Ewan-M | 2025-08-10 17:27:53 | CC BY-SA 4.0 | identity-verified; description-address; The Italians fascia plus Charlotte/Percy street plates identify the corner; OSM names the occupier at 2 Charlotte Street |
| 16 Charlotte Street | [Fitzroy Tavern, Fitzrovia, W1.jpg](https://commons.wikimedia.org/wiki/File:Fitzroy_Tavern,_Fitzrovia,_W1.jpg) / Ewan-M | 2025-08-10 17:28:39 | CC BY-SA 4.0 | identity-verified; description-address; 16 Charlotte Street fascia, Fitzroy Tavern signs, and Charlotte/Windmill street plates are visible |
| 16 Charlotte Street | [The Fitzroy Tavern - geograph.org.uk - 6466403.jpg](https://commons.wikimedia.org/wiki/File:The_Fitzroy_Tavern_-_geograph.org.uk_-_6466403.jpg) / N Chadwick | 2019-03-30 | CC BY-SA 2.0 | candidate; name-match |
| 16 Charlotte Street | [The Fitzroy Tavern - geograph.org.uk - 6471384.jpg](https://commons.wikimedia.org/wiki/File:The_Fitzroy_Tavern_-_geograph.org.uk_-_6471384.jpg) / N Chadwick | 2019-03-30 | CC BY-SA 2.0 | candidate; name-match |
| 16 Charlotte Street | [Fitzroy Tavern, Fitzrovia, W1 - 33694115898.jpg](https://commons.wikimedia.org/wiki/File:Fitzroy_Tavern,_Fitzrovia,_W1_-_33694115898.jpg) / Ewan-M | 2019-03-25 17:26:46 | CC BY-SA 2.0 | candidate; description-address |
| 16 Charlotte Street | [Approaching The Fitzroy Tavern - geograph.org.uk - 3033689.jpg](https://commons.wikimedia.org/wiki/File:Approaching_The_Fitzroy_Tavern_-_geograph.org.uk_-_3033689.jpg) / Basher Eyre | 2012-07-07 | CC BY-SA 2.0 | candidate; name-match |
| 16 Charlotte Street | [Fitzroy Tavern - Fitzrovia - W1.jpg](https://commons.wikimedia.org/wiki/File:Fitzroy_Tavern_-_Fitzrovia_-_W1.jpg) / Ewan Munro from London, UK | Taken on 21 May 2009 | CC BY-SA 2.0 | candidate; description-address |
| 16 Charlotte Street | [Fitzroy Tavern, Fitzrovia - geograph.org.uk - 1091773.jpg](https://commons.wikimedia.org/wiki/File:Fitzroy_Tavern,_Fitzrovia_-_geograph.org.uk_-_1091773.jpg) / Chris Whippet | 2008-12-26 | CC BY-SA 2.0 | candidate; name-match |
| 16 Charlotte Street | [Fitzroy Tavern, Fitzrovia, W1 - 2008-03-05.jpg](https://commons.wikimedia.org/wiki/File:Fitzroy_Tavern,_Fitzrovia,_W1_-_2008-03-05.jpg) / Ewan-M | 2008-03-05 10:17:17 | CC BY-SA 2.0 | candidate; description-address |
| 26 Charlotte Street | [26 Charlotte Street, Fitzrovia, May 2022.jpg](https://commons.wikimedia.org/wiki/File:26_Charlotte_Street,_Fitzrovia,_May_2022.jpg) / No Swan So Fine | 2022-05-28 | CC BY-SA 4.0 | identity-verified; title-address; number 26 is visible and the accepted F1 source card independently reviewed the match |
| 28 Charlotte Street | [Goode Flowers 2024-05-08.jpg](https://commons.wikimedia.org/wiki/File:Goode_Flowers_2024-05-08.jpg) / Adrian Scottow | 2024-05-08 16:21:57 | CC BY-SA 2.0 | identity-verified; description-address; Goode Flowers fascia and visible adjoining 30a; OSM maps Goode Flowers at 28 Charlotte Street |
| 28 Charlotte Street | [28 Charlotte Street, Fitzrovia, May 2022.jpg](https://commons.wikimedia.org/wiki/File:28_Charlotte_Street,_Fitzrovia,_May_2022.jpg) / No Swan So Fine | 2022-05-28 | CC BY-SA 4.0 | identity-verified; title-address; accepted F1 source card independently reviewed the address and terrace context |
| 30 Charlotte Street | [30 Charlotte Street, Fitzrovia, May 2023.jpg](https://commons.wikimedia.org/wiki/File:30_Charlotte_Street,_Fitzrovia,_May_2023.jpg) / No Swan So Fine | 2023-05-26 | CC BY-SA 4.0 | rejected; rejected-by-review: linked Historic England entry 1379038 is 30 Tottenham Street; two-bay brick building conflicts with the 28 Charlotte Street photo (feasibility.md, frontage-source-cards.md) |
| 40 Charlotte Street | [Andreas, Fitzrovia, W1 (7313653698).jpg](https://commons.wikimedia.org/wiki/File:Andreas,_Fitzrovia,_W1_(7313653698).jpg) / Ewan Munro from London, UK | 2012-05-31 13:33 | CC BY-SA 2.0 | candidate; description-address |

## Street objects between the building lines (south → north)

| Chainage (m) | Side | Kind | Source | Form / dimensions | Presence at dated inspection | Current presence |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | east | crossing (unmarked) | [osm:node:12382201742](https://www.openstreetmap.org/node/12382201742) | — | — | — |
| 0.8 | west | tree | [osm:node:2356344192](https://www.openstreetmap.org/node/2356344192) | — | — | — |
| 2.4 | east | waste_basket | [osm:node:12798084427](https://www.openstreetmap.org/node/12798084427) | — | — | — |
| 6.2 | on-centreline | crossing (unmarked) | [osm:node:12382201738](https://www.openstreetmap.org/node/12382201738) | — | — | — |
| 25.5 | west | cycle_parking | [osm:node:4249404249](https://www.openstreetmap.org/node/4249404249) | — | — | — |
| 57.5 | east | sign | [osm:node:12057463728](https://www.openstreetmap.org/node/12057463728) | — | — | — |
| 57.5 | east | crossing (unmarked) | [osm:node:12398519154](https://www.openstreetmap.org/node/12398519154) | — | — | — |
| 70.7 | east | motorcycle_parking | [osm:node:4249404262](https://www.openstreetmap.org/node/4249404262) | — | — | — |
| 116.4 | west | sign | [osm:node:12057496377](https://www.openstreetmap.org/node/12057496377) | — | — | — |
| 116.4 | west | crossing (unmarked) | [osm:node:12398519161](https://www.openstreetmap.org/node/12398519161) | — | — | — |
| 116.6 | west | sign GB:616 | [osm:node:13056111821](https://www.openstreetmap.org/node/13056111821) | — | — | — |
| 129.2 | west | tree | [camden:tree:00003852](https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss) | observed: Sycamore - Purple Leaved; height 16 m; spread 10 m; Mature | observed: present, inspected 2025-07-07 | — |
| 140.9 | east | tree | [camden:tree:00060690](https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss) | observed: Elm - New Horizon; height 10 m; spread 6 m; Semi-mature | observed: present, inspected 2025-07-07 | — |
| 142.4 | west | tree | [camden:tree:00003853](https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss) | observed: Maple - Norway; height 17 m; spread 6 m; Mature | observed: present, inspected 2025-07-07 | — |
| 150.7 | west | tree | [camden:tree:00060688](https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss) | observed: Elm - New Horizon; height 11 m; spread 6 m; Semi-mature | observed: present, inspected 2025-07-07 | — |
| 152.2 | east | tree | [camden:tree:00060689](https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss) | observed: Elm - New Horizon; height 10 m; spread 6 m; Semi-mature | observed: present, inspected 2025-07-07 | — |
| 166.3 | on-centreline | sign (no) | [osm:node:2440641464](https://www.openstreetmap.org/node/2440641464) | — | — | — |
| 170.8 | on-centreline | crossing (traffic_signals) | [osm:node:2440641466](https://www.openstreetmap.org/node/2440641466) | — | — | — |
| 172.5 | east | bench | [osm:node:6524630688](https://www.openstreetmap.org/node/6524630688) | — | — | — |
| 177.5 | east | crossing (traffic_signals) | [osm:node:2440641461](https://www.openstreetmap.org/node/2440641461) | — | — | — |
| 178.1 | west | crossing (traffic_signals) | [osm:node:2440641463](https://www.openstreetmap.org/node/2440641463) | — | — | — |
| 185.6 | on-centreline | crossing (traffic_signals) | [osm:node:2440641460](https://www.openstreetmap.org/node/2440641460) | — | — | — |
| 186.8 | east | cycle_hire | [osm:node:1132306194](https://www.openstreetmap.org/node/1132306194) | — | — | — |
| 189.7 | on-centreline | sign (no) | [osm:node:2440641465](https://www.openstreetmap.org/node/2440641465) | — | — | — |
| 202.6 | west | vacant_tree_pit | [osm:node:3531928739](https://www.openstreetmap.org/node/3531928739) + camden:tree:00065182 (1.5 m) | — | observed: absent (vacant pit), 2025-07-10 | — |
| 208.3 | west | tree | [osm:node:3531928742](https://www.openstreetmap.org/node/3531928742) + camden:tree:00003855 (3.8 m) | observed: London plane; height 17 m; spread 9 m; Mature | observed: present, inspected 2025-07-10 | — |
| 229.8 | west | tree | [camden:tree:00003857](https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss) | observed: London plane; height 20 m; spread 10 m; Mature | observed: present, inspected 2025-07-10 | — |
| 237.3 | east | crossing (unmarked) | [osm:node:12373737572](https://www.openstreetmap.org/node/12373737572) | — | — | — |
| 237.5 | west | motorcycle_parking | [osm:node:6524371764](https://www.openstreetmap.org/node/6524371764) | — | — | — |
| 240.3 | east | tree | [osm:node:3531897248](https://www.openstreetmap.org/node/3531897248) + camden:tree:00003851 (4.4 m) | observed: London plane; height 21 m; spread 10 m; Mature | observed: present, inspected 2025-07-10 | — |
| 242.5 | west | tree | [osm:node:3531928772](https://www.openstreetmap.org/node/3531928772) + camden:tree:00003858 (3.1 m) | observed: London plane; height 20 m; spread 7 m; Mature | observed: present, inspected 2025-07-10 | — |
| 246.1 | west | tree | [camden:tree:00053815](https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss) | observed: Maple - Field; height 6 m; spread 3 m; Young | observed: present, inspected 2025-07-10 | — |
| 249.2 | east | tree | [camden:tree:00050706](https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss) | observed: Maple - Column Norway; height 10 m; spread 3 m; Semi-mature | observed: present, inspected 2025-07-10 | — |
| 251.6 | west | tree | [osm:node:3531897253](https://www.openstreetmap.org/node/3531897253) + camden:tree:00003860 (1.5 m) | observed: London plane; height 16 m; spread 5 m; Mature | observed: present, inspected 2025-07-10 | — |
| 257.4 | east | tree | [camden:tree:00050707](https://opendata.camden.gov.uk/Environment/Trees-In-Camden/csqp-kdss) | observed: Maple - Column Norway; height 10 m; spread 3 m; Semi-mature | observed: present, inspected 2025-07-10 | — |
| 263.4 | east | tree | [osm:node:3531897273](https://www.openstreetmap.org/node/3531897273) + camden:tree:00003850 (0.4 m) | observed: London plane; height 19 m; spread 7 m; Mature | observed: present, inspected 2025-07-10 | — |
| 267.5 | on-centreline | crossing (unmarked) | [osm:node:12373737546](https://www.openstreetmap.org/node/12373737546) | — | — | — |
| 272.2 | east | sign | [osm:node:12057496376](https://www.openstreetmap.org/node/12057496376) | — | — | — |
| 272.2 | east | crossing (unmarked) | [osm:node:12373737544](https://www.openstreetmap.org/node/12373737544) | — | — | — |
| 272.3 | west | sign | [osm:node:12057496375](https://www.openstreetmap.org/node/12057496375) | — | — | — |
| 272.3 | west | crossing (unmarked) | [osm:node:12373737557](https://www.openstreetmap.org/node/12373737557) | — | — | — |

## Geotagged Commons files within 45 m of the centreline

| Chainage (m) | Side | File | Capture date | Licence | Geograph mirror |
| --- | --- | --- | --- | --- | --- |
| 0 | east | [Bricklayers Arms, Gresse Street - geograph.org.uk - 398230.jpg](https://commons.wikimedia.org/wiki/File:Bricklayers_Arms,_Gresse_Street_-_geograph.org.uk_-_398230.jpg) | 2006-07-07 | CC BY-SA 2.0 | yes |
| 0 | west | [Jerusalem Bar and Kitchen, Fitzrovia, W1 (2377483443).jpg](https://commons.wikimedia.org/wiki/File:Jerusalem_Bar_and_Kitchen,_Fitzrovia,_W1_(2377483443).jpg) | 2008-03-31 13:34 | CC BY-SA 2.0 | no |
| 0 | east | [Marquis of Granby. Fitzrovia - geograph.org.uk - 1091770.jpg](https://commons.wikimedia.org/wiki/File:Marquis_of_Granby._Fitzrovia_-_geograph.org.uk_-_1091770.jpg) | 2008-12-26 | CC BY-SA 2.0 | yes |
| 0 | west | [Wheatsheaf, Fitzrovia, W1 (2377482991).jpg](https://commons.wikimedia.org/wiki/File:Wheatsheaf,_Fitzrovia,_W1_(2377482991).jpg) | 2008-03-31 13:34 | CC BY-SA 2.0 | no |
| 0 | west | [Western District Post Office, Rathbone Place - geograph.org.uk - 2660732.jpg](https://commons.wikimedia.org/wiki/File:Western_District_Post_Office,_Rathbone_Place_-_geograph.org.uk_-_2660732.jpg) | 2011-05-21 | CC BY-SA 2.0 | yes |
| 4.7 | west | [Toilet (11292479013).jpg](https://commons.wikimedia.org/wiki/File:Toilet_(11292479013).jpg) | 2013-08-27 20:20 | CC BY-SA 2.0 | no |
| 6.6 | west | [Marquis of Granby, Fitzrovia, W1 (2378320462).jpg](https://commons.wikimedia.org/wiki/File:Marquis_of_Granby,_Fitzrovia,_W1_(2378320462).jpg) | 2008-03-31 13:34 | CC BY-SA 2.0 | no |
| 26.5 | west | [La Perla, Fitzrovia, W1 (4337906919).jpg](https://commons.wikimedia.org/wiki/File:La_Perla,_Fitzrovia,_W1_(4337906919).jpg) | 2010-01-19 13:24 | CC BY-SA 2.0 | no |
| 26.5 | west | [La Perla, Fitzrovia, London (4333892533).jpg](https://commons.wikimedia.org/wiki/File:La_Perla,_Fitzrovia,_London_(4333892533).jpg) | 2010-01-19 12:50 | CC BY-SA 2.0 | no |
| 56.9 | west | [BT Tower - geograph.org.uk - 922409.jpg](https://commons.wikimedia.org/wiki/File:BT_Tower_-_geograph.org.uk_-_922409.jpg) | 2008-08-14 | CC BY-SA 2.0 | yes |
| 57.5 | east | [Toilet (11292394046).jpg](https://commons.wikimedia.org/wiki/File:Toilet_(11292394046).jpg) | 2013-08-29 22:37 | CC BY-SA 2.0 | no |
| 70.2 | east | [Fitzroy Tavern - Fitzrovia - W1.jpg](https://commons.wikimedia.org/wiki/File:Fitzroy_Tavern_-_Fitzrovia_-_W1.jpg) | Taken on 21 May 2009 | CC BY-SA 2.0 | no |
| 95.2 | west | [Wahaca, Fitzrovia, London (8112148426).jpg](https://commons.wikimedia.org/wiki/File:Wahaca,_Fitzrovia,_London_(8112148426).jpg) | 2012-10-22 08:44 | CC BY-SA 2.0 | no |
| 103.2 | east | [Duke of York, Fitzrovia - geograph.org.uk - 1091779.jpg](https://commons.wikimedia.org/wiki/File:Duke_of_York,_Fitzrovia_-_geograph.org.uk_-_1091779.jpg) | 2008-12-26 | CC BY-SA 2.0 | yes |
| 129.7 | west | [Roka Shochu Lounge, Fitzrovia, W1 (3694773151).jpg](https://commons.wikimedia.org/wiki/File:Roka_Shochu_Lounge,_Fitzrovia,_W1_(3694773151).jpg) | 2009-06-05 12:43 | CC BY-SA 2.0 | no |
| 129.7 | west | [Shochu Lounge, Fitzrovia, London (3739519411).jpg](https://commons.wikimedia.org/wiki/File:Shochu_Lounge,_Fitzrovia,_London_(3739519411).jpg) | 2009-07-17 15:22 | CC BY-SA 2.0 | no |
| 147.2 | east | [24 Rathbone Street W1 - geograph.org.uk - 1275630.jpg](https://commons.wikimedia.org/wiki/File:24_Rathbone_Street_W1_-_geograph.org.uk_-_1275630.jpg) | 2006-07-07 | CC BY-SA 2.0 | yes |
| 150.7 | west | [Lantana, Fitzrovia, London (3392175716).jpg](https://commons.wikimedia.org/wiki/File:Lantana,_Fitzrovia,_London_(3392175716).jpg) | 2009-03-25 08:05 | CC BY-SA 2.0 | no |
| 150.7 | west | [Lantana, Fitzrovia, London (3392177714).jpg](https://commons.wikimedia.org/wiki/File:Lantana,_Fitzrovia,_London_(3392177714).jpg) | 2009-03-25 08:33 | CC BY-SA 2.0 | no |
| 150.7 | west | [Lantana, Fitzrovia, London (6850427064).jpg](https://commons.wikimedia.org/wiki/File:Lantana,_Fitzrovia,_London_(6850427064).jpg) | 2012-03-13 09:05 | CC BY-SA 2.0 | no |
| 157.1 | east | [Andreas, Fitzrovia, W1 (7313653698).jpg](https://commons.wikimedia.org/wiki/File:Andreas,_Fitzrovia,_W1_(7313653698).jpg) | 2012-05-31 13:33 | CC BY-SA 2.0 | no |
| 169.3 | east | [Italian restaurant on Goodge Street - geograph.org.uk - 2477108.jpg](https://commons.wikimedia.org/wiki/File:Italian_restaurant_on_Goodge_Street_-_geograph.org.uk_-_2477108.jpg) | 2011-06-23 | CC BY-SA 2.0 | yes |
| 188.8 | west | [World Finance branded Goodge Street News.jpg](https://commons.wikimedia.org/wiki/File:World_Finance_branded_Goodge_Street_News.jpg) | 2017-09-09 18:07:45 | CC BY-SA 4.0 | no |
| 264.2 | west | [Blu Soul, Fitzrovia, W1 (4029157247).jpg](https://commons.wikimedia.org/wiki/File:Blu_Soul,_Fitzrovia,_W1_(4029157247).jpg) | 2009-07-21 14:19 | CC BY-SA 2.0 | no |
| 272.3 | east | [Charlotte Street, London W1 - geograph.org.uk - 398257.jpg](https://commons.wikimedia.org/wiki/File:Charlotte_Street,_London_W1_-_geograph.org.uk_-_398257.jpg) | 2006-07-07 | CC BY-SA 2.0 | yes |
