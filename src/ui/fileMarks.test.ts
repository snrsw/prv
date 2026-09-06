import { test, expect, describe } from "bun:test";
import { describeBlock, fileMarks, type ChangeBlock } from "./fileMarks";
import type { FileDiff, Hunk } from "./types";

function hunk(text: string): Hunk {
  const [head, ...lines] = text.split("\n");
  const m = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@(.*)$/.exec(head!)!;
  return {
    oldStart: parseInt(m[1]!, 10),
    oldLines: parseInt(m[2]!, 10),
    newStart: parseInt(m[3]!, 10),
    newLines: parseInt(m[4]!, 10),
    header: m[5]!,
    lines,
  };
}

function fileOf(hunks: Hunk[], status: FileDiff["status"] = "modified"): FileDiff {
  return { path: "x.ts", status, binary: false, hunks, raw: "" };
}

const lineKinds = (m: ReturnType<typeof fileMarks>) =>
  [...m.lines].map(([ln, b]) => [ln, b.kind] as const);
const gapKeys = (m: ReturnType<typeof fileMarks>) => [...m.gaps.keys()];

describe("fileMarks (new side)", () => {
  test("a pure insertion marks its lines as added", () => {
    const file = fileOf([hunk(["@@ -1,2 +1,4 @@", " a", "+b", "+c", " d"].join("\n"))]);
    const marks = fileMarks(file, "new");
    expect(lineKinds(marks)).toEqual([
      [2, "add"],
      [3, "add"],
    ]);
    expect(marks.blocks).toEqual([{ kind: "add", start: 2, here: 2, other: 0 }]);
    expect(gapKeys(marks)).toEqual([]);
  });

  test("a replaced block marks the new lines as modified", () => {
    const file = fileOf([hunk(["@@ -1,3 +1,3 @@", " a", "-old b", "+new b", " c"].join("\n"))]);
    const marks = fileMarks(file, "new");
    expect(lineKinds(marks)).toEqual([[2, "mod"]]);
    expect(marks.blocks).toEqual([{ kind: "mod", start: 2, here: 1, other: 1 }]);
    expect(gapKeys(marks)).toEqual([]);
  });

  test("a replacement that shrank the file also marks the seam", () => {
    const file = fileOf([
      hunk(["@@ -1,5 +1,3 @@", " a", "-b", "-c", "-d", "+bcd", " e"].join("\n")),
    ]);
    const marks = fileMarks(file, "new");
    expect(lineKinds(marks)).toEqual([[2, "mod"]]);
    expect(gapKeys(marks)).toEqual([2]);
    expect(marks.gaps.get(2)).toEqual({ kind: "mod", start: 2, here: 1, other: 3 });
  });

  test("a pure deletion becomes a gap before the following line", () => {
    const file = fileOf([hunk(["@@ -1,4 +1,2 @@", " a", "-b", "-c", " d"].join("\n"))]);
    const marks = fileMarks(file, "new");
    expect(marks.lines.size).toBe(0);
    expect(marks.blocks).toEqual([{ kind: "gap", start: 2, here: 0, other: 2 }]);
    expect(gapKeys(marks)).toEqual([2]);
  });

  test("a deletion at the end of the file is keyed one past the last line", () => {
    const file = fileOf([hunk(["@@ -1,3 +1,2 @@", " a", " b", "-c"].join("\n"))]);
    const marks = fileMarks(file, "new");
    expect(gapKeys(marks)).toEqual([3]);
  });

  test("blocks are separated by context and numbered per hunk", () => {
    const file = fileOf([
      hunk(["@@ -1,3 +1,4 @@", " a", "+b", " c", "-d", "+e", "+f"].join("\n")),
      hunk(["@@ -20,3 +21,2 @@", " x", "-y", " z"].join("\n")),
    ]);
    const marks = fileMarks(file, "new");
    expect(lineKinds(marks)).toEqual([
      [2, "add"],
      [4, "mod"],
      [5, "mod"],
    ]);
    expect(marks.blocks.map((b) => b.kind)).toEqual(["add", "mod", "gap"]);
    expect(gapKeys(marks)).toEqual([22]);
  });

  test("binary files and empty diffs have no marks", () => {
    expect(fileMarks({ ...fileOf([]), binary: true }, "new").blocks).toEqual([]);
    expect(fileMarks(fileOf([]), "new").blocks).toEqual([]);
  });
});

describe("fileMarks (old side)", () => {
  test("a deleted file marks every line as deleted", () => {
    const file = fileOf([hunk(["@@ -1,3 +0,0 @@", "-a", "-b", "-c"].join("\n"))], "deleted");
    const marks = fileMarks(file, "old");
    expect(lineKinds(marks)).toEqual([
      [1, "del"],
      [2, "del"],
      [3, "del"],
    ]);
    expect(gapKeys(marks)).toEqual([]);
  });

  test("insertions become gaps and replacements modifications", () => {
    const file = fileOf([
      hunk(["@@ -1,3 +1,4 @@", " a", "+inserted", " b", "-c", "+c2"].join("\n")),
    ]);
    const marks = fileMarks(file, "old");
    expect(gapKeys(marks)).toEqual([2]);
    expect(lineKinds(marks)).toEqual([[3, "mod"]]);
  });
});

describe("describeBlock", () => {
  const block = (kind: ChangeBlock["kind"], here: number, other: number): ChangeBlock => ({
    kind,
    start: 1,
    here,
    other,
  });

  test("names what happened on the shown side", () => {
    expect(describeBlock(block("add", 1, 0), "new")).toBe("Added 1 line");
    expect(describeBlock(block("add", 3, 0), "new")).toBe("Added 3 lines");
    expect(describeBlock(block("del", 2, 0), "old")).toBe("Deleted 2 lines");
    expect(describeBlock(block("mod", 1, 3), "new")).toBe("Replaced 3 lines with 1");
    expect(describeBlock(block("mod", 3, 1), "old")).toBe("3 lines replaced by 1");
    expect(describeBlock(block("gap", 0, 2), "new")).toBe("2 lines removed here");
    expect(describeBlock(block("gap", 0, 1), "old")).toBe("1 line inserted here");
  });
});
