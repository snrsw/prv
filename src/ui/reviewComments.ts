/** Pure helpers for rendering agent-review comments in the UI. */

import type { Comment } from "../shared/comments";
import type { ChatMessage } from "./useDiffChat";

/**
 * True for comments that never anchored to diff lines (file-level findings):
 * the transform gives them all-null endpoints and no anchor text.
 */
export function isFileLevelComment(c: Comment): boolean {
  return c.start?.old == null && c.start?.new == null && c.end?.old == null && c.end?.new == null;
}

/**
 * Split a review thread's transcript into the leading finding body (the
 * assistant message the transform seeded) and the conversation after it.
 * Defensive: when the first message isn't assistant text, nothing splits.
 */
export function splitFindingBody(messages: ChatMessage[]): {
  body: string | null;
  rest: ChatMessage[];
} {
  const first = messages[0];
  if (first && first.role === "assistant") return { body: first.text, rest: messages.slice(1) };
  return { body: null, rest: messages };
}

/** First-turn agent context for a finding that applies to the whole file. */
export function fileLevelContext(path: string): string {
  return [`File: ${path}`, "This comment applies to the whole file."].join("\n");
}
