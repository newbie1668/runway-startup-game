# RUNWAY

RUNWAY is a standalone preview app for the London startup strategy game.

It was extracted from London Startup Map PR #62 so the experiment can continue
without adding `/game` to the main `londonstartupmap.com` codebase.

## Local Development

```bash
pnpm install
pnpm dev
```

The game route is `/game`. The root route redirects there.

## Checks

```bash
pnpm test:game
pnpm lint
pnpm build
```

## Repo Boundary

This repo is intentionally separate from `newbie1668/london-startup-map`.
Do not merge or deploy it under `londonstartupmap.com` without product approval.
