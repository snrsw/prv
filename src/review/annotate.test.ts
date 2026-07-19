import { test, expect, describe } from "bun:test";
import { annotateDiff, annotateFile } from "./annotate";
import type { FileDiff } from "../diff/types";

const file: FileDiff = {
  path: "greet.ts",
  status: "modified",
  binary: false,
  raw: "",
  hunks: [
    {
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2,
      header: "",
      lines: [" import x;", "-const a = 1;", "+const a = 2;"],
    },
    {
      oldStart: 10,
      oldLines: 1,
      newStart: 10,
      newLines: 2,
      header: "",
      lines: [" export {};", "+export default a;"],
    },
  ],
};

const binary: FileDiff = { path: "img.png", status: "added", binary: true, raw: "", hunks: [] };

describe("annotateFile", () => {
  const text = annotateFile(file);
  const lines = text.split("\n");

  test("starts with a path + status header", () => {
    expect(lines[0]).toBe("### greet.ts (modified)");
  });

  test("context lines carry both numbers, added/deleted only one", () => {
    expect(lines[1]).toBe("1\t1\t import x;");
    expect(lines[2]).toBe("2\t\t-const a = 1;");
    expect(lines[3]).toBe("\t2\t+const a = 2;");
  });

  test("a second hunk shows up as a plain line-number jump", () => {
    expect(lines[4]).toBe("10\t10\t export {};");
    expect(lines[5]).toBe("\t11\t+export default a;");
    expect(lines).toHaveLength(6);
  });

  test("binary and hunkless files produce nothing", () => {
    expect(annotateFile(binary)).toBe("");
    expect(annotateFile({ ...file, hunks: [] })).toBe("");
  });
});

describe("annotateDiff", () => {
  test("joins annotatable files with blank lines, skipping binary ones", () => {
    const text = annotateDiff([file, binary, { ...file, path: "b.ts" }]);
    expect(text).toContain("### greet.ts (modified)");
    expect(text).toContain("\n\n### b.ts (modified)");
    expect(text).not.toContain("img.png");
  });

  test("empty input yields an empty string", () => {
    expect(annotateDiff([])).toBe("");
    expect(annotateDiff([binary])).toBe("");
  });
});
