# RUNWAY

RUNWAY is a standalone preview app for the London startup strategy game.

It is a separate experiment from [London Startup Map](https://londonstartupmap.com/),
so the game can continue without adding `/game` to the main product codebase.

## Local Development

```bash
pnpm install
pnpm dev
```

The game route is `/game`. The root route redirects there.

The map is a 3D London miniature. The look follows the HBO _Silicon Valley_
opening titles by [yU+co](https://www.yuco.com/works/silicon-valley)
(isometric daylight miniature, pop-up gags). Orbit, fly-to, and pins follow the
[NYC AI Atlas](https://nycaiatlas.com) interaction model. Game mechanics are
unchanged.

## Checks

```bash
pnpm test:game
pnpm lint
pnpm build
```

## Repo Boundary

This repo is intentionally separate from the main London Startup Map product.
Do not deploy it under `londonstartupmap.com` without product approval.
