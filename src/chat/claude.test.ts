import { test, expect, describe } from "bun:test";
import { buildPrompt, relativizeTarget } from "./agent";
import { buildClaudeArgs as buildArgs, parseClaudeEvent as parseEvent } from "./claude";

describe("buildArgs", () => {
  test("ask profile is read-only (plan + disallow Edit/Write/Bash)", () => {
    const args = buildArgs("ask");
    expect(args).toContain("plan");
    expect(args.join(" ")).toContain("--disallowedTools Edit,Write,Bash");
    expect(args).not.toContain("acceptEdits");
  });

  test("apply profile allows edits but not Bash", () => {
    const args = buildArgs("apply");
    expect(args).toContain("acceptEdits");
    expect(args.join(" ")).toContain("--allowedTools Read,Edit,Write,Grep,Glob");
    expect(args.join(" ")).not.toContain("Bash");
  });

  test("resume is appended when a session id is given", () => {
    expect(buildArgs("ask", "sid-1").slice(-2)).toEqual(["--resume", "sid-1"]);
    expect(buildArgs("ask")).not.toContain("--resume");
  });
});

describe("buildPrompt apply mode", () => {
  test("apply framing tells the agent to edit, ask framing forbids it", () => {
    const apply = buildPrompt({
      diff: "d",
      question: "rename x",
      isFirstTurn: true,
      mode: "apply",
    });
    expect(apply).toContain("editing the files directly");
    expect(apply).toContain("Requested change: rename x");
    const ask = buildPrompt({ diff: "d", question: "why?", isFirstTurn: true, mode: "ask" });
    expect(ask).toContain("read-only");
    expect(ask).toContain("Question: why?");
  });
});

describe("buildPrompt", () => {
  test("first turn embeds the diff and the question", () => {
    const prompt = buildPrompt({
      diff: "diff --git a/x b/x\n+hello",
      question: "what changed?",
      isFirstTurn: true,
    });
    expect(prompt).toContain("<diff>");
    expect(prompt).toContain("diff --git a/x b/x");
    expect(prompt).toContain("Question: what changed?");
    expect(prompt).toContain("read-only");
  });

  test("later turns send only the question (diff carried by --resume)", () => {
    const prompt = buildPrompt({
      diff: "diff --git a/x b/x\n+hello",
      question: "and which file is biggest?",
      isFirstTurn: false,
    });
    expect(prompt).toBe("and which file is biggest?");
  });
});

describe("parseEvent", () => {
  test("blank lines and garbage are ignored", () => {
    expect(parseEvent("")).toEqual([]);
    expect(parseEvent("   ")).toEqual([]);
    expect(parseEvent("not json")).toEqual([]);
  });

  test("system init yields the session id", () => {
    const line = JSON.stringify({
      type: "system",
      subtype: "init",
      cwd: "/repo",
      session_id: "488111f6-3e62-4a5d-85d7-b62f136833f9",
    });
    expect(parseEvent(line)).toEqual([
      {
        kind: "session",
        sessionId: "488111f6-3e62-4a5d-85d7-b62f136833f9",
      },
    ]);
  });

  test("other system subtypes (hooks) are ignored", () => {
    const hook = JSON.stringify({
      type: "system",
      subtype: "hook_started",
      session_id: "x",
    });
    expect(parseEvent(hook)).toEqual([]);
  });

  test("assistant message yields the joined text blocks", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world" },
        ],
      },
      session_id: "x",
    });
    expect(parseEvent(line)).toEqual([{ kind: "text", text: "Hello world" }]);
  });

  test("result event yields done with the final text", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "OK",
      session_id: "x",
    });
    expect(parseEvent(line)).toEqual([{ kind: "done", result: "OK" }]);
  });

  test("rate_limit_event and unknown types are ignored", () => {
    expect(parseEvent(JSON.stringify({ type: "rate_limit_event" }))).toEqual([]);
    expect(parseEvent(JSON.stringify({ type: "something_new" }))).toEqual([]);
  });

  test("tool_use with a file_path yields a tool event with the file as target", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/foo.ts" } }],
      },
    });
    expect(parseEvent(line)).toEqual([{ kind: "tool", name: "Edit", target: "src/foo.ts" }]);
  });

  test("Bash tool_use uses the command as target", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: "Bash", input: { command: "ls -la" } }],
      },
    });
    expect(parseEvent(line)).toEqual([{ kind: "tool", name: "Bash", target: "ls -la" }]);
  });

  test("Grep tool_use uses the pattern as target", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: "Grep", input: { pattern: "TODO" } }],
      },
    });
    expect(parseEvent(line)).toEqual([{ kind: "tool", name: "Grep", target: "TODO" }]);
  });

  test("tool_use with no recognizable input key has no target", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: "Read", input: {} }],
      },
    });
    expect(parseEvent(line)).toEqual([{ kind: "tool", name: "Read" }]);
  });

  test("text sharing a message with a tool_use is narration (progress), then the tool", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Editing now" },
          { type: "tool_use", name: "Write", input: { file_path: "a.ts" } },
        ],
      },
    });
    expect(parseEvent(line)).toEqual([
      { kind: "progress", text: "Editing now" },
      { kind: "tool", name: "Write", target: "a.ts" },
    ]);
  });

  test("text-only assistant message is the answer (kind: text)", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "The answer" }] },
    });
    expect(parseEvent(line)).toEqual([{ kind: "text", text: "The answer" }]);
  });

  test("tool_use with a non-string name is skipped; unknown block types contribute nothing", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          { type: "tool_use", name: 42, input: { file_path: "a.ts" } },
          { type: "thinking", thinking: "hmm" },
          { type: "image", source: {} },
        ],
      },
    });
    expect(parseEvent(line)).toEqual([]);
  });
});

describe("relativizeTarget", () => {
  test("strips the cwd prefix from a path under cwd", () => {
    expect(relativizeTarget("/repo/src/ui/App.tsx", "/repo")).toBe("src/ui/App.tsx");
  });

  test("handles a cwd that already ends with a slash", () => {
    expect(relativizeTarget("/repo/a.ts", "/repo/")).toBe("a.ts");
  });

  test("leaves a path outside cwd unchanged", () => {
    expect(relativizeTarget("/etc/hosts", "/repo")).toBe("/etc/hosts");
  });

  test("leaves a non-path target (Bash command, Grep pattern) unchanged", () => {
    expect(relativizeTarget("ls -la", "/repo")).toBe("ls -la");
    expect(relativizeTarget("TODO", "/repo")).toBe("TODO");
  });

  test("passes undefined through", () => {
    expect(relativizeTarget(undefined, "/repo")).toBeUndefined();
  });
});

describe("buildArgs model/effort", () => {
  test("no settings → no --model/--effort flags (CLI defaults apply)", () => {
    const args = buildArgs("ask");
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--effort");
  });

  test("model and effort are passed as their own flags", () => {
    const args = buildArgs("ask", undefined, { model: "opus", effort: "high" });
    expect(args.join(" ")).toContain("--model opus");
    expect(args.join(" ")).toContain("--effort high");
  });

  test("each flag is independent of the other", () => {
    expect(buildArgs("apply", undefined, { model: "sonnet" })).not.toContain("--effort");
    expect(buildArgs("apply", undefined, { effort: "low" })).not.toContain("--model");
  });

  test("settings are sent on resumed turns too", () => {
    const args = buildArgs("ask", "sid-1", { model: "haiku", effort: "max" });
    expect(args.join(" ")).toContain("--model haiku --effort max --resume sid-1");
  });
});
