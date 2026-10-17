/**
 * Batch runner for "Finish review": one apply-mode agent turn that addresses
 * every pending comment thread, with one --resume retry when the reply lost
 * its JSON block (mirroring the review panel's lens runner).
 *
 * The runner never touches the comment store — it emits the parsed results and
 * the browser, which owns the store, folds them into the threads.
 */

import { relativizeTarget, runTurn, type ChatEvent } from "../chat/agent";
import type { TurnRunner } from "../review/runner";
import type { BatchServerFrame } from "../shared/batch";
import type { ChatSettings } from "../shared/chat";
import type { Comment } from "../shared/comments";
import { BATCH_RETRY_PROMPT, buildBatchPrompt } from "./prompt";
import { extractBatchResults } from "./results";

export type RunBatchArgs = {
  comments: Comment[];
  /** Optional review-level note applied to the whole batch. */
  instructions?: string;
  cwd: string;
  emit: (frame: BatchServerFrame) => void;
  /** Aborting kills the in-flight turn; an aborted batch stops silently. */
  signal?: AbortSignal;
  /** Which CLI (and model/effort) runs the turn; omitted = Claude Code defaults. */
  settings?: ChatSettings;
  turnRunner?: TurnRunner;
};

type TurnOutcome = { sessionId: string | null; result: string | null; error: string | null };

/** Drain one turn, relaying its activity as frames and capturing the outcome. */
async function collectTurn(
  events: AsyncGenerator<ChatEvent>,
  cwd: string,
  emit: (frame: BatchServerFrame) => void,
): Promise<TurnOutcome> {
  const outcome: TurnOutcome = { sessionId: null, result: null, error: null };
  for await (const event of events) {
    switch (event.kind) {
      case "session":
        outcome.sessionId = event.sessionId;
        break;
      case "tool":
        emit({ type: "tool", name: event.name, target: relativizeTarget(event.target, cwd) });
        break;
      case "progress":
      case "text":
        // The batch's answer is the `done` result; streamed text is narration.
        emit({ type: "progress", text: event.text });
        break;
      case "error":
        outcome.error = event.message;
        break;
      case "done":
        outcome.result = event.result;
        break;
    }
  }
  return outcome;
}

/**
 * Run the whole batch in one apply-mode turn and emit at most one `results`
 * frame (or an `error`). `done` is the caller's to send — the server emits it
 * in a `finally`, so every accepted start terminates exactly once.
 */
export async function runBatch({
  comments,
  instructions,
  cwd,
  emit,
  signal,
  settings = {},
  turnRunner = runTurn,
}: RunBatchArgs): Promise<void> {
  const ids = comments.map((c) => c.id);
  const prompt = buildBatchPrompt({ comments, instructions });
  const first = await collectTurn(
    turnRunner({ cwd, prompt, mode: "apply", signal, ...settings }),
    cwd,
    emit,
  );
  if (signal?.aborted) return; // stopped on purpose — no error, no retry
  if (first.result === null) {
    // Spawn failure or a turn that died before producing a result — the
    // session is broken (or absent), so resuming it would fail again.
    emit({ type: "error", message: first.error ?? "the agent produced no result" });
    return;
  }

  let parsed = extractBatchResults(first.result, ids);
  if (parsed === null && first.sessionId !== null) {
    // The edits are already made; the retry only has to restate the JSON, so
    // it runs read-only. Claude resumes a session across modes, and Codex's
    // sandbox likewise only narrows what the resumed turn may do.
    const retry = turnRunner({
      cwd,
      prompt: BATCH_RETRY_PROMPT,
      sessionId: first.sessionId,
      mode: "ask",
      signal,
      ...settings,
    });
    const second = await collectTurn(retry, cwd, emit);
    if (second.result !== null) parsed = extractBatchResults(second.result, ids);
  }
  if (signal?.aborted) return;
  if (parsed === null) {
    emit({ type: "error", message: "the agent did not return a parseable results block" });
    return;
  }

  emit({ type: "results", results: parsed.results, skipped: parsed.skipped.length });
}
