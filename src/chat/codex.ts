/**
 * OpenAI Codex CLI backend: `codex exec --json`, one subprocess per turn,
 * `codex exec resume <thread-id>` to continue a conversation. The prompt is
 * always fed via stdin (the `-` positional).
 *
 * Read-only is the `read-only` sandbox: the agent may run shell commands but
 * the OS sandbox rejects every write. `apply` mode uses `workspace-write`, so
 * edits land in the repo (and nowhere else). Approvals are pinned to `never`
 * because `codex exec` has no one to ask — an approval prompt would otherwise
 * silently decline the edit.
 *
 * Codex's JSONL is item-based: `item.started`/`item.updated`/`item.completed`
 * carry a typed item (`agent_message`, `command_execution`, `file_change`,
 * `reasoning`, …) and the turn ends with `turn.completed` or `turn.failed`.
 * Each turn gets its own parser because the same item id is reported several
 * times (started, then completed) and we surface each tool call once.
 */

import type { ChatSettings } from "../shared/chat";
import type { Backend, ChatEvent, LineParser, TurnMode } from "./backend";

const BASE_ARGS = ["exec", "--json", "--color", "never", "-c", 'approval_policy="never"'];

const SANDBOX_ARGS: Record<TurnMode, string[]> = {
  ask: ["--sandbox", "read-only"],
  apply: ["--sandbox", "workspace-write"],
};

/**
 * Assemble the full `codex` argument list for a turn (exported for tests).
 * Options come before the `resume` subcommand (they belong to `exec`); the
 * trailing `-` reads the prompt from stdin in both forms.
 */
export function buildCodexArgs(
  mode: TurnMode,
  sessionId?: string,
  { model, effort }: ChatSettings = {},
): string[] {
  const args = [...BASE_ARGS, ...SANDBOX_ARGS[mode]];
  if (model) args.push("--model", model);
  if (effort) args.push("-c", `model_reasoning_effort="${effort}"`);
  if (sessionId) args.push("resume", sessionId);
  args.push("-");
  return args;
}

type Item = Record<string, unknown> & { id?: unknown; type?: unknown };

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Tool events for one item, or `[]` for item types that are not tool-like. */
function toolEvents(item: Item): ChatEvent[] {
  switch (item.type) {
    case "command_execution": {
      const command = str(item.command);
      return [
        command === undefined
          ? { kind: "tool", name: "Bash" }
          : { kind: "tool", name: "Bash", target: command },
      ];
    }
    case "file_change": {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const events: ChatEvent[] = [];
      for (const change of changes) {
        if (typeof change !== "object" || change === null) continue;
        const { path, kind } = change as { path?: unknown; kind?: unknown };
        const name = kind === "add" ? "Write" : kind === "delete" ? "Delete" : "Edit";
        const target = str(path);
        events.push(target === undefined ? { kind: "tool", name } : { kind: "tool", name, target });
      }
      return events.length > 0 ? events : [{ kind: "tool", name: "Edit" }];
    }
    case "mcp_tool_call": {
      const server = str(item.server);
      const tool = str(item.tool);
      const target = server && tool ? `${server}.${tool}` : (tool ?? server);
      return [
        target === undefined
          ? { kind: "tool", name: "MCP" }
          : { kind: "tool", name: "MCP", target },
      ];
    }
    case "web_search": {
      const query = str(item.query);
      return [
        query === undefined
          ? { kind: "tool", name: "WebSearch" }
          : { kind: "tool", name: "WebSearch", target: query },
      ];
    }
    case "todo_list":
      return [{ kind: "tool", name: "TodoWrite" }];
    default:
      return [];
  }
}

/**
 * A parser for one `codex exec --json` turn. Returns `[]` for blank lines,
 * unparseable JSON and events we don't surface. Tolerant by design so CLI
 * version drift degrades gracefully.
 *
 * Mapping:
 * - `thread.started`            → `session` (the thread id is what `resume` takes)
 * - `agent_message` completed    → `text` (the last one is also the `done` result)
 * - `reasoning` completed        → `progress` (the agent narrating its plan)
 * - tool-like items, first seen  → `tool`
 * - `error` events / items       → `progress`, prefixed "⚠": Codex keeps going
 *                                  after these (retries, transport fallbacks)
 * - `turn.completed`             → `done`
 * - `turn.failed`                → `error`
 */
export function createCodexParser(): LineParser {
  const seen = new Set<string>();
  let lastMessage = "";

  return (line: string): ChatEvent[] => {
    const trimmed = line.trim();
    if (!trimmed) return [];

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return [];
    }

    switch (obj.type) {
      case "thread.started": {
        const id = str(obj.thread_id);
        return id === undefined ? [] : [{ kind: "session", sessionId: id }];
      }
      case "item.started":
      case "item.updated":
      case "item.completed": {
        const item = obj.item;
        if (typeof item !== "object" || item === null) return [];
        return itemEvents(item as Item, obj.type === "item.completed");
      }
      case "turn.completed":
        return [{ kind: "done", result: lastMessage }];
      case "turn.failed": {
        const error = obj.error as { message?: unknown } | undefined;
        return [{ kind: "error", message: str(error?.message) ?? "codex turn failed" }];
      }
      case "error": {
        const message = str(obj.message);
        return message === undefined ? [] : [{ kind: "progress", text: `⚠ ${message}` }];
      }
      default:
        return [];
    }
  };

  function itemEvents(item: Item, completed: boolean): ChatEvent[] {
    switch (item.type) {
      case "agent_message": {
        if (!completed) return [];
        const text = str(item.text) ?? "";
        if (text === "") return [];
        lastMessage = text;
        return [{ kind: "text", text }];
      }
      case "reasoning": {
        if (!completed) return [];
        const text = str(item.text) ?? "";
        return text === "" ? [] : [{ kind: "progress", text }];
      }
      case "error": {
        const message = str(item.message);
        return message === undefined ? [] : [{ kind: "progress", text: `⚠ ${message}` }];
      }
      default: {
        // Tool-like items are reported on start and again on completion (and
        // sometimes in between); surface each id once, whichever comes first.
        const id = str(item.id) ?? JSON.stringify(item);
        if (seen.has(id)) return [];
        const events = toolEvents(item);
        if (events.length > 0) seen.add(id);
        return events;
      }
    }
  }
}

export const codexBackend: Backend = {
  command: "codex",
  notFoundMessage:
    "codex CLI not found — install Codex (`npm install -g @openai/codex`) and run `codex login`.",
  buildArgs: buildCodexArgs,
  createParser: createCodexParser,
};
