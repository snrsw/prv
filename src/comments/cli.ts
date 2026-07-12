/**
 * Headless comments CLI (`prv comments list`, `prv comment`, `prv reply`,
 * `prv resolve|unresolve`) — the file-based protocol that lets an agent read
 * and write review comments in `.prv/comments.json` without a browser.
 *
 * `prv comment` derives the comment's id/anchor from the computed
 * HEAD-vs-worktree diff (never from raw file content), so CLI-created
 * comments anchor in the UI exactly like browser-created ones.
 */
import { $ } from "bun";
import { computeDiff } from "../diff/engine";
import type { Comment, StoredMessage } from "../shared/comments";
import { pathExists } from "../shared/fs";
import { anchorTextOf, commentId, flattenDiff, keyOfRow } from "../shared/lines";
import { readCommentsStrict, writeComments } from "./store";

export type CliResult = { code: number; out: string; err: string };

export const COMMENT_SUBCOMMANDS: readonly string[] = [
  "comments",
  "comment",
  "reply",
  "resolve",
  "unresolve",
] as const;

const ok = (out = ""): CliResult => ({ code: 0, out, err: "" });
const fail = (err: string): CliResult => ({ code: 1, out: "", err });

/** Parse `<file>:<line>` (split on the LAST colon; line is a positive integer). */
export function parseTarget(target: string): { file: string; line: number } | null {
  const i = target.lastIndexOf(":");
  if (i <= 0) return null;
  const file = target.slice(0, i);
  const lineStr = target.slice(i + 1);
  if (!/^\d+$/.test(lineStr)) return null;
  const line = parseInt(lineStr, 10);
  if (line < 1) return null;
  return { file, line };
}

type Flags = {
  positional: string[];
  unresolved: boolean;
  json: boolean;
  role: StoredMessage["role"];
  file?: string;
};

function parseFlags(argv: string[]): Flags | { error: string } {
  const flags: Flags = { positional: [], unresolved: false, json: false, role: "assistant" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      // End of options: everything after is positional (dash-leading messages).
      flags.positional.push(...argv.slice(i + 1));
      break;
    } else if (arg === "--unresolved") flags.unresolved = true;
    else if (arg === "--json") flags.json = true;
    else if (arg === "--role") {
      const next = argv[++i];
      if (next !== "user" && next !== "assistant")
        return { error: "`--role` must be `user` or `assistant`" };
      flags.role = next;
    } else if (arg === "--file") {
      const next = argv[++i];
      if (!next) return { error: "`--file` requires a path" };
      flags.file = next;
    } else if (arg.startsWith("-")) return { error: `unknown flag: ${arg}` };
    else flags.positional.push(arg);
  }
  return flags;
}

/** Find a comment by id, using `file` to disambiguate cross-file id collisions. */
function locateById(
  comments: Comment[],
  id: string,
  file?: string,
): { comment: Comment } | { error: string } {
  const matches = comments.filter((c) => c.id === id && (!file || c.file === file));
  if (matches.length === 0)
    return { error: `no comment with id ${id}${file ? ` on ${file}` : ""}` };
  if (matches.length > 1) {
    const files = matches.map((c) => c.file).join(", ");
    return { error: `id ${id} matches comments in multiple files: ${files} — pass --file <path>` };
  }
  return { comment: matches[0]! };
}

/** Human label for a comment's range: new-side numbers when available. */
function rangeOf(c: Comment): string {
  const nums = [c.start.new, c.end.new].filter((v): v is number => v != null);
  const olds = [c.start.old, c.end.old].filter((v): v is number => v != null);
  const use = nums.length ? nums : olds;
  if (use.length === 0) return "";
  const lo = Math.min(...use);
  const hi = Math.max(...use);
  const prefix = nums.length ? "" : "old ";
  return lo === hi ? `${prefix}${lo}` : `${prefix}${lo}-${hi}`;
}

function formatComment(c: Comment): string {
  const excerpt = (c.messages[0]?.text ?? "").split("\n")[0] ?? "";
  const count = c.messages.length;
  return [
    `${c.id}  ${c.file}:${rangeOf(c)}  ${c.status}  ${count} message${count === 1 ? "" : "s"}`,
    excerpt ? `  ${excerpt}` : undefined,
  ]
    .filter((l): l is string => l != null)
    .join("\n");
}

async function list(flags: Flags, cwd: string): Promise<CliResult> {
  const all = await readCommentsStrict(cwd);
  const comments = flags.unresolved ? all.filter((c) => c.status === "open") : all;
  if (flags.json) return ok(JSON.stringify(comments, null, 2));
  if (comments.length === 0) return ok("no comments");
  return ok(comments.map(formatComment).join("\n"));
}

async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await $`git -C ${cwd} rev-parse --is-inside-work-tree`.nothrow().quiet();
  return r.exitCode === 0;
}

async function addComment(flags: Flags, cwd: string): Promise<CliResult> {
  const [target, message] = flags.positional;
  if (!target || !message) return fail('usage: prv comment <file>:<line> "message"');
  const parsed = parseTarget(target);
  if (!parsed) return fail(`invalid target '${target}' — expected <file>:<line> (line >= 1)`);
  const file = parsed.file.replace(/^\.\//, "");
  if (!(await pathExists(`${cwd}/${file}`))) return fail(`prv comment: '${file}' does not exist`);
  if (!(await isGitRepo(cwd))) {
    return fail("prv comment: not a git repository — comments anchor to the HEAD-vs-worktree diff");
  }

  const diff = await computeDiff({
    kind: "git",
    cwd,
    leftRef: "HEAD",
    right: { kind: "worktree" },
    paths: [file],
  });
  const fileDiff = diff.find((f) => f.path === file);
  const row = fileDiff ? flattenDiff(fileDiff).find((r) => r.new === parsed.line) : undefined;
  if (!fileDiff || !row) {
    return fail(
      `prv comment: ${file}:${parsed.line} is not part of the HEAD-vs-worktree diff — ` +
        `comments anchor to changed lines (plus nearby context) only`,
    );
  }

  // Build the comment exactly like the UI does, so it relocates in the browser.
  const key = keyOfRow(row);
  const id = commentId(key, key);
  const comments = await readCommentsStrict(cwd);
  if (comments.some((c) => c.id === id && c.file === fileDiff.path)) {
    return fail(
      `prv comment: a comment already exists on ${fileDiff.path}:${parsed.line} — ` +
        `add to its thread with \`prv reply ${id}\``,
    );
  }
  const comment: Comment = {
    id,
    file: fileDiff.path,
    start: key,
    end: key,
    anchorText: anchorTextOf([row]),
    status: "open",
    messages: [{ role: flags.role, text: message }],
  };
  await writeComments([...comments, comment], cwd);
  if (flags.json) return ok(JSON.stringify(comment, null, 2));
  return ok(`created ${id} on ${fileDiff.path}:${parsed.line}`);
}

type Mutation = {
  usage: string;
  errorPrefix: string;
  mutate: (c: Comment) => Comment;
  done: (id: string, file: string) => string;
};

async function mutateById(flags: Flags, cwd: string, m: Mutation): Promise<CliResult> {
  const [id] = flags.positional;
  if (!id) return fail(m.usage);
  const comments = await readCommentsStrict(cwd);
  const located = locateById(comments, id, flags.file);
  if ("error" in located) return fail(`${m.errorPrefix}: ${located.error}`);
  const updated = comments.map((c) => (c === located.comment ? m.mutate(c) : c));
  await writeComments(updated, cwd);
  return ok(m.done(id, located.comment.file));
}

function replyMutation(flags: Flags): Mutation | { error: string } {
  const message = flags.positional[1];
  if (!message) return { error: 'usage: prv reply <id> "message" [--file <path>]' };
  const role = flags.role;
  return {
    usage: 'usage: prv reply <id> "message" [--file <path>]',
    errorPrefix: "prv reply",
    mutate: (c) => ({ ...c, messages: [...c.messages, { role, text: message }] }),
    done: (id, file) => `replied to ${id} (${file})`,
  };
}

const setStatus = (verb: "resolve" | "unresolve"): Mutation => ({
  usage: `usage: prv ${verb} <id> [--file <path>]`,
  errorPrefix: `prv ${verb}`,
  mutate: (c) => ({ ...c, status: verb === "resolve" ? "resolved" : "open" }),
  done: (id, file) => `${verb}d ${id} (${file})`,
});

export async function runCommentsCli(argv: string[], cwd: string): Promise<CliResult> {
  const [command, ...rest] = argv;
  const flags = parseFlags(rest);
  if ("error" in flags) return fail(`prv ${command}: ${flags.error}`);

  try {
    return await dispatch(command!, flags, cwd);
  } catch (err) {
    // e.g. a corrupt .prv/comments.json from readCommentsStrict.
    const message = err instanceof Error ? err.message : String(err);
    return fail(`prv ${command}: ${message}`);
  }
}

async function dispatch(command: string, flags: Flags, cwd: string): Promise<CliResult> {
  switch (command) {
    case "comments": {
      const [sub, ...subRest] = flags.positional;
      if (sub !== "list") return fail("usage: prv comments list [--unresolved] [--json]");
      if (subRest.length > 0) return fail("usage: prv comments list [--unresolved] [--json]");
      return list(flags, cwd);
    }
    case "comment":
      return addComment(flags, cwd);
    case "reply": {
      const m = replyMutation(flags);
      if ("error" in m) return fail(m.error);
      return mutateById(flags, cwd, m);
    }
    case "resolve":
    case "unresolve":
      return mutateById(flags, cwd, setStatus(command));
    default:
      return fail(`prv: unknown command '${command}'`);
  }
}
