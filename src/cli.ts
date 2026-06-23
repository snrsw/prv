#!/usr/bin/env bun
import { $ } from "bun";
import { stat } from "node:fs/promises";
import type { DiffMode } from "./diff/engine";
import { createServer } from "./server";

export type CLIOptions = {
  mode: DiffMode;
  port: number;
  open: boolean;
  help: boolean;
  version: boolean;
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
  let help = false;
  let version = false;

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
    } else if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--version" || arg === "-v") {
      version = true;
    } else if (arg === "--port") {
      const next = argv[i + 1];
      if (!next) throw new Error("`--port` requires a number");
      port = parseInt(next, 10);
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  return { mode, port, open, help, version };
}

async function main() {
  const opts = await parseArgs(Bun.argv.slice(2), process.cwd());
  const server = createServer({ port: opts.port, defaultMode: opts.mode });
  console.log(`prv listening at ${server.url}`);
  if (opts.open) {
    await openBrowser(String(server.url));
  }
}

export function shouldAutoOpen(
  open: boolean,
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): boolean {
  if (!open) return false;
  // macOS/Windows have a system opener that works without an X/Wayland session.
  if (platform !== "linux") return true;
  // On Linux a GUI needs a display server; otherwise xdg-open is pointless.
  return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
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
