import { test, expect, describe } from "bun:test";
import { appendUserMessage, persistedIsAhead } from "./threadTranscript";
import type { StoredMessage } from "../shared/comments";

const user = (text: string): StoredMessage => ({ role: "user", text });
const assistant = (text: string): StoredMessage => ({ role: "assistant", text });

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
