import { test, expect, describe } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildClaudeModelList,
  buildCodexModelList,
  loadModelList,
  parseClaudeCatalog,
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

const CATALOG = {
  version: 2,
  catalog: {
    surface: "cc",
    config: {
      models: [
        {
          id: "claude-opus-4-8",
          name: "Opus 4.8",
          section: "overflow",
          runtime: { effort_levels: ["low", "high"], default_effort: "high" },
        },
        {
          id: "claude-opus-5-5",
          name: "Opus 5.5",
          short_name: "Opus",
          description: "For complex work and everyday tasks",
          section: "main",
          runtime: { effort_levels: ["low", "medium", "high", "xhigh", "max", "bogus level"] },
        },
        { id: "bad id; rm", name: "Evil", section: "main" },
        { name: "No id" },
      ],
    },
    state: { model: "claude-opus-5-5", thinking: { type: "effort", effort: "medium" } },
  },
};

describe("parseClaudeCatalog", () => {
  test("lists main models first with display names, descriptions and efforts", () => {
    expect(parseClaudeCatalog(CATALOG)).toEqual([
      {
        id: "claude-opus-5-5",
        label: "Opus 5.5",
        description: "For complex work and everyday tasks",
        alias: "opus",
        efforts: ["low", "medium", "high", "xhigh", "max"],
      },
      { id: "claude-opus-4-8", label: "Opus 4.8", efforts: ["low", "high"], defaultEffort: "high" },
    ]);
  });

  test("anything not shaped like the catalogue yields no models", () => {
    expect(parseClaudeCatalog(undefined)).toEqual([]);
    expect(parseClaudeCatalog({ catalog: { config: { models: "x" } } })).toEqual([]);
  });
});

describe("buildClaudeModelList", () => {
  test("with a catalogue, offers its models and the account default", () => {
    const list = buildClaudeModelList(undefined, CATALOG);
    expect(list.models.map((m) => m.label)).toEqual(["Opus 5.5", "Opus 4.8"]);
    expect(list.defaultModel).toBe("claude-opus-5-5");
    expect(list.defaultEffort).toBe("medium");
  });

  test("an alias in settings.json resolves to the catalogue model it names", () => {
    const list = buildClaudeModelList({ model: "opus" }, CATALOG);
    expect(list.defaultModel).toBe("claude-opus-5-5");
    expect(list.models).toHaveLength(2);
  });

  test("settings.json's model overrides the catalogue default", () => {
    const list = buildClaudeModelList({ model: "claude-opus-4-8" }, CATALOG);
    expect(list.defaultModel).toBe("claude-opus-4-8");
    expect(list.defaultEffort).toBeUndefined();
    expect(list.models).toHaveLength(2);
  });

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

  test("reads the newest per-account Claude catalogue, ignoring published documents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "prv-models-"));
    const catalogDir = join(dir, "cache", "model-catalog");
    mkdirSync(catalogDir, { recursive: true });
    writeFileSync(join(catalogDir, "published-abc.json"), JSON.stringify({ version: 2 }));
    writeFileSync(join(catalogDir, "old-cc.json"), JSON.stringify({ catalog: {} }));
    utimesSync(join(catalogDir, "old-cc.json"), new Date(0), new Date(0));
    writeFileSync(join(catalogDir, "acct-cc.json"), JSON.stringify(CATALOG));
    const claude = await loadModelList("claude", { CLAUDE_CONFIG_DIR: dir });
    expect(claude.models.map((m) => m.label)).toEqual(["Opus 5.5", "Opus 4.8"]);
    expect(claude.defaultModel).toBe("claude-opus-5-5");
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
