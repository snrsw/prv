import { stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { looksBinary } from "../file/loader";
import type { FilesMode } from "./types";

/** Directories never listed as changes: git's own store and prv's comment store. */
export const SKIPPED_DIRS = new Set([".git", ".prv"]);

/**
 * A unified diff that adds every file of `mode` from nothing, in the exact
 * shape `git diff` gives a new file, so the parser and renderer treat the
 * two alike. Paths are shown relative to `cwd` when they are under it and
 * absolute otherwise.
 */
export async function rawFilesDiff(mode: FilesMode): Promise<string> {
  const files = await listFiles(mode);
  const sections = await Promise.all(
    files.map(async ({ abs, path }) => addedFileSection(path, await Bun.file(abs).bytes())),
  );
  return sections.join("");
}

/** Resolve `mode.paths` to files: a directory expands to everything under it. */
export async function listFiles(mode: FilesMode): Promise<{ abs: string; path: string }[]> {
  const out: { abs: string; path: string }[] = [];
  for (const p of mode.paths) {
    const abs = resolve(mode.cwd, p);
    const shown = displayPath(mode.cwd, abs);
    if ((await stat(abs)).isDirectory()) {
      const glob = new Bun.Glob("**/*");
      const inside = (await Array.fromAsync(glob.scan({ cwd: abs, dot: true, onlyFiles: true })))
        .filter((rel) => !SKIPPED_DIRS.has(rel.split("/")[0]!))
        .sort();
      for (const rel of inside) out.push({ abs: join(abs, rel), path: join(shown, rel) });
    } else {
      out.push({ abs, path: shown });
    }
  }
  return out;
}

export function displayPath(cwd: string, abs: string): string {
  const rel = relative(cwd, abs);
  return rel === "" || rel.startsWith("..") || isAbsolute(rel) ? abs : rel;
}

export function addedFileSection(path: string, bytes: Uint8Array): string {
  const header = `diff --git a/${path} b/${path}\nnew file mode 100644\n`;
  if (looksBinary(bytes)) return header + `Binary files /dev/null and b/${path} differ\n`;

  const lines = new TextDecoder().decode(bytes).split("\n");
  const endsWithNewline = lines.at(-1) === "";
  if (endsWithNewline) lines.pop();
  if (lines.length === 0) return header;

  return (
    header +
    `--- /dev/null\n+++ b/${path}\n` +
    `@@ -0,0 +1,${lines.length} @@\n` +
    lines.map((l) => `+${l}\n`).join("") +
    (endsWithNewline ? "" : "\\ No newline at end of file\n")
  );
}
