import { test, expect, describe } from "bun:test";
import {
  applyBatchResults,
  commentLocation,
  commentSummary,
  pendingComments,
  SUMMARY_MAX,
} from "./batchComments";
import type { BatchResult } from "../shared/batch";
import type { Comment, StoredMessage } from "../shared/comments";

const comment = (over: Partial<Comment> = {}): Comment => ({
  id: "c1",
  file: "a.ts",
  start: { old: null, new: 10 },
  end: { old: null, new: 10 },
  anchorText: ["+x"],
  status: "open",
  messages: [{ role: "user", text: "rename this" }],
  ...over,
});

const result = (over: Partial<BatchResult> = {}): BatchResult => ({
  id: "c1",
  file: "a.ts",
  reply: "done, renamed it",
  done: true,
  ...over,
});

describe("pendingComments", () => {
  test("keeps open threads whose last message is the user's", () => {
    const a = comment({ id: "a" });
    const answered = comment({
      id: "b",
      messages: [
        { role: "user", text: "q" },
        { role: "assistant", text: "a" },
      ],
    });
    const resolved = comment({ id: "c", status: "resolved" });
    expect(pendingComments([a, answered, resolved])).toEqual([a]);
  });

  test("a blank user message is not an ask", () => {
    expect(pendingComments([comment({ messages: [{ role: "user", text: "  " }] })])).toEqual([]);
  });
});

describe("applyBatchResults", () => {
  test("appends the reply and resolves the thread", () => {
    const [c] = applyBatchResults([comment()], [result()]);
    expect(c?.status).toBe("resolved");
    expect(c?.messages).toEqual([
      { role: "user", text: "rename this" },
      { role: "assistant", text: "done, renamed it" },
    ]);
  });

  test("a thread the agent left open keeps its status but gets the reply", () => {
    const [c] = applyBatchResults([comment()], [result({ done: false, reply: "not sure why" })]);
    expect(c?.status).toBe("open");
    expect(c?.messages.at(-1)).toEqual({ role: "assistant", text: "not sure why" });
  });

  test("an empty reply adds no message, but done still resolves", () => {
    const [c] = applyBatchResults([comment()], [result({ reply: "  " })]);
    expect(c?.messages).toHaveLength(1);
    expect(c?.status).toBe("resolved");
  });

  test("untouched comments keep their identity", () => {
    const mine = comment({ id: "c1" });
    const other = comment({ id: "c2" });
    const store = [mine, other];
    const next = applyBatchResults(store, [result()]);
    expect(next[1]).toBe(other);
    expect(next[0]).not.toBe(mine);
    // Nothing to change at all: the store itself comes back untouched.
    expect(applyBatchResults(store, [])).toBe(store);
    expect(applyBatchResults(store, [result({ id: "gone" })])[0]).toBe(mine);
  });

  test("ids are matched per file, so a collision across files is not crossed", () => {
    const a = comment({ id: "dup", file: "a.ts" });
    const b = comment({ id: "dup", file: "b.ts" });
    const next = applyBatchResults([a, b], [result({ id: "dup", file: "b.ts", reply: "fixed" })]);
    expect(next[0]).toBe(a);
    expect(next[1]?.messages.at(-1)).toEqual({ role: "assistant", text: "fixed" });
  });

  test("a result with no file falls back to matching on the id alone", () => {
    const next = applyBatchResults([comment()], [result({ file: "" })]);
    expect(next[0]?.status).toBe("resolved");
  });

  test("a result the store has no comment for is ignored", () => {
    const store = [comment()];
    expect(applyBatchResults(store, [result({ id: "ghost", file: "z.ts" })])).toEqual(store);
  });

  test("an already resolved thread is left alone when there is nothing to add", () => {
    const resolved = comment({ status: "resolved" });
    expect(applyBatchResults([resolved], [result({ reply: "" })])[0]).toBe(resolved);
  });
});

describe("commentLocation", () => {
  test("a single line, a range, and a file-level finding", () => {
    expect(commentLocation(comment())).toBe("a.ts:10");
    expect(commentLocation(comment({ end: { old: null, new: 14 } }))).toBe("a.ts:10-14");
    expect(
      commentLocation(comment({ start: { old: null, new: null }, end: { old: null, new: null } })),
    ).toBe("a.ts");
  });

  test("a deleted line falls back to its old-side number", () => {
    const deleted = comment({ start: { old: 4, new: null }, end: { old: 4, new: null } });
    expect(commentLocation(deleted)).toBe("a.ts:4");
  });
});

describe("commentSummary", () => {
  test("shows the first line of the last user message", () => {
    const messages: StoredMessage[] = [
      { role: "user", text: "first" },
      { role: "assistant", text: "an answer" },
      { role: "user", text: "  second\nmore detail" },
    ];
    expect(commentSummary(comment({ messages }))).toBe("second");
  });

  test("clips a long line and says so", () => {
    const text = "x".repeat(SUMMARY_MAX + 20);
    const summary = commentSummary(comment({ messages: [{ role: "user", text }] }));
    expect(summary).toHaveLength(SUMMARY_MAX);
    expect(summary.endsWith("…")).toBe(true);
  });

  test("a thread with no user message summarizes as empty", () => {
    expect(commentSummary(comment({ messages: [{ role: "assistant", text: "hi" }] }))).toBe("");
  });
});
