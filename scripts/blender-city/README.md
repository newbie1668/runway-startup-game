# RUNWAY London diorama

Production Blender pipeline for issue #20. It builds the complete art-directed
London scene from deterministic `bpy` geometry, renders the wide city artwork,
eight matching hub-focus views, clay marker tokens, and writes the hub-anchor
manifest consumed by the browser.

## Preview

```sh
sh scripts/blender-city/render.sh --preview
```

This renders `artifacts/diorama-authoring/master-preview.png` at 1600×900.

To review every focus-camera composition without paying the full production
render cost:

```sh
sh scripts/blender-city/render.sh --focus-preview all
```

This writes eight 800×800 review renders alongside the master preview.

To regenerate only the neutral source clay tokens:

```sh
sh scripts/blender-city/render.sh --tokens-only
```

## Final asset sources

```sh
sh scripts/blender-city/render.sh --final
node scripts/process-diorama-assets.mjs
```

The final command compresses the authoring PNGs into the AVIF/WebP variants
under `public/game/diorama/`. Authoring PNGs and the `.blend` file are retained
outside the shipped public asset folder.

`process-diorama-assets.mjs` also writes the generated runtime manifest used for
the inline master-image LQIP. Do not hand-edit that manifest after processing.

Blender 5.1.2 is the verified runtime. The scene uses Cycles with Metal when
available and falls back to CPU rendering.
