import { test, expect, beforeAll, afterAll } from "bun:test";

import { createServer } from "../../src/server";
import type { ChatEvent, RunTurnArgs } from "../../src/chat/agent";
import type { ChatServerFrame } from "../../src/shared/chat";

/** Args of every turn the fake runner served, for signal assertions. */
const seenTurns: RunTurnArgs[] = [];

/** Resolves when `signal` aborts, or after `ms` as a safety net. */
function abortedOrTimeout(signal: AbortSignal | undefined, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (!signal || signal.aborted) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Every turn: a session and one chunk, then it hangs (like a CLI waiting on
 * a login prompt) until aborted — or, as a safety net, for a second — and
 * only produces a result when it was not aborted. Mirrors `runTurn`, which
 * ends silently on abort.
 */
async function* fakeTurn(args: RunTurnArgs): AsyncGenerator<ChatEvent> {
  seenTurns.push(args);
  yield { kind: "session", sessionId: "s1" };
  yield { kind: "text", text: "hi" };
  await abortedOrTimeout(args.signal, 1000);
  if (args.signal?.aborted) return;
  yield { kind: "done", result: "hi" };
}

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer({ port: 0, turnRunner: fakeTurn });
});

afterAll(() => {
  server.stop();
});

function openSocket(): Promise<WebSocket> {
  const url = new URL("/api/chat", server.url);
  url.protocol = "ws:";
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => reject(new Error("websocket to /api/chat failed"));
  });
}

/** Gather frames until the terminal `done`, optionally reacting to each one. */
function collectFrames(
  ws: WebSocket,
  onFrame?: (frame: ChatServerFrame) => void,
): Promise<ChatServerFrame[]> {
  return new Promise((resolve) => {
    const frames: ChatServerFrame[] = [];
    ws.onmessage = (e) => {
      const frame = JSON.parse(String(e.data)) as ChatServerFrame;
      frames.push(frame);
      onFrame?.(frame);
      if (frame.type === "done") resolve(frames);
    };
  });
}

const ask = (question: string) => JSON.stringify({ type: "ask", question, diff: "d" });

test("a stop frame aborts the in-flight turn and exactly one done still arrives", async () => {
  const before = seenTurns.length;
  const ws = await openSocket();
  const framesPromise = collectFrames(ws, (frame) => {
    if (frame.type === "chunk") ws.send(JSON.stringify({ type: "stop" })); // deterministically mid-turn
  });
  ws.send(ask("q1"));
  const frames = await framesPromise;

  expect(seenTurns[before]?.signal?.aborted).toBe(true);
  expect(frames).toEqual([
    { type: "session", sessionId: "s1" },
    { type: "chunk", text: "hi" },
    { type: "done" },
  ]);

  // The socket and its session survive the stop: the next ask resumes it and
  // is accepted (no `busy`), since the aborted turn released the connection.
  const nextFrames = collectFrames(ws);
  ws.send(ask("q2"));
  const frames2 = await nextFrames;
  ws.close();
  expect(frames2.some((f) => f.type === "busy")).toBe(false);
  expect(frames2.at(-1)).toEqual({ type: "done" });
  expect(seenTurns[before + 1]).toMatchObject({ sessionId: "s1", prompt: "q2" });
});

test("a stop frame with no turn in flight is ignored", async () => {
  const ws = await openSocket();
  const framesPromise = collectFrames(ws);
  ws.send(JSON.stringify({ type: "stop" }));
  ws.send(ask("q"));
  const frames = await framesPromise;
  ws.close();
  expect(frames.at(-1)).toEqual({ type: "done" });
  expect(frames.filter((f) => f.type === "done")).toHaveLength(1);
});

test("closing the socket mid-turn aborts the in-flight turn", async () => {
  const before = seenTurns.length;
  const ws = await openSocket();
  const sawChunk = new Promise<void>((resolve) => {
    ws.onmessage = (e) => {
      if ((JSON.parse(String(e.data)) as ChatServerFrame).type === "chunk") resolve();
    };
  });
  ws.send(ask("q"));
  await sawChunk;
  ws.close();
  await Bun.sleep(30); // let the close reach the server

  expect(seenTurns[before]?.signal?.aborted).toBe(true);
});
