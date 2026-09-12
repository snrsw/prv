/**
 * Pure helpers for "Finish review": choosing the threads a batch sends and
 * folding the agent's per-thread results back into the comment store.
 *
 * The browser stays the store's only writer — the server builds its prompt
 * from the threads the client hands it and never touches `.prv/comments.json`
 * — so everything a run changes about a thread happens here.
 */

import type { BatchResult } from "../shared/batch";
import { isPendingComment, type Comment, type StoredMessage } from "../shared/comments";

/** The threads "Finish review" sends: open, with the user's word last. */
export function pendingComments(comments: Comment[]): Comment[] {
  return comments.filter(isPendingComment);
}

/**
 * Whether `result` addresses `comment`. Ids are minted per file, so two files
 * can carry the same one (and a hand-edited store can repeat one outright):
 * the file has to agree as well, unless the agent echoed no file at all, in
 * which case the id is all there is to match on.
 */
function matches(result: BatchResult, comment: Comment): boolean {
  if (result.id !== comment.id) return false;
  return result.file === "" || result.file === comment.file;
}

/**
 * Fold one run's results into the store: the agent's `reply` becomes an
 * assistant message on the thread, and `done` resolves it (Reopen is one
 * click). Results for ids the store no longer holds are ignored, and a comment
 * that nothing matched — or that a result asks for no change to — comes back
 * by identity, so React skips its subtree and its live transcript is left be.
 */
export function applyBatchResults(comments: Comment[], results: BatchResult[]): Comment[] {
  if (results.length === 0) return comments;
  return comments.map((comment) => {
    const result = results.find((r) => matches(r, comment));
    if (!result) return comment;
    const reply = result.reply.trim();
    const resolves = result.done && comment.status !== "resolved";
    if (reply === "" && !resolves) return comment;
    const messages: StoredMessage[] =
      reply === "" ? comment.messages : [...comment.messages, { role: "assistant", text: reply }];
    return { ...comment, messages, status: result.done ? "resolved" : comment.status };
  });
}

/**
 * `file:line` (or `file:start-end`) for a thread, from its stored line keys —
 * the diff slice `rangeLabel` needs is not around in the batch card. A
 * file-level finding has no line numbers at all and shows as just the path.
 */
export function commentLocation(c: Comment): string {
  const start = c.start?.new ?? c.start?.old ?? null;
  const end = c.end?.new ?? c.end?.old ?? null;
  if (start === null) return c.file;
  return end === null || end === start ? `${c.file}:${start}` : `${c.file}:${start}-${end}`;
}

/** How much of a thread's ask the pending list shows before eliding it. */
export const SUMMARY_MAX = 90;

/**
 * The one-line gist of what a thread asks for: the first line of its last user
 * message (the message that makes it pending), clipped to fit one row.
 */
export function commentSummary(c: Comment, max: number = SUMMARY_MAX): string {
  const last = [...c.messages].reverse().find((m) => m.role === "user");
  const line = (last?.text ?? "").trim().split("\n")[0]?.trim() ?? "";
  return line.length > max ? line.slice(0, max - 1).trimEnd() + "…" : line;
}
