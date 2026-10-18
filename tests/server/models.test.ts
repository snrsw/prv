import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "../../src/server";
import type { ChatModelList } from "../../src/shared/chat";

let server: ReturnType<typeof createServer>;
const saved = {
  CODEX_HOME: process.env.CODEX_HOME,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
};
const dir = mkdtempSync(join(tmpdir(), "prv-srv-models-"));

beforeAll(() => {
  writeFileSync(
    join(dir, "models_cache.json"),
    JSON.stringify({
      models: [
        { slug: "gpt-b", display_name: "GPT-B", visibility: "list", priority: 2 },
        {
          slug: "gpt-a",
          display_name: "GPT-A",
          description: "First.",
          default_reasoning_level: "low",
          supported_reasoning_levels: [{ effort: "low" }, { effort: "ultra" }],
          visibility: "list",
          priority: 1,
        },
      ],
    }),
  );
  writeFileSync(join(dir, "config.toml"), 'model = "gpt-a"\n');
  process.env.CODEX_HOME = dir;
  // No settings.json here: Claude falls back to its aliases.
  process.env.CLAUDE_CONFIG_DIR = dir;
  server = createServer({ port: 0 });
});

afterAll(() => {
  server.stop();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function getModels(agent: string): Promise<Response> {
  const url = new URL("/api/agents/models", server.url);
  url.searchParams.set("agent", agent);
  return fetch(url);
}

test("GET /api/agents/models?agent=codex lists the CLI's catalogue and defaults", async () => {
  const res = await getModels("codex");
  expect(res.status).toBe(200);
  const body = (await res.json()) as ChatModelList;
  expect(body).toEqual({
    models: [
      {
        id: "gpt-a",
        label: "GPT-A",
        description: "First.",
        efforts: ["low", "ultra"],
        defaultEffort: "low",
      },
      { id: "gpt-b", label: "GPT-B" },
    ],
    defaultModel: "gpt-a",
  });
});

test("GET /api/agents/models?agent=claude falls back to the aliases without settings.json", async () => {
  const res = await getModels("claude");
  expect(res.status).toBe(200);
  const body = (await res.json()) as ChatModelList;
  expect(body.models.map((m) => m.id)).toEqual(["fable", "opus", "sonnet", "haiku"]);
  expect(body.defaultModel).toBeUndefined();
});

test("GET /api/agents/models rejects an unknown agent", async () => {
  expect((await getModels("gemini")).status).toBe(400);
});
