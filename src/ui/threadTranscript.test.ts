import { test, expect, describe } from "bun:test";
import { appendUserMessage, persistedIsAhead, splitPendingTail } from "./threadTranscript";
import type { StoredMessage } from "../shared/comments";

const user = (text: string): StoredMessage => ({ role: "user", text });
const assistant = (text: string): StoredMessage => ({ role: "assistant", text });

describe("splitPendingTail", () => {
  test("a single pending comment is the question; nothing earlier", () => {
    expect(splitPendingTail([user("why?")])).toEqual({ earlier: [], pending: "why?" });
  });

  test("several unanswered comments join into one question; answered history stays earlier", () => {
    const thread = [user("a"), assistant("A"), user(" b "), user("c")];
    expect(splitPendingTail(thread)).toEqual({
      earlier: [user("a"), assistant("A")],
      pending: "b\n\nc",
    });
  });

  test("a thread ending with the agent's reply has no pending tail", () => {
    const thread = [user("a"), assistant("A")];
    expect(splitPendingTail(thread)).toEqual({ earlier: thread, pending: "" });
    expect(splitPendingTail([])).toEqual({ earlier: [], pending: "" });
  });
});

describe("appendUserMessage", () => {
  test("appends the trimmed text", () => {
    expect(appendUserMessage([user("a")], "  b\n")).toEqual([user("a"), user("b")]);
  });

  test("blank input changes nothing, by identity", () => {
    const messages = [user("a")];
    expect(appendUserMessage(messages, "   ")).toBe(messages);
  });
});

describe("persistedIsAhead", () => {
  const base = [user("q"), assistant("a")];

  test("false when the two agree", () => {
    expect(persistedIsAhead(base, [user("q"), assistant("a")])).toBe(false);
    expect(persistedIsAhead([], [])).toBe(false);
  });

  test("true when the store gained a message (a batch reply landed)", () => {
    expect(persistedIsAhead([...base, assistant("batched")], base)).toBe(true);
  });

  test("false while the live list runs ahead — that write is on its way out", () => {
    expect(persistedIsAhead(base, [...base, user("just typed")])).toBe(false);
  });

  test("true when a shared message disagrees, however long each list is", () => {
    expect(persistedIsAhead([user("q"), assistant("other")], base)).toBe(true);
    expect(persistedIsAhead([user("q")], [assistant("q"), user("x")])).toBe(true);
  });
});
