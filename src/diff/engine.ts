import { $ } from "bun";
import { realpathSync } from "node:fs";
import type { DiffMode, FileDiff, Hunk, Status } from "./types";

export type { DiffMode, FileDiff, GitRight, Hunk, Status } from "./types";

async function computeRawDiff(mode: DiffMode): Promise<string> {
  if (mode.kind === "path-vs-path") {
    const result = await $`git diff --no-color --no-index ${mode.a} ${mode.b}`.nothrow().quiet();
    return result.stdout.toString();
  }
  if (mode.right.kind === "ref") {
    const r = await $`git -C ${mode.cwd} diff --no-color ${mode.leftRef} ${mode.right.ref}`
      .nothrow()
      .quiet();
    return r.stdout.toString();
  }
  const tracked = await $`git -C ${mode.cwd} diff --no-color ${mode.leftRef}`.nothrow().quiet();
  const untracked = await rawUntrackedDiffs(mode.cwd);
  return [tracked.stdout.toString(), untracked].filter((s) => s.length > 0).join("");
}

async function rawUntrackedDiffs(cwd: string): Promise<string> {
  const realCwd = realpathSync(cwd);
  const list = await $`git -C ${cwd} ls-files --others --exclude-standard`.nothrow().quiet();
  const files = list.stdout.toString().split("\n").filter(Boolean);
  const diffs = await Promise.all(
    files.map(async (file) => {
      const r = await $`git diff --no-color --no-index /dev/null ${file}`
        .cwd(realCwd)
        .nothrow()
        .quiet();
      return r.stdout.toString();
    }),
  );
  return diffs.join("");
}

export async function computeDiff(mode: DiffMode): Promise<FileDiff[]> {
  const raw = await computeRawDiff(mode);
  const [aRoot, bRoot] = mode.kind === "path-vs-path" ? [mode.a, mode.b] : [mode.cwd, mode.cwd];
  return parseUnifiedDiff(raw, aRoot, bRoot);
}

function parseUnifiedDiff(text: string, aRoot: string, bRoot: string): FileDiff[] {
  if (text.length === 0) return [];

  const sections = text.split(/^diff --git /m).filter((s) => s.length > 0);
  return sections.map((s) => parseFileSection("diff --git " + s, aRoot, bRoot));
}

function parseFileSection(section: string, aRoot: string, bRoot: string): FileDiff {
  const lines = section.split("\n");
  const headerMatch = /^diff --git (a\/\S+) (b\/\S+)/.exec(lines[0] ?? "");
  let oldHeader = "";
  let newHeader = "";
  let binary = false;
  let i = 1;

  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("--- ")) {
      oldHeader = line.slice(4);
    } else if (line.startsWith("+++ ")) {
      newHeader = line.slice(4);
      i++;
      break;
    } else if (line.startsWith("Binary files ")) {
      binary = true;
      break;
    }
  }

  const status = computeStatus(oldHeader, newHeader);
  const path = computePath({ binary, headerMatch, oldHeader, newHeader, status, aRoot, bRoot });

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

  return { path, status, hunks, binary, raw: section };
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
  aRoot: string;
  bRoot: string;
}): string {
  const { binary, headerMatch, oldHeader, newHeader, status, aRoot, bRoot } = args;
  if (binary) return stripRoot(headerMatch?.[2] ?? "", bRoot);
  return status === "deleted" ? stripRoot(oldHeader, aRoot) : stripRoot(newHeader, bRoot);
}

function stripRoot(prefixedPath: string, root: string): string {
  let out = prefixedPath;
  if (out.startsWith("a/") || out.startsWith("b/")) out = out.slice(2);
  const r = root.startsWith("/") ? root.slice(1) : root;
  if (out.startsWith(r + "/")) out = out.slice(r.length + 1);
  return out;
}
