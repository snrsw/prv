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

## DR: tagpr release automation (issue #34)

- **Date**: 2026-08-11
- **Context**: prv had no tags and no releases, while the README pointed people at `nix run github:snrsw/prv/v0.1.0`. Adopting tagpr raised three forks the draft spec could not settle.
- **Decision**:
  1. First tag is `v0.1.0`, matching the README and the plugin manifest.
  2. No prebuilt binaries on the release. prv ships via Nix (builds from source) and the plugin marketplace, so there is no artifact to upload.
  3. Both `package.json` and `.claude-plugin/plugin.json` are seeded at `0.0.0`, and the first release PR is labelled `minor` to reach `v0.1.0`.
- **Rationale**: Decision 3 follows from how tagpr works. With no tags present it treats the current version as `v0.0.0` (`tagpr.go`), and `bumpVersionFile` rewrites the _current_ version string in each version file — a file holding any other value is silently left alone, with no error. Keeping both files at `0.0.0` is therefore the only way they stay in step, and a `minor` label turns tagpr's default `v0.0.1` proposal into the wanted `v0.1.0`. The alternative, tagging `v0.1.0` by hand, works but does by hand the one job tagpr exists to do.
