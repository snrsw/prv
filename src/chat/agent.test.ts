import { test, expect, describe } from "bun:test";
import { buildPrompt, parseEvent } from "./agent";

describe("buildPrompt", () => {
  test("first turn embeds the diff and the question", () => {
    const prompt = buildPrompt({
      diff: "diff --git a/x b/x\n+hello",
      question: "what changed?",
      isFirstTurn: true,
    });
    expect(prompt).toContain("<diff>");
    expect(prompt).toContain("diff --git a/x b/x");
    expect(prompt).toContain("Question: what changed?");
    expect(prompt).toContain("read-only");
  });

  test("later turns send only the question (diff carried by --resume)", () => {
    const prompt = buildPrompt({
      diff: "diff --git a/x b/x\n+hello",
      question: "and which file is biggest?",
      isFirstTurn: false,
    });
    expect(prompt).toBe("and which file is biggest?");
  });
});

describe("parseEvent", () => {
  test("blank lines and garbage are ignored", () => {
    expect(parseEvent("")).toBeNull();
    expect(parseEvent("   ")).toBeNull();
    expect(parseEvent("not json")).toBeNull();
  });

  test("system init yields the session id", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      cwd: "/repo",
      session_id: "488111f6-3e62-4a5d-85d7-b62f136833f9",
    });
    expect(parseEvent(line)).toEqual({
      kind: "session",
      sessionId: "488111f6-3e62-4a5d-85d7-b62f136833f9",
    });
  });

  test("other system subtypes (hooks) are ignored", () => {
    const hook = JSON.stringify({
      type: "system",
      subtype: "hook_started",
      session_id: "x",
    });
    expect(parseEvent(hook)).toBeNull();
  });

  test("assistant message yields the joined text blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      },
      session_id: "x",
    });
    expect(parseEvent(line)).toEqual({ kind: "text", text: "Hello world" });
  });

  test("assistant message with only tool_use blocks is ignored", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: {} }] },
    });
    expect(parseEvent(line)).toBeNull();
  });

  test("result event yields done with the final text", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "OK",
      session_id: "x",
    });
    expect(parseEvent(line)).toEqual({ kind: "done", result: "OK" });
  });

  test("rate_limit_event and unknown types are ignored", () => {
    expect(parseEvent(JSON.stringify({ type: "rate_limit_event" }))).toBeNull();
    expect(parseEvent(JSON.stringify({ type: "something_new" }))).toBeNull();
  });
});
