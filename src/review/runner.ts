/**
 * Parallel lens runner. Each lens is one read-only agent turn over the same
 * annotated diff; its stream events are relayed as lens-tagged wire frames
 * through an injected emitter, and its final reply is parsed into findings
 * (with one --resume retry when the reply lost the JSON block). One lens
 * failing never aborts the others.
 */

import { relativizeTarget, runTurn, type ChatEvent, type RunTurnArgs } from "../chat/agent";
import type { ChatSettings } from "../shared/chat";
import type { LensId, ReviewServerFrame } from "../shared/review";
import { extractFindings } from "./findings";
import { buildReviewPrompt, LENSES, RETRY_PROMPT, type Lens } from "./lenses";

/** `runTurn`'s shape, injectable so tests can script turns without an agent CLI. */
export type TurnRunner = (args: RunTurnArgs) => AsyncGenerator<ChatEvent>;

export type RunPanelArgs = {
  annotatedDiff: string;
  cwd: string;
  emit: (frame: ReviewServerFrame) => void;
  /** Aborting kills in-flight turns; aborted lenses stop silently. */
  signal?: AbortSignal;
  /** Which CLI (and model/effort) runs every lens; omitted = Claude Code defaults. */
  settings?: ChatSettings;
  lenses?: readonly Lens[];
  turnRunner?: TurnRunner;
};

type TurnOutcome = { sessionId: string | null; result: string | null; error: string | null };

/** Drain one turn, relaying activity as lens-tagged frames and capturing the outcome. */
async function collectTurn(
  events: AsyncGenerator<ChatEvent>,
  lens: LensId,
  cwd: string,
  emit: (frame: ReviewServerFrame) => void,
): Promise<TurnOutcome> {
  const outcome: TurnOutcome = { sessionId: null, result: null, error: null };
  for await (const event of events) {
    switch (event.kind) {
      case "session":
        outcome.sessionId = event.sessionId;
        break;
      case "tool":
        emit({
          type: "tool",
          lens,
          name: event.name,
          target: relativizeTarget(event.target, cwd),
        });
        break;
      case "progress":
      case "text":
        // A review's answer is the `done` result; streamed text is narration.
        emit({ type: "progress", lens, text: event.text });
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

async function runLens(
  lens: Lens,
  annotatedDiff: string,
  cwd: string,
  emit: (frame: ReviewServerFrame) => void,
  turnRunner: TurnRunner,
  settings: ChatSettings,
  signal?: AbortSignal,
): Promise<void> {
  emit({ type: "lens", lens: lens.id, state: "running" });

  const prompt = buildReviewPrompt(lens, annotatedDiff);
  const first = await collectTurn(
    turnRunner({ cwd, prompt, mode: "ask", signal, ...settings }),
    lens.id,
    cwd,
    emit,
  );
  if (signal?.aborted) return; // stopped on purpose — no error, no retry
  if (first.result === null) {
    // Spawn failure or a turn that died before producing a result — the
    // session is broken (or absent), so resuming it would fail again.
    emit({
      type: "lens",
      lens: lens.id,
      state: "error",
      message: first.error ?? "the reviewer produced no result",
    });
    return;
  }

  let parsed = extractFindings(first.result);
  if (parsed === null && first.sessionId !== null) {
    const retry = turnRunner({
      cwd,
      prompt: RETRY_PROMPT,
      sessionId: first.sessionId,
      mode: "ask",
      signal,
      ...settings,
    });
    const second = await collectTurn(retry, lens.id, cwd, emit);
    if (second.result !== null) parsed = extractFindings(second.result);
  }
  if (signal?.aborted) return;
  if (parsed === null) {
    emit({
      type: "lens",
      lens: lens.id,
      state: "error",
      message: "the reviewer did not return a parseable findings block",
    });
    return;
  }

  emit({
    type: "findings",
    lens: lens.id,
    findings: parsed.findings,
    skipped: parsed.skipped.length,
  });
  emit({ type: "lens", lens: lens.id, state: "done" });
}

/** Run every lens in parallel; each failure is contained to its own lens frame. */
export async function runReviewPanel({
  annotatedDiff,
  cwd,
  emit,
  signal,
  settings = {},
  lenses = LENSES,
  turnRunner = runTurn,
}: RunPanelArgs): Promise<void> {
  await Promise.all(
    lenses.map((lens) =>
      runLens(lens, annotatedDiff, cwd, emit, turnRunner, settings, signal).catch(
        (err: unknown) => {
          emit({
            type: "lens",
            lens: lens.id,
            state: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        },
      ),
    ),
  );
}
