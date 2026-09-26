# Making the map part of play

Status: **direction approved by the owner on 26 Sept 2026; implementation
not started.** The first step is the playtest prototype (build step 0
below). The recovery product contract
(`docs/runway-recovery/product.md`) keeps game rules, balance, RNG, the save
schema and action semantics out of scope, and rules out a broader game
redesign, live citizens/traffic and a day/night switch. Everything below
changes those things, so it is its own gameplay track. It must not land in
the recovery PR, and it runs after, or alongside, the map recovery work.

## Owner direction (25 Sept 2026)

- **One sitting, start to finish.** A player keeps playing in one session
  until they reach unicorn or go bust. A "week" is an in-game turn, never a
  real-world wait. No energy timers, no daily limits, no "come back
  tomorrow".
- **The map must be interactive and show itself off**, taking cues from
  what people are building in Three.js with Claude.

## Owner direction (26 Sept 2026)

- **Competitive and shareable.** Players should chase a leaderboard, share
  their result, and pull friends in to try to beat them. The owner approved
  the recommendations in [Competition and sharing](#competition-and-sharing):
  - short runs
  - a daily seed
  - scoring on founder payout
  - neighbourhood leaderboards
  - a share card
  - server-verified scores
  - a playtest before the full build

## Where we are today

- **Session length already fits.** `scripts/test-game.ts` reports its bot
  reaching unicorn in ~56 in-game weeks on average (197/240 wins). Each week
  is 2 focus clicks plus "End week", so a run is about 15–25 minutes of
  clicking.
- **Turns are thin, and none of that time is spent on the map.** The six
  core actions are sidebar buttons with no location. Event pins can be
  attended from any distance. Rival shields only show a message. A player can
  finish a run without looking at London once.

Two fixes follow. Each in-game week becomes a short, hands-on stretch of play
that happens _on the map_. And the run gets shorter so that restarting is
tempting (see below).

- **Too easy to rank on.** The bot wins 82% of runs. Every unicorn scores the
  same fixed £1B valuation plus cash. Each funding round is one roll at
  5–93% odds. The leaderboard would be flat at the top and decided by luck.

## The session loop

### One run = 8–12 minutes, three acts

The competitive loop needs "one more go": a lost run should cost minutes,
not an evening. The default **Daily London** and **Practice** modes target
8–12 minutes. A longer **Founder mode** (~30–40 minutes, the full-depth run)
can stay as an unranked option.

Company growth is shown by how much of London you use. The camera pulls back
as you grow, like Katamari or Spore:

| Act                      | Stages             | Your London                                                             | What you're juggling                                                  |
| ------------------------ | ------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **1. The neighbourhood** | Garage → Pre-seed  | Your HQ hub plus walking distance. Street-level camera.                 | One founder avatar. Learn the map by walking it.                      |
| **2. The city**          | Seed → Series A    | All eight hubs. The Tube and taxis unlock. Mid-height camera.           | Founder plus 1–2 hires you can send out as extra avatars.             |
| **3. The skyline**       | Series B → Unicorn | City-wide. Rival turf wars. Your tower on the skyline. Overview camera. | Several team avatars at once, rivals poaching nearby, investor races. |

A win ends with a victory-lap camera flight over London. A loss ends with the
HQ lights going out and a replay of the run.

### One week = a ~15 second live "workday" on the map

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
- The UI plays each slot back over ~1–2 real seconds at 1×, animating the avatar
  along a pre-baked street path. Pausing or changing speed only changes the
  animation. Engine state changes happen only at slot boundaries.
- Leads and dilemmas are rolled from the seeded RNG. Saves store the slot
  index, so a run can still be resumed at any time.
- The balance bot plans slots and travel, so `test-game.ts` keeps guarding
  fairness. The target is the bot winning in ~30–40 weeks, which at ~15 s a
  week gives the 8–12 minute run. The bot's win rate should drop from 82%
  to roughly 40–55%, so that finishing at all is an achievement and skill
  shows in the score.

## Competition and sharing

### Daily London (the ranked mode)

- Everyone plays **the same seed each day**: the same leads, events,
  dilemmas and rival moves, in the same places. The comparison is fair and
  people have something to talk about ("did you take the angel at Monmouth on
  Wednesday?").
- Ranked on the **first attempt** of the day. Retries are allowed but
  unranked, so the daily result means something.
- **Practice** uses random seeds and is never ranked.

### Scoring with room to improve

- **Dilution.** Each round sells equity. The founder starts at 100%, and each
  round's cut depends on how ready you were (traction, hype, connections).
  This is the real founder trade-off: raise early and own less, or grow
  slowly and keep more.
- **Valuation above £1B.** The unicorn round is priced on the company's
  stats, so a strong run can close at £2–3B.
- **Headline score = founder payout** (equity kept × final valuation), shown
  as "you walked away with £412M". Weeks to unicorn is shown next to it as a
  speedrun time and used as the tiebreak.
- A run that fails still posts a result: it ranks by weeks survived and peak
  valuation, below every unicorn.

### Luck you can plan around

- **Show pitch odds before you commit.** Preparation raises them: warm intros
  from events, a demo, traction, hype. A failed pitch should feel like a
  choice you made, not bad dice.
- Keep randomness in _what appears_ (leads, dilemmas), which is identical for
  everyone on the daily seed. Keep it out of _whether your good play pays off_.

### Leaderboards tied to real places

- Global daily and weekly boards.
- **Neighbourhood boards** by starting hub ("Shoreditch vs King's Cross this
  week"), plus a hub-vs-hub total. London tech people identify with their
  patch. This is the leaderboard only the map can give us.
- Friends board through the challenge link (below). No accounts are needed
  to play. A display name is asked for once, when you first submit.

### The share card

- A generated image showing:
  - the 3D skyline with your tower
  - your route across London drawn on the map
  - a fake-press headline, e.g. "_Pigeonly (Shoreditch): unicorn in 34
    weeks, founders kept 18%, top 6% today_"
- Built for LinkedIn and X, where London founders post. It has a
  Wordle-style text version too, for chats.
- The card's link is a **challenge link**: it opens the same daily seed, and
  your ghost route is shown on the map to race against.

### Scores verified on a server

- Clients submit **the seed plus the list of moves**. The server replays the
  engine and records the score it computes, not the score the client
  claims. The pure, deterministic engine makes this cheap. It needs the same
  engine code on the server, and a replay size/time limit.
- This needs a small backend: a Next.js API route plus a store for
  submissions and boards. Which host and store to use is an owner decision
  (see below).

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

## Build order

0. **Playtest prototype (first).** A rough live week in the **2D map**:
   - actions at places, with travel in slots
   - the slot clock and auto-advance
   - dilution with pitch odds shown before you commit
   - a fixed seed

   No leaderboard backend, no new 3D work. Have 5–10 people play it and
   record three things: do they finish a run, do they **start a second run
   straight away**, and would they share the result. The immediate restart
   is the most important of the three. Go on to step 1 only if the loop
   passes. Otherwise re-tune the loop and test again.

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
7. **Daily London and leaderboards.**
   - the daily seed
   - server replay verification
   - global, neighbourhood and friends boards
8. **Share card and challenge link**, with a ghost route.

Step 0 decides whether the rest is worth building. Slices 1–2 are the new
core loop and ship together. 3–4 are mostly renderer/overlay work with
little balance risk. 7–8 are what makes the game spread, so they should
follow soon after 1–2 rather than last.

## Engineering constraints to respect

- **Engine stays pure and deterministic.** It adds slots, travel, leads and
  HQ tier to `GameState`, all rolled from the seeded RNG. Bumping
  `SAVE_VERSION` means old saves reset (needs owner approval).
- **Balance bot.** `scripts/test-game.ts` must plan slots and travel, and the
  fairness ranges get re-tuned to the 30–40-week, 40–55% win-rate target. The
  bot also checks that dilution and payout scores spread out, not cluster.
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

## Decided (26 Sept 2026)

- The gameplay track is approved as a separate track from map recovery.
- The game is competitive and shareable:
  - short runs
  - Daily London with leaderboards
  - payout scoring with dilution
  - a share card with a challenge link
- A playtest prototype comes before the full build.

## Still open

1. Which branch and PR the prototype goes on. It should stay out of the
   recovery PR (#30).
2. Should the live week replace "End week" by default, with classic turns
   kept as a setting? (Recommended: yes.)
3. Is a save-version bump OK, meaning old saves reset? (Recommended: yes.)
4. Can founder/team avatars move on the map, as an exception to "no live
   citizens"? (Recommended: yes.)
5. The leaderboard backend: which host and data store, and how display
   names are moderated.
6. Launch domain. Sharing works best from `londonstartupmap.com`, but
   attaching the game there still needs explicit product approval.
