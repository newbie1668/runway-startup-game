# R0 reproducible browser baseline

Run a production server on loopback, then run `pnpm test:map:browser`. The runner defaults to `http://127.0.0.1:4317`; set `RUNWAY_BASE_URL` for another production origin and `RUNWAY_EVIDENCE_DIR` to retain a prior run. It writes `baseline.json`, one deterministic JSON log per case, screenshots, and the bounded 30-second browser animation-frame trace. `RUNWAY_CASES=B8` selects a focused smoke run and records that filtered scope in `baseline.json`; it is never a full-matrix result.

The runner uses isolated contexts for each cold navigation and reload. It records safe OS/CPU/RAM facts, readiness, page crashes, page errors, console errors, failed requests and HTTP failures. It attempts an artifact and writes a failure log even when context creation, navigation or readiness fails, then returns nonzero after all cases close.

`data-map-ready=1` records legacy completion only. It does not establish actual 3D mode, useful rendered frame, draw calls, unique geometry bytes or geographic coverage. The B6 search and drag observations are UI/camera evidence, not coverage evidence; its frame intervals are browser `requestAnimationFrame` intervals, not renderer timings.
