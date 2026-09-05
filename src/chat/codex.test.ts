import { test, expect, describe } from "bun:test";
import { buildCodexArgs, createCodexParser } from "./codex";
import type { ChatEvent } from "./backend";

const line = (obj: unknown): string => JSON.stringify(obj);

/** Feed several JSONL lines through one parser and flatten the events. */
function parseAll(lines: unknown[]): ChatEvent[] {
  const parse = createCodexParser();
  return lines.flatMap((l) => parse(typeof l === "string" ? l : line(l)));
}

describe("buildCodexArgs", () => {
  test("ask profile runs `codex exec --json` in the read-only sandbox, prompt on stdin", () => {
    const args = buildCodexArgs("ask");
    expect(args.slice(0, 2)).toEqual(["exec", "--json"]);
    expect(args.join(" ")).toContain("--sandbox read-only");
    expect(args.join(" ")).toContain('-c approval_policy="never"');
    expect(args.at(-1)).toBe("-");
    expect(args).not.toContain("workspace-write");
    expect(args).not.toContain("resume");
  });

  test("apply profile uses the workspace-write sandbox, never full access", () => {
    const args = buildCodexArgs("apply");
    expect(args.join(" ")).toContain("--sandbox workspace-write");
    expect(args.join(" ")).not.toContain("danger-full-access");
    expect(args.join(" ")).not.toContain("--dangerously-bypass");
  });

  test("a session id becomes the `resume <id>` subcommand, still reading stdin", () => {
    const args = buildCodexArgs("ask", "thread-1");
    expect(args.slice(-3)).toEqual(["resume", "thread-1", "-"]);
    // exec-level options precede the subcommand.
    expect(args.indexOf("--sandbox")).toBeLessThan(args.indexOf("resume"));
  });

  test("no settings → no model/effort overrides (CLI defaults apply)", () => {
    const args = buildCodexArgs("ask");
    expect(args).not.toContain("--model");
    expect(args.join(" ")).not.toContain("model_reasoning_effort");
  });

  test("model is a flag and effort is a config override", () => {
    const args = buildCodexArgs("ask", undefined, { model: "gpt-5.5", effort: "xhigh" });
    expect(args.join(" ")).toContain("--model gpt-5.5");
    expect(args).toContain('model_reasoning_effort="xhigh"');
  });

  test("settings are sent on resumed turns too, before the subcommand", () => {
    const args = buildCodexArgs("apply", "t2", { model: "gpt-5.5", effort: "low" });
    expect(args.join(" ")).toContain('--model gpt-5.5 -c model_reasoning_effort="low" resume t2 -');
  });
});

describe("createCodexParser", () => {
  test("blank lines, garbage and unknown events are ignored", () => {
    expect(
      parseAll(["", "   ", "not json", { type: "turn.started" }, { type: "brand_new" }]),
    ).toEqual([]);
  });

  test("thread.started yields the session (thread) id", () => {
    expect(parseAll([{ type: "thread.started", thread_id: "01a0-7" }])).toEqual([
      { kind: "session", sessionId: "01a0-7" },
    ]);
  });

  test("a completed agent_message is text and becomes the done result", () => {
    const events = parseAll([
      { type: "item.started", item: { id: "item_0", type: "agent_message", text: "" } },
      { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "The answer" } },
      { type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    expect(events).toEqual([
      { kind: "text", text: "The answer" },
      { kind: "done", result: "The answer" },
    ]);
  });

  test("the done result is the last agent message; an empty turn has an empty result", () => {
    const events = parseAll([
      { type: "item.completed", item: { id: "i1", type: "agent_message", text: "Looking…" } },
      { type: "item.completed", item: { id: "i2", type: "agent_message", text: "Final" } },
      { type: "turn.completed", usage: {} },
    ]);
    expect(events.at(-1)).toEqual({ kind: "done", result: "Final" });
    expect(parseAll([{ type: "turn.completed", usage: {} }])).toEqual([
      { kind: "done", result: "" },
    ]);
  });

  test("reasoning is narration (progress)", () => {
    expect(
      parseAll([
        { type: "item.completed", item: { id: "r", type: "reasoning", text: "Plan: read" } },
      ]),
    ).toEqual([{ kind: "progress", text: "Plan: read" }]);
  });

  test("a command execution is one Bash tool line with the command, reported once", () => {
    const item = {
      id: "item_1",
      type: "command_execution",
      command: "cat src/app.ts",
      aggregated_output: "",
      exit_code: null,
      status: "in_progress",
    };
    const events = parseAll([
      { type: "item.started", item },
      { type: "item.updated", item: { ...item, aggregated_output: "…" } },
      {
        type: "item.completed",
        item: { ...item, aggregated_output: "…", exit_code: 0, status: "completed" },
      },
    ]);
    expect(events).toEqual([{ kind: "tool", name: "Bash", target: "cat src/app.ts" }]);
  });

  test("a command seen only at completion is still reported", () => {
    const events = parseAll([
      {
        type: "item.completed",
        item: { id: "c", type: "command_execution", command: "ls", status: "completed" },
      },
    ]);
    expect(events).toEqual([{ kind: "tool", name: "Bash", target: "ls" }]);
  });

  test("a file change yields one tool line per path, named by change kind", () => {
    const events = parseAll([
      {
        type: "item.completed",
        item: {
          id: "f",
          type: "file_change",
          status: "completed",
          changes: [
            { path: "/repo/src/a.ts", kind: "update" },
            { path: "/repo/src/new.ts", kind: "add" },
            { path: "/repo/old.ts", kind: "delete" },
          ],
        },
      },
    ]);
    expect(events).toEqual([
      { kind: "tool", name: "Edit", target: "/repo/src/a.ts" },
      { kind: "tool", name: "Write", target: "/repo/src/new.ts" },
      { kind: "tool", name: "Delete", target: "/repo/old.ts" },
    ]);
  });

  test("mcp tool calls, web searches and todo lists map to tool lines", () => {
    const events = parseAll([
      {
        type: "item.started",
        item: {
          id: "m",
          type: "mcp_tool_call",
          server: "github",
          tool: "get_pr",
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: { id: "w", type: "web_search", query: "bun test", action: {} },
      },
      { type: "item.completed", item: { id: "t", type: "todo_list", items: [] } },
    ]);
    expect(events).toEqual([
      { kind: "tool", name: "MCP", target: "github.get_pr" },
      { kind: "tool", name: "WebSearch", target: "bun test" },
      { kind: "tool", name: "TodoWrite" },
    ]);
  });

  test("error events and error items are non-fatal progress lines", () => {
    // Codex keeps running after these (stream retries, transport fallbacks).
    const events = parseAll([
      { type: "error", message: "Reconnecting... 2/5" },
      {
        type: "item.completed",
        item: { id: "e", type: "error", message: "Falling back to HTTPS" },
      },
    ]);
    expect(events).toEqual([
      { kind: "progress", text: "⚠ Reconnecting... 2/5" },
      { kind: "progress", text: "⚠ Falling back to HTTPS" },
    ]);
  });

  test("turn.failed is the fatal error", () => {
    expect(parseAll([{ type: "turn.failed", error: { message: "quota exceeded" } }])).toEqual([
      { kind: "error", message: "quota exceeded" },
    ]);
    expect(parseAll([{ type: "turn.failed" }])).toEqual([
      { kind: "error", message: "codex turn failed" },
    ]);
  });

  test("a full turn in order: session, narration, tool, answer, done", () => {
    const events = parseAll([
      { type: "thread.started", thread_id: "T" },
      { type: "turn.started" },
      { type: "item.completed", item: { id: "0", type: "reasoning", text: "I'll check a.ts" } },
      { type: "item.started", item: { id: "1", type: "command_execution", command: "cat a.ts" } },
      { type: "item.completed", item: { id: "1", type: "command_execution", command: "cat a.ts" } },
      {
        type: "item.completed",
        item: { id: "2", type: "agent_message", text: "a.ts adds foo()." },
      },
      { type: "turn.completed", usage: {} },
    ]);
    expect(events.map((e) => e.kind)).toEqual(["session", "progress", "tool", "text", "done"]);
  });
});
