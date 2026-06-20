import type { FileDiff, Hunk } from "./types";

export type LineSide = "old" | "new";

export type LineLocation = { hunk: Hunk; lineText: string };

/**
 * Locate the diff line addressed by `(side, line)` and return the hunk it
 * belongs to plus the line's text (without the leading +/-/space). Walks each
 * hunk's raw lines tracking old/new line numbers: a context line (' ')
 * advances both sides, '+' advances new only, '-' advances old only. Returns
 * null if no such line exists (e.g. the number isn't part of any hunk).
 */
export function findHunkForLine(file: FileDiff, side: LineSide, line: number): LineLocation | null {
  for (const hunk of file.hunks) {
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    for (const raw of hunk.lines) {
      const marker = raw[0];
      const text = raw.slice(1);
      if (marker === "+") {
        if (side === "new" && newNo === line) return { hunk, lineText: text };
        newNo++;
      } else if (marker === "-") {
        if (side === "old" && oldNo === line) return { hunk, lineText: text };
        oldNo++;
      } else {
        if (side === "new" && newNo === line) return { hunk, lineText: text };
        if (side === "old" && oldNo === line) return { hunk, lineText: text };
        oldNo++;
        newNo++;
      }
    }
  }
  return null;
}

/** Reconstruct the textual hunk (the `@@ … @@` header line plus its body). */
export function hunkText(hunk: Hunk): string {
  const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${hunk.header}`;
  return [header, ...hunk.lines].join("\n");
}

/** Text of the lines on `side` whose number falls within [start, end]. */
export function collectRangeText(hunk: Hunk, side: LineSide, start: number, end: number): string[] {
  const out: string[] = [];
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  for (const raw of hunk.lines) {
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      if (side === "new" && newNo >= start && newNo <= end) out.push(text);
      newNo++;
    } else if (marker === "-") {
      if (side === "old" && oldNo >= start && oldNo <= end) out.push(text);
      oldNo++;
    } else {
      if (side === "new" && newNo >= start && newNo <= end) out.push(text);
      else if (side === "old" && oldNo >= start && oldNo <= end) out.push(text);
      oldNo++;
      newNo++;
    }
  }
  return out;
}

/**
 * Build the first-turn context string sent to the agent for a line or range
 * comment: the file path, which line(s) were commented on, and the surrounding
 * hunk. `startLine`/`endLine` may be given in any order.
 */
export function buildRangeCommentContext(
  file: FileDiff,
  side: LineSide,
  startLine: number,
  endLine: number,
): string {
  const start = Math.min(startLine, endLine);
  const end = Math.max(startLine, endLine);
  const label = start === end ? `${side} line ${start}` : `${side} lines ${start}–${end}`;
  const lead = `File: ${file.path}\nI'm commenting on ${label}:`;
  const found = findHunkForLine(file, side, start);
  if (!found) return `${lead}\n(lines not found in the diff)`;
  return [
    lead,
    collectRangeText(found.hunk, side, start, end).join("\n"),
    "",
    "Here is the surrounding diff hunk it belongs to:",
    hunkText(found.hunk),
  ].join("\n");
}

/** Convenience: context for a single commented line. */
export function buildLineCommentContext(file: FileDiff, side: LineSide, line: number): string {
  return buildRangeCommentContext(file, side, line, line);
}

export type CommentAnchor = {
  side: LineSide;
  startLine: number;
  endLine: number;
  anchorText: string[];
};

/**
 * Find where a stored comment's range sits in the current diff. Returns its
 * range if the same lines still carry the same text, else null ("orphaned")
 * so the UI can flag it rather than anchor to the wrong place. MVP: exact
 * match only — fuzzy text relocation is a deliberate follow-up.
 */
export function relocateComment(
  file: FileDiff,
  comment: CommentAnchor,
): { side: LineSide; startLine: number; endLine: number } | null {
  const found = findHunkForLine(file, comment.side, comment.startLine);
  if (!found) return null;
  const current = collectRangeText(found.hunk, comment.side, comment.startLine, comment.endLine);
  if (current.join("\n") !== comment.anchorText.join("\n")) return null;
  return { side: comment.side, startLine: comment.startLine, endLine: comment.endLine };
}
