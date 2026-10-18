import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CHAT_MODEL_PRESETS_BY_AGENT,
  isChatEffort,
  isChatModel,
  type ChatAgent,
  type ChatModelList,
  type ChatModelOption,
} from "../shared/chat";

/**
 * The models each agent's CLI offers, for the model picker. Neither CLI has a
 * cheap "list models" command, so prv reads the files the CLIs keep:
 *
 * - Codex: its model catalogue `$CODEX_HOME/models_cache.json` (which the CLI
 *   refreshes itself) plus the `model` / `model_reasoning_effort` defaults in
 *   `$CODEX_HOME/config.toml`. `codex app-server` can list models too, but it
 *   needs a subprocess and a JSON-RPC handshake per request for the same data.
 * - Claude Code: the account's model catalogue, which the CLI caches as
 *   `$CLAUDE_CONFIG_DIR/cache/model-catalog/<account>-cc.json` (display names
 *   such as "Opus 5.5", descriptions, effort levels, and the account default),
 *   plus the `model` in `$CLAUDE_CONFIG_DIR/settings.json`. Without a catalogue
 *   it falls back to the fixed aliases.
 *
 * Every value is validated with `isChatModel` / `isChatEffort`, so nothing read
 * here can become an unsafe CLI argument. A missing or malformed file degrades
 * to the hardcoded presets; the parsers below are pure.
 */

/**
 * Read the given top-level `key = "value"` string entries of a TOML document.
 * Only the lines before the first `[table]` header are top-level; values are
 * basic or literal strings, with an optional trailing comment. Pure.
 */
export function parseTomlTopLevel(text: string, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) break;
    const m = /^([A-Za-z0-9_-]+)\s*=\s*(?:"([^"\\]*)"|'([^']*)')\s*(?:#.*)?$/.exec(line);
    if (!m || !keys.includes(m[1]!)) continue;
    out[m[1]!] = m[2] ?? m[3] ?? "";
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The picker entries in a parsed `models_cache.json`: only `visibility: "list"`
 * models (the ones Codex's own picker shows), by ascending `priority`. Entries
 * without a valid slug are skipped, as are effort levels that fail
 * `isChatEffort`. Anything not shaped like the catalogue yields `[]`. Pure.
 */
export function parseCodexModelsCache(json: unknown): ChatModelOption[] {
  if (!isRecord(json) || !Array.isArray(json.models)) return [];
  const listed: { option: ChatModelOption; priority: number }[] = [];
  for (const entry of json.models) {
    if (!isRecord(entry) || entry.visibility !== "list" || !isChatModel(entry.slug)) continue;
    const option: ChatModelOption = {
      id: entry.slug,
      label: optionalString(entry.display_name) ?? entry.slug,
    };
    const description = optionalString(entry.description);
    if (description) option.description = description;
    if (Array.isArray(entry.supported_reasoning_levels)) {
      const efforts = entry.supported_reasoning_levels
        .map((level) => (isRecord(level) ? level.effort : undefined))
        .filter((effort): effort is string => isChatEffort(effort, "codex"));
      if (efforts.length > 0) option.efforts = efforts;
    }
    if (isChatEffort(entry.default_reasoning_level, "codex")) {
      option.defaultEffort = entry.default_reasoning_level as string;
    }
    const priority = typeof entry.priority === "number" ? entry.priority : Infinity;
    listed.push({ option, priority });
  }
  return listed.sort((a, b) => a.priority - b.priority).map((l) => l.option);
}

/**
 * Codex's picker list from its catalogue (parsed JSON, or `undefined` when
 * unreadable) and `config.toml` text. The configured default model is kept
 * even when the catalogue does not list it. Pure.
 */
export function buildCodexModelList(cache: unknown, configToml: string): ChatModelList {
  const models = parseCodexModelsCache(cache);
  const config = parseTomlTopLevel(configToml, ["model", "model_reasoning_effort"]);
  const list: ChatModelList = { models };
  if (isChatModel(config.model)) {
    list.defaultModel = config.model;
    if (!models.some((m) => m.id === config.model)) {
      models.push({ id: config.model, label: config.model });
    }
  }
  if (isChatEffort(config.model_reasoning_effort, "codex")) {
    list.defaultEffort = config.model_reasoning_effort;
  }
  return list;
}

/**
 * The picker entries in a parsed Claude Code catalogue file: the models of
 * `catalog.config.models`, the "main" section (what `/model` lists first)
 * before the rest, each with its display name, description, and effort levels.
 * Entries without a valid id are skipped. Anything not shaped like the
 * catalogue yields `[]`. Pure.
 */
export function parseClaudeCatalog(json: unknown): ChatModelOption[] {
  const catalog = isRecord(json) && isRecord(json.catalog) ? json.catalog : undefined;
  const config = catalog && isRecord(catalog.config) ? catalog.config : undefined;
  if (!config || !Array.isArray(config.models)) return [];
  const main: ChatModelOption[] = [];
  const rest: ChatModelOption[] = [];
  for (const entry of config.models) {
    if (!isRecord(entry) || !isChatModel(entry.id)) continue;
    const option: ChatModelOption = { id: entry.id, label: optionalString(entry.name) ?? entry.id };
    const description = optionalString(entry.description);
    if (description) option.description = description;
    // `--model opus` means the latest Opus — the main-section model of that family.
    const alias = optionalString(entry.short_name)?.toLowerCase();
    if (entry.section === "main" && CHAT_MODEL_PRESETS_BY_AGENT.claude.some((a) => a === alias)) {
      option.alias = alias;
    }
    const runtime = isRecord(entry.runtime) ? entry.runtime : {};
    if (Array.isArray(runtime.effort_levels)) {
      const efforts = runtime.effort_levels.filter((e): e is string => isChatEffort(e, "claude"));
      if (efforts.length > 0) option.efforts = efforts;
    }
    if (isChatEffort(runtime.default_effort, "claude")) {
      option.defaultEffort = runtime.default_effort as string;
    }
    (entry.section === "main" ? main : rest).push(option);
  }
  return [...main, ...rest];
}

/** The account default in a parsed catalogue file: `catalog.state.model` and its effort. Pure. */
function claudeCatalogDefault(json: unknown): { model?: string; effort?: string } {
  const catalog = isRecord(json) && isRecord(json.catalog) ? json.catalog : undefined;
  const state = catalog && isRecord(catalog.state) ? catalog.state : undefined;
  if (!state || !isChatModel(state.model)) return {};
  const thinking = isRecord(state.thinking) ? state.thinking.effort : undefined;
  return {
    model: state.model,
    effort: isChatEffort(thinking, "claude") ? (thinking as string) : undefined,
  };
}

/**
 * Claude Code's picker list from its catalogue (parsed JSON, or `undefined`)
 * and a parsed `settings.json` (or `undefined`). With a catalogue the models
 * are the catalogue's; without one, the fixed aliases. The default is
 * settings.json's `model` (an alias resolved to its catalogue model), else the catalogue's account default (with its
 * effort); a configured model neither lists is still offered. Pure.
 */
export function buildClaudeModelList(settings: unknown, catalog?: unknown): ChatModelList {
  const fromCatalog = parseClaudeCatalog(catalog);
  const models: ChatModelOption[] =
    fromCatalog.length > 0
      ? fromCatalog
      : CHAT_MODEL_PRESETS_BY_AGENT.claude.map((alias) => ({ id: alias, label: alias }));
  const list: ChatModelList = { models };
  const configured = isRecord(settings) ? settings.model : undefined;
  if (isChatModel(configured)) {
    list.defaultModel = models.find((m) => m.alias === configured)?.id ?? configured;
  } else {
    const fallback = claudeCatalogDefault(catalog);
    if (fallback.model) list.defaultModel = fallback.model;
    if (fallback.effort) list.defaultEffort = fallback.effort;
  }
  if (list.defaultModel && !models.some((m) => m.id === list.defaultModel)) {
    models.push({ id: list.defaultModel, label: list.defaultModel });
  }
  return list;
}

/**
 * The newest Claude Code catalogue file in `dir` (`*-cc.json`; the signed
 * `published-*` documents are not per-account), or `undefined`.
 */
async function newestClaudeCatalog(dir: string): Promise<string | undefined> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return undefined;
  }
  let best: { path: string; mtime: number } | undefined;
  for (const name of names) {
    if (!name.endsWith("-cc.json") || name.startsWith("published-")) continue;
    const path = join(dir, name);
    try {
      const { mtimeMs } = await stat(path);
      if (!best || mtimeMs > best.mtime) best = { path, mtime: mtimeMs };
    } catch {
      /* vanished between readdir and stat */
    }
  }
  return best?.path;
}

/** A file's text, or `""` when it is missing or unreadable. */
async function readText(path: string): Promise<string> {
  try {
    return await Bun.file(path).text();
  } catch {
    return "";
  }
}

/** A file's parsed JSON, or `undefined` when it is missing or malformed. */
async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readText(path));
  } catch {
    return undefined;
  }
}

/** Read the agent's CLI files and build its picker list. Never throws. */
export async function loadModelList(
  agent: ChatAgent,
  env: Record<string, string | undefined> = process.env,
): Promise<ChatModelList> {
  if (agent === "codex") {
    const home = env.CODEX_HOME || join(homedir(), ".codex");
    const [cache, config] = await Promise.all([
      readJson(join(home, "models_cache.json")),
      readText(join(home, "config.toml")),
    ]);
    return buildCodexModelList(cache, config);
  }
  const home = env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  const catalogPath = await newestClaudeCatalog(join(home, "cache", "model-catalog"));
  const [settings, catalog] = await Promise.all([
    readJson(join(home, "settings.json")),
    catalogPath ? readJson(catalogPath) : undefined,
  ]);
  return buildClaudeModelList(settings, catalog);
}
