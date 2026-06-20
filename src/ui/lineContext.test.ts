import { test, expect, describe } from "bun:test";
import {
  findHunkForLine,
  buildLineCommentContext,
  buildRangeCommentContext,
  collectRangeText,
  hunkText,
  relocateComment,
} from "./lineContext";
import type { FileDiff } from "./types";

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
      newLines: 3,
      header: " greet",
      lines: [
        " import x;", // context → old 1, new 1
        "-const a = 1;", // delete → old 2
        "+const a = 2;", // insert → new 2
        " export {};", // context → old 3, new 3
      ],
    },
  ],
};

describe("findHunkForLine", () => {
  test("context line resolves on both sides", () => {
    expect(findHunkForLine(file, "new", 1)?.lineText).toBe("import x;");
    expect(findHunkForLine(file, "old", 1)?.lineText).toBe("import x;");
    expect(findHunkForLine(file, "new", 3)?.lineText).toBe("export {};");
  });

  test("deleted line resolves on the old side only", () => {
    expect(findHunkForLine(file, "old", 2)?.lineText).toBe("const a = 1;");
    // new line 2 is the inserted line, not the deleted one
    expect(findHunkForLine(file, "new", 2)?.lineText).toBe("const a = 2;");
  });

  test("returns the containing hunk", () => {
    expect(findHunkForLine(file, "new", 2)?.hunk).toBe(file.hunks[0]!);
  });

  test("missing line returns null", () => {
    expect(findHunkForLine(file, "new", 99)).toBeNull();
    expect(findHunkForLine(file, "old", 99)).toBeNull();
  });
});

describe("hunkText", () => {
  test("reconstructs the @@ header line plus body", () => {
    expect(hunkText(file.hunks[0]!)).toBe(
      ["@@ -1,3 +1,3 @@ greet", " import x;", "-const a = 1;", "+const a = 2;", " export {};"].join(
        "\n",
      ),
    );
  });
});

describe("buildLineCommentContext", () => {
  test("includes path, the commented line, and the hunk", () => {
    const ctx = buildLineCommentContext(file, "new", 2);
    expect(ctx).toContain("File: greet.ts");
    expect(ctx).toContain("new line 2");
    expect(ctx).toContain("const a = 2;");
    expect(ctx).toContain("@@ -1,3 +1,3 @@ greet");
  });

  test("degrades gracefully when the line is not found", () => {
    const ctx = buildLineCommentContext(file, "new", 99);
    expect(ctx).toContain("not found");
  });
});

describe("collectRangeText", () => {
  test("collects new-side lines within the range", () => {
    expect(collectRangeText(file.hunks[0]!, "new", 1, 3)).toEqual([
      "import x;",
      "const a = 2;",
      "export {};",
    ]);
  });

  test("collects only old-side lines for the old side", () => {
    expect(collectRangeText(file.hunks[0]!, "old", 1, 2)).toEqual(["import x;", "const a = 1;"]);
  });
});

describe("buildRangeCommentContext", () => {
  test("labels a multi-line range and includes its lines", () => {
    const ctx = buildRangeCommentContext(file, "new", 1, 3);
    expect(ctx).toContain("new lines 1–3");
    expect(ctx).toContain("import x;");
    expect(ctx).toContain("export {};");
    expect(ctx).toContain("@@ -1,3 +1,3 @@ greet");
  });

  test("normalizes reversed bounds and single-line uses singular label", () => {
    expect(buildRangeCommentContext(file, "new", 3, 1)).toContain("new lines 1–3");
    expect(buildRangeCommentContext(file, "new", 2, 2)).toContain("new line 2");
  });
});

describe("relocateComment", () => {
  test("returns the range when the lines still match", () => {
    expect(
      relocateComment(file, {
        side: "new",
        startLine: 2,
        endLine: 3,
        anchorText: ["const a = 2;", "export {};"],
      }),
    ).toEqual({ side: "new", startLine: 2, endLine: 3 });
  });

  test("returns null (orphaned) when the line text changed", () => {
    expect(
      relocateComment(file, {
        side: "new",
        startLine: 2,
        endLine: 3,
        anchorText: ["const a = 999;", "export {};"],
      }),
    ).toBeNull();
  });

  test("returns null when the line no longer exists", () => {
    expect(
      relocateComment(file, { side: "new", startLine: 99, endLine: 99, anchorText: ["x"] }),
    ).toBeNull();
  });
});
