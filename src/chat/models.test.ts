import { test, expect, describe } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildClaudeModelList,
  buildCodexModelList,
  loadModelList,
  parseCodexModelsCache,
  parseTomlTopLevel,
} from "./models";

const level = (effort: string) => ({ effort, description: effort });

/** A trimmed-down `models_cache.json` in the shape codex-cli 0.160 writes. */
const CACHE = {
  fetched_at: "2026-10-17T16:17:31Z",
  client_version: "0.160.0",
  models: [
    {
      slug: "gpt-6-astra",
      display_name: "GPT-6-Astra",
      description: "Frontier intelligence.",
      default_reasoning_level: "low",
      supported_reasoning_levels: ["low", "medium", "high", "xhigh", "max", "ultra"].map(level),
      visibility: "list",
      priority: 2,
    },
    {
      slug: "codex-auto-review",
      display_name: "Codex Auto Review",
      default_reasoning_level: "medium",
      supported_reasoning_levels: [level("medium")],
      visibility: "hide",
      priority: 0,
    },
    {
      slug: "gpt-6.1-sol",
      display_name: "GPT-6.1-Sol",
      description: "Latest workhorse model.",
      default_reasoning_level: "low",
      supported_reasoning_levels: [level("low"), level("max"), level('x"; rm -rf /')],
      visibility: "list",
      priority: 1,
    },
  ],
};

describe("parseTomlTopLevel", () => {
  test("reads the requested top-level string keys", () => {
    const toml = [
      "# Codex config",
      'model = "gpt-6.1-sol"',
      "model_reasoning_effort = 'low'  # comment",
      'approval_policy = "never"',
      "",
      "[profiles.fast]",
      'model = "gpt-6-luna"',
    ].join("\n");
    expect(parseTomlTopLevel(toml, ["model", "model_reasoning_effort"])).toEqual({
      model: "gpt-6.1-sol",
      model_reasoning_effort: "low",
    });
  });

  test("ignores keys inside tables, non-string values and garbage", () => {
    expect(parseTomlTopLevel('[a]\nmodel = "x"', ["model"])).toEqual({});
    expect(parseTomlTopLevel('model = 3\nmodel_x = "y"\nnot toml', ["model"])).toEqual({});
    expect(parseTomlTopLevel("", ["model"])).toEqual({});
  });
});

describe("parseCodexModelsCache", () => {
  test("keeps listed models by priority with their labels, descriptions and efforts", () => {
    expect(parseCodexModelsCache(CACHE)).toEqual([
      {
        id: "gpt-6.1-sol",
        label: "GPT-6.1-Sol",
        description: "Latest workhorse model.",
        // The unsafe level is dropped.
        efforts: ["low", "max"],
        defaultEffort: "low",
      },
      {
        id: "gpt-6-astra",
        label: "GPT-6-Astra",
        description: "Frontier intelligence.",
        efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
        defaultEffort: "low",
      },
    ]);
  });

  test("skips malformed entries and tolerates missing fields", () => {
    const models = parseCodexModelsCache({
      models: [null, { slug: "-flag", visibility: "list" }, { slug: "bare", visibility: "list" }],
    });
    expect(models).toEqual([{ id: "bare", label: "bare" }]);
  });

  test("anything not shaped like the catalogue yields no models", () => {
    expect(parseCodexModelsCache(undefined)).toEqual([]);
    expect(parseCodexModelsCache({ models: "x" })).toEqual([]);
    expect(parseCodexModelsCache([])).toEqual([]);
  });
});

describe("buildCodexModelList", () => {
  test("adds the config.toml defaults", () => {
    const list = buildCodexModelList(
      CACHE,
      'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "max"\n',
    );
    expect(list.defaultModel).toBe("gpt-6.1-sol");
    expect(list.defaultEffort).toBe("max");
    expect(list.models.map((m) => m.id)).toEqual(["gpt-6.1-sol", "gpt-6-astra"]);
  });

  test("a configured model the catalogue does not list is still offered", () => {
    const list = buildCodexModelList(CACHE, 'model = "my-model"\n');
    expect(list.defaultModel).toBe("my-model");
    expect(list.models.at(-1)).toEqual({ id: "my-model", label: "my-model" });
  });

  test("missing files degrade to no models and no defaults", () => {
    expect(buildCodexModelList(undefined, "")).toEqual({ models: [] });
    expect(buildCodexModelList(undefined, 'model = "--x"\nmodel_reasoning_effort = "a b"')).toEqual(
      { models: [] },
    );
  });
});

describe("buildClaudeModelList", () => {
  test("offers the aliases, and no default when settings.json sets none", () => {
    expect(buildClaudeModelList(undefined)).toEqual({
      models: ["fable", "opus", "sonnet", "haiku"].map((id) => ({ id, label: id })),
    });
    expect(buildClaudeModelList({ theme: "dark" }).defaultModel).toBeUndefined();
  });

  test("names the configured default, adding it when it is not an alias", () => {
    const alias = buildClaudeModelList({ model: "opus" });
    expect(alias.defaultModel).toBe("opus");
    expect(alias.models).toHaveLength(4);
    const full = buildClaudeModelList({ model: "claude-opus-5-5" });
    expect(full.defaultModel).toBe("claude-opus-5-5");
    expect(full.models.at(-1)).toEqual({ id: "claude-opus-5-5", label: "claude-opus-5-5" });
  });
});

describe("loadModelList", () => {
  test("reads $CODEX_HOME and $CLAUDE_CONFIG_DIR", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prv-models-"));
    writeFileSync(join(dir, "models_cache.json"), JSON.stringify(CACHE));
    writeFileSync(join(dir, "config.toml"), 'model = "gpt-6-astra"\n');
    writeFileSync(join(dir, "settings.json"), JSON.stringify({ model: "sonnet" }));
    const codex = await loadModelList("codex", { CODEX_HOME: dir });
    expect(codex.defaultModel).toBe("gpt-6-astra");
    expect(codex.models).toHaveLength(2);
    const claude = await loadModelList("claude", { CLAUDE_CONFIG_DIR: dir });
    expect(claude.defaultModel).toBe("sonnet");
  });

  test("missing or malformed files fall back to the presets", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prv-models-"));
    writeFileSync(join(dir, "settings.json"), "{not json");
    expect(await loadModelList("codex", { CODEX_HOME: join(dir, "absent") })).toEqual({
      models: [],
    });
    expect((await loadModelList("claude", { CLAUDE_CONFIG_DIR: dir })).models).toHaveLength(4);
  });
});
