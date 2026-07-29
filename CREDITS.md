# RUNWAY diorama credits

The London diorama, its hub-focus views, and its clay marker tokens are generated
from deterministic geometry in [`scripts/blender-city/build_city.py`](scripts/blender-city/build_city.py).
All environment, prop, landmark, and token meshes shipped in the game were
authored in this repository. No third-party 3D model, texture, HDRI, or paid
asset is included.

## Map data

The River Thames shape, primary-road alignments, and hub coordinates in the
diorama are derived from © OpenStreetMap contributors and available under the
Open Database License (ODbL) 1.0:
https://www.openstreetmap.org/copyright.

The simplified authoring snapshot is stored in
`scripts/blender-city/london-geography.json`. RUNWAY's low-poly buildings,
landmarks, props, materials, lighting, and composition remain original artwork
authored in this repository.

Issue #20 identified several CC0 kitbash libraries and CC-BY landmark models as
possible source material. The production scene uses original procedural
geometry instead, so those candidate assets are not redistributed and do not
require attribution here.

## Fonts

- **Barlow Condensed** — Jeremy Tribby — SIL Open Font License 1.1. Loaded
  through `next/font`.
- **Geist** — Vercel — SIL Open Font License 1.1. Loaded through `next/font`.

## Names and trademarks

London place names and the startup/company wordmarks visible in the scene are
used as nominative visual references. Their trademarks remain the property of
their respective owners. RUNWAY is not endorsed by or affiliated with those
companies. The scene uses styled 3D text fallbacks rather than redistributing
official logo SVG files.
