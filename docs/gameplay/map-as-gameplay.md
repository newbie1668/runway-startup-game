# Making the map part of play

Status: **proposal, not yet approved.** The recovery product contract
(`docs/runway-recovery/product.md`) keeps game rules, balance, RNG, the save
schema and action semantics out of scope, and rules out a broader game
redesign, live citizens/traffic and a day/night switch. Everything below
changes those things, so it needs the owner to approve it as its own track.
It should run after, or alongside, the map recovery work, not inside it.

## Owner direction (25 Sept 2026)

- **One sitting, start to finish.** A player keeps playing in one session
  until they reach unicorn or go bust. A "week" is an in-game turn, never a
  real-world wait. No energy timers, no daily limits, no "come back
  tomorrow".
- **The map must be interactive and show itself off**, taking cues from
  what people are building in Three.js with Claude.

## Where we are today

- **Session length already fits.** `scripts/test-game.ts` reports its bot
  reaching unicorn in ~56 in-game weeks on average (197/240 wins). Each week
  is 2 focus clicks plus "End week", so a run is about 15–25 minutes of
  clicking.
- **Turns are thin, and none of that time is spent on the map.** The six
  core actions are sidebar buttons with no location. Event pins can be
  attended from any distance. Rival shields only show a message. A player can
  finish a run without looking at London once.

So the fix is not a different game length. It's making each in-game week a
short, hands-on stretch of play that happens _on the map_.

## The session loop

### One run = 30–40 minutes, three acts

Company growth is shown by how much of London you use. The camera pulls back
as you grow, like Katamari or Spore:

| Act                      | Stages             | Your London                                                             | What you're juggling                                                  |
| ------------------------ | ------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **1. The neighbourhood** | Garage → Pre-seed  | Your HQ hub plus walking distance. Street-level camera.                 | One founder avatar. Learn the map by walking it.                      |
| **2. The city**          | Seed → Series A    | All eight hubs. The Tube and taxis unlock. Mid-height camera.           | Founder plus 1–2 hires you can send out as extra avatars.             |
| **3. The skyline**       | Series B → Unicorn | City-wide. Rival turf wars. Your tower on the skyline. Overview camera. | Several team avatars at once, rivals poaching nearby, investor races. |

A win ends with a victory-lap camera flight over London. A loss ends with the
HQ lights going out and a replay of the run.

### One week = a 30–60 second live "workday" on the map

This replaces the current "click 2 buttons, press End week" turn:

1. **Monday: the city lights up.** This week's opportunities appear as pins
   across London, each with a countdown: an event at a real venue, an angel
   at a café until Wednesday, a candidate at King's Cross, a journalist in
   Soho.
2. **Mon–Fri: the clock runs.** Click a place and your founder travels
   there along real streets. You choose walk (free, slow), Tube (cheap, runs
   on the line network) or taxi (fast, costs £). Arriving does that place's
   action:
   - Hire at talent hubs.
   - Press in Soho.
   - Pitch in Mayfair, and later Canary Wharf.
   - Growth in high-footfall hubs.
   - Retreat in the parks.
   - Build happens at HQ, and your team keeps building while you're out.

   Travel time is the cost. The decision is which two or three things you
   can reach this week.

3. **Things happen on the way.** Dilemma cards fire _somewhere_: the camera
   flies there and the clock pauses while you choose.
4. **Friday: a 5-second recap.** User dots flow toward HQ, cash floats up or
   down, and rival stage-ups flash across the map. Then Monday starts again
   automatically, with no "End week" button to press. The recap is always
   skippable.

Controls follow Two Point Hospital and Cities: Skylines: **pause / 1× / 2×
/ 3×** always visible, and the game auto-pauses on any card. The current
turn-by-turn play stays available as a "Classic turns" setting and as the
accessibility fallback.

### How this stays deterministic and testable

The real-time feel is **presentation only**. Underneath, the engine stays a
pure turn machine:

- A week is **10 half-day slots** (Mon AM … Fri PM). Every action and trip
  costs whole slots. Trips use a **committed hub-to-hub travel table** (walk,
  Tube or taxi, cost in slots and £) generated at bake time, not at runtime.
- The UI plays each slot back over ~3–5 real seconds, animating the avatar
  along a pre-baked street path. Pausing or changing speed only changes the
  animation. Engine state changes happen only at slot boundaries.
- Leads and dilemmas are rolled from the seeded RNG. Saves store the slot
  index, so a run can still be resumed at any time.
- The balance bot plans slots and travel, so `test-game.ts` keeps guarding
  fairness. The target is the bot winning in ~40–60 weeks, which at ~40 s a
  week gives the 30–40 minute run.

## Three.js inspiration

These are recent browser games built with AI coding agents (Claude,
Opus, Cursor). Each has something we can borrow:

| Game                                                                                                                                                                                                                     | What it does                                                                                                                                                                                         | What we borrow                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [San Francisco — The Game](https://sf.thijs.gg/) (Codex, 2026)                                                                                                                                                           | The real city rebuilt from Apple Maps. Walk, drive, climb and hang-glide. Search and teleport to any address. Shareable location links. Multiplayer ghosts. ~884 hours played in its first two days. | Proof that a **recognisable real city is the hook**. Address search → fly there; a **shareable "my HQ" link**; later, other founders' HQs as ghosts. |
| [The Great Taxi Assignment](https://great-taxi-assignment.netlify.app/) (Claude 3.7 Sonnet, Vibe Jam 2025 winner) and [Capybaras Delivering Food](https://capybara-vibejam26.leocoout.dev/) (Claude Code, Vibe Jam 2026) | Timed pickups and drop-offs across a 3D city.                                                                                                                                                        | The **Mon–Fri errand run**: pins with countdowns, and routing across real streets under time pressure.                                               |
| [Vector Tango](https://www.vector-tango.com/play/) (Vibe Jam 2025, 3rd)                                                                                                                                                  | 3D air-traffic control: juggle many moving craft.                                                                                                                                                    | **Act 3**: dispatching several team avatars at once without collisions or wasted trips.                                                              |
| [Tiny Skies](https://tinyskies.vercel.app/) (Vibe Jam 2026, Most Polished) and [fly.pieter.com](https://fly.pieter.com/)                                                                                                 | Cozy flying over a small, dense world.                                                                                                                                                               | The **victory-lap flight** and fly-overs between acts. The map as a joy to move through.                                                             |
| [FULL SEND](https://fullsend.game/) (Cursor + Claude)                                                                                                                                                                    | Racing on OpenStreetMap scenery, with leaderboards.                                                                                                                                                  | Same OSM source as us. **Seeded daily runs** with a leaderboard ("fastest unicorn this week") so one session feels like an attempt worth sharing.    |
| [Kanso](https://github.com/lappemic/awesome-ai-built-games) (Vibe Jam 2026, Most Zen)                                                                                                                                    | A calm, living bonsai that visibly grows.                                                                                                                                                            | **Your HQ as the growing thing**: laptop in a café → co-working desk → floor with a sign → building → tower-top logo.                                |
| Opus 5 / 5.5 SimCity-style builders ([SimSafari](https://github.com/sandrajovicevic/SimSafari/pull/3), [llm-city-builder](https://github.com/CyberSecDef/llm-city-builder/tree/main))                                    | Zones, cars following lanes, and demand, jobs and population changing as the city grows.                                                                                                             | **Data views**: talent, buzz, rent, rival territory and your users as map recolours, SimCity-style.                                                  |
| [Hop.Earth](https://www.explainx.ai/blog/hop-earth-drive-anywhere-satellite-maps-game-august-2026), [WildCity](https://github.com/Aakif9866/WildCity)                                                                    | Drivable/explorable worlds from OSM data.                                                                                                                                                            | Street-level exploration rewards: hidden leads at real founder spots (Silicon Roundabout, famous cafés).                                             |

The common thread is that the popular ones let you **move through a real
place with a goal and a clock**. The ones that only let you look at a city
don't hold attention for long. RUNWAY already has the goal (unicorn) and the
place (London). The missing piece is movement with a clock.

## Map features, in build order

1. **Places, not menus.** Actions happen at hubs, with travel in slots. Click
   a hub to get an action card, and have the sidebar ask "where?". Uses the
   existing hub multipliers (`hireQualityMult`, `hypeMult`,
   `eventFrequencyMult`, `synergySector`). _Makes the map matter._
2. **The live week.** Founder avatar, animated trips, slot clock with speed
   controls, Friday recap and auto-advance. _Makes a session flow._
3. **The city shows your company.** HQ grows by stage. User dots/lit windows
   spread as traction grows, billboards appear while hype is high, and rival
   HQs grow too. _Makes progress visible._
4. **Data views.** Talent, buzz, rent, rivals and users as HUD toggles.
   _Makes the map the place where you plan._
5. **Acts, camera pull-back and team avatars.** The Act 1–3 zones and
   several avatars in Act 3. _Gives the run an arc._
6. **Timed leads, located dilemmas, city events.** London Tech Week, a Tube
   strike (taxis only that week), rival offices opening nearby.
7. **Shareable runs.** A seeded "daily London" run, a result card with a
   flight-path replay of the run, and an HQ link.

Slices 1–2 are the new core loop and should ship together. 3–4 are mostly
renderer/overlay work with little balance risk. 5–7 add depth once the loop
feels good.

## Engineering constraints to respect

- **Engine stays pure and deterministic.** It adds slots, travel, leads and
  HQ tier to `GameState`, all rolled from the seeded RNG. Bumping
  `SAVE_VERSION` means old saves reset (needs owner approval).
- **Balance bot.** `scripts/test-game.ts` must plan slots and travel, and the
  fairness ranges get re-tuned to the 40–60-week target.
- **Renderer contract is additive.** Extend `Scene` with optional fields
  (avatars + paths, HQ tier, user density, ads, leads, overlay mode), and
  `HitTarget` with `lead`. The 2D fallback must show the same information as
  simple markers/tints, so the game stays fully playable in 2D.
- **three.js boundary.** New 3D visuals live in `render3d/` behind the
  dynamic factory import.
- **Performance.** Native cover-grid gates are still open. Avatars, dots,
  ads and leads should be overlay sprites or small instanced batches:
  a handful of avatars, never crowds or per-building mesh edits.
- **Committed data only.** Street paths between hubs, Tube-line polylines,
  the travel table and new places (investor offices, parks, lead spots) are
  baked and committed, like the city binary. No runtime geodata, routing APIs
  or AI calls.
- **Contract conflicts to lift explicitly.** Moving avatars conflict with
  "no live citizens/traffic". A Mon→Fri light change would conflict with "no
  day/night switch". Keep the light fixed unless the owner lifts that.

## Decisions needed from the owner

1. Approve a gameplay track separate from map recovery.
2. Replace "End week" with the live week by default, keeping classic turns as
   a setting?
3. Accept a save-version bump (old saves reset).
4. Allow founder/team avatars moving on the map (an exception to "no live
   citizens").
5. Do you want the seeded daily run + leaderboard, or should the game stay
   purely single-player with no shared results?
