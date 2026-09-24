# Desktop check: the last step before PR #30 review

About 20–30 minutes on a desktop or laptop that has a real graphics card: a
Mac, or a Windows/Linux PC with a GPU. Chrome doesn't have to be installed;
the script brings its own browser.

## One-time setup

You need Node.js 20+ and pnpm 10. On a Mac with Homebrew:
`brew install node pnpm`.

```bash
git clone https://github.com/newbie1668/runway-startup-game.git
cd runway-startup-game
git checkout build/runway-recovery
pnpm install
pnpm exec playwright install chromium
```

## Run the check

Close other heavy apps first. Leave the laptop plugged in.

```bash
pnpm build
pnpm start --hostname 127.0.0.1 --port 4317
```

When it prints "Ready", open a **second terminal** in the same folder and run:

```bash
pnpm check:desktop
```

A browser window opens by itself and runs for about 5 minutes. Don't touch
the mouse while it runs. It does three things:

1. It opens the game five times from a cold start and records whether the 3D
   city loads, and how long it takes.
2. It drags the map around for 30 seconds and measures smoothness.
3. It zooms in from the whole-city view and straight back out, twice, and
   records how much of the city stays drawn.

## What you'll see at the end

```text
PASS  E6 loads into 3D  5/5 ready, median 6100 ms to useful 3D
PASS  E7 smooth panning  p95 18.4 ms (limit 33), median 16.7 ms
PASS  E5 reverse zoom @30ms  stock 113538 → min 90000 → 113538
PASS  E5 reverse zoom @500ms  stock 113538 → min 90000 → 113538
```

These numbers are only an illustration.

- **E6:** every load must reach the 3D city. Load time is recorded for
  information only, per your decision.
- **E7:** p95 is the "slowest 5% of frames". At or under 33 ms feels smooth.
- **E5:** at least 75% of buildings stay drawn while zooming, and the city
  is fully back afterwards.

Send the lead the printed lines, plus the
`docs/runway-recovery/evidence/R6/desktop-check-<commit>/` folder (a JSON
file and a few screenshots). You can also commit it on the branch.

If anything prints **FAIL**, that is a result, not something you did
wrong. Send it and the team will act on it.
