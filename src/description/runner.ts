/**
 * Generate runner: one read-only agent turn that drafts the change
 * description, saved to `.prv/description.md` on success. Activity is relayed
 * as frames like the review and batch runners; unlike the batch, the server
 * writes the result itself, since the description file has no browser-side
 * owner (the CLI writes it too).
 */

import { relativizeTarget, runTurn } from "../chat/agent";
import type { FileDiff } from "../diff/types";
import type { TurnRunner } from "../review/runner";
import type { ChatSettings } from "../shared/chat";
import {
  descriptionBytes,
  descriptionTooLargeMessage,
  MAX_DESCRIPTION_BYTES,
  type DescribeServerFrame,
} from "../shared/description";
import { buildDescribePrompt, diffForDescribe, extractDescription } from "./prompt";
import { writeDescription } from "./store";

export type RunDescribeArgs = {
  files: FileDiff[];
  /** Where the agent runs. */
  cwd: string;
  /** Where the description is saved (the comment store's directory). */
  storeDir: string;
  emit: (frame: DescribeServerFrame) => void;
  /** Aborting kills the in-flight turn; an aborted run stops silently and saves nothing. */
  signal?: AbortSignal;
  /** Which CLI (and model/effort) runs the turn; omitted = Claude Code defaults. */
  settings?: ChatSettings;
  /** What to write; omitted = DEFAULT_DESCRIBE_INSTRUCTIONS. */
  instructions?: string;
  turnRunner?: TurnRunner;
};

/**
 * Run the turn and emit at most one `description` frame (or an `error`). An
 * empty or oversized reply is an error and leaves the old description alone.
 * `done` is the caller's to send — the server emits it in a `finally`.
 */
export async function runDescribe({
  files,
  cwd,
  storeDir,
  emit,
  signal,
  settings = {},
  instructions,
  turnRunner = runTurn,
}: RunDescribeArgs): Promise<void> {
  const prompt = buildDescribePrompt(diffForDescribe(files), instructions);
  let result: string | null = null;
  let error: string | null = null;
  for await (const event of turnRunner({ cwd, prompt, mode: "ask", signal, ...settings })) {
    switch (event.kind) {
      case "tool":
        emit({ type: "tool", name: event.name, target: relativizeTarget(event.target, cwd) });
        break;
      case "progress":
      case "text":
        // The description is the `done` result; streamed text is narration.
        emit({ type: "progress", text: event.text });
        break;
      case "error":
        error = event.message;
        break;
      case "done":
        result = event.result;
        break;
      case "session":
        break;
    }
  }
  if (signal?.aborted) return; // stopped on purpose — keep the old description
  if (result === null) {
    emit({ type: "error", message: error ?? "the agent produced no result" });
    return;
  }
  const markdown = extractDescription(result);
  if (markdown === null) {
    emit({ type: "error", message: "the agent returned an empty description" });
    return;
  }
  // Rejected, not truncated: a cut-off description would read as finished.
  const bytes = descriptionBytes(markdown);
  if (bytes > MAX_DESCRIPTION_BYTES) {
    emit({ type: "error", message: descriptionTooLargeMessage(bytes) });
    return;
  }
  emit({ type: "description", description: await writeDescription(markdown, storeDir) });
}
