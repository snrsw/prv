import { $ } from "bun";
import { resolve } from "node:path";
import type { DiffMode } from "../diff/types";

export type FileSide = "new" | "old";

export type FileContent =
  | { kind: "text"; content: string }
  | { kind: "missing" }
  | { kind: "binary" };

export async function loadFile(mode: DiffMode, path: string, side: FileSide): Promise<FileContent> {
  const source = resolveSource(mode, side);
  if (source === null) return { kind: "missing" };
  if (source.kind === "disk") return readDiskFile(resolve(source.root, path));
  return readGitFile(source.cwd, source.ref, path);
}

type Source = { kind: "disk"; root: string } | { kind: "git"; cwd: string; ref: string };

function resolveSource(mode: DiffMode, side: FileSide): Source | null {
  // Files mode adds every file from nothing: the new side is the file on disk,
  // and there is no old side.
  if (mode.kind === "files") return side === "new" ? { kind: "disk", root: mode.cwd } : null;
  if (side === "old") return { kind: "git", cwd: mode.cwd, ref: mode.leftRef };
  if (mode.right.kind === "ref") return { kind: "git", cwd: mode.cwd, ref: mode.right.ref };
  return { kind: "disk", root: mode.cwd };
}

async function readDiskFile(absPath: string): Promise<FileContent> {
  try {
    return decodeBytes(await Bun.file(absPath).bytes());
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === "ENOENT") return { kind: "missing" };
    throw e;
  }
}

async function readGitFile(cwd: string, ref: string, path: string): Promise<FileContent> {
  const result = await $`git -C ${cwd} show ${ref}:${path}`.nothrow().quiet();
  if (result.exitCode !== 0) return { kind: "missing" };
  return decodeBytes(result.stdout);
}

function decodeBytes(bytes: Uint8Array): FileContent {
  if (looksBinary(bytes)) return { kind: "binary" };
  return { kind: "text", content: new TextDecoder().decode(bytes) };
}

// Match git's heuristic: NUL byte in the first 8000 bytes implies binary.
export function looksBinary(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 8000);
  for (let i = 0; i < limit; i++) {
    if (bytes[i] === 0) return true;
  }
  return false;
}
