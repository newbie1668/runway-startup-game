# R5a bounded scheduler

The pure scheduler is independently reviewed and integrated at `422f525` (accepted worker source `3f1c966`). It preserves caller FIFO priority, keeps incomplete work at the head, checks an injected clock between steps, reports failures by job ID, and cancels obsolete generations exactly once. Nine focused checks cover ordering, overrun, cancellation during a step, cleanup errors, ID reuse and non-advancing clocks. [Review](review.md).

An individual step can overrun its budget; R5b must split expensive geometry work. The helper is not yet wired to the renderer, and this packet does not claim that default-view generation or memory is bounded. Combined app checks are pending the R3a runtime integration.
