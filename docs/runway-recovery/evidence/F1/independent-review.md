# F1 Charlotte Street — bounded correction re-review

**ACCEPT the research packet at `1aa3fef0d2753c5870131246f59652214fd5048f`. Modelling remains NO-GO.**

Reviewed the four remaining findings and correction regressions against `9fb1c6861537188483bd50a760e0a77363dd7c94`, on `origin/devin/1789671809-f1-source-feasibility`. The remote-tracking branch resolved to the requested SHA, and the prior reviewed commit is its ancestor.

**Remaining substantive issues within this scope: none.** The four findings are closed in substance. Earlier corrected identity, date, parent/part, NHLE and vacant-pit findings remain closed.

This accepts a bounded research packet with explicit unknowns. It does not certify exhaustive imagery acquisition, surveyed dimensions, current street condition, asset suitability or modelling readiness. Full acquisition is not required for this acceptance.

## Validation record

All requested commands passed in an external archive of the exact commit:

```bash
pnpm tsx scripts/audit-street-sources.ts --offline
pnpm exec tsc --noEmit --strict --target ES2022 --module NodeNext \
  --moduleResolution NodeNext --esModuleInterop --skipLibCheck \
  scripts/audit-street-sources.ts
pnpm exec eslint scripts/audit-street-sources.ts
pnpm exec prettier --check scripts/audit-street-sources.ts
```

- Regenerated JSON equals committed output after excluding only `recordedAt` and `mode`. Generated coverage Markdown equals committed output after excluding only its generation banner.
- Independently recomputed west/east/total photo states, buildings versus parts, and verified versus non-rejected 2025+ counts. The result is 61 geometry records = 52 buildings + 9 parts; 9 verified = 6 buildings + 3 parts; 48 candidate-only; 4 without a positive candidate; 7 verified 2025+ geometry records representing 4 buildings.
- The rejected Tottenham Street image remains a negative fixture. No frontage image field cites a rejected match. The 30 Charlotte Street fallback contains four candidates; its separately acknowledged historical news reference is not promoted to a dated/current observation.
- All **32 cached text-response bodies and 6 binary payloads** pass independent SHA-256 checks; binary lengths also match. Every cache file retained at the prior reviewed SHA is unchanged. The pinned decompressed OSM hash remains `17e8d0ca27890f094414bf7d780d4508d5468089b8ee78f862af2feb6faf9972`.
- Compared previous/current machine records: route geometry, parent links, controls, objects, photo observations and non-image frontage fields are unchanged. Independently reran parent-containment, vacant-pit and retained metadata checks.
- Checked the three new KartaView sequence records against frame/contributor attribution and the required collective credit. A fresh public read of sequence `1123901` confirms contributor `53`. Inspected the committed rendered Terms of Use §4 capture and checked its licence quotation against the packet; a fresh HTTP terms read returns the documented application shell. The terms capture SHA-256 is `33de0d7adacab5480c1a486816ad648a344875f05826de1a12d385d5cc40c7b0`.
- All five Commons screenshot attribution rows agree with retained per-file metadata. The report now identifies them as image reproductions.

Reference locations: [photo aggregation](https://github.com/newbie1668/runway-startup-game/blob/1aa3fef0d2753c5870131246f59652214fd5048f/scripts/audit-street-sources.ts#L1535-L1588), [historical 30 reference and coverage](https://github.com/newbie1668/runway-startup-game/blob/1aa3fef0d2753c5870131246f59652214fd5048f/docs/runway-recovery/evidence/F1/full-route-feasibility.md#L107-L182), [transform limits](https://github.com/newbie1668/runway-startup-game/blob/1aa3fef0d2753c5870131246f59652214fd5048f/docs/runway-recovery/evidence/F1/full-route-feasibility.md#L209-L242), [retained-image rights](https://github.com/newbie1668/runway-startup-game/blob/1aa3fef0d2753c5870131246f59652214fd5048f/docs/runway-recovery/evidence/F1/full-route-feasibility.md#L273-L305), [conditional acquisition](https://github.com/newbie1668/runway-startup-game/blob/1aa3fef0d2753c5870131246f59652214fd5048f/docs/runway-recovery/evidence/F1/full-route-feasibility.md#L322-L348).

No tracked files changed. No push, PR, merge, deployment, additional session or modelling approval was made.
