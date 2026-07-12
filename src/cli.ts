#!/usr/bin/env bun
import { $ } from "bun";
import { stat } from "node:fs/promises";
import type { DiffMode } from "./diff/engine";
import { createServer } from "./server";
import { version } from "./version";

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
  let usedDiff = false;
  let singlePath: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "diff") {
      const a = argv[i + 1];
      const b = argv[i + 2];
      if (!a || !b) throw new Error("`diff` requires two args: prv diff <a> <b>");
      mode = await classifyDiffArgs(cwd, a, b);
      usedDiff = true;
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
    } else if (singlePath !== undefined) {
      throw new Error("prv: only one path is supported. To compare two, use `prv diff <a> <b>`.");
    } else {
      // A bare positional is the single file to view (`prv <file>`).
      singlePath = arg;
    }
  }

  // `prv <file>`: HEAD vs working tree, scoped to a single path.
  if (singlePath !== undefined) {
    if (usedDiff) throw new Error("prv: cannot combine a path argument with `diff`.");
    if (!(await pathExists(singlePath))) throw new Error(`prv: '${singlePath}' does not exist.`);
    mode = { kind: "git", cwd, leftRef: "HEAD", right: { kind: "worktree" }, paths: [singlePath] };
  }

  return { mode, port, open, help, version };
}

const HELP = `prv — Pull-Request like View. Local GitHub-style diff viewer.

Usage:
  prv                          Diff HEAD vs the working tree (default)
  prv diff <a> <b>             Diff two args; each is auto-classified:
                                 path vs path, ref vs ref, or ref + path.
                                 If an arg is both a ref name and an existing
                                 path, the path wins. Force ref with HEAD/a SHA/
                                 origin/<branch>; force path with ./name.
  prv --port <n>               Pin the server port (default: a free port)
  prv --no-open                Do not open a browser
  prv --version, -v            Print version and exit
  prv --help, -h               Print this help and exit

Notes:
  The "chat about the diff" feature requires Claude Code (the \`claude\` CLI)
  installed separately.`;

async function main() {
  const opts = await parseArgs(Bun.argv.slice(2), process.cwd());

  if (opts.help) {
    console.log(HELP);
    return;
  }
  if (opts.version) {
    console.log(version);
    return;
  }

  let server: ReturnType<typeof createServer>;
  try {
    server = createServer({
      port: opts.port,
      defaultMode: opts.mode,
      development: process.env.PRV_DEV === "1",
    });
  } catch (err) {
    if (err instanceof Error && /EADDRINUSE|in use|address already/i.test(err.message)) {
      throw new Error(
        `port ${opts.port} in use — pick another with --port, or omit --port to let prv choose a free one.`,
      );
    }
    throw err;
  }

  const url = String(server.url);
  console.log(`prv listening at ${url}`);

  if (shouldAutoOpen(opts.open, process.platform, process.env)) {
    await openBrowser(url);
  } else if (opts.open) {
    console.log(`(no display detected — open ${url} in a browser manually)`);
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
  const code = await Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).exited;
  if (code !== 0) {
    console.log(`(couldn't open a browser — open ${url} manually)`);
  }
}

if (import.meta.main) {
  try {
    await main();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not a git repository/i.test(message)) {
      console.error(
        "prv: not a git repository. cd into a repo, or compare folders with `prv diff <a> <b>`.",
      );
    } else {
      console.error(`prv: ${message}`);
    }
    process.exit(1);
  }
}
