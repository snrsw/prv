import { unlink } from "node:fs/promises";
import { prvDir } from "../comments/store";
import {
  descriptionBytes,
  descriptionTooLargeMessage,
  MAX_DESCRIPTION_BYTES,
  type Description,
} from "../shared/description";

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

/** Thrown by `writeDescription` for Markdown over `MAX_DESCRIPTION_BYTES`. */
export class DescriptionTooLargeError extends Error {}

/**
 * Replace the description for `dir` (creates `.prv/` if needed) and return it
 * as stored. A trailing newline is normalized to exactly one. Markdown over
 * `MAX_DESCRIPTION_BYTES` throws `DescriptionTooLargeError` and writes nothing;
 * every writer checks first, so this is the last line of defense.
 */
export async function writeDescription(
  markdown: string,
  dir: string = process.cwd(),
): Promise<Description> {
  const bytes = descriptionBytes(markdown);
  if (bytes > MAX_DESCRIPTION_BYTES) {
    throw new DescriptionTooLargeError(descriptionTooLargeMessage(bytes));
  }
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

/**
 * Read a byte stream as UTF-8 text, keeping at most `maxBytes` so an unbounded
 * body or pipe is never buffered whole. null when over the cap.
 *
 * Past the cap the stream is cancelled, or with `drain` read to its end and
 * thrown away: an HTTP request body must be consumed for its keep-alive
 * connection to carry the next request (Bun's `maxRequestBodySize` bounds it).
 */
export async function readCapped(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  { drain = false }: { drain?: boolean } = {},
): Promise<string | null> {
  if (stream === null) return "";
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      if (!drain) {
        await reader.cancel();
        return null;
      }
      chunks.length = 0;
      continue;
    }
    chunks.push(value);
  }
  return total > maxBytes ? null : new TextDecoder().decode(Buffer.concat(chunks));
}
