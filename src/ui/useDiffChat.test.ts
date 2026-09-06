import { test, expect, describe } from "bun:test";
import {
  appendChunk,
  appendTool,
  appendProgress,
  applyFrame,
  dropEmptyAssistants,
  stopTurn,
  stripEphemeral,
  dropEmptyPlaceholder,
  type ChatMessage,
} from "./useDiffChat";
import type { ChatServerFrame } from "../shared/chat";

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

  test("a new answer bubble demotes the prior answer to progress narration", () => {
    const before: ChatMessage[] = [
      { role: "assistant", text: "I'll read it" },
      { role: "tool", name: "Read", target: "a.ts" },
    ];
    expect(appendChunk(before, "the answer")).toEqual([
      { role: "progress", text: "I'll read it" },
      { role: "tool", name: "Read", target: "a.ts" },
      { role: "assistant", text: "the answer" },
    ]);
  });

  test("standalone-preamble turn ends with one answer bubble, preamble muted", () => {
    // Pattern the agent actually produces: a text-only preamble message, THEN
    // the tool, THEN the answer — the preamble must not stay a second answer.
    let msgs: ChatMessage[] = [
      { role: "user", text: "q" },
      { role: "assistant", text: "" },
    ];
    msgs = appendChunk(msgs, "I'll read it"); // fills the placeholder
    msgs = appendTool(msgs, { name: "Read", target: "a.ts" });
    msgs = appendChunk(msgs, "the answer"); // new bubble → demotes preamble
    expect(msgs).toEqual([
      { role: "user", text: "q" },
      { role: "progress", text: "I'll read it" },
      { role: "tool", name: "Read", target: "a.ts" },
      { role: "assistant", text: "the answer" },
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

  test("drops the empty assistant placeholder of a turn that never completed", () => {
    // send() seeds [user, assistant("")]; with no `done` frame the placeholder
    // is still there when the store is written — it must not be persisted.
    const messages: ChatMessage[] = [
      { role: "user", text: "q" },
      { role: "tool", name: "Read", target: "a.ts" },
      { role: "assistant", text: "" },
    ];
    expect(stripEphemeral(messages)).toEqual([{ role: "user", text: "q" }]);
  });
});

describe("dropEmptyAssistants", () => {
  test("heals a persisted transcript holding empty assistant bubbles", () => {
    const stored: ChatMessage[] = [
      { role: "user", text: "q1" },
      { role: "assistant", text: "" },
      { role: "user", text: "q2" },
      { role: "assistant", text: "a2" },
    ];
    expect(dropEmptyAssistants(stored)).toEqual([
      { role: "user", text: "q1" },
      { role: "user", text: "q2" },
      { role: "assistant", text: "a2" },
    ]);
  });

  test("keeps an empty user message (only assistant placeholders are ephemeral)", () => {
    const messages: ChatMessage[] = [{ role: "user", text: "" }];
    expect(dropEmptyAssistants(messages)).toEqual(messages);
  });
});

describe("applyFrame", () => {
  const sent: ChatMessage[] = [
    { role: "user", text: "q" },
    { role: "assistant", text: "" },
  ];
  const reduceAll = (frames: ChatServerFrame[], from: ChatMessage[] = sent) =>
    frames.reduce(applyFrame, from);

  test("a full turn persists exactly the question and the answer, once", () => {
    // Each state produced by the reducer is what the persist effect sees; the
    // persisted view must stay free of activity lines and the placeholder.
    const states: ChatMessage[][] = [sent];
    const frames: ChatServerFrame[] = [
      { type: "session", sessionId: "s1" },
      { type: "progress", text: "I'll read it" },
      { type: "tool", name: "Read", target: "a.ts" },
      { type: "chunk", text: "the " },
      { type: "chunk", text: "answer" },
      { type: "done" },
    ];
    for (const frame of frames) states.push(applyFrame(states.at(-1)!, frame));
    const persisted = states.map(stripEphemeral);
    expect(persisted[0]).toEqual([{ role: "user", text: "q" }]);
    expect(persisted.at(-1)).toEqual([
      { role: "user", text: "q" },
      { role: "assistant", text: "the answer" },
    ]);
    for (const p of persisted)
      expect(p.some((m) => m.role === "assistant" && m.text === "")).toBe(false);
  });

  test("a turn without done never persists an empty assistant", () => {
    const hung = reduceAll([
      { type: "session", sessionId: "s1" },
      { type: "tool", name: "Read", target: "a.ts" },
    ]);
    expect(hung.at(-1)).toEqual({ role: "assistant", text: "" }); // still "thinking…"
    expect(stripEphemeral(hung)).toEqual([{ role: "user", text: "q" }]);
  });

  test("session and busy frames leave the transcript untouched", () => {
    expect(applyFrame(sent, { type: "session", sessionId: "s1" })).toBe(sent);
  });

  test("a busy reply surfaces as an answer so the turn does not hang", () => {
    const next = applyFrame(sent, { type: "busy" });
    expect(next.at(-1)?.role).toBe("assistant");
    expect((next.at(-1) as { text: string }).text).toContain("busy");
  });

  test("an error fills the placeholder with a warning", () => {
    expect(reduceAll([{ type: "error", message: "boom" }])).toEqual([
      { role: "user", text: "q" },
      { role: "assistant", text: "⚠ boom" },
    ]);
  });
});

describe("stopTurn", () => {
  test("drops the placeholder and leaves a muted stopped line", () => {
    const stopped = stopTurn([
      { role: "user", text: "q" },
      { role: "tool", name: "Read", target: "a.ts" },
      { role: "assistant", text: "" },
    ]);
    expect(stopped).toEqual([
      { role: "user", text: "q" },
      { role: "tool", name: "Read", target: "a.ts" },
      { role: "progress", text: "stopped" },
    ]);
    // Nothing of the aborted turn but the question reaches the store.
    expect(stripEphemeral(stopped)).toEqual([{ role: "user", text: "q" }]);
  });

  test("keeps a partial answer that had already streamed", () => {
    const stopped = stopTurn([
      { role: "user", text: "q" },
      { role: "assistant", text: "half an" },
    ]);
    expect(stopped).toEqual([
      { role: "user", text: "q" },
      { role: "assistant", text: "half an" },
      { role: "progress", text: "stopped" },
    ]);
  });
});
