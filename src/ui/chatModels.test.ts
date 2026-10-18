import { test, expect, describe } from "bun:test";
import type { ChatModelList } from "../shared/chat";
import {
  defaultEffortFor,
  effortsFor,
  fallbackModelList,
  resolveOption,
  selectModel,
} from "./chatModels";

const CODEX: ChatModelList = {
  models: [
    { id: "sol", label: "Sol", efforts: ["low", "medium", "max", "ultra"], defaultEffort: "low" },
    { id: "luna", label: "Luna", efforts: ["low", "medium"], defaultEffort: "medium" },
  ],
  defaultModel: "sol",
};

describe("fallbackModelList", () => {
  test("is the hardcoded presets", () => {
    expect(fallbackModelList("claude").models.map((m) => m.id)).toEqual([
      "fable",
      "opus",
      "sonnet",
      "haiku",
    ]);
    expect(fallbackModelList("codex")).toEqual({ models: [] });
  });
});

describe("effortsFor", () => {
  test("follows the selected model's reported levels", () => {
    expect(effortsFor("codex", CODEX, "luna")).toEqual(["low", "medium"]);
  });

  test("'default' follows the CLI's default model", () => {
    expect(effortsFor("codex", CODEX, undefined)).toEqual(["low", "medium", "max", "ultra"]);
  });

  test("falls back to the agent's list for unknown models and unreported levels", () => {
    expect(effortsFor("codex", CODEX, "custom-model")).toContain("minimal");
    expect(effortsFor("claude", fallbackModelList("claude"), "opus")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });
});

describe("resolveOption", () => {
  test("is the selected model, or the CLI's default model for 'default'", () => {
    expect(resolveOption(CODEX, "luna")?.label).toBe("Luna");
    expect(resolveOption(CODEX, undefined)?.label).toBe("Sol");
    expect(resolveOption(CODEX, "custom-model")).toBeUndefined();
    expect(resolveOption({ models: CODEX.models }, undefined)).toBeUndefined();
  });

  test("an alias finds the model it names", () => {
    const claude = { models: [{ id: "claude-opus-5-5", label: "Opus 5.5", alias: "opus" }] };
    expect(resolveOption(claude, "opus")?.label).toBe("Opus 5.5");
    expect(resolveOption(claude, "sonnet")).toBeUndefined();
  });
});

describe("defaultEffortFor", () => {
  test("is the configured level, else the model's own default", () => {
    expect(defaultEffortFor(CODEX, "luna")).toBe("medium");
    expect(defaultEffortFor(CODEX, undefined)).toBe("low");
    expect(defaultEffortFor({ ...CODEX, defaultEffort: "max" }, "luna")).toBe("max");
    expect(defaultEffortFor(fallbackModelList("claude"), "opus")).toBeUndefined();
  });
});

describe("selectModel", () => {
  test("keeps an effort the new model supports", () => {
    expect(selectModel({ agent: "codex", effort: "medium" }, "luna", CODEX)).toEqual({
      agent: "codex",
      model: "luna",
      effort: "medium",
    });
  });

  test("clears an effort the new model does not support", () => {
    expect(selectModel({ agent: "codex", model: "sol", effort: "ultra" }, "luna", CODEX)).toEqual({
      agent: "codex",
      model: "luna",
      effort: undefined,
    });
  });

  test("back to default keeps levels of the default model", () => {
    expect(
      selectModel({ agent: "codex", model: "luna", effort: "medium" }, undefined, CODEX),
    ).toEqual({ agent: "codex", model: undefined, effort: "medium" });
  });
});
