# What "done" means: goals and owner instructions

Owner: Foo (product manager). Written 24 September 2026 from the owner
instructions recorded in this repository. Each line cites its source. If a
future session finds a conflict, this page and [status.md](status.md) win over
older plans; ask Foo rather than reinterpreting.

## The product goal

RUNWAY is a London startup strategy game. You found a company, choose an HQ
hub and sector, then play weekly actions against rivals, events and dilemmas
until you reach a **£1 billion** goal. The map is the game board.

The map's end goal is **a faithful, explorable Three.js London at the
standard of the two SFSIM posts Foo selected.** Someone who knows an ordinary
street should recognise its buildings, trees, signs and street features. The
game itself stays exactly as it is.
([product.md](product.md), Foo's clarification on 5 September 2026.)

- References: [workflow post](https://x.com/davidfromkansas/status/2090527551961940028),
  [detail post](https://x.com/davidfromkansas/status/2090527554310635552), and
  [Foo's screenshot](evidence/F0/reference.md). The style is chosen; do not ask
  again.
- The look is simplified, clean 3D forms that keep each real building's shape,
  proportions, roof, window rhythm, materials and standout features.
  Photorealism is not required. Generic or random facades and evenly spaced
  fake trees do not count.
- The target is daytime. A day/night switch is not in scope.

## Standing instructions (apply to all work)

| Instruction | Source |
|---|---|
| Game rules, balance, content, randomness, audio, saves and actions must not change. | product.md; original 3D plan "locked decisions" |
| The 2D map stays as an automatic fallback (no WebGL, weak device, context loss, failed data). | original 3D plan; README |
| No live third-party data, APIs or AI at play time. Everything is baked and committed; the game works with outside network blocked. | original 3D plan; verification.md |
| No live traffic, weather, citizens, interiors, building descriptions or broader game redesign. | product.md scope |
| Keep this repo and `/game` separate from londonstartupmap.com. No deploy or attachment without Foo's approval. | AGENTS.md |
| No merge or deployment without Foo's explicit approval. | every plan and handoff |
| Before calling a change done: `pnpm test:game`, `pnpm lint`, `pnpm build`, and `pnpm test:ui` for game code. | AGENTS.md |
| ~~Mobile matters.~~ **Superseded 24 Sep: desktop browser only** (see decision 4). Existing mobile layout code stays but is not a requirement. | product.md P7 |
| Use cheaper models for well-specified small tasks. The lead owns architecture and acceptance. | agent-contract.md, 5 September 2026 |

## Decisions of 24 September 2026 (this session)

1. **PR #30 is "make the 3D map work reliably".** Making London look like
   London is a separate project and does not block PR #30.
2. **The whole-city zoomed-out view going over 300 draw calls is a follow-up,
   not a blocker.**
3. **A slow first load is acceptable.** What matters is that the game *does*
   load, on the first attempt without failing, and then plays smoothly. The
   5-second desktop load target no longer blocks PR #30. Smooth play after
   loading still does.
4. **Desktop only: "something that runs in the browser" on a desktop or
   laptop.** Phones, tablets, iPhone/Safari device testing and
   reference-mobile performance are dropped from every stage. Mobile layout
   code is kept (not removed), but is not tested or gated.

## Definition of done, in three stages

### Stage 1: PR #30, the reliable 3D map (current)

Done when all of these hold on one final commit:

- The automated checks pass.
- The game, saves, the 2D fallback and context-loss recovery still work.
- On a desktop with a real graphics card, `/game` opens into the 3D city on
  the first attempt with no crash or error. Load time is recorded, not judged.
- After loading, panning and zooming stay smooth: 95% of frames within 33 ms
  on desktop.
- Searching for and visiting the eight hubs works, including zooming in and
  back out without the city disappearing.
- Memory stays within budget: ≤128 MiB of map geometry and ≤2 million
  triangles.

Then Foo reviews the PR and decides whether to merge.

**Branch note.** PR #30 is the top of a stack of unmerged PRs:
#30 → #29 (plan) → #27 → #26 → #24 → `main`. `main` has none of the 3D map
yet, so merging PR #30 on its own does not put it in the game. Stage 1 ends
with Foo choosing how to land the stack. The lead's recommendation is to open
one consolidated PR from `build/runway-recovery` to `main`.

### Stage 2: one real London street (the faithful-London pilot)

Done when about 200–300 m of one ordinary street (both sides and a junction)
matches the real street:

- building footprints, heights, roofs, facades and standout features
- real trees, signs and street objects in their real positions

It must also be explorable up close in the game. A person who knows the
street recognises it without labels, and Foo approves it against the SFSIM
reference. ([product.md](product.md), [verification.md](verification.md) G2.)

- The candidate is Charlotte Street, Fitzrovia; Foo may nominate another
  street.
- **Blocked on:** a dated daylight photo pass of the street. A person has to
  go and take the photos. See the
  [recommendation](evidence/F1/acquisition-recommendation.md).

### Stage 3: repeatable London (city-wide ambition)

Done when the same process reproduces that quality in a second, contrasting
area, and Foo has a costed, area-by-area rollout plan for London
([product.md](product.md) P12, verification.md G3).

The release candidate also needs a full desktop-browser QA pass on the exact
commit ([verification.md](verification.md) G4, minus its mobile rows per
decision 4). The final
geographic extent, target devices and budget are still to be set by Foo after
Stage 2.

## Open items only Foo can provide

- Stage 1: about 30 minutes on a desktop with a real graphics card for the
  final check. Steps: [desktop-check.md](desktop-check.md).
- Stage 1 end: how to land the unmerged PR stack.
- Stage 2 start: go/no-go and who takes the Charlotte Street photos (or a
  different street).
- Stage 3: geographic extent and budget.
