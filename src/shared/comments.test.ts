import { test, expect, describe } from "bun:test";
import { isPendingComment } from "./comments";
import type { Comment, StoredMessage } from "./comments";

const comment = (over: Partial<Comment> = {}): Comment => ({
  id: "c:2_2:2_2",
  file: "a.ts",
  start: { old: 2, new: 2 },
  end: { old: 2, new: 2 },
  anchorText: [" two"],
  status: "open",
  messages: [{ role: "user", text: "rename this" }],
  ...over,
});

const messages = (...pairs: [StoredMessage["role"], string][]): StoredMessage[] =>
  pairs.map(([role, text]) => ({ role, text }));

describe("isPendingComment", () => {
  test("an open thread whose last message is the user's is pending", () => {
    expect(isPendingComment(comment())).toBe(true);
    expect(
      isPendingComment(
        comment({ messages: messages(["assistant", "finding"], ["user", "fix it"]) }),
      ),
    ).toBe(true);
  });

  test("a thread the agent already answered is not pending", () => {
    expect(
      isPendingComment(comment({ messages: messages(["user", "fix it"], ["assistant", "done"]) })),
    ).toBe(false);
  });

  test("a resolved thread is never pending, whatever its last message", () => {
    expect(isPendingComment(comment({ status: "resolved" }))).toBe(false);
  });

  test("an empty or whitespace-only last user message is not pending", () => {
    expect(isPendingComment(comment({ messages: messages(["user", "   "]) }))).toBe(false);
    expect(isPendingComment(comment({ messages: [] }))).toBe(false);
  });
});
