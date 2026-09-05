import { test, expect, describe } from "bun:test";
import { fileMarks } from "./fileMarks";
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

describe("fileMarks (new side)", () => {
  test("a pure insertion marks its lines as added", () => {
    const file = fileOf([hunk(["@@ -1,2 +1,4 @@", " a", "+b", "+c", " d"].join("\n"))]);
    const marks = fileMarks(file, "new");
    expect([...marks.lines]).toEqual([
      [2, "add"],
      [3, "add"],
    ]);
    expect(marks.gaps.size).toBe(0);
  });

  test("a replaced block marks the new lines as modified", () => {
    const file = fileOf([hunk(["@@ -1,3 +1,3 @@", " a", "-old b", "+new b", " c"].join("\n"))]);
    const marks = fileMarks(file, "new");
    expect([...marks.lines]).toEqual([[2, "mod"]]);
    expect(marks.gaps.size).toBe(0);
  });

  test("a pure deletion becomes a gap before the following line", () => {
    const file = fileOf([hunk(["@@ -1,4 +1,2 @@", " a", "-b", "-c", " d"].join("\n"))]);
    const marks = fileMarks(file, "new");
    expect(marks.lines.size).toBe(0);
    expect([...marks.gaps]).toEqual([[2, 2]]);
  });

  test("a deletion at the end of the file is keyed one past the last line", () => {
    const file = fileOf([hunk(["@@ -1,3 +1,2 @@", " a", " b", "-c"].join("\n"))]);
    const marks = fileMarks(file, "new");
    expect([...marks.gaps]).toEqual([[3, 1]]);
  });

  test("blocks are separated by context and numbered per hunk", () => {
    const file = fileOf([
      hunk(["@@ -1,3 +1,4 @@", " a", "+b", " c", "-d", "+e", "+f"].join("\n")),
      hunk(["@@ -20,3 +21,2 @@", " x", "-y", " z"].join("\n")),
    ]);
    const marks = fileMarks(file, "new");
    expect([...marks.lines]).toEqual([
      [2, "add"],
      [4, "mod"],
      [5, "mod"],
    ]);
    expect([...marks.gaps]).toEqual([[22, 1]]);
  });

  test("binary files and empty diffs have no marks", () => {
    expect(fileMarks({ ...fileOf([]), binary: true }, "new").lines.size).toBe(0);
    expect(fileMarks(fileOf([]), "new").lines.size).toBe(0);
  });
});

describe("fileMarks (old side)", () => {
  test("a deleted file marks every line as deleted", () => {
    const file = fileOf([hunk(["@@ -1,3 +0,0 @@", "-a", "-b", "-c"].join("\n"))], "deleted");
    const marks = fileMarks(file, "old");
    expect([...marks.lines]).toEqual([
      [1, "del"],
      [2, "del"],
      [3, "del"],
    ]);
    expect(marks.gaps.size).toBe(0);
  });

  test("insertions become gaps and replacements modifications", () => {
    const file = fileOf([
      hunk(["@@ -1,3 +1,4 @@", " a", "+inserted", " b", "-c", "+c2"].join("\n")),
    ]);
    const marks = fileMarks(file, "old");
    expect([...marks.gaps]).toEqual([[2, 1]]);
    expect([...marks.lines]).toEqual([[3, "mod"]]);
  });
});
