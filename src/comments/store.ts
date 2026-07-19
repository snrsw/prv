import type { Comment, CommentsFile } from "../shared/comments";

/** Path to the comment store for a given repo directory. */
export function commentsPath(dir: string): string {
  return `${dir}/.prv/comments.json`;
}

/**
 * Read all persisted comments for `dir`. Tolerant of a missing or corrupt
 * file (both yield `[]`), and of either the wrapped `{comments}` shape or a
 * bare array.
 */
export async function readComments(dir: string = process.cwd()): Promise<Comment[]> {
  try {
    const file = Bun.file(commentsPath(dir));
    if (!(await file.exists())) return [];
    const data = (await file.json()) as CommentsFile | Comment[] | null;
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.comments)) return data.comments;
    return [];
  } catch {
    return [];
  }
}

/**
 * Read comments for `dir`, but treat an existing-yet-unreadable store as an
 * error instead of an empty list. Used by the headless CLI, where "corrupt
 * file" silently becoming "no comments" would mislead an agent (and a
 * follow-up write would destroy the corrupt file's contents). Missing file
 * still reads as `[]`. The server keeps the tolerant `readComments` so the
 * browser UI degrades gracefully.
 */
export async function readCommentsStrict(dir: string = process.cwd()): Promise<Comment[]> {
  const file = Bun.file(commentsPath(dir));
  if (!(await file.exists())) return [];
  let data: CommentsFile | Comment[] | null;
  try {
    data = (await file.json()) as CommentsFile | Comment[] | null;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`could not read ${commentsPath(dir)}: ${reason} — fix or remove the file`);
  }
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.comments)) return data.comments;
  throw new Error(
    `could not read ${commentsPath(dir)}: unrecognized shape — fix or remove the file`,
  );
}

/** Replace the whole comment store for `dir`. Creates `.prv/` if needed. */
export async function writeComments(
  comments: Comment[],
  dir: string = process.cwd(),
): Promise<void> {
  const payload: CommentsFile = { schema_version: "1.0", comments };
  await Bun.write(commentsPath(dir), JSON.stringify(payload, null, 2));
}
