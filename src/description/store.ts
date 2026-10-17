import { unlink } from "node:fs/promises";
import { prvDir } from "../comments/store";
import type { Description } from "../shared/description";

/** Path to the change description for a given repo directory (next to the comment store). */
export function descriptionPath(dir: string): string {
  return `${prvDir(dir)}/description.md`;
}

/** Read the description for `dir`; null when none has been written. */
export async function readDescription(dir: string = process.cwd()): Promise<Description | null> {
  const file = Bun.file(descriptionPath(dir));
  if (!(await file.exists())) return null;
  const markdown = await file.text();
  return { markdown, updatedAt: new Date(file.lastModified).toISOString() };
}

/**
 * Replace the description for `dir` (creates `.prv/` if needed) and return it
 * as stored. A trailing newline is normalized to exactly one.
 */
export async function writeDescription(
  markdown: string,
  dir: string = process.cwd(),
): Promise<Description> {
  await Bun.write(descriptionPath(dir), `${markdown.trimEnd()}\n`);
  return (await readDescription(dir))!;
}

/** Remove the description for `dir`. Returns whether there was one. */
export async function clearDescription(dir: string = process.cwd()): Promise<boolean> {
  try {
    await unlink(descriptionPath(dir));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}
