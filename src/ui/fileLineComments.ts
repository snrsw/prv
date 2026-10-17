/**
 * Comments in the File view, where every line of the file can take one.
 *
 * The File view shows the whole file, but a comment anchors to diff rows. The
 * bridge is the *fully expanded* diff: the file's diff with every hidden line
 * folded in as context (see `hunkExpand.ts`). In it, each line of the shown
 * side is exactly one row, so File-view line N is the row whose number on
 * that side is N. An unchanged line becomes a context row, and a changed line
 * keeps the key the Diff view gives it — so one comment shows in both views.
 */

import type { Comment, LineKey } from "../shared/comments";
import { addRange, expandFile, type LineRange } from "./hunkExpand";
import {
  anchorTextOf,
  flattenDiff,
  keyOfRow,
  lineMaps,
  relocateComment,
  type DiffRow,
  type Located,
  type LineSide,
} from "./lineContext";
import type { FileDiff } from "./types";

/**
 * The diff with every line of the file in it. An added or deleted file's
 * diff already carries every line; any other gets its hidden lines revealed
 * from `sourceLines` (the file's new side).
 */
export function fullyExpanded(file: FileDiff, sourceLines: string[]): FileDiff {
  if (file.status === "added" || file.status === "deleted") return file;
  return expandFile(file, sourceLines, [{ start: 1, end: sourceLines.length }]);
}

/** The global index of the row for line `line` on `side`, if there is one. */
function rowGi(rows: DiffRow[], side: LineSide, line: number): number | null {
  const maps = lineMaps(rows);
  return (side === "new" ? maps.newMap : maps.oldMap).get(line) ?? null;
}

/** The comment key of File-view line `line` on `side`, given the expanded rows. */
export function lineKeyOf(rows: DiffRow[], side: LineSide, line: number): LineKey | null {
  const gi = rowGi(rows, side, line);
  return gi == null ? null : keyOfRow(rows[gi]!);
}

/**
 * A new comment's range for File-view lines `a`..`b` (either order): its
 * endpoint keys and anchor text. The range runs over the expanded rows, so it
 * also takes in the other side's lines that sit between the two.
 */
export function lineRangeComment(
  rows: DiffRow[],
  side: LineSide,
  a: number,
  b: number,
): Pick<Comment, "start" | "end" | "anchorText"> | null {
  const lo = rowGi(rows, side, Math.min(a, b));
  const hi = rowGi(rows, side, Math.max(a, b));
  if (lo == null || hi == null) return null;
  return {
    start: keyOfRow(rows[lo]!),
    end: keyOfRow(rows[hi]!),
    anchorText: anchorTextOf(rows.slice(lo, hi + 1)),
  };
}

/** The `side` line numbers of the rows a located comment covers. */
export function linesOnSide(rows: DiffRow[], loc: Pick<Located, "lo" | "hi">, side: LineSide) {
  return rows
    .slice(loc.lo, loc.hi + 1)
    .map((r) => r[side])
    .filter((n): n is number => n != null);
}

/**
 * The File-view line a thread sits under: the last line of its range that
 * exists on `side`. A range with none there (only deleted lines, while the
 * new side is shown) sits under the nearest line before it; 0 means above
 * the first line.
 */
export function anchorLine(rows: DiffRow[], loc: Pick<Located, "lo" | "hi">, side: LineSide) {
  for (let gi = loc.hi; gi >= 0; gi--) {
    const n = rows[gi]?.[side];
    if (n != null) return n;
  }
  return 0;
}

/**
 * The new-side lines to reveal so the Diff view can anchor `comment`: its
 * range in the fully expanded diff. Null when it does not relocate there (its
 * lines really changed) or has no new-side line.
 */
export function revealFor(expanded: FileDiff, comment: Comment): LineRange | null {
  const loc = relocateComment(expanded, comment);
  if (!loc) return null;
  const lines = linesOnSide(flattenDiff(expanded), loc, "new");
  if (lines.length === 0) return null;
  return { start: Math.min(...lines), end: Math.max(...lines) };
}

/** True when `range` already lies inside one of `ranges`. */
export function isCovered(ranges: LineRange[], range: LineRange): boolean {
  return ranges.some((r) => r.start <= range.start && r.end >= range.end);
}

/**
 * Sort the comments that do not relocate in the Diff view. Before the source
 * arrives (`source` null) they are pending: revealed nowhere, listed nowhere.
 * Once it has, one that relocates against the fully expanded diff is revealed
 * — unless its lines are revealed already and it still does not anchor,
 * which lists it rather than revealing forever. If the source failed to load,
 * every one is listed.
 */
export function planReveals(
  file: FileDiff,
  unlocated: Comment[],
  source: string[] | null | "failed",
  reveals: LineRange[],
): { reveal: LineRange[]; listed: Comment[] } {
  if (source === null) return { reveal: [], listed: [] };
  if (source === "failed") return { reveal: [], listed: unlocated };
  const expanded = fullyExpanded(file, source);
  const reveal: LineRange[] = [];
  const listed: Comment[] = [];
  for (const comment of unlocated) {
    const range = revealFor(expanded, comment);
    if (range && !isCovered(reveals, range)) reveal.push(range);
    else listed.push(comment);
  }
  return { reveal, listed };
}

/** `reveals` with every range in `add` merged in. */
export function withRanges(reveals: LineRange[], add: LineRange[]): LineRange[] {
  return add.reduce(addRange, reveals);
}
