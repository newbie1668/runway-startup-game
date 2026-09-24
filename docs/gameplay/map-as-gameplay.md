# Making the map part of play

Status: **proposal, not yet approved.** The recovery product contract
(`docs/runway-recovery/product.md`) keeps game rules, balance, RNG, the save
schema and action semantics out of scope, and rules out a broader game
redesign. Everything below changes those things, so it needs the owner to
approve it as its own track. It should come after, or run alongside, the map
recovery work, not inside it.

## Why the map feels passive today

In the code, the map affects play in only three ways:

1. **HQ choice.** Each hub has fixed modifiers (rent, `eventFrequencyMult`,
   `hireQualityMult`, `hypeMult`, `synergySector`). You pick them once in
   setup and, after that, only see them through numbers in the sidebar.
2. **Event pins.** One to three pins appear each week. Clicking one is the
   same as pressing a sidebar button (`attend`, 1 focus). It makes no
   difference how far away the event is.
3. **Rival shields.** Clicking a rival only shows a toast.

The six core actions (build, growth, hire, press, retreat, pitch) are
sidebar buttons with no location. They work the same whether the camera
shows Shoreditch or the Thames. Clicking a hub that isn't your HQ gives the
hint "use Move office…". So the player can play a whole game without looking
at the map. It works as a nice backdrop, but it's something you watch, not
something you play in.

## What other sims do

Games where the world feels lived in tend to use the same few patterns:

| Pattern | Games | What it does to the player |
| --- | --- | --- |
| **A calendar where time is spent in places.** Limited daily slots, and each spot in town offers a different activity. | Persona 3–5, Stardew Valley, Harvest Moon, Kairosoft sims | "Where do I go today?" becomes the main decision. The city is the menu. |
| **Location is a trade-off, not a stat pick.** Where you put things decides what's nearby and what it costs. | SimCity, Cities: Skylines, Theme / Two Point Hospital | You read the map to plan, and moving is a real bet. |
| **The world shows your progress.** Your base grows, and your influence becomes visible in the world. | Game Dev Tycoon / Startup Company (office moves), Animal Crossing, Civilization (culture borders) | Growth feels physical. You look at the map to feel proud. |
| **Data overlays.** Toggles that recolour the map by demand, land value or traffic. | SimCity, Cities: Skylines, Tropico | The map answers strategic questions you're already asking. |
| **Opportunities that appear somewhere and expire.** | Pokémon Go, Death Stranding, GTA side activities, Football Manager scouting | Something to look for, a reason to scan the map, and fear of missing out. |
| **Rivals act in the same space you do.** | Offworld Trading Company, Civilization, Monopoly | Competition is visible and has a location ("they're moving into my patch"). |
| **The turn plays out on screen.** A short replay of what happened. | Football Manager highlights, Frostpunk day summaries, XCOM | The results of the week happen on the map instead of in a log. |
| **Exploring is rewarded.** Real places hide things. | Breath of the Wild, GeoGuessr, Pokémon Go | This makes the faithful London reconstruction pay off in gameplay. |

The closest match to RUNWAY's structure (weekly turns, 2 focus, stats,
dilemmas) is the **Persona/Stardew calendar**. RUNWAY already has the
calendar. What's missing is the "where". That's the core of the proposal.
The other patterns build on it.

## Proposal, in order of value

### 1. Places, not menus (core loop change)

Every action happens somewhere in London. The sidebar buttons stay as a
shortcut and accessibility fallback, but they now ask "where?" and fly the
camera there.

| Action | Where it happens | Why the place matters |
| --- | --- | --- |
| Build | Your HQ | Always available. HQ quality (rent tier) nudges output. |
| Hire | Talent hubs: King's Cross (UCL/Google/DeepMind), Farringdon, Shoreditch | Uses the existing `hireQualityMult` of the hub you *visit*, not only your HQ's. |
| Press | Media quarter: Soho, and Fleet Street/King's Cross as later additions | Uses the visited hub's `hypeMult`. |
| Growth | Busy hubs: Shoreditch, Camden, London Bridge (footfall) | A footfall multiplier per hub, with sector fit (consumer ↔ Camden, fintech ↔ Canary Wharf). |
| Pitch | Investor offices: Mayfair/St James's for VCs, Canary Wharf for later stages | Stage-gated destinations. Later rounds unlock new parts of the city. |
| Retreat | Parks: Regent's Park, Hampstead Heath, Battersea Park | Morale boost. A spot for the camera to linger on scenery. |
| Attend | Event venue (already has a hub + venue name) | Unchanged, but now travel applies. |

**Travel is the cost that makes this a decision.** Keep it simple and
deterministic:

- Same hub as HQ: no extra cost.
- Neighbouring zone: no focus cost, a small cash cost (Tube fare/Ubers,
  scales with team).
- Across town: costs part of a focus. The cleanest way to implement this is
  to switch the week from 2 focus to **5 day slots (Mon–Fri)**, where actions
  take 1–2 days and a cross-town trip adds half a day. Persona and Stardew
  both work at this level of detail.
- Moving HQ becomes a real strategic choice ("move to King's Cross so hiring
  trips are free"), rather than a way to swap modifiers.

This is the one change that makes the map *necessary*. The later sections
make it enjoyable to use.

### 2. The city shows your company

The payoff for growing should be visible in London:

- **HQ evolves by stage.** A laptop in a café (garage), then a co-working
  desk, a floor with a window sign, a whole building with your name, and at
  unicorn stage a tower-top logo. This is the Game Dev Tycoon / Startup
  Company office-upgrade effect. Implement it as a marker/prefab swap on the
  HQ building. No new city geometry is needed.
- **Your users light up the city.** Lit windows or small glowing dots spread
  outward from your HQ as traction grows, concentrated in hubs that match
  your sector. 10k users should *look* different from 100 users.
- **Hype shows as ads.** Past a hype threshold, billboards/bus-stop posters
  with your company name appear in the hubs where you did Press or Growth.
  They fade as hype decays, so you can see it decay.
- **Rivals grow too.** Rival HQ markers step up by stage in the same way, so
  a rival's Series B is visible across the river.

### 3. Data views (SimCity-style overlays)

Add HUD toggles that recolour hubs/districts:

- **Talent**: hire quality per hub.
- **Buzz**: event frequency and hype multiplier, plus where your ads are.
- **Rent**: weekly cost per hub (makes "Move office" readable).
- **Rivals**: each rival's territory and stage.
- **Your users**: where your traction is.

These are mostly existing hub numbers. They are cheap to build and they make
the map the place where planning happens.

### 4. A living city: timed opportunities and pressure

- **Leads with a location and an expiry.** "An angel is at Monmouth Coffee,
  Borough, until Thursday." "A senior ML engineer is leaving DeepMind, King's
  Cross, 2 weeks." "A TechCrunch writer is at a Soho launch." Each is a pin
  with a countdown. They are rarer and richer than events, and they compete
  for the same days.
- **Rivals act in space.** A rival opening near your HQ raises local hiring
  competition. A poach dilemma names *which* rival and *where*. Rivals host
  events you can gatecrash.
- **City-wide events on the map.** London Tech Week makes King's Cross busy
  (more events). A Tube strike makes all cross-town travel cost double for a
  week. The existing flood dilemma is shown at your HQ. Dilemmas get a
  location, and the camera flies there when they fire.

### 5. The week plays out (end-of-week replay)

After "End week", run a 5–8 second camera sequence: user dots flowing
toward the HQ, cash floating up/down, rival stage-ups flashing across the
map, and the next week's pins appearing. The news feed becomes captions for
things you actually see happen. Always skippable. On by default in 3D, off in
2D.

### 6. Exploration pays off

Because the reconstruction aims for recognisable real streets, reward people
who look at them:

- **Hidden leads**: close-zoom-only markers at real founder places (famous
  cafés, co-working buildings, Silicon Roundabout). Finding one gives a
  connection, or unlocks a dilemma card.
- **London lore collection**: a "places visited" log with short real-history
  notes. This is optional and cosmetic. It gives completionists a reason to
  roam without making lore a mandatory part of the product.

## Suggested order and first slice

1. **Slice A (1–2 weeks, biggest single change):** map-anchored actions plus
   travel cost using the existing hub multipliers. Add a click-hub → action
   card on the map. Keep the sidebar as a shortcut that asks "where?".
2. **Slice B:** HQ evolution + users/ads visuals (2) and data views (3). These
   are almost entirely rendering/overlay work with no balance risk.
3. **Slice C:** timed leads, located dilemmas, city events (4).
4. **Slice D:** end-of-week replay (5) and exploration rewards (6).

Slice B could ship first if we want to avoid touching balance. It makes the
map *feel* alive, but only Slice A makes it *matter*.

## Engineering constraints to respect

- **Engine stays pure and deterministic.** New state (visited hub per action,
  day slots, leads, ads) lives in `GameState` and is rolled from the seeded
  RNG. This means bumping `SAVE_VERSION`, which throws away old saves. Get
  explicit owner approval for that.
- **Balance bot.** `scripts/test-game.ts` must learn to travel. Re-tune so a
  sensible bot still hits the current win/bankrupt ranges before shipping.
- **Renderer contract is additive.** Extend `Scene` with optional fields (HQ
  tier, user density per hub, ads, leads, overlay mode). Extend `HitTarget`
  with `lead`. Both renderers must draw the new fields: the 2D fallback
  shows the same information as simple markers/tints.
- **three.js boundary.** All new 3D visuals go through `render3d/` behind the
  dynamic factory import. No static imports outside it.
- **Performance.** The native cover-grid gates are still open. Ads, user
  dots and leads should be overlay-canvas sprites or instanced markers, never
  per-building mesh edits or thousands of agents.
- **Location data.** New places (investor offices, parks, lead spots) are
  committed coordinates in `content.ts`, like the hubs are. No runtime geodata
  or API calls.

## Decisions needed from the owner

1. Approve a gameplay track separate from map recovery (the recovery
   contract excludes this).
2. Switch from 2 focus to 5 day slots, or keep 2 focus with cash-only travel?
   Day slots give richer play but mean more rebalancing.
3. Accept a save-version bump (old saves reset).
4. Start with Slice A (makes the map matter) or Slice B (looks alive,
   no balance risk)?
