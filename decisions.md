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
  1. A thread is _pending_ when it is open and its last message is the user's (`isPendingComment`, shared by UI, server and the CLI's `--pending`). No schema change, and replies to agent-review findings count, so triaging findings feeds the same batch.
  2. Thread composer: **Comment** saves only; **Ask agent** (read-only) and **Apply with agent** (single thread) stay explicit.
  3. Transport: a dedicated `/api/batch` WebSocket shaped like `/api/review` — the server builds one apply-mode prompt from the comments the client sends (anchor lines + transcript, no whole diff; the agent can read files), streams activity, and parses one JSON `results` block (one `--resume` retry when it is missing).
  4. The browser folds `results` into the threads (reply appended; `done: true` → resolved) and persists through the existing store flow. The agent never writes `.prv/comments.json` from the browser path.
- **Rationale**: Keeps the "browser is the store's single writer" decision (letting the agent run `prv reply`/`prv resolve` would race the debounced PUT and needs Bash in apply mode). Mirroring the review runner gives an injectable `TurnRunner` and tolerant parsing for free. Resolving on `done: true` was chosen over "reply only" because Reopen is one click and the point of the batch is fewer clicks.
