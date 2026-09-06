import { test, expect, describe } from "bun:test";
import {
  getChatSettings,
  parseStoredChatSettings,
  setChatSettings,
  summarizeChatSettings,
} from "./chatSettings";

describe("parseStoredChatSettings", () => {
  test("missing entry means CLI defaults", () => {
    expect(parseStoredChatSettings(null)).toEqual({});
  });

  test("round-trips a stored value", () => {
    expect(parseStoredChatSettings(JSON.stringify({ model: "opus", effort: "max" }))).toEqual({
      model: "opus",
      effort: "max",
    });
  });

  test("malformed JSON and invalid fields fall back safely", () => {
    expect(parseStoredChatSettings("{not json")).toEqual({});
    expect(parseStoredChatSettings(JSON.stringify({ effort: "turbo", model: 7 }))).toEqual({});
    expect(parseStoredChatSettings(JSON.stringify({ effort: "low", model: "-x" }))).toEqual({
      effort: "low",
    });
  });
});

describe("store", () => {
  test("setChatSettings sanitizes and getChatSettings reflects it (no window needed)", () => {
    setChatSettings({ model: "sonnet", effort: "high" });
    expect(getChatSettings()).toEqual({ model: "sonnet", effort: "high" });
    setChatSettings({ model: "", effort: "high" });
    expect(getChatSettings()).toEqual({ effort: "high" });
    setChatSettings({});
    expect(getChatSettings()).toEqual({});
  });
});

describe("summarizeChatSettings", () => {
  test("defaults read as Claude with the CLI default model", () => {
    expect(summarizeChatSettings({})).toBe("Claude · default");
  });

  test("names the agent, model and effort that are set", () => {
    expect(summarizeChatSettings({ model: "opus" })).toBe("Claude · opus");
    expect(summarizeChatSettings({ agent: "codex", model: "gpt-5", effort: "high" })).toBe(
      "Codex · gpt-5 · high",
    );
    expect(summarizeChatSettings({ agent: "codex", effort: "low" })).toBe("Codex · default · low");
  });
});
