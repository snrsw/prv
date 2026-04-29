import { $ } from "bun";
import { readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { computeDiff } from "./diff/engine";
import type { DiffMode } from "./diff/types";
import { decodeMode } from "./shared/modeQuery";
import index from "./ui/index.html";

export type ServerOptions = {
  port: number;
  defaultMode?: DiffMode;
};

export function createServer(options: ServerOptions) {
  const { defaultMode } = options;

  return Bun.serve({
    port: options.port,
    routes: {
      "/": index,
      "/api/config": () => Response.json({ mode: defaultMode ?? null, serverCwd: process.cwd() }),
      "/api/diff": {
        GET: async (req) => {
          const mode = decodeMode(new URL(req.url).searchParams) ?? defaultMode;
          if (!mode) return Response.json({ error: "no mode" }, { status: 400 });
          return Response.json(await computeDiff(mode));
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
    },
  });
}
