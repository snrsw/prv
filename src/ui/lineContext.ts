import type { FileDiff } from "./types";
import type { Comment, LineKey, StoredMessage } from "../shared/comments";
import { anchorTextOf, flattenDiff, keyGi, lineMaps, type DiffRow } from "../shared/diffLines";
import type { LineSide } from "../shared/diffLines";

// The pure diff-row helpers live in shared/ (the server uses them too); keep
// re-exporting them here so UI code has a single import site.
export { anchorTextOf, flattenDiff, keyGi, keyOfRow, lineMaps } from "../shared/diffLines";
export type { DiffRow, LineMaps, LineSide } from "../shared/diffLines";

/** Stable id derived from a comment's range endpoints. */
export function commentId(start: LineKey, end: LineKey): string {
  const k = (key: LineKey) => `${key.old ?? ""}_${key.new ?? ""}`;
  return `c:${k(start)}:${k(end)}`;
}

export type Located = {
  lo: number;
  hi: number;
  last: { side: LineSide; line: number };
  slice: DiffRow[];
};

/**
 * Locate a comment's range in the current diff, verifying the line text still
 * matches. Returns the global-index span, the slice, and the last line (for
 * thread placement), or null if the lines changed ("orphaned").
 */
export function relocateComment(file: FileDiff, comment: Comment): Located | null {
  if (!comment.start || !comment.end || !Array.isArray(comment.anchorText)) return null;
  const rows = flattenDiff(file);
  const maps = lineMaps(rows);
  const a = keyGi(maps, comment.start);
  const b = keyGi(maps, comment.end);
  if (a == null || b == null) return null;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const slice = rows.slice(lo, hi + 1);
  if (anchorTextOf(slice).join("\n") !== comment.anchorText.join("\n")) return null;
  const lastRow = rows[hi]!;
  const last =
    lastRow.new != null
      ? { side: "new" as const, line: lastRow.new }
      : { side: "old" as const, line: lastRow.old! };
  return { lo, hi, last, slice };
}

/** Human label for a comment's range (new-side numbers when available). */
export function rangeLabel(slice: DiffRow[]): string {
  const news = slice.map((r) => r.new).filter((v): v is number => v != null);
  const olds = slice.map((r) => r.old).filter((v): v is number => v != null);
  const nums = news.length ? news : olds;
  if (nums.length === 0) return "";
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const prefix = news.length ? "" : "old ";
  return lo === hi ? `${prefix}${lo}` : `${prefix}${lo}–${hi}`;
}

/** First-turn context for the agent: the file and the selected diff lines. */
export function buildCommentContext(file: FileDiff, slice: DiffRow[]): string {
  return [
    `File: ${file.path}`,
    "I'm commenting on these diff lines:",
    "",
    ...anchorTextOf(slice),
  ].join("\n");
}

/**
 * A thread's first-turn context plus its persisted transcript, so a fresh
 * claude session knows the prior conversation (for review comments, that
 * includes the finding itself). Harmless on later turns of a live session —
 * only a session's first send transmits context.
 */
export function buildThreadContext(context: string, messages: StoredMessage[]): string {
  if (messages.length === 0) return context;
  const transcript = messages.map(
    (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`,
  );
  return [context, "", "Prior conversation on this comment:", "", ...transcript].join("\n");
}
