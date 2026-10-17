import { describe, expect, test } from "bun:test";
import type { Comment } from "../shared/comments";
import {
  isOpenFinding,
  openCommentsByFile,
  openFindingsBySeverity,
  subtreeOpenCount,
  viewedCount,
} from "./progress";

function comment(over: Partial<Comment> & { file: string }): Comment {
  return {
    id: over.id ?? `${over.file}:${Math.random()}`,
    start: { old: null, new: 1 },
    end: { old: null, new: 1 },
    anchorText: ["+x"],
    status: "open",
    messages: [],
    ...over,
  };
}

describe("openCommentsByFile", () => {
  test("counts open comments per file, any source", () => {
    const byFile = openCommentsByFile([
      comment({ file: "a.ts" }),
      comment({ file: "a.ts", source: "review", severity: "major" }),
      comment({ file: "b.ts", status: "resolved" }),
      comment({ file: "c.ts" }),
    ]);
    expect(byFile).toEqual({ "a.ts": 2, "c.ts": 1 });
  });

  test("is empty without comments", () => {
    expect(openCommentsByFile([])).toEqual({});
  });
});

describe("viewedCount", () => {
  test("counts only the listed paths that are marked viewed", () => {
    const ui = {
      "a.ts": { viewed: true },
      "gone.ts": { viewed: true },
      "b.ts": { collapsed: true },
    };
    expect(viewedCount(["a.ts", "b.ts", "c.ts"], ui)).toBe(1);
    expect(viewedCount([], ui)).toBe(0);
  });
});

describe("subtreeOpenCount", () => {
  const byFile = { "src/ui/a.ts": 2, "src/ui/x/b.ts": 1, "src/uix/c.ts": 4, "top.ts": 1 };

  test("sums every file under the directory", () => {
    expect(subtreeOpenCount(byFile, "src/ui")).toBe(3);
    expect(subtreeOpenCount(byFile, "src")).toBe(7);
  });

  test("matches whole path segments only", () => {
    expect(subtreeOpenCount(byFile, "src/u")).toBe(0);
    expect(subtreeOpenCount(byFile, "src/ui/")).toBe(3);
  });
});

describe("openFindingsBySeverity", () => {
  test("counts open review comments, defaulting a missing severity to info", () => {
    const counts = openFindingsBySeverity([
      comment({ file: "a.ts", source: "review", severity: "critical" }),
      comment({ file: "a.ts", source: "review", severity: "critical", status: "resolved" }),
      comment({ file: "b.ts", source: "review", severity: "minor" }),
      comment({ file: "b.ts", source: "review" }),
      comment({ file: "b.ts", severity: "major" }), // hand-made: not a finding
    ]);
    expect(counts).toEqual({ critical: 1, minor: 1, info: 1 });
  });

  test("isOpenFinding needs both the review source and open status", () => {
    expect(isOpenFinding(comment({ file: "a", source: "review" }))).toBe(true);
    expect(isOpenFinding(comment({ file: "a", source: "review", status: "resolved" }))).toBe(false);
    expect(isOpenFinding(comment({ file: "a" }))).toBe(false);
  });
});
