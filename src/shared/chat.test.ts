import { test, expect, describe } from "bun:test";
import {
  CHAT_EFFORTS_BY_AGENT,
  isChatAgent,
  isChatEffort,
  isChatModel,
  sanitizeChatSettings,
} from "./chat";

describe("isChatAgent", () => {
  test("accepts the known agents and nothing else", () => {
    expect(isChatAgent("claude")).toBe(true);
    expect(isChatAgent("codex")).toBe(true);
    expect(isChatAgent("gemini")).toBe(false);
    expect(isChatAgent("")).toBe(false);
    expect(isChatAgent(undefined)).toBe(false);
  });
});

describe("isChatEffort", () => {
  test("accepts every level of each agent's enum", () => {
    for (const level of CHAT_EFFORTS_BY_AGENT.claude)
      expect(isChatEffort(level, "claude")).toBe(true);
    for (const level of CHAT_EFFORTS_BY_AGENT.codex)
      expect(isChatEffort(level, "codex")).toBe(true);
  });

  test("defaults to Claude's levels", () => {
    expect(isChatEffort("max")).toBe(true);
    expect(isChatEffort("minimal")).toBe(false);
  });

  test("levels are agent-specific", () => {
    expect(isChatEffort("minimal", "claude")).toBe(false);
    expect(isChatEffort("minimal", "codex")).toBe(true);
  });

  test("rejects unknown strings and non-strings", () => {
    expect(isChatEffort("ultra")).toBe(false);
    expect(isChatEffort("")).toBe(false);
    expect(isChatEffort(3)).toBe(false);
    expect(isChatEffort(undefined)).toBe(false);
  });
});

describe("isChatModel", () => {
  test("accepts aliases and full model names", () => {
    expect(isChatModel("opus")).toBe(true);
    expect(isChatModel("claude-fable-5-1")).toBe(true);
    expect(isChatModel("claude-sonnet-4-5[1m]")).toBe(true);
    expect(isChatModel("us.anthropic.claude-opus-5")).toBe(true);
    expect(isChatModel("gpt-5.5-codex")).toBe(true);
  });

  test("rejects empty, flag-like, whitespace-bearing and oversized values", () => {
    expect(isChatModel("")).toBe(false);
    expect(isChatModel("--dangerously-skip-permissions")).toBe(false);
    expect(isChatModel("-x")).toBe(false);
    expect(isChatModel("opus 4")).toBe(false);
    expect(isChatModel("opus\n")).toBe(false);
    expect(isChatModel("a".repeat(101))).toBe(false);
    expect(isChatModel(42)).toBe(false);
  });
});

describe("sanitizeChatSettings", () => {
  test("keeps well-formed fields", () => {
    expect(sanitizeChatSettings({ model: "sonnet", effort: "high" })).toEqual({
      model: "sonnet",
      effort: "high",
    });
    expect(sanitizeChatSettings({ agent: "codex", model: "gpt-5.5", effort: "minimal" })).toEqual({
      agent: "codex",
      model: "gpt-5.5",
      effort: "minimal",
    });
  });

  test("drops invalid fields independently and ignores extras", () => {
    expect(sanitizeChatSettings({ model: "-bad", effort: "high", other: 1 })).toEqual({
      effort: "high",
    });
    expect(sanitizeChatSettings({ model: "opus", effort: "turbo" })).toEqual({ model: "opus" });
    expect(sanitizeChatSettings({ agent: "gemini", model: "opus" })).toEqual({ model: "opus" });
  });

  test("effort is validated against the sanitized agent", () => {
    // A Claude-only level never reaches Codex, and vice versa.
    expect(sanitizeChatSettings({ agent: "codex", effort: "max" })).toEqual({
      agent: "codex",
      effort: "max",
    });
    expect(sanitizeChatSettings({ agent: "claude", effort: "minimal" })).toEqual({
      agent: "claude",
    });
    // An unknown agent falls back to Claude, so Claude's levels apply.
    expect(sanitizeChatSettings({ agent: "nope", effort: "minimal" })).toEqual({});
  });

  test("non-objects yield empty settings", () => {
    expect(sanitizeChatSettings(null)).toEqual({});
    expect(sanitizeChatSettings("opus")).toEqual({});
    expect(sanitizeChatSettings(undefined)).toEqual({});
  });
});
