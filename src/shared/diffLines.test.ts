import { test, expect, describe } from "bun:test";
import { flattenDiff, lineMaps, keyGi, rangeLabelOfComment } from "./diffLines";
import type { FileDiff } from "../diff/types";
import type { LineKey } from "./comments";

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

describe("rangeLabelOfComment", () => {
  const range = (start: LineKey, end: LineKey) => rangeLabelOfComment({ start, end });

  test("uses new-side numbers when the range has any", () => {
    expect(range({ old: 2, new: 2 }, { old: 2, new: 2 })).toBe("2");
    expect(range({ old: 2, new: 2 }, { old: 4, new: 5 })).toBe("2-5");
    expect(range({ old: null, new: 11 }, { old: null, new: 11 })).toBe("11");
  });

  test("a deleted-only range falls back to the old side, labelled as such", () => {
    expect(range({ old: 7, new: null }, { old: 9, new: null })).toBe("old 7-9");
  });

  test("endpoints out of order still read low-to-high", () => {
    expect(range({ old: null, new: 9 }, { old: null, new: 3 })).toBe("3-9");
  });

  test("a file-level comment (no line numbers) has no label", () => {
    expect(range({ old: null, new: null }, { old: null, new: null })).toBe("");
  });
});
