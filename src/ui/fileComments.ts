/**
 * Pure helpers behind inline comment threads in the File view.
 *
 * A comment made on a line of the whole file must be the very comment the
 * Diff view would make on that line — same id, same `start`/`end` keys, same
 * anchor text — so it shows up in both views, in `.prv/comments.json` and in
 * the comments CLI without any of them knowing where it came from. The trick
 * is to index the shown file the way the Diff view indexes its rows: the new
 * side is folded into the diff as revealed context (exactly what expanding
 * every hunk header does), so every line has a diff row, with the other
 * side's number wherever the diff can map it.
 */

import type { FileDiff, FileSide } from "./types";
import type { Comment, LineKey } from "../shared/comments";
import {
  anchorTextOf,
  commentId,
  flattenDiff,
  keyOfRow,
  lineMaps,
  type DiffRow,
  type LineMaps,
} from "../shared/diffLines";
import { expandFile } from "./hunkExpand";
import { relocateInRows } from "./lineContext";

/** The shown side of a file, indexed against the diff. */
export type FileIndex = {
  side: FileSide;
  /** The file's lines, 1-based line n at `lines[n - 1]`. */
  lines: string[];
  rows: DiffRow[];
  maps: LineMaps;
};

/** An inclusive run of lines of the shown side. */
export type LineSpan = { lo: number; hi: number };

/**
 * Index `lines` (the text of `side`) against `file`'s diff. The old side is
 * only ever shown for a deleted file, whose single hunk already lists every
 * line, so it needs no folding.
 */
export function indexFile(file: FileDiff, side: FileSide, lines: string[]): FileIndex {
  const full =
    side === "new" && lines.length > 0
      ? expandFile(file, lines, [{ start: 1, end: lines.length }])
      : file;
  const rows = flattenDiff(full);
  return { side, lines, rows, maps: lineMaps(rows) };
}

/** The diff row of line `n` on the shown side, if the diff has one. */
function rowOf(index: FileIndex, n: number): DiffRow | null {
  const gi = index.side === "new" ? index.maps.newMap.get(n) : index.maps.oldMap.get(n);
  return gi == null ? null : (index.rows[gi] ?? null);
}

/**
 * The line key of line `n`: the diff row's own key where the diff has one
 * (a context line carries both numbers, an added line only `new`). A line
 * the diff never touched at all — the diff has no hunks, as for a rename or
 * mode change — reads the same on both sides, so it keys to itself there.
 */
export function fileLineKey(index: FileIndex, n: number): LineKey {
  const row = rowOf(index, n);
  if (row) return keyOfRow(row);
  return index.side === "new" ? { old: n, new: n } : { old: n, new: null };
}

/**
 * The selected lines as the Diff view would record them, so relocation in
 * either view compares equal text. Inside the diff that is the row slice
 * between the two endpoints — including any other-side rows in between, as
 * a gutter drag over the same lines would take. Outside it, an unchanged
 * line is what the diff would show as context: a space and the text.
 */
export function fileAnchorText(index: FileIndex, span: LineSpan): string[] {
  const a = rowOf(index, span.lo);
  const b = rowOf(index, span.hi);
  if (a && b) return anchorTextOf(index.rows.slice(a.gi, b.gi + 1));
  const out: string[] = [];
  for (let n = span.lo; n <= span.hi; n++) {
    const row = rowOf(index, n);
    out.push(row ? row.marker + row.text : " " + (index.lines[n - 1] ?? ""));
  }
  return out;
}

/** A new, empty thread on the lines between `a` and `b` (either order). */
export function fileRangeComment(index: FileIndex, path: string, a: number, b: number): Comment {
  const span = { lo: Math.min(a, b), hi: Math.max(a, b) };
  const start = fileLineKey(index, span.lo);
  const end = fileLineKey(index, span.hi);
  return {
    id: commentId(start, end),
    file: path,
    start,
    end,
    anchorText: fileAnchorText(index, span),
    status: "open",
    messages: [],
  };
}

/**
 * Where a comment sits on the shown side: the span of its lines there, or
 * null when it has none — it is on lines the other side lost, it is a
 * file-level finding, or its text has since changed. The diff's own
 * relocation decides for anything the diff covers; a comment on a file the
 * diff left whole is checked against the file text itself.
 */
export function placeInFile(index: FileIndex, comment: Comment): LineSpan | null {
  const loc = relocateInRows(index.rows, index.maps, comment);
  if (loc) {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const row of loc.slice) {
      const n = row[index.side];
      if (n == null) continue;
      if (n < lo) lo = n;
      if (n > hi) hi = n;
    }
    return hi < lo ? null : { lo, hi };
  }
  const a = comment.start?.[index.side];
  const b = comment.end?.[index.side];
  if (a == null || b == null || !Array.isArray(comment.anchorText)) return null;
  const span = { lo: Math.min(a, b), hi: Math.max(a, b) };
  if (span.hi > index.lines.length) return null;
  // Only lines the diff has no row for can be placed this way; anything the
  // diff covers was already turned down above.
  for (let n = span.lo; n <= span.hi; n++) if (rowOf(index, n)) return null;
  const expected = index.lines.slice(span.lo - 1, span.hi).map((l) => " " + l);
  return expected.join("\n") === comment.anchorText.join("\n") ? span : null;
}

/** The thread's line label, matching `rangeLabel` in the Diff view: `12`, `10–14`, `old 3`. */
export function fileRangeLabel(side: FileSide, span: LineSpan): string {
  const prefix = side === "old" ? "old " : "";
  return span.lo === span.hi ? `${prefix}${span.lo}` : `${prefix}${span.lo}–${span.hi}`;
}

/** Lines shown on each side of the selection in a thread's first-turn context. */
export const FILE_CONTEXT_LINES = 10;

/**
 * First-turn context for the agent when the thread was opened on the file
 * rather than the diff: the selected lines, marked, inside a window of the
 * lines around them, all numbered so the agent can find them.
 */
export function buildFileContext(
  path: string,
  lines: string[],
  span: LineSpan,
  side: FileSide = "new",
): string {
  const from = Math.max(1, span.lo - FILE_CONTEXT_LINES);
  const to = Math.min(lines.length, span.hi + FILE_CONTEXT_LINES);
  const width = String(to).length;
  const body: string[] = [];
  for (let n = from; n <= to; n++) {
    const mark = n >= span.lo && n <= span.hi ? ">" : " ";
    body.push(`${mark} ${String(n).padStart(width)} | ${lines[n - 1] ?? ""}`);
  }
  const which = span.lo === span.hi ? `line ${span.lo}` : `lines ${span.lo}–${span.hi}`;
  const version = side === "old" ? "the old version of the file" : "the file";
  return [
    `File: ${path}`,
    `I'm commenting on ${which} of ${version} (marked with ">"), shown with the lines around it:`,
    "",
    ...body,
  ].join("\n");
}
