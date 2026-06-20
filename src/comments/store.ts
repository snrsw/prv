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

/** Replace the whole comment store for `dir`. Creates `.prv/` if needed. */
export async function writeComments(
  comments: Comment[],
  dir: string = process.cwd(),
): Promise<void> {
  const payload: CommentsFile = { schema_version: "1.0", comments };
  await Bun.write(commentsPath(dir), JSON.stringify(payload, null, 2));
}
