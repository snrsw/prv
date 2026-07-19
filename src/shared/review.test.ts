import { test, expect, describe } from "bun:test";
import { isClearableReviewComment } from "./review";
import type { Comment } from "./comments";

const base: Comment = {
  id: "r:run1:correctness:0",
  file: "a.ts",
  start: { old: null, new: 1 },
  end: { old: null, new: 1 },
  anchorText: ["+x"],
  status: "open",
  messages: [{ role: "assistant", text: "**Bug**\n\nDetails." }],
  source: "review",
  severity: "major",
  title: "Bug",
  lens: "correctness",
  runId: "run1",
};

describe("isClearableReviewComment", () => {
  test("open review comment with only the finding message is clearable", () => {
    expect(isClearableReviewComment(base)).toBe(true);
  });

  test("a user reply protects the comment", () => {
    const replied = {
      ...base,
      messages: [...base.messages, { role: "user" as const, text: "why?" }],
    };
    expect(isClearableReviewComment(replied)).toBe(false);
  });

  test("resolved review comments are kept", () => {
    expect(isClearableReviewComment({ ...base, status: "resolved" })).toBe(false);
  });

  test("hand-made comments are never clearable", () => {
    const { source: _source, ...rest } = base;
    expect(isClearableReviewComment({ ...rest, id: "c:1_1:1_1" })).toBe(false);
  });
});
