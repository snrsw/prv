#!/usr/bin/env bun
import { $ } from "bun";
import { COMMENT_SUBCOMMANDS, runCommentsCli } from "./comments/cli";
import type { DiffMode } from "./diff/engine";
import { createServer } from "./server";
import { pathExists } from "./shared/fs";
import { version } from "./version";

export type CLIOptions = {
  mode: DiffMode;
  port: number;
  open: boolean;
  help: boolean;
  version: boolean;
};

async function isRef(cwd: string, ref: string): Promise<boolean> {
  const r = await $`git -C ${cwd} rev-parse --verify --quiet ${ref}`.nothrow().quiet();
  return r.exitCode === 0;
}

/** `prv diff <a> <b>` compares two git refs; a name that isn't one is an error. */
async function refDiffMode(cwd: string, a: string, b: string): Promise<DiffMode> {
  const [aIsRef, bIsRef] = await Promise.all([isRef(cwd, a), isRef(cwd, b)]);
  const notRefs = [aIsRef ? null : a, bIsRef ? null : b].filter((x) => x !== null);
  if (notRefs.length > 0) {
    throw new Error(
      `not a git ref: ${notRefs.map((r) => `'${r}'`).join(", ")}. ` +
        "prv compares git refs (e.g. `prv diff main HEAD`).",
    );
  }
  return { kind: "git", cwd, leftRef: a, right: { kind: "ref", ref: b } };
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
      mode = await refDiffMode(cwd, a, b);
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
  prv <file>                   Diff HEAD vs the working tree for one file
  prv diff <a> <b>             Diff two git refs (branch, tag, SHA, HEAD)
  prv --port <n>               Pin the server port (default: a free port)
  prv --no-open                Do not open a browser
  prv --version, -v            Print version and exit
  prv --help, -h               Print this help and exit

Review comments (headless, no browser — for agents and scripts):
  prv comments list            List review comments [--unresolved] [--json]
  prv comment <file>:<line> "msg"
                               Add a comment anchored to a diff line
                               [--role user|assistant] [--json]
  prv reply <id> "msg"         Append to a comment thread [--role] [--file <path>]
  prv resolve <id>             Mark a comment resolved [--file <path>]
  prv unresolve <id>           Reopen a resolved comment [--file <path>]

  Comments live in .prv/comments.json under the current directory; run these
  from the repo root. \`prv comment\` anchors to lines of the HEAD-vs-worktree
  diff (changed lines plus nearby context). These keywords take precedence
  over file names — view a file named "comment" with \`prv ./comment\`.

Notes:
  The "chat about the diff" feature requires Claude Code (the \`claude\` CLI)
  installed separately.`;

async function main() {
  const argv = Bun.argv.slice(2);

  // Headless comments CLI: keywords win over file names (`prv ./comment`
  // forces the path form, matching the existing ref/path convention).
  if (argv[0] !== undefined && COMMENT_SUBCOMMANDS.includes(argv[0])) {
    const res = await runCommentsCli(argv, process.cwd());
    if (res.out) console.log(res.out);
    if (res.err) console.error(res.err);
    process.exit(res.code);
  }

  const opts = await parseArgs(argv, process.cwd());

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
      console.error("prv: not a git repository. cd into a git repo and try again.");
    } else {
      console.error(`prv: ${message}`);
    }
    process.exit(1);
  }
}
