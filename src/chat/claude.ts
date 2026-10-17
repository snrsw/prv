/**
 * Claude Code backend: `claude --print --output-format stream-json`, one
 * subprocess per turn, `--resume` to continue a conversation.
 *
 * Read-only is enforced two ways: `--permission-mode plan` (no edits) plus
 * `--disallowedTools Edit,Write,Bash` (mutation tools removed entirely).
 */

import type { ChatSettings } from "../shared/chat";
import type { Backend, ChatEvent, TurnMode } from "./backend";

/** Extract the concatenated text of all `text` blocks in an assistant message. */
function assistantText(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("");
}

/**
 * Derive a short human label for a tool call from its input object. We probe a
 * small ordered set of well-known keys and return the first string value found
 * (e.g. `file_path` for Read/Edit/Write, `command` for Bash, `pattern` for
 * Grep). Returns `undefined` when nothing obvious is present.
 */
function toolTarget(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const keys = ["file_path", "notebook_path", "command", "pattern", "url", "query", "description"];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/** Extract the `tool_use` blocks of an assistant message as name/target pairs. */
function toolUses(message: unknown): { name: string; target?: string }[] {
  if (typeof message !== "object" || message === null) return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (block): block is { type: "tool_use"; name: string; input?: unknown } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "tool_use" &&
        typeof (block as { name?: unknown }).name === "string",
    )
    .map((block) => {
      const target = toolTarget(block.input);
      return target === undefined ? { name: block.name } : { name: block.name, target };
    });
}

/**
 * Parse one line of `claude --output-format stream-json` output into zero or
 * more `ChatEvent`s. Returns `[]` for blank lines, unparseable JSON, and event
 * types we don't surface (hooks, rate-limit notices, etc.). A single assistant
 * line can carry both a text block and one or more tool calls, so the return
 * type is an array. The parser is deliberately tolerant so CLI version drift
 * degrades gracefully.
 */
export function parseClaudeEvent(line: string): ChatEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return [];
  }

  switch (obj.type) {
    case "system": {
      if (obj.subtype === "init" && typeof obj.session_id === "string") {
        return [{ kind: "session", sessionId: obj.session_id }];
      }
      return [];
    }
    case "assistant": {
      const events: ChatEvent[] = [];
      const text = assistantText(obj.message);
      const tools = toolUses(obj.message);
      // Text that shares a message with a tool call is the agent narrating what
      // it is about to do ("I'll read X"); a text-only message is the answer.
      if (text) events.push(tools.length > 0 ? { kind: "progress", text } : { kind: "text", text });
      for (const use of tools) {
        events.push(
          use.target === undefined
            ? { kind: "tool", name: use.name }
            : { kind: "tool", name: use.name, target: use.target },
        );
      }
      return events;
    }
    case "result": {
      const result = typeof obj.result === "string" ? obj.result : "";
      return [{ kind: "done", result }];
    }
    default:
      return [];
  }
}

const BASE_ARGS = ["--print", "--verbose", "--output-format", "stream-json"];

/**
 * Permission profile per mode. `ask` is strictly read-only; `apply` lets the
 * agent edit files (Read/Edit/Write/Grep/Glob) but never run Bash.
 */
const PROFILE_ARGS: Record<TurnMode, string[]> = {
  ask: ["--permission-mode", "plan", "--disallowedTools", "Edit,Write,Bash"],
  apply: ["--permission-mode", "acceptEdits", "--allowedTools", "Read,Edit,Write,Grep,Glob"],
};

/**
 * Assemble the full `claude` argument list for a turn (exported for tests).
 * `model`/`effort` are sent on every turn, resumed ones included, so a setting
 * changed mid-conversation takes effect from the next turn.
 */
export function buildClaudeArgs(
  mode: TurnMode,
  sessionId?: string,
  { model, effort }: ChatSettings = {},
): string[] {
  const args = [...BASE_ARGS, ...PROFILE_ARGS[mode]];
  if (model) args.push("--model", model);
  if (effort) args.push("--effort", effort);
  if (sessionId) args.push("--resume", sessionId);
  return args;
}

export const claudeBackend: Backend = {
  command: "claude",
  notFoundMessage: "claude CLI not found — install Claude Code and run `claude` once to log in.",
  buildArgs: buildClaudeArgs,
  createParser: () => parseClaudeEvent,
};
