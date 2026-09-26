# Charlotte Street: one bounded acquisition recommendation

Keep the existing **273.3 m Percy Street–Tottenham Street** candidate. The
[corrected audit](full-route-feasibility.md) at `1aa3fef` was independently
[accepted as a research packet](independent-review.md); modelling remains
**NO-GO**. It inventories 52 buildings and nine linked parts, rather than 61
separate buildings. Only six buildings have any identity-verified dated
photograph, and only four have a verified view from 2025 or later.

## Recommendation

Obtain **one dated daylight photo pass along both pavements**, using the
existing inventory as its finite checklist. This replaces further speculative
imagery searches. The audit estimates roughly 40 minutes for the street walk;
that estimate is not a guarantee that every facade or object will be visible.

The requested delivery is original, unfiltered photographs, with capture dates,
location/direction where available, and permission to retain them as references.
Take a square-on full-elevation view of each accessible frontage, including its
roofline and ground floor; add oblique views at corners and where an obstruction
hides a storey. Include visible address/fascia identifiers so each frame can be
matched to the existing OSM building/part ID. Record occluded or inaccessible
features rather than supplying a substitute facade.

Use the same pass to check the audit's 41 street-object records: signs and their
faces, crossing markings, lamps, trees and the mapped vacant pit. Capture views
along the street at the endpoints and intermediate junctions for later visual
comparison. Do not assume the pit is a tree or that an older mapped object is
still present.

After runtime recovery, one bounded processing packet can:

1. Match the delivered frames to all 61 existing geometry records, with
   `observed`, `inferred` and `unknown` fields kept separate. Count storeys and
   facade bays only in identity-verified visible portions.
2. Extend the existing cached EA DSM/DTM sample to the remaining 49 building
   footprints, retaining survey-date and sample-count uncertainty. Measure
   footprint-to-raster registration separately; the audit's approximately 2 m
   coordinate-transform residual is not a building-height or registration
   accuracy bound.
3. Produce one coverage/gap table and an independent source decision. Roof
   depth, rear elevations, hidden features and metric heights remain unknown
   unless the evidence supports them. Do not promote raster percentiles to
   measured eaves/ridge heights.

This packet ends with the decision and a finite residual-gap list. It does not
start modelling or another imagery search loop automatically.

## Smallest owner input

Can Foo provide this photo pass, or arrange for someone already near Charlotte
Street to capture it? No paid service, API token or new data download is needed
for the proposed packet. No travel or photographer budget has been approved;
if a local pass cannot be supplied, retain the candidate and the NO-GO state
until a bounded acquisition decision is made.

The photo pass and cached raster analysis are an acquisition recommendation,
not a promise of F2–F6 or G2 completion. Full source, model, visual-comparison and
independent-review evidence must still satisfy the existing fidelity contract.
