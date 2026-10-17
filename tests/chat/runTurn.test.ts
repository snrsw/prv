import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn, type ChatEvent } from "../../src/chat/agent";

/**
 * End-to-end over `runTurn` with fake `claude` and `codex` executables on
 * PATH: each script records its argv and stdin, then replays a canned stream
 * so the spawn loop, backend dispatch and stdin prompt delivery are covered
 * without either real CLI.
 */

let bin: string;
let originalPath: string | undefined;

const CODEX_STREAM = [
  { type: "thread.started", thread_id: "thread-9" },
  { type: "turn.started" },
  { type: "item.started", item: { id: "0", type: "command_execution", command: "cat a.ts" } },
  { type: "item.completed", item: { id: "0", type: "command_execution", command: "cat a.ts" } },
  { type: "item.completed", item: { id: "1", type: "agent_message", text: "Done." } },
  { type: "turn.completed", usage: {} },
];

const CLAUDE_STREAM = [
  { type: "system", subtype: "init", session_id: "sess-1" },
  { type: "assistant", message: { content: [{ type: "text", text: "Hi" }] } },
  { type: "result", subtype: "success", result: "Hi" },
];

function fakeCli(name: string, stream: unknown[]): void {
  const script = [
    "#!/bin/sh",
    `printf '%s\\n' "$*" > "${bin}/${name}.argv"`,
    `cat > "${bin}/${name}.stdin"`,
    ...stream.map((line) => `echo '${JSON.stringify(line)}'`),
  ].join("\n");
  writeFileSync(join(bin, name), script + "\n");
  chmodSync(join(bin, name), 0o755);
}

beforeAll(() => {
  bin = mkdtempSync(join(tmpdir(), "prv-fake-cli-"));
  fakeCli("codex", CODEX_STREAM);
  fakeCli("claude", CLAUDE_STREAM);
  originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
});

afterAll(() => {
  process.env.PATH = originalPath;
  rmSync(bin, { recursive: true, force: true });
});

async function collect(events: AsyncGenerator<ChatEvent>): Promise<ChatEvent[]> {
  const out: ChatEvent[] = [];
  for await (const event of events) out.push(event);
  return out;
}

const read = (name: string) => Bun.file(join(bin, name)).text();

describe("runTurn dispatch", () => {
  test("agent: codex spawns `codex exec --json` with the prompt on stdin", async () => {
    const events = await collect(
      runTurn({
        cwd: bin,
        prompt: "explain the diff",
        agent: "codex",
        mode: "ask",
        model: "gpt-5.5",
        effort: "high",
      }),
    );
    expect(events).toEqual([
      { kind: "session", sessionId: "thread-9" },
      { kind: "tool", name: "Bash", target: "cat a.ts" },
      { kind: "text", text: "Done." },
      { kind: "done", result: "Done." },
    ]);
    const argv = (await read("codex.argv")).trim();
    expect(argv).toBe(
      'exec --json --color never -c approval_policy="never" --sandbox read-only --model gpt-5.5 -c model_reasoning_effort="high" -',
    );
    expect(await read("codex.stdin")).toBe("explain the diff");
  });

  test("a resumed codex turn uses the resume subcommand", async () => {
    await collect(runTurn({ cwd: bin, prompt: "more", agent: "codex", sessionId: "thread-9" }));
    expect((await read("codex.argv")).trim()).toEndWith("--sandbox read-only resume thread-9 -");
    expect(await read("codex.stdin")).toBe("more");
  });

  test("the default agent is still claude", async () => {
    const events = await collect(runTurn({ cwd: bin, prompt: "hello" }));
    expect(events).toEqual([
      { kind: "session", sessionId: "sess-1" },
      { kind: "text", text: "Hi" },
      { kind: "done", result: "Hi" },
    ]);
    expect((await read("claude.argv")).trim()).toStartWith("--print --verbose");
    expect(await read("claude.stdin")).toBe("hello");
  });

  test("a CLI that exits without a result reports an error naming the backend", async () => {
    fakeCli("codex", []); // prints nothing
    const events = await collect(runTurn({ cwd: bin, prompt: "x", agent: "codex" }));
    expect(events).toEqual([
      { kind: "error", message: "codex exited with code 0 before producing a result." },
    ]);
    fakeCli("codex", CODEX_STREAM);
  });
});
