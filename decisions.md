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

## DR: Codex as a second agent backend

- **Date**: 2026-09-05
- **Context**: prv's chat, "Apply with agent" and review panel all spawned the `claude` CLI directly; users on OpenAI Codex had no way to use them.
- **Decision**:
  1. One `Backend` contract (`src/chat/backend.ts`): argv for a turn + a per-turn line parser. `runTurn` owns the subprocess; `claude.ts` and `codex.ts` only know their CLI's flags and stream format.
  2. The agent is a per-turn setting (`agent: "claude" | "codex"`) next to model/effort, chosen in the chat panel, persisted in the browser, and sent on chat turns and review starts alike. Effort levels and model presets are per agent.
  3. A session belongs to the CLI that created it: switching agents mid-conversation drops the session on the server and re-sends the diff from the client.
  4. Codex read-only = `--sandbox read-only`; apply = `--sandbox workspace-write`; `approval_policy="never"` in both, since `codex exec` cannot prompt. Codex's non-fatal `error` events surface as progress lines, only `turn.failed` is an error.
- **Rationale**: Keeps the wire protocol and UI event model unchanged (both CLIs normalize to `ChatEvent`), so every existing consumer works with either agent; the per-agent validation keeps a Claude-only flag from ever reaching Codex.

## DR: "Finish review" batches pending threads to one apply turn

- **Date**: 2026-09-10
- **Context**: Every thread message used to call the agent immediately, so there was no way to write several comments and hand them over together; per-thread "Apply with agent" ran one subprocess per comment with only that thread's context.
- **Decision**:
  1. A thread is _pending_ when it is open and its last message is the user's (`isPendingComment`, shared by UI and server). No schema change, and replies to agent-review findings count, so triaging findings feeds the same batch.
  2. Thread composer: **Comment** saves only; **Ask agent** (read-only) and **Apply with agent** (single thread) stay explicit.
  3. Transport: a dedicated `/api/batch` WebSocket shaped like `/api/review` — the server builds one apply-mode prompt from the comments the client sends (anchor lines + transcript, no whole diff; the agent can read files), streams activity, and parses one JSON `results` block (one `--resume` retry when it is missing).
  4. The browser folds `results` into the threads (reply appended; `done: true` → resolved) and persists through the existing store flow. The agent never writes `.prv/comments.json` from the browser path.
- **Rationale**: Keeps the "browser is the store's single writer" decision (letting the agent run `prv reply`/`prv resolve` would race the debounced PUT and needs Bash in apply mode). Mirroring the review runner gives an injectable `TurnRunner` and tolerant parsing for free. Resolving on `done: true` was chosen over "reply only" because Reopen is one click and the point of the batch is fewer clicks.

## DR: Only the "+" button starts a comment thread from the mouse

- **Date**: 2026-10-17
- **Context**: Pressing anywhere in a diff row (code text or line number) started a comment drag and blocked native text selection, so code could not be copied (#75).
- **Decision**: The hover "+" button is the only mouse trigger — click for one line, drag from it for a range, left button only. Code text is plain selectable text, and clicking or dragging a line number opens no thread. The keyboard path (#56: Shift+↑/↓, Enter on a gutter cell) is unchanged.
- **Rationale**: Matches GitHub, where the line number is not a comment trigger. Keeping line-number clicks as a trigger was the other option; it was rejected so one visible affordance owns the mouse path.
