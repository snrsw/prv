import { test, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createServer } from "../../src/server";
import { encodeMode } from "../../src/shared/modeQuery";
import { mkTempRepo } from "../support";
import type { ChatEvent } from "../../src/chat/agent";
import type { ChatServerFrame } from "../../src/shared/chat";
import type { ReviewServerFrame } from "../../src/shared/review";

const finding = {
  file: "hello.txt",
  side: "new",
  startLine: 1,
  endLine: 1,
  severity: "minor",
  title: "T",
  body: "B",
};
const reply = `\`\`\`json\n${JSON.stringify({ findings: [finding] })}\n\`\`\``;

/** Every turn: a session, one narration line, then a good findings reply.
 * The sleep keeps the run in flight long enough for a mid-run client message
 * (a synchronous fake would finish before a loopback round-trip). */
async function* fakeTurn(): AsyncGenerator<ChatEvent> {
  yield { kind: "session", sessionId: "s1" };
  yield { kind: "text", text: "hi" };
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

async function committedRepo(label: string): Promise<string> {
  const repo = await mkTempRepo(label);
  writeFileSync(join(repo, "hello.txt"), "hello\n");
  await $`git -C ${repo} add .`.quiet();
  await $`git -C ${repo} commit -qm init`.quiet();
  return repo;
}

async function dirtyRepo(): Promise<string> {
  const repo = await committedRepo("prv-review-");
  writeFileSync(join(repo, "hello.txt"), "hello world\n");
  return repo;
}

function gitModeQuery(repo: string): string {
  const params = new URLSearchParams();
  encodeMode({ kind: "git", cwd: repo, leftRef: "HEAD", right: { kind: "worktree" } }, params);
  return params.toString();
}

test("a start over a real repo streams run → per-lens findings → one done", async () => {
  const ws = await openSocket("/api/review");
  const framesPromise = collectFrames<ReviewServerFrame>(ws);
  ws.send(JSON.stringify({ type: "start", modeQuery: gitModeQuery(await dirtyRepo()) }));
  const frames = await framesPromise;
  ws.close();

  expect(frames[0]).toMatchObject({
    type: "run",
    lenses: ["correctness", "silent-failures", "test-coverage"],
  });
  expect((frames[0] as { runId: string }).runId).toHaveLength(8);
  expect(frames.filter((f) => f.type === "findings")).toHaveLength(3);
  expect(frames.filter((f) => f.type === "lens" && f.state === "done")).toHaveLength(3);
  expect(frames.filter((f) => f.type === "progress")).toHaveLength(3);
  const findingsFrame = frames.find((f) => f.type === "findings");
  expect(findingsFrame).toMatchObject({ findings: [finding], skipped: 0 });
  expect(frames.at(-1)).toEqual({ type: "done" });
  expect(frames.filter((f) => f.type === "done")).toHaveLength(1);
});

test("a second start while running gets a lone busy frame", async () => {
  const start = JSON.stringify({ type: "start", modeQuery: gitModeQuery(await dirtyRepo()) });
  const ws = await openSocket("/api/review");
  const framesPromise = collectFrames<ReviewServerFrame>(ws, (frame) => {
    if (frame.type === "run") ws.send(start); // deterministically mid-run
  });
  ws.send(start);
  const frames = await framesPromise;
  ws.close();

  expect(frames.filter((f) => f.type === "busy")).toHaveLength(1);
  expect(frames.filter((f) => f.type === "run")).toHaveLength(1);
  expect(frames.filter((f) => f.type === "done")).toHaveLength(1);
});

test("an undecodable mode with no default mode is an error, then done", async () => {
  const ws = await openSocket("/api/review");
  const framesPromise = collectFrames<ReviewServerFrame>(ws);
  ws.send(JSON.stringify({ type: "start", modeQuery: "" }));
  const frames = await framesPromise;
  ws.close();

  expect(frames).toEqual([{ type: "error", message: "no diff mode" }, { type: "done" }]);
});

test("a clean repo reports no reviewable changes", async () => {
  const ws = await openSocket("/api/review");
  const framesPromise = collectFrames<ReviewServerFrame>(ws);
  const repo = await committedRepo("prv-review-clean-");
  ws.send(JSON.stringify({ type: "start", modeQuery: gitModeQuery(repo) }));
  const frames = await framesPromise;
  ws.close();

  expect(frames).toEqual([{ type: "error", message: "no reviewable changes" }, { type: "done" }]);
});

test("the /api/chat socket still works through the shared dispatcher", async () => {
  const ws = await openSocket("/api/chat");
  const framesPromise = collectFrames<ChatServerFrame>(ws);
  ws.send(JSON.stringify({ type: "ask", question: "what changed?", diff: "d" }));
  const frames = await framesPromise;
  ws.close();

  expect(frames).toEqual([
    { type: "session", sessionId: "s1" },
    { type: "chunk", text: "hi" },
    { type: "done" },
  ]);
});
