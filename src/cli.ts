#!/usr/bin/env bun
import { $ } from "bun";
import { stat } from "node:fs/promises";
import type { DiffMode } from "./diff/engine";
import { createGatewayResolver } from "./lsp/createResolver";
import { createServer } from "./server";

export type CLIOptions = {
  mode: DiffMode;
  port: number;
  open: boolean;
};

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isRef(cwd: string, ref: string): Promise<boolean> {
  const r = await $`git -C ${cwd} rev-parse --verify --quiet ${ref}`.nothrow().quiet();
  return r.exitCode === 0;
}

async function classifyDiffArgs(cwd: string, a: string, b: string): Promise<DiffMode> {
  const [aIsPath, bIsPath] = await Promise.all([pathExists(a), pathExists(b)]);
  const [aIsRef, bIsRef] = await Promise.all([
    aIsPath ? Promise.resolve(false) : isRef(cwd, a),
    bIsPath ? Promise.resolve(false) : isRef(cwd, b),
  ]);

  if (aIsPath && bIsPath) return { kind: "path-vs-path", a, b };
  if (aIsRef && bIsRef) return { kind: "git", cwd, leftRef: a, right: { kind: "ref", ref: b } };
  if (aIsRef && bIsPath) return { kind: "ref-vs-path", cwd, ref: a, path: b, refOnLeft: true };
  if (aIsPath && bIsRef) return { kind: "ref-vs-path", cwd, ref: b, path: a, refOnLeft: false };
  throw new Error(
    `prv diff: '${a}' and '${b}' are neither both paths, both refs, nor a ref+path pair.`,
  );
}

export async function parseArgs(argv: string[], cwd: string): Promise<CLIOptions> {
  let mode: DiffMode = { kind: "git", cwd, leftRef: "HEAD", right: { kind: "worktree" } };
  let port = 0;
  let open = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "diff") {
      const a = argv[i + 1];
      const b = argv[i + 2];
      if (!a || !b) throw new Error("`diff` requires two args: prv diff <a> <b>");
      mode = await classifyDiffArgs(cwd, a, b);
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
  const opts = await parseArgs(Bun.argv.slice(2), process.cwd());
  const lsp = createGatewayResolver();
  const server = createServer({
    port: opts.port,
    defaultMode: opts.mode,
    resolveDefinition: lsp.resolver,
    resolveReferences: lsp.references,
  });
  console.log(`prv listening at ${server.url}`);
  process.on("SIGINT", () => {
    void lsp.shutdown().finally(() => process.exit(0));
  });
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
