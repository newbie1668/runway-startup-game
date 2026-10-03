# RUNWAY: London Live — map-based startup sim (plan + prototype)

Status: prototype at `/game/rts`, for playtesting. The existing `/game` is unchanged.

## Pitch

RUNWAY stays a startup simulator. The new mechanic is **moving around the map**,
borrowed from map-based RTS/sim games (StarCraft/Warcraft workers, Civilization's
tech tree). You control your team as people on the London map. Work only happens
at places, so *who you send where, and when* is the game. There is no territory,
no combat and no war theme.

## Core loop

1. **Select people, send them to places.** Click a person, then right-click a
   place. Travel takes in-game time.
2. **Places produce what a startup needs**, like resource nodes in an RTS:

   | Place | Who works there | What you get |
   |---|---|---|
   | 🏠 Your office | Engineers (founder at half speed) | Build points for the roadmap; product polish when nothing is queued |
   | ✨🛍️🏪⌨️🏦 Customer spots | Growth people (founder at 0.6×) | Users from a shared pool that refills slowly. Rivals drain the same pool |
   | 🎓 Talent spots | Anyone | Lets you hire. Hire quality depends on the place and the area |
   | 💷 Investor offices | Founder, in person | Funding rounds. Odds and dilution are shown before you pitch |
   | Pop-up pins | Depends on the pin | Meetups, candidates, journalists, angels. They expire, and the first person to arrive wins |

3. **Build up, Warcraft-base style.** Your office upgrades from Kitchen table →
   Co-working desks → Own floor → HQ building. Each step raises your team cap and
   your rent. You can also open more offices in other areas.
4. **Roadmap = tech tree (Civ).** MVP → Onboarding / Payments / Public API →
   Mobile app / Analytics / Enterprise SSO → AI assistant. Shipping a feature
   raises product and can open a **customer segment**: Payments → small
   businesses, Mobile → consumers, API → developers, SSO → enterprise. Locked
   customer spots show a 🔒 with the feature they need.
5. **Rivals** are three AI startups that follow the same rules. Their people are
   visible on the map, chasing the same customers, hires, pins and investors.
6. **Clock:** real time with pause and 1×/2×/4× speed. Decision cards pause the game.
7. **Win** by reaching the Unicorn round. **Lose** if the cash runs out.

## Why this works for the two goals

- *Going around the map:* every action has a location, and travel costs time,
  so London's geography matters (talent in King's Cross, banks at Canary Wharf,
  consumers in Camden and Soho).
- *Being a startup:* the numbers are the existing game's. Burn, runway,
  product, users, hype, funding stages and dilution all carry over, and the map
  decides how you earn them.

## Prototype scope (this PR)

- `lib/rts/*`: a pure, deterministic sim (seeded, no DOM/Date/Math.random) and
  a canvas overlay on the existing 2D London map.
- `components/rts/RtsApp.tsx` + `app/game/rts/page.tsx`: setup screen, live map,
  top resource bar, roadmap, place/office/person panels, leaderboard, minimap,
  hotkeys.
- `scripts/test-rts.ts`: determinism, no-mutation, refused commands,
  work-only-at-places, shared pools, shipping, and a 200-seed balance bot.

Not in scope yet: sound, saves, mobile layout, the 3D map (PR #30), tutorials.

## Next steps if playtests go well

1. Tune pacing (game length, pool sizes, rival aggression) from real play.
2. Move units/places onto the shared map contract so the 3D map can render them.
3. Fold the best mechanics into the main `/game` and retire the duplicated logic.
