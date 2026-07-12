import type { FileDiff } from "./types";
import type { Comment } from "../shared/comments";
import { anchorTextOf, flattenDiff, keyGi, lineMaps } from "../shared/lines";
import type { DiffRow, LineSide } from "../shared/lines";

// Pure diff-line helpers live in src/shared/lines.ts (shared with the
// headless comments CLI); re-exported here for the UI's existing imports.
export {
  anchorTextOf,
  commentId,
  flattenDiff,
  keyGi,
  keyOfRow,
  lineMaps,
} from "../shared/lines";
export type { DiffRow, LineMaps, LineSide } from "../shared/lines";

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
