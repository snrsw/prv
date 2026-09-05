import { test, expect, describe } from "bun:test";
import { CHAT_EFFORTS, isChatEffort, isChatModel, sanitizeChatSettings } from "./chat";

describe("isChatEffort", () => {
  test("accepts every level of the CLI enum", () => {
    for (const level of CHAT_EFFORTS) expect(isChatEffort(level)).toBe(true);
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
  });

  test("drops invalid fields independently and ignores extras", () => {
    expect(sanitizeChatSettings({ model: "-bad", effort: "high", other: 1 })).toEqual({
      effort: "high",
    });
    expect(sanitizeChatSettings({ model: "opus", effort: "turbo" })).toEqual({ model: "opus" });
  });

  test("non-objects yield empty settings", () => {
    expect(sanitizeChatSettings(null)).toEqual({});
    expect(sanitizeChatSettings("opus")).toEqual({});
    expect(sanitizeChatSettings(undefined)).toEqual({});
  });
});
