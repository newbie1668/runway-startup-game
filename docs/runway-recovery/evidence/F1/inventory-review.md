# F1a inventory review

Task: mapped-candidate inventory only. Implementer and independent reviewer: separate GPT-5.6-Terra workers at Medium, with bounded task context.

Initial submission `41978a17ae53188e772fad2436e191c0efa03322` failed independent data review. The reviewer found 236 incorrect distances along the route, an undisclosed source-boundary limitation, and a validation snippet that did not assert the actual source hash.

Correction `f8e16aa7449f7726842cba420891438c8d852e0c` passed independent re-review:

- Recomputed nearest projected-point distances along the route match all 245 records; example nodes `12382201737` and `10247412500` are 5.9 m and 39.7 m respectively.
- The selected building buffer extends 31.7 m beyond the source's southern boundary and 14.3 m beyond its eastern boundary at the route start. Object-buffer gaps are 21.7 m and 4.3 m. These limits are explicit in JSON and Markdown.
- The reproduction snippet calculates and asserts the raw XML SHA-256. All selected source IDs, versions, timestamps, tags and resolved coordinates match the pinned XML.
- Entity counts, categories, route, source relations and required 26/28/30 Charlotte records remain consistent. Vertex-based candidate selection is explicitly limited; the reviewer found no vertex-only false negative within this frozen extract.

Data-review verdict: **PASS for F1a**. The lead integrated the two exact submitted commits. Repository integration checks are tracked in [status](../../status.md); this data review does not replace those checks.

For portable handoff, the lead subsequently committed the original XML as `map-source.osm.xml.gz` and updated the reproduction command to decompress it. Decompression was checked byte-for-byte against the original and against the recorded SHA-256. No selected entity, source attribute or measurement changed.

**F1 GO remains pending.** These are 245 provider records, including 119 building ways and 49 Charlotte-addressed building candidates, not 245 confirmed real buildings. The extract cannot establish complete route coverage. The next packet must fill the source-boundary gap, join both frontages to dated reference views, and resolve metric and distinctive-object evidence before modelling can start.
