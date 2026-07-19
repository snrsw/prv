import { test, expect, describe } from "bun:test";
import { findingsToComments, resolveFindingFile } from "./transform";
import { relocateComment } from "../ui/lineContext";
import type { FileDiff } from "../diff/types";
import type { ReviewFinding } from "../shared/review";

// Same shape as the lineContext fixture:
//   gi 0  " import x;"     old1 new1
//   gi 1  "-const a = 1;"  old2
//   gi 2  "+const a = 2;"  new2
//   gi 3  "+const b = 3;"  new3
//   gi 4  " export {};"    old3 new4
const file: FileDiff = {
  path: "src/greet.ts",
  status: "modified",
  binary: false,
  raw: "",
  hunks: [
    {
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      header: "",
      lines: [" import x;", "-const a = 1;", "+const a = 2;", "+const b = 3;", " export {};"],
    },
  ],
};
const files = [file];

const finding = (over: Partial<ReviewFinding> = {}): ReviewFinding => ({
  file: "src/greet.ts",
  side: "new",
  startLine: 2,
  endLine: 2,
  severity: "major",
  title: "Suspicious constant",
  body: "This looks wrong because `a` changed meaning.",
  ...over,
});

const transform = (findings: ReviewFinding[]) =>
  findingsToComments({ findings, files, runId: "run1", lens: "correctness" });

describe("findingsToComments — anchoring", () => {
  test("a new-side finding anchors and relocates like a hand-made comment", () => {
    const [comment] = transform([finding()]).comments;
    expect(comment).toMatchObject({
      start: { old: null, new: 2 },
      end: { old: null, new: 2 },
      anchorText: ["+const a = 2;"],
    });
    const loc = relocateComment(file, comment!);
    expect(loc).not.toBeNull();
    expect([loc!.lo, loc!.hi]).toEqual([2, 2]);
  });

  test("an old-side finding anchors to the deleted line", () => {
    const [comment] = transform([finding({ side: "old", startLine: 2, endLine: 2 })]).comments;
    expect(comment).toMatchObject({
      start: { old: 2, new: null },
      anchorText: ["-const a = 1;"],
    });
    expect(relocateComment(file, comment!)).not.toBeNull();
  });

  test("a range spans mixed context and added rows", () => {
    const [comment] = transform([finding({ startLine: 2, endLine: 4 })]).comments;
    expect(comment?.anchorText).toEqual(["+const a = 2;", "+const b = 3;", " export {};"]);
  });

  test("a side-mismatched line falls back to the other side", () => {
    // side "old" but line 4 exists only on the new side.
    const [comment] = transform([finding({ side: "old", startLine: 4, endLine: 4 })]).comments;
    expect(comment?.start).toEqual({ old: 3, new: 4 });
  });

  test("one unresolvable endpoint degrades to a single-line anchor", () => {
    const [comment] = transform([finding({ startLine: 2, endLine: 99 })]).comments;
    expect(comment).toMatchObject({
      start: { old: null, new: 2 },
      end: { old: null, new: 2 },
    });
    expect(relocateComment(file, comment!)).not.toBeNull();
  });

  test("fully unresolvable lines fall back to a file-level comment", () => {
    const [comment] = transform([finding({ startLine: 90, endLine: 99 })]).comments;
    expect(comment).toMatchObject({
      file: "src/greet.ts",
      start: { old: null, new: null },
      end: { old: null, new: null },
      anchorText: [],
    });
    expect(relocateComment(file, comment!)).toBeNull(); // renders via the orphaned path
  });
});

describe("findingsToComments — files and metadata", () => {
  test("findings for files outside the diff are dropped and recorded", () => {
    const result = transform([finding({ file: "other.ts" }), finding()]);
    expect(result.comments).toHaveLength(1);
    expect(result.droppedFiles).toEqual(["other.ts"]);
  });

  test("ids are namespaced by run, lens, and index", () => {
    const result = transform([finding(), finding({ startLine: 3 })]);
    expect(result.comments.map((c) => c.id)).toEqual([
      "r:run1:correctness:0",
      "r:run1:correctness:1",
    ]);
  });

  test("the finding is stored as a bold-titled assistant message plus metadata", () => {
    const [comment] = transform([finding()]).comments;
    expect(comment?.messages).toEqual([
      {
        role: "assistant",
        text: "**Suspicious constant**\n\nThis looks wrong because `a` changed meaning.",
      },
    ]);
    expect(comment).toMatchObject({
      status: "open",
      source: "review",
      severity: "major",
      title: "Suspicious constant",
      lens: "correctness",
      runId: "run1",
    });
  });

  test("an empty body stores just the bold title", () => {
    const [comment] = transform([finding({ body: "" })]).comments;
    expect(comment?.messages[0]?.text).toBe("**Suspicious constant**");
  });
});

describe("resolveFindingFile", () => {
  const nested: FileDiff = { ...file, path: "src/utils/greet.ts" };

  test("tolerates ./, a/, b/, and absolute prefixes", () => {
    expect(resolveFindingFile(files, "./src/greet.ts")).toBe(file);
    expect(resolveFindingFile(files, "a/src/greet.ts")).toBe(file);
    expect(resolveFindingFile(files, "b/src/greet.ts")).toBe(file);
    expect(resolveFindingFile(files, "/home/me/repo/src/greet.ts")).toBe(file);
  });

  test("suffix ambiguity picks the longest diff path", () => {
    const both = [{ ...file, path: "greet.ts" }, nested];
    expect(resolveFindingFile(both, "/repo/src/utils/greet.ts")).toBe(nested);
  });

  test("unknown files stay unresolved", () => {
    expect(resolveFindingFile(files, "nope.ts")).toBeUndefined();
  });
});
