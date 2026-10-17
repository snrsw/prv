import { test, expect, describe } from "bun:test";
import {
  EXPAND_STEP,
  addRange,
  expandFile,
  gapsOf,
  revealRange,
  splitLines,
  type Gap,
} from "./hunkExpand";
import type { FileDiff, Hunk } from "./types";

// A 60-line file changed in two places, each hunk carrying git's default three
// lines of context. Hidden gaps are new-side 1-8, 16-38 and 46-60.
const source = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`);

const RAW_HEAD =
  "diff --git a/x.ts b/x.ts\nindex 1111111..2222222 100644\n--- a/x.ts\n+++ b/x.ts\n";

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

function fileOf(hunks: Hunk[]): FileDiff {
  const raw =
    RAW_HEAD +
    hunks
      .map(
        (h) =>
          `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${h.header}\n` +
          h.lines.map((l) => l + "\n").join(""),
      )
      .join("");
  return { path: "x.ts", status: "modified", binary: false, hunks, raw };
}

// Same line count on both sides: old N is new N everywhere.
const hunkA = hunk(
  [
    "@@ -9,7 +9,7 @@ funcA",
    " line 9",
    " line 10",
    " line 11",
    "-was 12",
    "+line 12",
    " line 13",
    " line 14",
    " line 15",
  ].join("\n"),
);
const hunkB = hunk(
  [
    "@@ -39,7 +39,7 @@ funcB",
    " line 39",
    " line 40",
    " line 41",
    "-was 42",
    "+line 42",
    " line 43",
    " line 44",
    " line 45",
  ].join("\n"),
);
const twoHunks = fileOf([hunkA, hunkB]);

describe("gapsOf", () => {
  test("finds the leading, interior and trailing gaps", () => {
    expect(gapsOf(twoHunks.hunks, 60)).toEqual([
      { hunkIndex: 0, start: 1, end: 8 },
      { hunkIndex: 1, start: 16, end: 38 },
      { hunkIndex: 2, start: 46, end: 60 },
    ]);
  });

  test("has no leading gap when the first hunk starts at line 1", () => {
    const atTop = hunk(["@@ -1,3 +1,3 @@", "-was 1", "+line 1", " line 2", " line 3"].join("\n"));
    expect(gapsOf([atTop], 3)).toEqual([]);
  });

  test("has no trailing gap when the last hunk reaches the last line", () => {
    expect(gapsOf([hunkA], 15)).toEqual([{ hunkIndex: 0, start: 1, end: 8 }]);
  });

  // Before the file is fetched its length is unknown, so a trailing gap is
  // guessed from the hunk carrying a full three lines of trailing context.
  test("guesses an open-ended trailing gap when the file length is unknown", () => {
    expect(gapsOf(twoHunks.hunks, null)).toEqual([
      { hunkIndex: 0, start: 1, end: 8 },
      { hunkIndex: 1, start: 16, end: 38 },
      { hunkIndex: 2, start: 46, end: null },
    ]);
  });

  test("guesses no trailing gap when the last hunk ends short of full context", () => {
    const atEof = hunk(
      ["@@ -9,5 +9,5 @@", " line 9", " line 10", "-was 11", "+line 11", " line 12"].join("\n"),
    );
    expect(gapsOf([atEof], null)).toEqual([{ hunkIndex: 0, start: 1, end: 8 }]);
  });

  test("returns no gaps for a file with no hunks", () => {
    expect(gapsOf([], 10)).toEqual([]);
  });
});

describe("revealRange", () => {
  const interior: Gap = { hunkIndex: 1, start: 16, end: 38 };
  const trailing: Gap = { hunkIndex: 2, start: 46, end: null };

  test("up reveals the last step of lines, next to the hunk below", () => {
    expect(revealRange(interior, "up")).toEqual({ start: 38 - EXPAND_STEP + 1, end: 38 });
  });

  test("down reveals the first step of lines, next to the hunk above", () => {
    expect(revealRange(interior, "down")).toEqual({ start: 16, end: 16 + EXPAND_STEP - 1 });
  });

  test("all reveals the whole gap", () => {
    expect(revealRange(interior, "all")).toEqual({ start: 16, end: 38 });
  });

  test("never reveals past the gap's own edges", () => {
    const small: Gap = { hunkIndex: 0, start: 1, end: 8 };
    expect(revealRange(small, "up")).toEqual({ start: 1, end: 8 });
    expect(revealRange(small, "down")).toEqual({ start: 1, end: 8 });
  });

  test("steps down into an open-ended trailing gap, but cannot step up or reveal all", () => {
    expect(revealRange(trailing, "down")).toEqual({ start: 46, end: 46 + EXPAND_STEP - 1 });
    expect(revealRange(trailing, "up")).toBeNull();
    expect(revealRange(trailing, "all")).toBeNull();
  });
});

describe("addRange", () => {
  test("keeps ranges sorted", () => {
    expect(addRange([{ start: 20, end: 25 }], { start: 1, end: 5 })).toEqual([
      { start: 1, end: 5 },
      { start: 20, end: 25 },
    ]);
  });

  test("merges touching and overlapping ranges", () => {
    const merged = addRange(
      [
        { start: 1, end: 5 },
        { start: 20, end: 25 },
      ],
      { start: 6, end: 19 },
    );
    expect(merged).toEqual([{ start: 1, end: 25 }]);
  });

  test("leaves the input untouched", () => {
    const before = [{ start: 1, end: 5 }];
    addRange(before, { start: 6, end: 9 });
    expect(before).toEqual([{ start: 1, end: 5 }]);
  });
});

describe("expandFile", () => {
  test("returns the file untouched when nothing is revealed", () => {
    expect(expandFile(twoHunks, source, [])).toBe(twoHunks);
  });

  test("grows a hunk upward with the revealed context lines", () => {
    const out = expandFile(twoHunks, source, [{ start: 6, end: 8 }]);
    expect(out.hunks).toHaveLength(2);
    const grown = out.hunks[0]!;
    expect(grown.lines.slice(0, 4)).toEqual([" line 6", " line 7", " line 8", " line 9"]);
    expect(grown).toMatchObject({ oldStart: 6, oldLines: 10, newStart: 6, newLines: 10 });
    expect(grown.header).toBe(" funcA");
  });

  test("grows a hunk downward and clamps the reveal to the end of the file", () => {
    const out = expandFile(twoHunks, source, [{ start: 46, end: 65 }]);
    const grown = out.hunks[1]!;
    expect(grown.lines.at(-1)).toBe(" line 60");
    expect(grown).toMatchObject({ oldStart: 39, oldLines: 22, newStart: 39, newLines: 22 });
  });

  test("merges two hunks once the gap between them is fully revealed", () => {
    const out = expandFile(twoHunks, source, [{ start: 16, end: 38 }]);
    expect(out.hunks).toHaveLength(1);
    const merged = out.hunks[0]!;
    expect(merged).toMatchObject({ oldStart: 9, oldLines: 37, newStart: 9, newLines: 37 });
    expect(merged.lines).toHaveLength(39);
    expect(merged.header).toBe(" funcA");
    expect(merged.lines[8]).toBe(" line 16");
    expect(merged.lines[30]).toBe(" line 38");
  });

  test("keeps the gap split when only part of it is revealed at each edge", () => {
    const out = expandFile(twoHunks, source, [
      { start: 16, end: 18 },
      { start: 36, end: 38 },
    ]);
    expect(out.hunks).toHaveLength(2);
    expect(out.hunks[0]!.lines.at(-1)).toBe(" line 18");
    expect(out.hunks[1]!.lines[0]).toBe(" line 36");
    expect(out.hunks[1]!).toMatchObject({ newStart: 36, oldStart: 36 });
  });

  test("ignores reveals that fall inside a hunk", () => {
    const out = expandFile(twoHunks, source, [{ start: 10, end: 14 }]);
    expect(out.hunks).toEqual(twoHunks.hunks);
  });

  test("rebuilds raw so the rendered diff matches the hunks", () => {
    const out = expandFile(twoHunks, source, [{ start: 7, end: 8 }]);
    expect(out.raw).toBe(
      RAW_HEAD +
        "@@ -7,9 +7,9 @@ funcA\n" +
        [" line 7", " line 8"].map((l) => l + "\n").join("") +
        hunkA.lines.map((l) => l + "\n").join("") +
        `@@ -39,7 +39,7 @@ funcB\n` +
        hunkB.lines.map((l) => l + "\n").join(""),
    );
  });

  test("numbers revealed lines on the old side using the hunk's own offset", () => {
    // hunkC adds one line, so below it the old side runs one behind the new.
    const hunkC = hunk(
      [
        "@@ -9,6 +9,7 @@ funcC",
        " line 9",
        " line 10",
        " line 11",
        "+line 12",
        " line 13",
        " line 14",
        " line 15",
      ].join("\n"),
    );
    const hunkD = hunk(
      [
        "@@ -38,7 +39,7 @@ funcD",
        " line 39",
        " line 40",
        " line 41",
        "-was 42",
        "+line 42",
        " line 43",
        " line 44",
        " line 45",
      ].join("\n"),
    );
    const shifted = fileOf([hunkC, hunkD]);

    const below = expandFile(shifted, source, [{ start: 16, end: 18 }]);
    expect(below.hunks[0]!).toMatchObject({ oldStart: 9, oldLines: 9, newStart: 9, newLines: 10 });

    const above = expandFile(shifted, source, [{ start: 36, end: 38 }]);
    expect(above.hunks[1]!).toMatchObject({ oldStart: 35, newStart: 36 });
    expect(above.hunks[1]!.lines[0]).toBe(" line 36");
  });
});

describe("splitLines", () => {
  test("drops the empty tail of a file ending in a newline", () => {
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
  });

  test("keeps the last line of a file with no trailing newline", () => {
    expect(splitLines("a\nb")).toEqual(["a", "b"]);
  });

  test("treats an empty file as no lines", () => {
    expect(splitLines("")).toEqual([]);
  });
});
