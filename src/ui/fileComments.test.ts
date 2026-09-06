import { describe, expect, test } from "bun:test";
import {
  buildFileContext,
  fileAnchorText,
  fileLineKey,
  fileRangeComment,
  fileRangeLabel,
  indexFile,
  placeInFile,
} from "./fileComments";
import { anchorTextOf, commentId, flattenDiff, keyOfRow, relocateComment } from "./lineContext";
import type { FileDiff } from "./types";
import type { Comment } from "../shared/comments";

// old: a b c d e f g h i j      new: a b c e F g h i j
// d (old 4) was deleted, f (old 6) replaced by F (new 5); j (old 10 / new 9)
// is outside the hunk's context.
const file: FileDiff = {
  path: "x.txt",
  status: "modified",
  binary: false,
  raw: "",
  hunks: [
    {
      oldStart: 1,
      oldLines: 9,
      newStart: 1,
      newLines: 8,
      header: "",
      lines: [" a", " b", " c", "-d", " e", "-f", "+F", " g", " h", " i"],
    },
  ],
};
const newLines = ["a", "b", "c", "e", "F", "g", "h", "i", "j"];
const index = indexFile(file, "new", newLines);

describe("fileLineKey", () => {
  test("maps both numbers where the diff can, inside and outside hunks", () => {
    expect(fileLineKey(index, 1)).toEqual({ old: 1, new: 1 });
    expect(fileLineKey(index, 4)).toEqual({ old: 5, new: 4 }); // e, after the deleted d
    expect(fileLineKey(index, 5)).toEqual({ old: null, new: 5 }); // F, added
    expect(fileLineKey(index, 9)).toEqual({ old: 10, new: 9 }); // j, past the hunk
  });

  test("a file the diff left whole keys each line to itself", () => {
    const whole = indexFile({ ...file, hunks: [] }, "new", ["a", "b"]);
    expect(fileLineKey(whole, 2)).toEqual({ old: 2, new: 2 });
    expect(fileAnchorText(whole, { lo: 1, hi: 2 })).toEqual([" a", " b"]);
  });

  test("the old side of a deleted file has only old numbers", () => {
    const deleted: FileDiff = {
      path: "gone.txt",
      status: "deleted",
      binary: false,
      raw: "",
      hunks: [
        { oldStart: 1, oldLines: 2, newStart: 0, newLines: 0, header: "", lines: ["-a", "-b"] },
      ],
    };
    const old = indexFile(deleted, "old", ["a", "b"]);
    expect(fileLineKey(old, 2)).toEqual({ old: 2, new: null });
    expect(fileAnchorText(old, { lo: 1, hi: 2 })).toEqual(["-a", "-b"]);
  });
});

describe("fileRangeComment", () => {
  test("is the comment a Diff-view drag over the same rows makes", () => {
    // New lines 4–5 (e, F) span the deleted f in the diff, like a drag would.
    const rows = flattenDiff(file);
    const lo = rows.findIndex((r) => r.new === 4);
    const hi = rows.findIndex((r) => r.new === 5);
    const fromDiff = {
      id: commentId(keyOfRow(rows[lo]!), keyOfRow(rows[hi]!)),
      start: keyOfRow(rows[lo]!),
      end: keyOfRow(rows[hi]!),
      anchorText: anchorTextOf(rows.slice(lo, hi + 1)),
    };
    const fromFile = fileRangeComment(index, "x.txt", 5, 4);
    expect(fromFile).toMatchObject(fromDiff);
    expect(fromFile.anchorText).toEqual([" e", "-f", "+F"]);
    expect(fromFile.status).toBe("open");
    expect(relocateComment(file, fromFile)).not.toBeNull();
  });

  test("outside the hunk it anchors as context, relocating once that context is revealed", () => {
    const c = fileRangeComment(index, "x.txt", 9, 9);
    expect(c.start).toEqual({ old: 10, new: 9 });
    expect(c.anchorText).toEqual([" j"]);
    expect(relocateComment(file, c)).toBeNull();
    expect(placeInFile(index, c)).toEqual({ lo: 9, hi: 9 });
  });
});

describe("placeInFile", () => {
  const rows = flattenDiff(file);
  const commentOn = (giLo: number, giHi: number): Comment => ({
    id: "c",
    file: "x.txt",
    start: keyOfRow(rows[giLo]!),
    end: keyOfRow(rows[giHi]!),
    anchorText: anchorTextOf(rows.slice(giLo, giHi + 1)),
    status: "open",
    messages: [],
  });

  test("a Diff-view comment mixing removed and added lines lands on this side's lines", () => {
    // rows: a b c -d e -f +F g h i → gi 3 (-d) .. gi 6 (+F)
    expect(placeInFile(index, commentOn(3, 6))).toEqual({ lo: 4, hi: 5 });
  });

  test("a comment only on removed lines has nowhere to go on the new side", () => {
    expect(placeInFile(index, commentOn(3, 3))).toBeNull();
    expect(placeInFile(indexFile(file, "old", []), commentOn(3, 3))).toEqual({ lo: 4, hi: 4 });
  });

  test("file-level findings and changed text are not placed", () => {
    const fileLevel: Comment = {
      id: "f",
      file: "x.txt",
      start: { old: null, new: null },
      end: { old: null, new: null },
      anchorText: [],
      status: "open",
      messages: [],
    };
    expect(placeInFile(index, fileLevel)).toBeNull();
    const stale = { ...commentOn(0, 1), anchorText: [" a", " B"] };
    expect(placeInFile(index, stale)).toBeNull();
  });

  test("a comment on a file the diff left whole is checked against the text", () => {
    const whole = indexFile({ ...file, hunks: [] }, "new", ["a", "b", "c"]);
    const c = fileRangeComment(whole, "x.txt", 2, 3);
    expect(placeInFile(whole, c)).toEqual({ lo: 2, hi: 3 });
    expect(placeInFile(whole, { ...c, anchorText: [" b", " X"] })).toBeNull();
    expect(placeInFile(indexFile({ ...file, hunks: [] }, "new", ["a"]), c)).toBeNull();
  });
});

describe("fileRangeLabel", () => {
  test("matches the Diff view's labels", () => {
    expect(fileRangeLabel("new", { lo: 12, hi: 12 })).toBe("12");
    expect(fileRangeLabel("new", { lo: 10, hi: 14 })).toBe("10–14");
    expect(fileRangeLabel("old", { lo: 3, hi: 4 })).toBe("old 3–4");
  });
});

describe("buildFileContext", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);

  test("marks the selection inside a numbered window of surrounding lines", () => {
    const ctx = buildFileContext("src/a.ts", lines, { lo: 15, hi: 16 });
    const body = ctx.split("\n");
    expect(body[0]).toBe("File: src/a.ts");
    expect(body[1]).toContain("lines 15–16 of the file");
    expect(body[2]).toBe("");
    // 10 lines before, the 2 selected, 10 after.
    expect(body.slice(3)).toHaveLength(22);
    expect(body[3]).toBe("   5 | line 5");
    expect(body[13]).toBe("> 15 | line 15");
    expect(body[14]).toBe("> 16 | line 16");
    expect(body[15]).toBe("  17 | line 17");
    expect(body.at(-1)).toBe("  26 | line 26");
  });

  test("clips the window to the file and names the old side", () => {
    const ctx = buildFileContext("a.ts", lines, { lo: 1, hi: 1 }, "old");
    const body = ctx.split("\n");
    expect(body[1]).toContain("line 1 of the old version of the file");
    expect(body[3]).toBe(">  1 | line 1");
    expect(body.slice(3)).toHaveLength(11);
    expect(buildFileContext("a.ts", lines, { lo: 30, hi: 30 }).split("\n").at(-1)).toBe(
      "> 30 | line 30",
    );
  });
});
