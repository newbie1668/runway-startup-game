# Charlotte Street mapped-candidate inventory

Recorded 5 September 2026. This is a reproducible inventory of **mapped
candidates**, not a survey, frontage confirmation, modelling packet or F1 GO.
Source: [OpenStreetMap map API](https://api.openstreetmap.org/api/0.6/map?bbox=-0.14,51.518,-0.134,51.5215), © OpenStreetMap contributors ([copyright](https://www.openstreetmap.org/copyright)). The cached XML is `charlotte-osm.xml`, SHA-256 `17e8d0ca27890f094414bf7d780d4508d5468089b8ee78f862af2feb6faf9972`; its recorded/retrieved time is `2026-09-05T07:08:56.609848+00:00`, not an observation date for any building or photo.

## Route and selection

The south-to-north centreline is OSM nodes 25495441 (Percy Street junction) to
107318 (Tottenham Street junction), through ways 1301782548, 4068454 and
30279582. It is 273.3 m by the stored haversine calculation; OSM's way
directions are reversed from this travel direction. `map-inventory.json`
retains every route coordinate and provider identifiers, versions, timestamps,
links, complete tags and resolved geometry.

For reproducibility, each point was measured to every route segment in WGS84
using a local equirectangular projection (longitude scale 111,320 m times the
local mean-latitude cosine; latitude scale 110,540 m). Building ways enter when
at least one resolved vertex is within 35 m; tagged candidate nodes and ways
(address/POI, tree, crossing, lamp, bench, sign/signal, barrier/man-made or
other mapped furniture) enter at 25 m. The inventory records nearest route
distance and chainage. This is a deliberately inclusive boundary buffer:
corner and side-street candidates are retained, but it does not say they face
Charlotte Street. Untagged geometry is excluded.

## Results

| Mapped category | Selected records |
| --- | ---: |
| Building ways | 119 |
| Address/POI | 34 |
| Street furniture (mainly kerbs/fences/walls) | 49 |
| Crossings (nodes and ways may describe the same crossing) | 29 |
| Trees | 8 |
| Signs/signals | 5 |
| Bench | 1 |
| **Total provider records** | **245** |

The source contains 5,226 nodes, 1,355 ways and 96 relations. One named
Charlotte Street `associatedStreet` relation is retained as an address-join
aid. Its members are references, not additional actual buildings, and it has
no independently resolved relation geometry here. No other relation was used
to invent geometry or duplicate counts.

The JSON labels 49 records as `addressed-building candidate`: building ways
whose `addr:street` is Charlotte Street. The other 196 are
`proximity-only candidate` records selected by the buffer. Neither label
confirms a Charlotte-facing frontage. The two accepted photo-match candidates
are 26 and 28; 30 is separately retained as a rejected photo match.

## Frontage coverage triage

| Scope | Map coverage | What it does not establish | Next source work |
| --- | --- | --- | --- |
| Whole buffered route | 119 candidate building ways; 49 have `addr:street=Charlotte Street`; 17 have no street address tag | both-side frontage assignment, roof/facade/window/door detail, current condition | street-level reference photos and a frontage-to-footprint join |
| 26 Charlotte, way 138339533 | footprint/tags retained; approximate map footprint 77 m² | binary presence is **UNVERIFIED** despite being below the old 90 m² ingest floor | metric footprint/height and current second viewpoint; May 2022 photo is an accepted initial candidate |
| 28 Charlotte, way 138339551 | footprint/tags retained | roof depth, metric dimensions, current shopfront | second current viewpoint; May 2022 photo is an accepted initial candidate |
| 30 Charlotte, way 138339531 | footprint/tags retained | any support from the Commons photo labelled “30 Charlotte” | collect correct address evidence: that photo matches 30 Tottenham Street and is rejected |
| Trees/signs/furniture | 8 tree, 5 sign/signal, 1 bench records plus 49 barrier/furniture records | zero/absent tags never prove absence in the street; visual form and date are unknown | dated, positioned street survey/photos |

The JSON's top-level `attributeInterpretation` distinguishes map-reported,
inferred, unobserved and unknown data without repeating the same boilerplate
for each entity. An absent tag means only that this extract does not report it.
A map timestamp is an edit timestamp; it is not a physical observation date.

## Reproduce and validate

No network request is needed. First confirm the pinned raw source, then check
the inventory's provider identity and three required candidates:

```sh
shasum -a 256 /tmp/runway-reference-20260905/charlotte-osm.xml
node - <<'NODE'
const fs = require('node:fs');
const raw = fs.readFileSync('/tmp/runway-reference-20260905/charlotte-osm.xml', 'utf8');
const data = JSON.parse(fs.readFileSync('docs/runway-recovery/evidence/F1/map-inventory.json', 'utf8'));
if (!raw.includes('<osm') || data.mapSource.rawSha256 !== '17e8d0ca27890f094414bf7d780d4508d5468089b8ee78f862af2feb6faf9972') throw Error('source mismatch');
for (const id of ['138339533', '138339551', '138339531']) if (!data.entities.some(e => e.sourceId === `osm:way:${id}`)) throw Error(`missing ${id}`);
console.log(data.providerParse.selectedEntities, data.providerParse.countsByCategory);
NODE
```

Expected hash is the value above and expected entity total is 245. The command
validates cache identity, JSON parseability and required IDs; the recorded
selection recipe makes a local parser implementation independently repeatable.
