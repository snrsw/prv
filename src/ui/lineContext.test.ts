import { test, expect, describe } from "bun:test";
import {
  flattenDiff,
  lineMaps,
  keyGi,
  keyOfRow,
  anchorTextOf,
  commentId,
  relocateComment,
  rangeLabel,
  buildCommentContext,
} from "./lineContext";
import type { FileDiff } from "./types";
import type { Comment } from "../shared/comments";

// A hunk mixing context, a deletion, and additions:
//   gi 0  " import x;"     old1 new1
//   gi 1  "-const a = 1;"  old2
//   gi 2  "+const a = 2;"  new2
//   gi 3  "+const b = 3;"  new3
//   gi 4  " export {};"    old3 new4
const file: FileDiff = {
  path: "greet.ts",
  status: "modified",
  binary: false,
  raw: "",
  hunks: [
    {
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      header: " greet",
      lines: [" import x;", "-const a = 1;", "+const a = 2;", "+const b = 3;", " export {};"],
    },
  ],
};

const rows = flattenDiff(file);

describe("flattenDiff", () => {
  test("assigns global indices and old/new numbers per marker", () => {
    expect(rows.map((r) => [r.gi, r.marker, r.old, r.new])).toEqual([
      [0, " ", 1, 1],
      [1, "-", 2, null],
      [2, "+", null, 2],
      [3, "+", null, 3],
      [4, " ", 3, 4],
    ]);
  });
});

describe("lineMaps + keyGi", () => {
  const maps = lineMaps(rows);
  test("new and old numbers resolve to the right global index", () => {
    expect(keyGi(maps, { old: null, new: 2 })).toBe(2); // added line
    expect(keyGi(maps, { old: 2, new: null })).toBe(1); // deleted line
    expect(keyGi(maps, { old: 1, new: 1 })).toBe(0); // context, prefers new
    expect(keyGi(maps, { old: 99, new: null })).toBeNull();
  });
});

describe("relocateComment", () => {
  const mixed: Comment = {
    id: "x",
    file: "greet.ts",
    start: keyOfRow(rows[1]!), // deleted line
    end: keyOfRow(rows[3]!), // second added line
    anchorText: anchorTextOf(rows.slice(1, 4)),
    status: "open",
    messages: [],
  };

  test("locates a range spanning deleted and added lines", () => {
    const loc = relocateComment(file, mixed);
    expect(loc).not.toBeNull();
    expect([loc!.lo, loc!.hi]).toEqual([1, 3]);
    expect(loc!.last).toEqual({ side: "new", line: 3 });
    expect(loc!.slice.map((r) => r.marker)).toEqual(["-", "+", "+"]);
  });

  test("orphans when the line text changed", () => {
    expect(relocateComment(file, { ...mixed, anchorText: ["-const a = 9;"] })).toBeNull();
  });

  test("orphans when an endpoint no longer exists", () => {
    expect(relocateComment(file, { ...mixed, end: { old: null, new: 999 } })).toBeNull();
  });
});

describe("rangeLabel + context + id", () => {
  test("label uses new-side numbers when present", () => {
    expect(rangeLabel(rows.slice(1, 4))).toBe("2–3"); // added lines new 2..3
    expect(rangeLabel([rows[1]!])).toBe("old 2"); // deletion-only → old label
  });

  test("context lists the selected diff lines with markers", () => {
    const ctx = buildCommentContext(file, rows.slice(1, 4));
    expect(ctx).toContain("File: greet.ts");
    expect(ctx).toContain("-const a = 1;");
    expect(ctx).toContain("+const b = 3;");
  });

  test("id is stable for the same endpoints", () => {
    expect(commentId(keyOfRow(rows[1]!), keyOfRow(rows[3]!))).toBe(
      commentId({ old: 2, new: null }, { old: null, new: 3 }),
    );
  });
});
