import { test, expect, describe } from "bun:test";
import { runBatch } from "./runner";
import { BATCH_RETRY_PROMPT } from "./prompt";
import type { TurnRunner } from "../review/runner";
import type { ChatEvent, RunTurnArgs } from "../chat/agent";
import type { BatchServerFrame } from "../shared/batch";
import type { Comment } from "../shared/comments";

const comments: Comment[] = [
  {
    id: "c:2_2:2_2",
    file: "a.ts",
    start: { old: 2, new: 2 },
    end: { old: 2, new: 2 },
    anchorText: [" two"],
    status: "open",
    messages: [{ role: "user", text: "rename this" }],
  },
  {
    id: "c:_9:_9",
    file: "b.ts",
    start: { old: null, new: 9 },
    end: { old: null, new: 9 },
    anchorText: ["+nine"],
    status: "open",
    messages: [{ role: "user", text: "add a test" }],
  },
];

const results = comments.map((c) => ({ id: c.id, file: c.file, reply: "done", done: true }));
const goodReply = `Edited both files.\n\`\`\`json\n${JSON.stringify({ results })}\n\`\`\``;

const done = (result: string): ChatEvent => ({ kind: "done", result });
const session = (id: string): ChatEvent => ({ kind: "session", sessionId: id });

/** Scripted TurnRunner: one event array per call, in call order; records args. */
function fakeRunner(...scripts: (ChatEvent[] | Error)[]): {
  runner: TurnRunner;
  calls: RunTurnArgs[];
} {
  const calls: RunTurnArgs[] = [];
  const runner: TurnRunner = (args) => {
    calls.push(args);
    const script = scripts[calls.length - 1] ?? [];
    return (async function* () {
      if (script instanceof Error) throw script;
      for (const event of script) yield event;
    })();
  };
  return { runner, calls };
}

async function run(
  runner: TurnRunner,
  over: Partial<Parameters<typeof runBatch>[0]> = {},
): Promise<BatchServerFrame[]> {
  const frames: BatchServerFrame[] = [];
  await runBatch({
    comments,
    cwd: "/repo",
    emit: (f) => frames.push(f),
    turnRunner: runner,
    ...over,
  });
  return frames;
}

describe("runBatch", () => {
  test("happy path: activity relayed, then one results frame (no done)", async () => {
    const { runner, calls } = fakeRunner([
      session("s1"),
      { kind: "tool", name: "Edit", target: "/repo/a.ts" },
      { kind: "progress", text: "Editing a.ts" },
      { kind: "text", text: "Narration" },
      done(goodReply),
    ]);
    const frames = await run(runner);
    expect(frames).toEqual([
      { type: "tool", name: "Edit", target: "a.ts" },
      { type: "progress", text: "Editing a.ts" },
      { type: "progress", text: "Narration" },
      { type: "results", results, skipped: 0 },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ cwd: "/repo", mode: "apply" });
  });

  test("the prompt carries every comment's id, file and anchor lines", async () => {
    const { runner, calls } = fakeRunner([done(goodReply)]);
    await run(runner);
    const prompt = calls[0]?.prompt ?? "";
    for (const c of comments) {
      expect(prompt).toContain(c.id);
      expect(prompt).toContain(c.file);
      for (const line of c.anchorText) expect(prompt).toContain(line);
    }
  });

  test("review-level instructions reach the prompt", async () => {
    const { runner, calls } = fakeRunner([done(goodReply)]);
    await run(runner, { instructions: "prefer small diffs" });
    expect(calls[0]?.prompt).toContain("prefer small diffs");
  });

  test("entries for unknown ids surface through the skipped count", async () => {
    const reply = `\`\`\`json\n${JSON.stringify({
      results: [...results, { id: "c:invented", file: "x.ts", reply: "?", done: true }],
    })}\n\`\`\``;
    const { runner } = fakeRunner([done(reply)]);
    const frames = await run(runner);
    expect(frames.at(-1)).toMatchObject({ type: "results", skipped: 1 });
  });

  test("a malformed reply retries once via --resume, then succeeds", async () => {
    const { runner, calls } = fakeRunner([session("s1"), done("no json here")], [done(goodReply)]);
    const frames = await run(runner);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toMatchObject({
      sessionId: "s1",
      prompt: BATCH_RETRY_PROMPT,
      // The edits are already made: the retry only restates the JSON.
      mode: "ask",
    });
    expect(frames.at(-1)).toMatchObject({ type: "results", results, skipped: 0 });
  });

  test("a failed retry ends in an error frame", async () => {
    const { runner } = fakeRunner([session("s1"), done("nope")], [done("still nope")]);
    const frames = await run(runner);
    expect(frames).toEqual([
      { type: "error", message: "the agent did not return a parseable results block" },
    ]);
  });

  test("a malformed reply with no session cannot retry", async () => {
    const { runner, calls } = fakeRunner([done("no json")]);
    const frames = await run(runner);
    expect(calls).toHaveLength(1);
    expect(frames.at(-1)).toMatchObject({ type: "error" });
  });

  test("an error event with no result reports the agent's message", async () => {
    const { runner, calls } = fakeRunner([{ kind: "error", message: "claude CLI not found" }]);
    const frames = await run(runner);
    expect(calls).toHaveLength(1);
    expect(frames).toEqual([{ type: "error", message: "claude CLI not found" }]);
  });

  test("no result and no error message falls back to a generic error", async () => {
    const { runner } = fakeRunner([session("s1")]);
    expect(await run(runner)).toEqual([{ type: "error", message: "the agent produced no result" }]);
  });

  test("an abort stops the batch silently, with no retry", async () => {
    const controller = new AbortController();
    const calls: RunTurnArgs[] = [];
    // The turn aborts mid-stream, then returns a reply that would normally
    // trigger a retry — the abort must win.
    const runner: TurnRunner = (args) => {
      calls.push(args);
      return (async function* () {
        yield session("s1");
        yield { kind: "progress", text: "working" };
        controller.abort();
        yield done("no json here");
      })();
    };
    const frames = await run(runner, { signal: controller.signal });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.signal).toBe(controller.signal);
    expect(frames).toEqual([{ type: "progress", text: "working" }]);
  });

  test("settings reach the first turn and the --resume retry alike", async () => {
    const { runner, calls } = fakeRunner([session("s1"), done("no json here")], [done(goodReply)]);
    await run(runner, { settings: { agent: "codex", model: "gpt-5.5", effort: "low" } });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toMatchObject({ agent: "codex", model: "gpt-5.5", effort: "low" });
    }
  });

  test("without settings the turn carries no agent/model/effort (CLI defaults)", async () => {
    const { runner, calls } = fakeRunner([done(goodReply)]);
    await run(runner);
    expect(calls[0]?.agent).toBeUndefined();
    expect(calls[0]?.model).toBeUndefined();
    expect(calls[0]?.effort).toBeUndefined();
  });
});
