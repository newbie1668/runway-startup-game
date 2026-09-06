# R2b runner review

## Result

FAIL for the runner at `c1ae94943ebbe38391f078cb86c2336b62f33c14`.

The bounded design is otherwise present: one source fetch per route, captured
document fulfilment for cold/reload, WebGL2-only stubbing, isolated contexts,
12-phase target, clock install before navigation, explicit 15-second `expect`
timeout, five-second screenshots, failure aggregation in `finally`, cleanup
failure propagation, and an explicit limitation against claiming 3D or
performance coverage. The supplied red evidence is correctly treated as
incomplete at 10 phases and cannot certify all 12.

## Findings

1. **Initial clock assertion is a race-prone snapshot.** The runner does
   `textContent()` into `entry.initialClientClock` and then checks the captured
   string. This does not wait for the locator to reach `23:59 THU · JAN 31`;
   a still-neutral or intermediate value fails immediately even if hydration
   settles within the configured assertion timeout. Use a locator expectation
   (with the configured timeout), then capture the actual value for evidence.

2. **The 15-second timeout is not applied to all assertion operations.**
   `expect.configure({ timeout })` controls `check(...)` expectations, but
   `fill`, `click`, `textContent`, and related locator actions retain the
   context default because no `context.setDefaultTimeout(timeout)` or
   `page.setDefaultTimeout(timeout)` is configured. A runner stall can
   therefore exceed the brief's per-assertion timeout.

No browser or suite reruns were performed. These findings are from static
inspection of the supplied diff and source.

## Correction

The previously reported event-isolation finding is withdrawn. Exact source
inspection shows `eventsFor(page)` is called inside `runPhase`, so each cold or
reload phase receives a fresh event array and copies only that phase's events.

## Scoped follow-up re-review: `c1ae949..7f75bb6`

PASS. The initial clock now uses the configured retrying locator expectation,
then captures the observed text in `finally`, preserving evidence on failure.
Each context now sets both default action and navigation timeouts to 15
seconds, covering the locator operations identified previously. The seven
line functional fix introduces no new issue on inspection. Supplied syntax,
diff, and lint checks pass; browser evidence remains pending and was not
rerun in this review.
