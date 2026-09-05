import { $ } from "bun";
import { buildPrompt, relativizeTarget, runTurn } from "./chat/agent";
import { readComments, writeComments } from "./comments/store";
import type { Comment } from "./shared/comments";
import { computeDiff } from "./diff/engine";
import type { DiffMode } from "./diff/types";
import { loadFile } from "./file/loader";
import { annotateDiff } from "./review/annotate";
import { LENSES } from "./review/lenses";
import { runReviewPanel, type TurnRunner } from "./review/runner";
import { DEFAULT_CHAT_AGENT, sanitizeChatSettings } from "./shared/chat";
import type { ChatAsk, ChatServerFrame, ChatWsData } from "./shared/chat";
import type { ReviewServerFrame, ReviewStart, ReviewWsData } from "./shared/review";
import { decodeMode } from "./shared/modeQuery";
import index from "./ui/index.html";

export type ServerOptions = {
  port: number;
  defaultMode?: DiffMode;
  /** Enable frontend HMR + console forwarding. Dev only; off for the shipped binary. */
  development?: boolean;
  /** Injectable agent-turn runner so tests can script agent turns. */
  turnRunner?: TurnRunner;
};

/** Every WebSocket route's per-connection state, discriminated by `kind`. */
type WsData = ChatWsData | ReviewWsData;

export function createServer(options: ServerOptions): Bun.Server<WsData> {
  const { defaultMode } = options;
  const turnRunner = options.turnRunner ?? runTurn;

  return Bun.serve({
    port: options.port,
    development: options.development ? { hmr: true, console: true } : false,
    routes: {
      "/": index,
      "/api/chat": (req, server) => {
        const data: ChatWsData = { kind: "chat", sessionId: null, agent: null, busy: false };
        if (server.upgrade(req, { data })) return undefined;
        return new Response("expected websocket upgrade", { status: 426 });
      },
      "/api/review": (req, server) => {
        const data: ReviewWsData = { kind: "review", busy: false };
        if (server.upgrade(req, { data })) return undefined;
        return new Response("expected websocket upgrade", { status: 426 });
      },
      "/api/config": () => Response.json({ mode: defaultMode ?? null }),
      "/api/diff": {
        GET: async (req) => {
          const mode = decodeMode(new URL(req.url).searchParams) ?? defaultMode;
          if (!mode) return Response.json({ error: "no mode" }, { status: 400 });
          return Response.json(await computeDiff(mode));
        },
      },
      "/api/file": {
        GET: async (req) => {
          const params = new URL(req.url).searchParams;
          const mode = decodeMode(params) ?? defaultMode;
          if (!mode) return Response.json({ error: "no mode" }, { status: 400 });
          const file = params.get("file");
          if (!file) return Response.json({ error: "file required" }, { status: 400 });
          const side = params.get("side");
          if (side !== "new" && side !== "old") {
            return Response.json({ error: "side must be 'new' or 'old'" }, { status: 400 });
          }
          return Response.json(await loadFile(mode, file, side));
        },
      },
      "/api/refs": {
        GET: async (req) => {
          const cwd = new URL(req.url).searchParams.get("cwd");
          if (!cwd) return Response.json({ error: "cwd required" }, { status: 400 });
          const fmt = "%(symref)\t%(refname:short)";
          const r = await $`git -C ${cwd} for-each-ref --format=${fmt} refs/heads refs/remotes`
            .nothrow()
            .quiet();
          const branches = r.stdout
            .toString()
            .split("\n")
            .filter((line) => line.startsWith("\t"))
            .map((line) => line.slice(1));
          return Response.json({ branches });
        },
      },
      "/api/comments": {
        GET: async () => Response.json(await readComments()),
        PUT: async (req) => {
          const comments = (await req.json()) as Comment[];
          if (!Array.isArray(comments)) {
            return Response.json({ error: "expected an array" }, { status: 400 });
          }
          await writeComments(comments);
          return Response.json({ ok: true });
        },
      },
    },
    websocket: {
      async message(ws, raw) {
        const data = ws.data;
        if (data.kind === "review") {
          return handleReviewMessage(ws, data, raw, defaultMode, turnRunner);
        }
        return handleChatMessage(ws, data, raw, turnRunner);
      },
      close(ws) {
        // A client that disconnects mid-review cancels it: kill the turns.
        if (ws.data.kind === "review") ws.data.abort?.abort();
      },
    },
  });
}

/** Handle one /api/chat message: run an agent turn and relay its events. */
async function handleChatMessage(
  ws: Bun.ServerWebSocket<WsData>,
  data: ChatWsData,
  raw: string | Buffer,
  turnRunner: TurnRunner,
): Promise<void> {
  const send = (frame: ChatServerFrame): void => {
    ws.send(JSON.stringify(frame));
  };

  let msg: ChatAsk;
  try {
    msg = JSON.parse(String(raw)) as ChatAsk;
  } catch {
    return;
  }
  if (msg.type !== "ask" || typeof msg.question !== "string") return;
  if (data.busy) {
    send({ type: "busy" });
    return;
  }

  data.busy = true;
  const mode = msg.mode ?? "ask";
  // The frame is untrusted input: keep only well-formed agent/model/effort values.
  const settings = sanitizeChatSettings(msg);
  const agent = settings.agent ?? DEFAULT_CHAT_AGENT;
  // A session is bound to the CLI that created it; a different agent cannot
  // resume it, so switching agents starts over (the client re-sends the diff).
  if (data.agent !== agent) {
    data.sessionId = null;
    data.agent = agent;
  }
  const isFirstTurn = !data.sessionId;
  const prompt = buildPrompt({
    diff: msg.diff ?? "",
    question: msg.question,
    isFirstTurn,
    mode,
  });
  try {
    for await (const event of turnRunner({
      cwd: process.cwd(),
      prompt,
      sessionId: data.sessionId ?? undefined,
      mode,
      ...settings,
    })) {
      switch (event.kind) {
        case "session":
          data.sessionId = event.sessionId;
          send({ type: "session", sessionId: event.sessionId });
          break;
        case "text":
          send({ type: "chunk", text: event.text });
          break;
        case "progress":
          send({ type: "progress", text: event.text });
          break;
        case "tool":
          send({
            type: "tool",
            name: event.name,
            target: relativizeTarget(event.target, process.cwd()),
          });
          break;
        case "error":
          send({ type: "error", message: event.message });
          break;
        case "done":
          // `done` is emitted in the finally below, once the turn has
          // fully completed and `busy` is cleared — so a client that
          // fires its next question on `done` never races `busy`.
          break;
      }
    }
  } finally {
    data.busy = false;
    send({ type: "done" });
  }
}

/**
 * Handle one /api/review message: compute + annotate the requested diff, then
 * run the lens panel, streaming its frames. Every accepted start terminates
 * with exactly one `done` (via finally); `busy` is a lone reply.
 */
async function handleReviewMessage(
  ws: Bun.ServerWebSocket<WsData>,
  data: ReviewWsData,
  raw: string | Buffer,
  defaultMode: DiffMode | undefined,
  turnRunner: TurnRunner,
): Promise<void> {
  const send = (frame: ReviewServerFrame): void => {
    ws.send(JSON.stringify(frame));
  };

  let msg: ReviewStart;
  try {
    msg = JSON.parse(String(raw)) as ReviewStart;
  } catch {
    return;
  }
  if (msg.type !== "start" || typeof msg.modeQuery !== "string") return;
  if (data.busy) {
    send({ type: "busy" });
    return;
  }

  data.busy = true;
  data.abort = new AbortController();
  try {
    const mode = decodeMode(new URLSearchParams(msg.modeQuery)) ?? defaultMode;
    if (!mode) {
      send({ type: "error", message: "no diff mode" });
      return;
    }
    const files = await computeDiff(mode);
    const annotatedDiff = annotateDiff(files);
    if (annotatedDiff === "") {
      send({ type: "error", message: "no reviewable changes" });
      return;
    }
    const runId = crypto.randomUUID().slice(0, 8);
    send({ type: "run", runId, lenses: LENSES.map((l) => l.id) });
    await runReviewPanel({
      annotatedDiff,
      cwd: mode.cwd,
      emit: send,
      signal: data.abort.signal,
      // Untrusted frame: keep only well-formed agent/model/effort values.
      settings: sanitizeChatSettings(msg),
      turnRunner,
    });
  } catch (err) {
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    data.busy = false;
    data.abort = undefined;
    send({ type: "done" });
  }
}
