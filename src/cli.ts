#!/usr/bin/env bun
import type { DiffMode } from "./diff/engine";
import { createServer } from "./server";

export type CLIOptions = {
  mode: DiffMode;
  port: number;
  open: boolean;
};

export function parseArgs(argv: string[], cwd: string): CLIOptions {
  let mode: DiffMode = { kind: "git", cwd, leftRef: "HEAD", right: { kind: "worktree" } };
  let port = 0;
  let open = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "diff") {
      const a = argv[i + 1];
      const b = argv[i + 2];
      if (!a || !b) throw new Error("`diff` requires two paths: prv diff <a> <b>");
      mode = { kind: "path-vs-path", a, b };
      i += 2;
    } else if (arg === "--no-open") {
      open = false;
    } else if (arg === "--port") {
      const next = argv[i + 1];
      if (!next) throw new Error("`--port` requires a number");
      port = parseInt(next, 10);
      i += 1;
    }
  }

  return { mode, port, open };
}

async function main() {
  const opts = parseArgs(Bun.argv.slice(2), process.cwd());
  const server = createServer({ port: opts.port, defaultMode: opts.mode });
  console.log(`prv listening at ${server.url}`);
  if (opts.open) {
    await openBrowser(String(server.url));
  }
}

async function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", url]
        : ["xdg-open", url];
  await Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).exited;
}

if (import.meta.main) {
  await main();
}
