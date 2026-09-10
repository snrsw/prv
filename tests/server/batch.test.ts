import { test, expect, beforeAll, afterAll } from "bun:test";

import { createServer } from "../../src/server";
import type { ChatEvent, RunTurnArgs } from "../../src/chat/agent";
import type { BatchServerFrame } from "../../src/shared/batch";
import type { Comment } from "../../src/shared/comments";

const pending = (over: Partial<Comment> = {}): Comment => ({
  id: "c:2_2:2_2",
  file: "a.ts",
  start: { old: 2, new: 2 },
  end: { old: 2, new: 2 },
  anchorText: [" two"],
  status: "open",
  messages: [{ role: "user", text: "rename this" }],
  ...over,
});

const resultsFor = (comments: Comment[]) =>
  comments.map((c) => ({ id: c.id, file: c.file, reply: "done", done: true }));

/** Args of every turn the fake runner served, for prompt/signal assertions. */
const seenTurns: RunTurnArgs[] = [];
/** What the next turn's final reply should be; reset per test that cares. */
let reply = "";

/** One session, one narration line, then the scripted reply. The sleep keeps
 * the run in flight long enough for a mid-run client message to land. */
async function* fakeTurn(args: RunTurnArgs): AsyncGenerator<ChatEvent> {
  seenTurns.push(args);
  yield { kind: "session", sessionId: "s1" };
  yield { kind: "text", text: "editing" };
  await Bun.sleep(10);
  yield { kind: "done", result: reply };
}

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer({ port: 0, turnRunner: fakeTurn });
});

afterAll(() => {
  server.stop();
});

function openSocket(path: string): Promise<WebSocket> {
  const url = new URL(path, server.url);
  url.protocol = "ws:";
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error(`websocket to ${path} failed`));
  });
}

/** Gather frames until the terminal `done`, optionally reacting to each one. */
function collectFrames<T extends { type: string }>(
  ws: WebSocket,
  onFrame?: (frame: T) => void,
): Promise<T[]> {
  return new Promise((resolve) => {
    const frames: T[] = [];
    ws.onmessage = (e) => {
      const frame = JSON.parse(String(e.data)) as T;
      frames.push(frame);
      onFrame?.(frame);
      if (frame.type === "done") resolve(frames);
    };
  });
}

/** Send one start and collect the whole frame sequence it produces. */
async function startBatch(start: Record<string, unknown>): Promise<BatchServerFrame[]> {
  const ws = await openSocket("/api/batch");
  const framesPromise = collectFrames<BatchServerFrame>(ws);
  ws.send(JSON.stringify({ type: "start", ...start }));
  const frames = await framesPromise;
  ws.close();
  return frames;
}

const fenced = (comments: Comment[]): string =>
  `\`\`\`json\n${JSON.stringify({ results: resultsFor(comments) })}\n\`\`\``;

test("a start streams run → activity → results → one done", async () => {
  const comments = [pending(), pending({ id: "c:_9:_9", file: "b.ts", anchorText: ["+nine"] })];
  reply = fenced(comments);
  const before = seenTurns.length;
  const frames = await startBatch({ comments, instructions: "keep it small" });

  expect(frames[0]).toMatchObject({ type: "run", count: 2 });
  expect((frames[0] as { runId: string }).runId).toHaveLength(8);
  expect(frames.filter((f) => f.type === "progress")).toHaveLength(1);
  expect(frames.find((f) => f.type === "results")).toEqual({
    type: "results",
    results: resultsFor(comments),
    skipped: 0,
  });
  expect(frames.at(-1)).toEqual({ type: "done" });
  expect(frames.filter((f) => f.type === "done")).toHaveLength(1);

  const turn = seenTurns[before];
  expect(turn).toMatchObject({ mode: "apply", cwd: process.cwd() });
  expect(turn?.prompt).toContain("c:_9:_9");
  expect(turn?.prompt).toContain("keep it small");
});

test("threads the agent already answered are dropped before the turn", async () => {
  const before = seenTurns.length;
  const frames = await startBatch({
    comments: [
      pending({
        messages: [
          { role: "user", text: "q" },
          { role: "assistant", text: "a" },
        ],
      }),
      pending({ id: "c:3_3:3_3", status: "resolved" }),
    ],
  });

  expect(frames).toEqual([{ type: "error", message: "no pending comments" }, { type: "done" }]);
  expect(seenTurns).toHaveLength(before); // no agent turn at all
});

test("malformed comments are dropped, and an all-malformed batch is an error", async () => {
  const frames = await startBatch({ comments: ["junk", { id: 7 }, { id: "x", file: 1 }] });
  expect(frames).toEqual([{ type: "error", message: "no pending comments" }, { type: "done" }]);
});

test("an empty comments array is an error, then done", async () => {
  expect(await startBatch({ comments: [] })).toEqual([
    { type: "error", message: "no pending comments" },
    { type: "done" },
  ]);
});

test("an unparseable reply ends in an error after the retry", async () => {
  reply = "I edited the files.";
  const before = seenTurns.length;
  const frames = await startBatch({ comments: [pending()] });

  expect(seenTurns.slice(before)).toHaveLength(2); // first turn + one --resume retry
  expect(frames.at(-2)).toEqual({
    type: "error",
    message: "the agent did not return a parseable results block",
  });
  expect(frames.at(-1)).toEqual({ type: "done" });
});

test("a second start while running gets a lone busy frame", async () => {
  const comments = [pending()];
  reply = fenced(comments);
  const start = JSON.stringify({ type: "start", comments });
  const ws = await openSocket("/api/batch");
  const framesPromise = collectFrames<BatchServerFrame>(ws, (frame) => {
    if (frame.type === "run") ws.send(start); // deterministically mid-run
  });
  ws.send(start);
  const frames = await framesPromise;
  ws.close();

  expect(frames.filter((f) => f.type === "busy")).toHaveLength(1);
  expect(frames.filter((f) => f.type === "run")).toHaveLength(1);
  expect(frames.filter((f) => f.type === "done")).toHaveLength(1);
});

test("closing the socket mid-run aborts the in-flight turn", async () => {
  const comments = [pending()];
  reply = fenced(comments);
  const before = seenTurns.length;
  const ws = await openSocket("/api/batch");
  const sawRun = new Promise<void>((resolve) => {
    ws.onmessage = (e) => {
      if ((JSON.parse(String(e.data)) as BatchServerFrame).type === "run") resolve();
    };
  });
  ws.send(JSON.stringify({ type: "start", comments }));
  await sawRun;
  ws.close();
  await Bun.sleep(30); // let the close reach the server and the run drain

  const turns = seenTurns.slice(before);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.signal?.aborted).toBe(true);
});

test("agent, model and effort ride along; malformed values are dropped", async () => {
  const comments = [pending()];
  reply = fenced(comments);
  let before = seenTurns.length;
  await startBatch({ comments, agent: "codex", model: "gpt-5.5", effort: "high" });
  expect(seenTurns[before]).toMatchObject({ agent: "codex", model: "gpt-5.5", effort: "high" });

  before = seenTurns.length;
  await startBatch({ comments, model: "--bad", effort: "turbo" });
  expect(seenTurns[before]?.model).toBeUndefined();
  expect(seenTurns[before]?.effort).toBeUndefined();
});

test("a non-start frame is ignored entirely", async () => {
  const ws = await openSocket("/api/batch");
  const frames: BatchServerFrame[] = [];
  ws.onmessage = (e) => frames.push(JSON.parse(String(e.data)) as BatchServerFrame);
  ws.send(JSON.stringify({ type: "stop" }));
  ws.send("not json");
  await Bun.sleep(30);
  ws.close();
  expect(frames).toEqual([]);
});

test("/api/batch requires a websocket upgrade", async () => {
  const res = await fetch(new URL("/api/batch", server.url));
  expect(res.status).toBe(426);
});
