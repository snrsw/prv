import { test, expect, describe } from "bun:test";
import {
  appendChunk,
  appendTool,
  appendProgress,
  stripEphemeral,
  dropEmptyPlaceholder,
  type ChatMessage,
} from "./useDiffChat";

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

describe("appendTool", () => {
  test("splices before the trailing empty assistant placeholder", () => {
    const before: ChatMessage[] = [
      { role: "user", text: "q" },
      { role: "assistant", text: "" },
    ];
    expect(appendTool(before, { name: "Read", target: "a.ts" })).toEqual([
      { role: "user", text: "q" },
      { role: "tool", name: "Read", target: "a.ts" },
      { role: "assistant", text: "" },
    ]);
  });

  test("appends after an assistant message that already has text", () => {
    const before: ChatMessage[] = [{ role: "assistant", text: "hi" }];
    expect(appendTool(before, { name: "Edit", target: "a.ts" })).toEqual([
      { role: "assistant", text: "hi" },
      { role: "tool", name: "Edit", target: "a.ts" },
    ]);
  });

  test("a tool-first turn leaves no stray empty assistant bubble", () => {
    // The sequence send() + a leading tool + streamed text produces a clean
    // transcript: user, tool, assistant(text) — no empty bubble stranded above.
    let msgs: ChatMessage[] = [
      { role: "user", text: "q" },
      { role: "assistant", text: "" },
    ];
    msgs = appendTool(msgs, { name: "Read", target: "a.ts" });
    msgs = appendChunk(msgs, "Done");
    expect(msgs).toEqual([
      { role: "user", text: "q" },
      { role: "tool", name: "Read", target: "a.ts" },
      { role: "assistant", text: "Done" },
    ]);
  });
});

describe("appendProgress", () => {
  test("splices before the trailing empty assistant placeholder", () => {
    const before: ChatMessage[] = [
      { role: "user", text: "q" },
      { role: "assistant", text: "" },
    ];
    expect(appendProgress(before, "I'll read the file")).toEqual([
      { role: "user", text: "q" },
      { role: "progress", text: "I'll read the file" },
      { role: "assistant", text: "" },
    ]);
  });

  test("a full turn keeps narration + tool out of the answer bubble", () => {
    // send seeds [user, assistant("")]; the agent narrates, reads, then answers.
    let msgs: ChatMessage[] = [
      { role: "user", text: "q" },
      { role: "assistant", text: "" },
    ];
    msgs = appendProgress(msgs, "I'll read the file");
    msgs = appendTool(msgs, { name: "Read", target: "a.ts" });
    msgs = appendChunk(msgs, "The answer");
    expect(msgs).toEqual([
      { role: "user", text: "q" },
      { role: "progress", text: "I'll read the file" },
      { role: "tool", name: "Read", target: "a.ts" },
      { role: "assistant", text: "The answer" },
    ]);
  });
});

describe("dropEmptyPlaceholder", () => {
  test("removes a trailing empty assistant", () => {
    expect(
      dropEmptyPlaceholder([
        { role: "user", text: "q" },
        { role: "progress", text: "working" },
        { role: "assistant", text: "" },
      ]),
    ).toEqual([
      { role: "user", text: "q" },
      { role: "progress", text: "working" },
    ]);
  });

  test("is a no-op when the last assistant has text", () => {
    const msgs: ChatMessage[] = [
      { role: "user", text: "q" },
      { role: "assistant", text: "done" },
    ];
    expect(dropEmptyPlaceholder(msgs)).toEqual(msgs);
  });
});

describe("stripEphemeral", () => {
  test("removes tool AND progress entries, preserving user/assistant order", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "q" },
      { role: "progress", text: "I'll read the file" },
      { role: "tool", name: "Read", target: "a.ts" },
      { role: "assistant", text: "done" },
      { role: "tool", name: "Edit", target: "a.ts" },
    ];
    expect(stripEphemeral(messages)).toEqual([
      { role: "user", text: "q" },
      { role: "assistant", text: "done" },
    ]);
  });

  test("is a no-op when there are no ephemeral entries", () => {
    const messages: ChatMessage[] = [
      { role: "user", text: "q" },
      { role: "assistant", text: "a" },
    ];
    expect(stripEphemeral(messages)).toEqual([
      { role: "user", text: "q" },
      { role: "assistant", text: "a" },
    ]);
  });
});
