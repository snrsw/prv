import { describe, expect, test } from "bun:test";
import type { Comment } from "../shared/comments";
import { documentOrder, nextCommentTarget } from "./commentNav";

describe("nextCommentTarget", () => {
  const ordered = ["a", "b", "c"];

  test("steps forward and backward", () => {
    expect(nextCommentTarget(ordered, "a", 1)).toBe("b");
    expect(nextCommentTarget(ordered, "b", -1)).toBe("a");
  });

  test("wraps around at both ends", () => {
    expect(nextCommentTarget(ordered, "c", 1)).toBe("a");
    expect(nextCommentTarget(ordered, "a", -1)).toBe("c");
  });

  test("starts at the first (next) or last (previous) without a current finding", () => {
    expect(nextCommentTarget(ordered, null, 1)).toBe("a");
    expect(nextCommentTarget(ordered, null, -1)).toBe("c");
  });

  test("treats a current id that is gone like no current id", () => {
    expect(nextCommentTarget(ordered, "resolved", 1)).toBe("a");
    expect(nextCommentTarget(ordered, "resolved", -1)).toBe("c");
  });

  test("is null with nothing to visit", () => {
    expect(nextCommentTarget([], null, 1)).toBeNull();
    expect(nextCommentTarget([], "a", -1)).toBeNull();
  });

  test("a single finding always targets itself", () => {
    expect(nextCommentTarget(["only"], "only", 1)).toBe("only");
    expect(nextCommentTarget(["only"], "only", -1)).toBe("only");
  });
});

function finding(id: string, file: string, line: number | null): Comment {
  const key = { old: null, new: line };
  return {
    id,
    file,
    start: key,
    end: key,
    anchorText: line === null ? [] : ["+x"],
    status: "open",
    messages: [],
    source: "review",
    severity: "info",
  };
}

describe("documentOrder", () => {
  const candidates = [
    finding("b2", "b.ts", 20),
    finding("a1", "a.ts", 5),
    finding("b1", "b.ts", 3),
    finding("bf", "b.ts", null),
    finding("c1", "c.ts", 1),
  ];

  test("follows the card order, then DOM order inside a rendered card", () => {
    // b.ts is rendered with b2 relocated above b1; a.ts and c.ts are collapsed.
    const order = documentOrder(["a.ts", "b.ts", "c.ts"], candidates, ["b2", "b1", "bf"]);
    expect(order).toEqual(["a1", "b2", "b1", "bf", "c1"]);
  });

  test("orders unrendered threads by line with file-level ones last", () => {
    expect(documentOrder(["b.ts"], candidates, [])).toEqual(["b1", "b2", "bf"]);
  });

  test("ignores DOM ids that are not candidates and never repeats an id", () => {
    const order = documentOrder(["a.ts", "b.ts"], candidates, ["hand", "b1", "b1", "a1"]);
    expect(order).toEqual(["a1", "b1", "b2", "bf"]);
  });

  test("skips files that are not in the diff", () => {
    expect(documentOrder(["a.ts"], candidates, ["c1"])).toEqual(["a1"]);
  });
});
