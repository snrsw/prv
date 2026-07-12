import { test, expect, describe } from "bun:test";
import { appendChunk, stripToolMessages, type ChatMessage } from "./useDiffChat";

describe("appendChunk", () => {
  test("starts a new assistant message when there is none", () => {
    expect(appendChunk([], "hi")).toEqual([{ role: "assistant", text: "hi" }]);
  });

  test("concatenates onto a trailing assistant message", () => {
    expect(appendChunk([{ role: "assistant", text: "a" }], "b")).toEqual([
      { role: "assistant", text: "ab" },
    ]);
  });

  test("does not append onto a user message", () => {
    expect(appendChunk([{ role: "user", text: "q" }], "x")).toEqual([
      { role: "user", text: "q" },
      { role: "assistant", text: "x" },
    ]);
  });

  test("text after a tool line starts a fresh assistant message (not dropped)", () => {
    const before: ChatMessage[] = [{ role: "tool", name: "Edit" }];
    expect(appendChunk(before, "x")).toEqual([
      { role: "tool", name: "Edit" },
      { role: "assistant", text: "x" },
    ]);
  });
});

describe("stripToolMessages", () => {
  test("removes tool entries and preserves user/assistant order", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "q" },
      { role: "tool", name: "Read", target: "a.ts" },
      { role: "assistant", text: "done" },
      { role: "tool", name: "Edit", target: "a.ts" },
    ];
    expect(stripToolMessages(messages)).toEqual([
      { role: "user", text: "q" },
      { role: "assistant", text: "done" },
    ]);
  });

  test("is a no-op when there are no tool entries", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "q" },
      { role: "assistant", text: "a" },
    ];
    expect(stripToolMessages(messages)).toEqual([
      { role: "user", text: "q" },
      { role: "assistant", text: "a" },
    ]);
  });
});
