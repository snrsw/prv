import { test, expect, describe } from "bun:test";
import {
  anchorLine,
  fullyExpanded,
  isCovered,
  lineKeyOf,
  lineRangeComment,
  planReveals,
  revealFor,
} from "./fileLineComments";
import { commentId, flattenDiff, relocateComment } from "./lineContext";
import type { Comment } from "../shared/comments";
import type { FileDiff } from "./types";

// A 20-line file (new side) where old line 8 was replaced by new lines 8-9:
//   old 1-7  = new 1-7   (5-7 are the hunk's leading context, 1-4 hidden)
//   old 8    → new 8, 9  ("-was 8", "+line 8", "+line 9")
//   old 9-11 = new 10-12 (hunk's trailing context; 13-20 hidden)
const source = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
const file: FileDiff = {
  path: "x.ts",
  status: "modified",
  binary: false,
  raw: "",
  hunks: [
    {
      oldStart: 5,
      oldLines: 7,
      newStart: 5,
      newLines: 8,
      header: "",
      lines: [
        " line 5",
        " line 6",
        " line 7",
        "-was 8",
        "+line 8",
        "+line 9",
        " line 10",
        " line 11",
        " line 12",
      ],
    },
  ],
};
const rows = flattenDiff(fullyExpanded(file, source));

function commentOn(a: number, b: number): Comment {
  const range = lineRangeComment(rows, "new", a, b)!;
  return {
    id: commentId(range.start, range.end),
    file: file.path,
    status: "open",
    messages: [],
    ...range,
  };
}

describe("lineKeyOf", () => {
  test("a changed line keeps its diff key", () => {
    expect(lineKeyOf(rows, "new", 8)).toEqual({ old: null, new: 8 });
  });

  test("a context line inside the hunk has both numbers", () => {
    expect(lineKeyOf(rows, "new", 10)).toEqual({ old: 9, new: 10 });
  });

  test("an unchanged line outside every hunk becomes a context row", () => {
    expect(lineKeyOf(rows, "new", 2)).toEqual({ old: 2, new: 2 });
    expect(lineKeyOf(rows, "new", 16)).toEqual({ old: 15, new: 16 });
  });

  test("a line past the end has no key", () => {
    expect(lineKeyOf(rows, "new", 21)).toBeNull();
  });
});

describe("lineRangeComment", () => {
  test("spans the other side's lines between its ends, in either order", () => {
    const range = lineRangeComment(rows, "new", 9, 7)!;
    expect(range.start).toEqual({ old: 7, new: 7 });
    expect(range.end).toEqual({ old: null, new: 9 });
    expect(range.anchorText).toEqual([" line 7", "-was 8", "+line 8", "+line 9"]);
  });

  test("a comment made in the File view relocates in the plain diff", () => {
    expect(relocateComment(file, commentOn(8, 8))).not.toBeNull();
  });
});

describe("anchorLine", () => {
  const expanded = fullyExpanded(file, source);

  test("sits under the last line of a normal range", () => {
    const loc = relocateComment(expanded, commentOn(6, 9))!;
    expect(anchorLine(rows, loc, "new")).toBe(9);
    expect(anchorLine(rows, loc, "old")).toBe(8);
  });

  test("a deleted-only range sits under the line before it", () => {
    // Old line 8 alone: no new-side line, so the thread goes under new line 7.
    const deleted: Comment = {
      id: "d",
      file: file.path,
      start: { old: 8, new: null },
      end: { old: 8, new: null },
      anchorText: ["-was 8"],
      status: "open",
      messages: [],
    };
    const loc = relocateComment(expanded, deleted)!;
    expect(anchorLine(rows, loc, "new")).toBe(7);
  });

  test("a range before every line of the side sits at the top", () => {
    const deletedFirst = flattenDiff({
      ...file,
      hunks: [{ oldStart: 1, oldLines: 1, newStart: 0, newLines: 0, header: "", lines: ["-gone"] }],
    });
    expect(anchorLine(deletedFirst, { lo: 0, hi: 0 }, "new")).toBe(0);
  });
});

describe("revealFor", () => {
  const expanded = fullyExpanded(file, source);

  test("a comment outside the hunks reveals its new-side lines", () => {
    const c = commentOn(2, 3);
    expect(relocateComment(file, c)).toBeNull();
    expect(revealFor(expanded, c)).toEqual({ start: 2, end: 3 });
  });

  test("a comment whose lines changed reveals nothing", () => {
    expect(revealFor(expanded, { ...commentOn(2, 3), anchorText: [" other", " text"] })).toBeNull();
  });
});

describe("planReveals", () => {
  const outside = commentOn(15, 16);
  const stale = { ...commentOn(2, 2), id: "stale", anchorText: [" changed"] };

  test("nothing is listed or revealed before the source arrives", () => {
    expect(planReveals(file, [outside, stale], null, [])).toEqual({ reveal: [], listed: [] });
  });

  test("reveals what relocates in the expanded diff and lists the rest", () => {
    expect(planReveals(file, [outside, stale], source, [])).toEqual({
      reveal: [{ start: 15, end: 16 }],
      listed: [stale],
    });
  });

  test("lists a comment whose lines are already revealed", () => {
    expect(planReveals(file, [outside], source, [{ start: 13, end: 20 }])).toEqual({
      reveal: [],
      listed: [outside],
    });
  });

  test("lists everything when the source failed to load", () => {
    expect(planReveals(file, [outside], "failed", [])).toEqual({ reveal: [], listed: [outside] });
  });
});

test("isCovered needs one range holding the whole span", () => {
  expect(isCovered([{ start: 1, end: 5 }], { start: 2, end: 5 })).toBe(true);
  expect(isCovered([{ start: 1, end: 3 }], { start: 2, end: 5 })).toBe(false);
});
