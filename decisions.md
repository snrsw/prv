# Decisions

## DR: Agent review panel scope (issue #20)

- **Date**: 2026-07-12
- **Context**: Turning agent review results into prv review comments with per-comment conversations; four forks the draft spec could not settle.
- **Decision**:
  1. Producers: in-app Review button first; external findings import is a follow-up.
  2. Reviewer shape: parallel lens panel (correctness, silent-failures, test-coverage), comments tagged by lens, no cross-lens dedupe in v1.
  3. Re-runs: stack, plus a "Clear agent comments" action for open, unreplied agent comments.
  4. Proceed to implementation (worktree → tests → draft PR).
- **Rationale**: Smallest end-to-end v1 that matches "review by agents"; the findings contract keeps an import path open. Cancellation was added to scope from #20's acceptance criteria.

## DR: Where findings become comments

- **Date**: 2026-07-12
- **Context**: Server-side store merge vs client-side transform for review findings.
- **Decision**: Client-side — the server streams raw findings; the browser transforms and persists them via the existing comment store flow.
- **Rationale**: The client's debounced whole-store PUT makes any second writer racy (a run-end server write can be silently clobbered). Keeping the browser the store's single writer removes the race with no new machinery; the pure transform stays importable server-side for a future import endpoint.
