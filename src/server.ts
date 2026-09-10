import { $ } from "bun";
import { buildPrompt, relativizeTarget, runTurn } from "./chat/agent";
import { readComments, writeComments } from "./comments/store";
import { computeDiff } from "./diff/engine";
import type { DiffMode } from "./diff/types";
import { loadFile } from "./file/loader";
import { runBatch } from "./batch/runner";
import { annotateDiff } from "./review/annotate";
import { LENSES } from "./review/lenses";
import { runReviewPanel, type TurnRunner } from "./review/runner";
import { DEFAULT_CHAT_AGENT, sanitizeChatSettings } from "./shared/chat";
import type { ChatClientFrame, ChatServerFrame, ChatWsData } from "./shared/chat";
import type { ReviewServerFrame, ReviewStart, ReviewWsData } from "./shared/review";
import type { BatchServerFrame, BatchStart, BatchWsData } from "./shared/batch";
import { isPendingComment, type Comment, type ReviewSeverity } from "./shared/comments";
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
type WsData = ChatWsData | ReviewWsData | BatchWsData;

/**
 * Whether prv runs from its source tree (`bun src/cli.ts`, `bun test`) rather
 * than the compiled binary, whose modules live under Bun's virtual `$bunfs`
 * root (`/$bunfs/…`; `B:\~BUN\…` on Windows).
 */
const runningFromSource = !/\$bunfs|~BUN/.test(import.meta.path);

export function createServer(options: ServerOptions): Bun.Server<WsData> {
  const { defaultMode } = options;
  const turnRunner = options.turnRunner ?? runTurn;

  return Bun.serve({
    port: options.port,
    // From source, the HTML import must go through Bun's HMR dev server: only
    // it emits cwd-independent asset URLs (`/_bun/asset/…`). The production
    // bundler writes them relative to `process.cwd()` at bundle time, and prv's
    // cwd is the repository under review, so from any directory other than the
    // prv checkout the page linked `/../../<cwd>/chunk-xxx.css` (#63). The
    // compiled binary embeds a prebuilt manifest and is unaffected.
    development: options.development
      ? { hmr: true, console: true }
      : runningFromSource
        ? { hmr: true, console: false }
        : false,
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
      "/api/batch": (req, server) => {
        const data: BatchWsData = { kind: "batch", busy: false };
        if (server.upgrade(req, { data })) return undefined;
        return new Response("expected websocket upgrade", { status: 426 });
      },
      "/api/config": () => Response.json({ mode: defaultMode ?? null }),
      "/api/diff": {
        GET: async (req) => {
          const mode = decodeMode(new URL(req.url).searchParams) ?? defaultMode;
          if (!mode) return Response.json({ error: "no mode" }, { status: 400 });
          try {
            return Response.json(await computeDiff(mode));
          } catch (err) {
            return Response.json({ error: errorMessage(err) }, { status: 400 });
          }
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
          try {
            return Response.json(await loadFile(mode, file, side));
          } catch (err) {
            return Response.json({ error: errorMessage(err) }, { status: 400 });
          }
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
        if (data.kind === "batch") {
          return handleBatchMessage(ws, data, raw, turnRunner);
        }
        return handleChatMessage(ws, data, raw, turnRunner);
      },
      close(ws) {
        // A client that disconnects mid-turn cancels it: kill the agent subprocess(es).
        ws.data.abort?.abort();
      },
    },
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Handle one /api/chat message: run an agent turn and relay its events, or
 * abort the in-flight turn on `stop`. Every accepted ask terminates with
 * exactly one `done` (via finally), stopped or not; `busy` is a lone reply.
 */
async function handleChatMessage(
  ws: Bun.ServerWebSocket<WsData>,
  data: ChatWsData,
  raw: string | Buffer,
  turnRunner: TurnRunner,
): Promise<void> {
  const send = (frame: ChatServerFrame): void => {
    ws.send(JSON.stringify(frame));
  };

  let msg: ChatClientFrame;
  try {
    msg = JSON.parse(String(raw)) as ChatClientFrame;
  } catch {
    return;
  }
  if (msg.type === "stop") {
    // The session survives a stop, so the next ask still resumes it.
    data.abort?.abort();
    return;
  }
  if (msg.type !== "ask" || typeof msg.question !== "string") return;
  if (data.busy) {
    send({ type: "busy" });
    return;
  }

  data.busy = true;
  const abort = new AbortController();
  data.abort = abort;
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
      signal: abort.signal,
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
    data.abort = undefined;
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
    send({ type: "error", message: errorMessage(err) });
  } finally {
    data.busy = false;
    data.abort = undefined;
    send({ type: "done" });
  }
}

const SEVERITIES: readonly ReviewSeverity[] = ["info", "minor", "major", "critical"];

/** Longest review-level instruction accepted; the rest is dropped, not an error. */
const MAX_INSTRUCTIONS = 4000;

/** Keep a client-sent line key's numbers, dropping anything else to null. */
function sanitizeLineKey(value: unknown): { old: number | null; new: number | null } {
  const k = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return { old: num(k.old), new: num(k.new) };
}

/**
 * Keep only the fields the batch prompt reads, from an untrusted client frame:
 * identity, anchor lines, transcript, and the review-finding labels. Anything
 * malformed drops the whole comment rather than half-describing it to the
 * agent. `status` is honored so a resolved thread can never come back in.
 */
function sanitizeBatchComment(value: unknown): Comment | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.id !== "string" || c.id === "" || typeof c.file !== "string") return null;
  if (!Array.isArray(c.anchorText) || !c.anchorText.every((l) => typeof l === "string"))
    return null;
  if (!Array.isArray(c.messages)) return null;
  const messages: Comment["messages"] = [];
  for (const raw of c.messages) {
    if (typeof raw !== "object" || raw === null) return null;
    const m = raw as Record<string, unknown>;
    if ((m.role !== "user" && m.role !== "assistant") || typeof m.text !== "string") return null;
    messages.push({ role: m.role, text: m.text });
  }
  const comment: Comment = {
    id: c.id,
    file: c.file,
    start: sanitizeLineKey(c.start),
    end: sanitizeLineKey(c.end),
    anchorText: c.anchorText as string[],
    status: c.status === "resolved" ? "resolved" : "open",
    messages,
  };
  // Review-finding labels are prompt context only; keep them when well-formed.
  if (c.source === "review") comment.source = "review";
  if (typeof c.title === "string") comment.title = c.title;
  if (typeof c.lens === "string") comment.lens = c.lens;
  if (SEVERITIES.includes(c.severity as ReviewSeverity))
    comment.severity = c.severity as ReviewSeverity;
  return comment;
}

/**
 * Handle one /api/batch message: address every pending comment thread the
 * client sent in a single apply-mode turn, streaming the agent's activity.
 * Every accepted start terminates with exactly one `done` (via finally);
 * `busy` is a lone reply. Like the chat panel's apply turns, the agent runs in
 * prv's own cwd — the repository under review — not in a diff mode's cwd.
 */
async function handleBatchMessage(
  ws: Bun.ServerWebSocket<WsData>,
  data: BatchWsData,
  raw: string | Buffer,
  turnRunner: TurnRunner,
): Promise<void> {
  const send = (frame: BatchServerFrame): void => {
    ws.send(JSON.stringify(frame));
  };

  let msg: BatchStart;
  try {
    msg = JSON.parse(String(raw)) as BatchStart;
  } catch {
    return;
  }
  if (msg.type !== "start" || !Array.isArray(msg.comments)) return;
  if (data.busy) {
    send({ type: "busy" });
    return;
  }

  data.busy = true;
  data.abort = new AbortController();
  try {
    // The client should only send pending threads, but it is untrusted input:
    // re-check, so a stale or hand-crafted frame can never make the agent
    // answer a thread it has already answered (or a resolved one).
    const comments = msg.comments
      .map(sanitizeBatchComment)
      .filter((c): c is Comment => c !== null && isPendingComment(c));
    if (comments.length === 0) {
      send({ type: "error", message: "no pending comments" });
      return;
    }
    const instructions =
      typeof msg.instructions === "string"
        ? msg.instructions.trim().slice(0, MAX_INSTRUCTIONS)
        : "";
    const runId = crypto.randomUUID().slice(0, 8);
    send({ type: "run", runId, count: comments.length });
    await runBatch({
      comments,
      instructions,
      cwd: process.cwd(),
      emit: send,
      signal: data.abort.signal,
      // Untrusted frame: keep only well-formed agent/model/effort values.
      settings: sanitizeChatSettings(msg),
      turnRunner,
    });
  } catch (err) {
    send({ type: "error", message: errorMessage(err) });
  } finally {
    data.busy = false;
    data.abort = undefined;
    send({ type: "done" });
  }
}
