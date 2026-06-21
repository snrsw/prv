import type { FileDiff } from "./types";
import type { Comment, LineKey } from "../shared/comments";

export type LineSide = "old" | "new";

/**
 * A single diff line, flattened across all hunks of a file and given a global
 * index `gi` in file order. `old`/`new` are its line numbers on each side (a
 * context line has both, an added line only `new`, a deleted line only `old`).
 * This single `gi` axis lets a selection span deleted and added lines, and —
 * in split view — span the two columns, since both map back to the same lines.
 */
export type DiffRow = {
  gi: number;
  old: number | null;
  new: number | null;
  marker: " " | "+" | "-";
  text: string;
};

export function flattenDiff(file: FileDiff): DiffRow[] {
  const rows: DiffRow[] = [];
  let gi = 0;
  for (const hunk of file.hunks) {
    let o = hunk.oldStart;
    let n = hunk.newStart;
    for (const raw of hunk.lines) {
      const marker = (raw[0] ?? " ") as " " | "+" | "-";
      const text = raw.slice(1);
      if (marker === "+") rows.push({ gi, old: null, new: n++, marker, text });
      else if (marker === "-") rows.push({ gi, old: o++, new: null, marker, text });
      else rows.push({ gi, old: o++, new: n++, marker, text });
      gi++;
    }
  }
  return rows;
}

export type LineMaps = { oldMap: Map<number, number>; newMap: Map<number, number> };

export function lineMaps(rows: DiffRow[]): LineMaps {
  const oldMap = new Map<number, number>();
  const newMap = new Map<number, number>();
  for (const r of rows) {
    if (r.old != null) oldMap.set(r.old, r.gi);
    if (r.new != null) newMap.set(r.new, r.gi);
  }
  return { oldMap, newMap };
}

/** Resolve a line key to its global index, preferring the new-side number. */
export function keyGi(maps: LineMaps, key: LineKey | null | undefined): number | null {
  if (!key) return null;
  if (key.new != null) {
    const gi = maps.newMap.get(key.new);
    if (gi != null) return gi;
  }
  if (key.old != null) {
    const gi = maps.oldMap.get(key.old);
    if (gi != null) return gi;
  }
  return null;
}

export function keyOfRow(row: DiffRow): LineKey {
  return { old: row.old, new: row.new };
}

export function anchorTextOf(slice: DiffRow[]): string[] {
  return slice.map((r) => r.marker + r.text);
}

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
