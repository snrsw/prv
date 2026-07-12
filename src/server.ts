import { $ } from "bun";
import { readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { buildPrompt, runTurn } from "./chat/agent";
import { readComments, writeComments } from "./comments/store";
import type { Comment } from "./shared/comments";
import { computeDiff } from "./diff/engine";
import type { DiffMode } from "./diff/types";
import { loadFile } from "./file/loader";
import type { ChatAsk, ChatServerFrame, ChatWsData } from "./shared/chat";
import { decodeMode } from "./shared/modeQuery";
import index from "./ui/index.html";

export type ServerOptions = {
  port: number;
  defaultMode?: DiffMode;
};

export function createServer(options: ServerOptions): Bun.Server<ChatWsData> {
  const { defaultMode } = options;

  return Bun.serve({
    port: options.port,
    routes: {
      "/": index,
      "/api/chat": (req, server) => {
        const data: ChatWsData = { sessionId: null, busy: false };
        if (server.upgrade(req, { data })) return undefined;
        return new Response("expected websocket upgrade", { status: 426 });
      },
      "/api/config": () => Response.json({ mode: defaultMode ?? null, serverCwd: process.cwd() }),
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
      "/api/list-dirs": {
        GET: async (req) => {
          const path = new URL(req.url).searchParams.get("path");
          if (!path || !isAbsolute(path)) return Response.json({ dirs: [] });
          try {
            const entries = await readdir(path, { withFileTypes: true });
            const dirs = entries
              .filter((e) => e.isDirectory() && !e.name.startsWith("."))
              .map((e) => join(path, e.name))
              .sort();
            return Response.json({ dirs });
          } catch {
            return Response.json({ dirs: [] });
          }
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
        const isFirstTurn = !data.sessionId;
        const mode = msg.mode ?? "ask";
        const prompt = buildPrompt({
          diff: msg.diff ?? "",
          question: msg.question,
          isFirstTurn,
          mode,
        });
        try {
          for await (const event of runTurn({
            cwd: process.cwd(),
            prompt,
            sessionId: data.sessionId ?? undefined,
            mode,
          })) {
            switch (event.kind) {
              case "session":
                data.sessionId = event.sessionId;
                send({ type: "session", sessionId: event.sessionId });
                break;
              case "text":
                send({ type: "chunk", text: event.text });
                break;
              case "tool":
                send({ type: "tool", name: event.name, target: event.target });
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
      },
    },
  });
}
