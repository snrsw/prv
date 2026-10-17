import { $ } from "bun";
import { realpathSync } from "node:fs";
import { SKIPPED_DIRS, rawFilesDiff } from "./files";
import type { DiffMode, FileDiff, Hunk, Status } from "./types";

export type { DiffMode, FileDiff, FilesMode, GitMode, GitRight, Hunk, Status } from "./types";

async function computeRawDiff(mode: DiffMode): Promise<string> {
  if (mode.kind === "files") return rawFilesDiff(mode);
  // `paths`, when set, is a git pathspec that scopes the diff (e.g. `prv <file>`).
  const paths = mode.paths ?? [];
  if (mode.right.kind === "ref") {
    const r =
      await $`git -C ${mode.cwd} diff --no-color ${mode.leftRef} ${mode.right.ref} -- ${paths}`
        .nothrow()
        .quiet();
    return stdoutOrThrow(r);
  }
  const tracked = await $`git -C ${mode.cwd} diff --no-color ${mode.leftRef} -- ${paths}`
    .nothrow()
    .quiet();
  const untracked = await rawUntrackedDiffs(mode.cwd, paths);
  return [stdoutOrThrow(tracked), untracked].filter((s) => s.length > 0).join("");
}

/**
 * A failed `git diff` (unknown ref, not a repo) must not read as "no
 * changes": surface git's own message so the caller can show it.
 */
function stdoutOrThrow(r: Bun.$.ShellOutput): string {
  if (r.exitCode !== 0) {
    const stderr = r.stderr.toString().trim();
    throw new Error(stderr.length > 0 ? stderr : `git diff failed (exit ${r.exitCode})`);
  }
  return r.stdout.toString();
}

async function rawUntrackedDiffs(cwd: string, paths: string[]): Promise<string> {
  const realCwd = realpathSync(cwd);
  const list = await $`git -C ${cwd} ls-files --others --exclude-standard -- ${paths}`
    .nothrow()
    .quiet();
  const files = list.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    // prv's own `.prv/` store is untracked but is not a change under review.
    .filter((file) => !SKIPPED_DIRS.has(file.split("/")[0]!));
  const diffs = await Promise.all(
    files.map(async (file) => {
      // `--` stops git parsing a filename like `--output=x` as an option.
      const r = await $`git diff --no-color --no-index -- /dev/null ${file}`
        .cwd(realCwd)
        .nothrow()
        .quiet();
      return r.stdout.toString();
    }),
  );
  return diffs.join("");
}

export async function computeDiff(mode: DiffMode): Promise<FileDiff[]> {
  return parseUnifiedDiff(await computeRawDiff(mode));
}

function parseUnifiedDiff(text: string): FileDiff[] {
  if (text.length === 0) return [];

  const sections = text.split(/^diff --git /m).filter((s) => s.length > 0);
  return sections.map((s) => parseFileSection("diff --git " + s));
}

function parseFileSection(section: string): FileDiff {
  const lines = section.split("\n");
  const headerMatch = /^diff --git (a\/\S+) (b\/\S+)/.exec(lines[0] ?? "");
  let oldHeader = "";
  let newHeader = "";
  let binary = false;
  // A 100%-similarity rename has no `---`/`+++` pair: its paths only appear
  // in `rename from`/`rename to` (git prints these unprefixed).
  let renameFrom: string | undefined;
  let renameTo: string | undefined;
  let copy = false;
  let i = 1;

  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const move = /^(rename|copy) (from|to) (.+)$/.exec(line);
    if (line.startsWith("--- ")) {
      oldHeader = line.slice(4);
    } else if (line.startsWith("+++ ")) {
      newHeader = line.slice(4);
      i++;
      break;
    } else if (line.startsWith("Binary files ")) {
      binary = true;
      break;
    } else if (move) {
      if (move[1] === "copy") copy = true;
      if (move[2] === "from") renameFrom = move[3];
      else renameTo = move[3];
    }
  }

  // A copy leaves the source in place, so the new file is an addition that
  // merely knows where it came from.
  const status = renameFrom && !copy ? "renamed" : computeStatus(oldHeader, newHeader);
  const path = renameTo ?? computePath({ binary, headerMatch, oldHeader, newHeader, status });

  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  const hunkHeader = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const m = hunkHeader.exec(line);
    if (m) {
      if (current) hunks.push(current);
      current = {
        oldStart: parseInt(m[1]!, 10),
        oldLines: m[2] ? parseInt(m[2], 10) : 1,
        newStart: parseInt(m[3]!, 10),
        newLines: m[4] ? parseInt(m[4], 10) : 1,
        header: m[5]!,
        lines: [],
      };
    } else if (current && (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-"))) {
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);

  return {
    path,
    ...(renameFrom ? { oldPath: renameFrom } : {}),
    status,
    hunks,
    binary,
    raw: section,
  };
}

function computeStatus(oldHeader: string, newHeader: string): Status {
  if (oldHeader === "/dev/null") return "added";
  if (newHeader === "/dev/null") return "deleted";
  return "modified";
}

function computePath(args: {
  binary: boolean;
  headerMatch: RegExpExecArray | null;
  oldHeader: string;
  newHeader: string;
  status: Status;
}): string {
  const { binary, headerMatch, oldHeader, newHeader, status } = args;
  if (binary) return stripSidePrefix(headerMatch?.[2] ?? "");
  return stripSidePrefix(status === "deleted" ? oldHeader : newHeader);
}

/** Git writes every diff path repo-relative behind an `a/` or `b/` side prefix. */
function stripSidePrefix(prefixedPath: string): string {
  const out = prefixedPath;
  return out.startsWith("a/") || out.startsWith("b/") ? out.slice(2) : out;
}
