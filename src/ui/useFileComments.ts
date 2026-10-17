import { useMemo } from "react";
import type { Comment } from "../shared/comments";
import { anchorLine, fullyExpanded, lineRangeComment, linesOnSide } from "./fileLineComments";
import { splitLines } from "./hunkExpand";
import { buildCommentContext, flattenDiff, rangeLabel, relocateComment } from "./lineContext";
import { isMarkdownPath } from "./markdown";
import type { FileContent, FileDiff, FileSide } from "./types";

/** A thread the File view shows under one of its lines (0: above line 1). */
export type FileThread = { comment: Comment; line: number; label: string; context: string };

/**
 * Comments in the File view. Every line of the shown file maps to a row of
 * the fully expanded diff, so any line can take a thread and a thread shows
 * in both views. Only the side the diff's new lines live on (the old side for
 * a deleted file) is commentable, in code and Markdown Source; with no hunks
 * there is nothing to anchor a thread to in the Diff view.
 *
 * `model` is null when the File view takes no comments on its lines. `listed`
 * is what goes below the file: comments its lines cannot show; where it shows
 * no threads (Rendered Markdown, an old-side fallback, no hunks), the Diff
 * view's list (`diffListed`); nothing while it has no text.
 */
export function useFileComments({
  file,
  comments,
  shown,
  content,
  side,
  mdView,
  diffListed,
  createThread,
}: {
  file: FileDiff;
  comments: Comment[];
  /** The File view is on screen. */
  shown: boolean;
  /** The fetched file, once it loaded without error. */
  content: FileContent | null;
  side: FileSide;
  mdView: "rendered" | "source";
  diffListed: Comment[];
  createThread: (range: Pick<Comment, "start" | "end" | "anchorText">) => void;
}) {
  const text = shown && content?.kind === "text" ? content.content : null;
  const commentable =
    text !== null &&
    (side === "new" || file.status === "deleted") &&
    file.hunks.length > 0 &&
    (!isMarkdownPath(file.path) || mdView === "source");

  const diff = useMemo(
    () => (commentable && text !== null ? fullyExpanded(file, splitLines(text)) : null),
    [commentable, file, text],
  );

  const model = useMemo(() => {
    if (!diff) return null;
    const rows = flattenDiff(diff);
    const threads: FileThread[] = [];
    const listed: Comment[] = [];
    const commentedLines = new Set<number>();
    for (const comment of comments) {
      const loc = relocateComment(diff, comment);
      if (!loc) {
        listed.push(comment);
        continue;
      }
      threads.push({
        comment,
        line: anchorLine(rows, loc, side),
        label: rangeLabel(loc.slice),
        context: buildCommentContext(diff, loc.slice),
      });
      if (comment.status === "open") {
        for (const n of linesOnSide(rows, loc, side)) commentedLines.add(n);
      }
    }
    const onSelect = (a: number, b: number) => {
      const range = lineRangeComment(rows, side, a, b);
      if (range) createThread(range);
    };
    return { threads, listed, commentedLines, onSelect };
  }, [diff, comments, side, createThread]);

  const listed = model ? model.listed : text !== null ? diffListed : [];
  return { model, listed };
}
