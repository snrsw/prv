/**
 * Revealing the context a diff hides, GitHub-style.
 *
 * A unified diff only carries a few lines around each change; everything else
 * in the file is invisible. Clicking a hunk header asks for some of it back.
 * Rather than injecting rows into the rendered table, we rebuild the file's
 * unified-diff text with the requested lines folded in as context and let
 * diff2html render it again. Comment anchoring, gutter selection and split
 * view all read the same `FileDiff`, so they keep working unchanged.
 *
 * Revealed lines are addressed by NEW-side line number: it is the one axis
 * that stays stable as hunks grow and merge. Their text comes from the new
 * side of the file (for a deleted file, the old side) — a hidden line is
 * unchanged by definition, so both sides carry the same text.
 */

import type { FileDiff, Hunk } from "./types";

/** An inclusive run of new-side line numbers. */
export type LineRange = { start: number; end: number };

/** A hidden region of the file, sitting directly above hunk `hunkIndex`. */
export type Gap = {
  /** Index of the hunk below the gap; equals `hunks.length` for the trailing gap. */
  hunkIndex: number;
  start: number;
  /** Inclusive last line, or null for a trailing gap whose file length is not known yet. */
  end: number | null;
};

export type ExpandDirection = "up" | "down" | "all";

/** Lines revealed per click, matching GitHub's step. */
export const EXPAND_STEP = 20;

/** git's default context width, used to guess whether a file continues past its last hunk. */
const DEFAULT_CONTEXT = 3;

export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

// A hunk header states a start and a count per side. git writes a zero count as
// "the empty spot after line N", so an empty range starts at N+1 and ends at N.
const rangeStart = (start: number, count: number): number => (count === 0 ? start + 1 : start);
const rangeEnd = (start: number, count: number): number =>
  count === 0 ? start : start + count - 1;

const firstNew = (h: Hunk): number => rangeStart(h.newStart, h.newLines);
const lastNew = (h: Hunk): number => rangeEnd(h.newStart, h.newLines);

/**
 * How far the old side runs ahead of (or behind) the new side just outside a
 * hunk. Exact from the header alone: a hunk's two ranges start and end at
 * corresponding positions, so the lines bracketing it correspond too.
 */
const deltaAbove = (h: Hunk): number => rangeStart(h.oldStart, h.oldLines) - firstNew(h);
const deltaBelow = (h: Hunk): number => rangeEnd(h.oldStart, h.oldLines) - lastNew(h);

/** Number of context lines a hunk ends with. */
function trailingContext(h: Hunk): number {
  let n = 0;
  for (let i = h.lines.length - 1; i >= 0 && h.lines[i]!.startsWith(" "); i--) n++;
  return n;
}

/**
 * The file's hidden regions, in order. `totalNewLines` is null until the file
 * has been fetched; the trailing gap is then guessed from the last hunk having
 * kept its full context — a hunk that ran into the end of the file has less.
 * The guess only ever costs one expander that reveals nothing and disappears.
 */
export function gapsOf(hunks: Hunk[], totalNewLines: number | null): Gap[] {
  if (hunks.length === 0) return [];

  const interior = hunks.flatMap((h, i) => {
    const start = i === 0 ? 1 : lastNew(hunks[i - 1]!) + 1;
    const end = firstNew(h) - 1;
    return start <= end ? [{ hunkIndex: i, start, end }] : [];
  });

  const last = hunks.at(-1)!;
  const start = lastNew(last) + 1;
  const trailing: Gap[] =
    totalNewLines === null
      ? trailingContext(last) >= DEFAULT_CONTEXT
        ? [{ hunkIndex: hunks.length, start, end: null }]
        : []
      : start <= totalNewLines
        ? [{ hunkIndex: hunks.length, start, end: totalNewLines }]
        : [];

  return [...interior, ...trailing];
}

/** Lines to reveal for one click on a gap, or null when the direction does not apply. */
export function revealRange(gap: Gap, direction: ExpandDirection): LineRange | null {
  if (gap.end === null) {
    // Only the hunk above an open-ended gap is known, so only "down" is anchored.
    return direction === "down" ? { start: gap.start, end: gap.start + EXPAND_STEP - 1 } : null;
  }
  if (direction === "all") return { start: gap.start, end: gap.end };
  if (direction === "down") {
    return { start: gap.start, end: Math.min(gap.end, gap.start + EXPAND_STEP - 1) };
  }
  return { start: Math.max(gap.start, gap.end - EXPAND_STEP + 1), end: gap.end };
}

/** Add a range to a sorted, non-overlapping set, merging anything it touches. */
export function addRange(ranges: LineRange[], add: LineRange): LineRange[] {
  const before = ranges.filter((r) => r.end < add.start - 1);
  const after = ranges.filter((r) => r.start > add.end + 1);
  const overlapping = ranges.filter((r) => r.end >= add.start - 1 && r.start <= add.end + 1);
  const merged = {
    start: Math.min(add.start, ...overlapping.map((r) => r.start)),
    end: Math.max(add.end, ...overlapping.map((r) => r.end)),
  };
  return [...before, merged, ...after];
}

/** One diff line, carrying its number on each side. */
type Row = { old: number | null; new: number | null; text: string };

/**
 * A run of consecutive rows: either an original hunk or a revealed stretch of
 * context. Runs are stitched back into hunks wherever they meet end to end.
 */
type Segment = {
  rows: Row[];
  firstNew: number;
  lastNew: number;
  oldStart: number;
  newStart: number;
  /** The header of the hunk this segment came from; null for revealed context. */
  header: string | null;
};

function hunkSegment(h: Hunk): Segment {
  let o = rangeStart(h.oldStart, h.oldLines);
  let n = firstNew(h);
  const rows = h.lines.map((text): Row => {
    if (text.startsWith("+")) return { old: null, new: n++, text };
    if (text.startsWith("-")) return { old: o++, new: null, text };
    return { old: o++, new: n++, text };
  });
  return {
    rows,
    firstNew: firstNew(h),
    lastNew: lastNew(h),
    oldStart: h.oldStart,
    newStart: h.newStart,
    header: h.header,
  };
}

function contextSegment(range: LineRange, delta: number, source: string[]): Segment {
  const rows = Array.from({ length: range.end - range.start + 1 }, (_, i): Row => {
    const n = range.start + i;
    return { old: n + delta, new: n, text: " " + source[n - 1]! };
  });
  return {
    rows,
    firstNew: range.start,
    lastNew: range.end,
    oldStart: range.start + delta,
    newStart: range.start,
    header: null,
  };
}

/** The revealed runs inside one gap, clipped to the gap and to the file. */
function revealedRuns(gap: Gap, limit: number, reveals: LineRange[]): LineRange[] {
  const end = Math.min(gap.end ?? limit, limit);
  return reveals
    .map((r) => ({ start: Math.max(r.start, gap.start), end: Math.min(r.end, end) }))
    .filter((r) => r.start <= r.end)
    .sort((a, b) => a.start - b.start);
}

function toHunk(group: Segment[]): Hunk {
  const rows = group.flatMap((s) => s.rows);
  const first = group[0]!;
  return {
    oldStart: first.oldStart,
    oldLines: rows.filter((r) => r.old !== null).length,
    newStart: first.newStart,
    newLines: rows.filter((r) => r.new !== null).length,
    header: group.find((s) => s.header !== null)?.header ?? "",
    lines: rows.map((r) => r.text),
  };
}

/** Group segments that run end to end; a break in numbering starts a new hunk. */
function groupSegments(segments: Segment[]): Segment[][] {
  return segments.reduce<Segment[][]>((groups, seg) => {
    const open = groups.at(-1);
    if (open && open.at(-1)!.lastNew + 1 === seg.firstNew) open.push(seg);
    else groups.push([seg]);
    return groups;
  }, []);
}

/** Everything in the raw diff before the first hunk header (the `diff --git` block). */
function rawHeader(raw: string): string {
  const at = raw.search(/^@@/m);
  return at < 0 ? raw : raw.slice(0, at);
}

function serialize(header: string, hunks: Hunk[]): string {
  return (
    header +
    hunks
      .map(
        (h) =>
          `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${h.header}\n` +
          h.lines.map((l) => l + "\n").join(""),
      )
      .join("")
  );
}

/**
 * Rebuild `file` with `reveals` folded in as context lines, taking their text
 * from `source` (the file's own lines). Reveals falling outside a hidden gap
 * are ignored, so applying a growing set to the original file is idempotent.
 *
 * A "\ No newline at end of file" marker is dropped from an expanded file:
 * it is not part of a parsed hunk, so it cannot be written back out.
 */
export function expandFile(file: FileDiff, source: string[], reveals: LineRange[]): FileDiff {
  if (reveals.length === 0 || file.hunks.length === 0) return file;

  const gaps = gapsOf(file.hunks, source.length);
  const runsAbove = (index: number, delta: number): Segment[] => {
    const gap = gaps.find((g) => g.hunkIndex === index);
    if (!gap) return [];
    return revealedRuns(gap, source.length, reveals).map((r) => contextSegment(r, delta, source));
  };

  const last = file.hunks.at(-1)!;
  const segments = [
    ...file.hunks.flatMap((h, i) => [...runsAbove(i, deltaAbove(h)), hunkSegment(h)]),
    ...runsAbove(file.hunks.length, deltaBelow(last)),
  ];

  const hunks = groupSegments(segments).map(toHunk);
  return { ...file, hunks, raw: serialize(rawHeader(file.raw), hunks) };
}
