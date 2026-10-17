import { test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChatEvent, RunTurnArgs } from "../chat/agent";
import type { FileDiff } from "../diff/types";
import type { TurnRunner } from "../review/runner";
import { MAX_DESCRIPTION_BYTES, type DescribeServerFrame } from "../shared/description";
import { runDescribe } from "./runner";
import { readDescription, writeDescription } from "./store";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "prv-describe-run-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const files: FileDiff[] = [
  { path: "a.ts", status: "modified", hunks: [], binary: false, raw: "+changed" },
];

/** Scripted TurnRunner: yields `events`, records its args. */
function fakeRunner(events: ChatEvent[]): { runner: TurnRunner; calls: RunTurnArgs[] } {
  const calls: RunTurnArgs[] = [];
  const runner: TurnRunner = (args) => {
    calls.push(args);
    return (async function* () {
      for (const event of events) yield event;
    })();
  };
  return { runner, calls };
}

async function run(
  runner: TurnRunner,
  storeDir: string,
  signal?: AbortSignal,
): Promise<DescribeServerFrame[]> {
  const frames: DescribeServerFrame[] = [];
  await runDescribe({
    files,
    cwd: "/repo",
    storeDir,
    emit: (f) => frames.push(f),
    signal,
    settings: { agent: "codex", model: "m" },
    turnRunner: runner,
  });
  return frames;
}

test("runs one read-only turn and saves the extracted description", async () => {
  const dir = tmp();
  const { runner, calls } = fakeRunner([
    { kind: "tool", name: "Read", target: "/repo/a.ts" },
    { kind: "text", text: "reading" },
    { kind: "done", result: "<description>## Summary\nX</description>" },
  ]);
  const frames = await run(runner, dir);

  expect(calls).toHaveLength(1);
  expect(calls[0]!.mode).toBe("ask");
  expect(calls[0]!.agent).toBe("codex");
  expect(calls[0]!.model).toBe("m");
  expect(calls[0]!.prompt).toContain("+changed");

  expect(frames.slice(0, 2)).toEqual([
    { type: "tool", name: "Read", target: "a.ts" },
    { type: "progress", text: "reading" },
  ]);
  const last = frames.at(-1)!;
  expect(last.type).toBe("description");
  const saved = await readDescription(dir);
  expect(saved?.markdown).toBe("## Summary\nX\n");
  expect(last).toEqual({ type: "description", description: saved! });
});

test("a turn without a result reports the agent's error and saves nothing", async () => {
  const dir = tmp();
  const { runner } = fakeRunner([{ kind: "error", message: "claude: not logged in" }]);
  expect(await run(runner, dir)).toEqual([{ type: "error", message: "claude: not logged in" }]);
  expect(await readDescription(dir)).toBeNull();
});

test("an empty reply is an error and keeps the old description", async () => {
  const dir = tmp();
  await writeDescription("old", dir);
  const { runner } = fakeRunner([{ kind: "done", result: "<description></description>" }]);
  expect(await run(runner, dir)).toEqual([
    { type: "error", message: "the agent returned an empty description" },
  ]);
  expect((await readDescription(dir))?.markdown).toBe("old\n");
});

test("a stopped run emits nothing and saves nothing", async () => {
  const dir = tmp();
  const abort = new AbortController();
  abort.abort();
  const { runner } = fakeRunner([{ kind: "done", result: "late" }]);
  expect(await run(runner, dir, abort.signal)).toEqual([]);
  expect(await readDescription(dir)).toBeNull();
});

test("an oversized reply is rejected, not truncated, and keeps the old description", async () => {
  const dir = tmp();
  await writeDescription("old", dir);
  const huge = "x".repeat(MAX_DESCRIPTION_BYTES + 1);
  const { runner } = fakeRunner([{ kind: "done", result: `<description>${huge}</description>` }]);
  const frames = await run(runner, dir);
  expect(frames).toHaveLength(1);
  expect(frames[0]!.type).toBe("error");
  expect((await readDescription(dir))?.markdown).toBe("old\n");
});
