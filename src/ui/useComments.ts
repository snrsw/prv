import { useCallback, useEffect, useRef, useState } from "react";
import type { Comment } from "../shared/comments";

/** How long the "Comment deleted — Undo" toast stays actionable. */
export const UNDO_TOAST_MS = 6000;

/**
 * Remove the comment with `id`, returning the new store and the comment that
 * was removed (null when nothing matched). Pure, so `removeComment` can both
 * stash the removed comment for undo and filter the store from one place.
 */
export function removeById(
  comments: Comment[],
  id: string,
): { comments: Comment[]; removed: Comment | null } {
  const removed = comments.find((c) => c.id === id) ?? null;
  return { comments: removed ? comments.filter((c) => c !== removed) : comments, removed };
}

/**
 * App-level store for persistent review comments. Loads from `/api/comments`
 * once `ready`, and debounces a whole-store `PUT` on every change.
 *
 * A single-thread delete is undoable: the removed comment is stashed as
 * `lastRemoved` for `UNDO_TOAST_MS` (latest wins) and `undoRemove` re-adds it.
 */
export function useComments(ready: boolean) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [lastRemoved, setLastRemoved] = useState<Comment | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The latest rendered store, so removeComment can find the comment to stash
  // outside the state updater (which must stay pure).
  const commentsRef = useRef(comments);
  commentsRef.current = comments;

  useEffect(() => {
    if (!lastRemoved) return;
    const timer = setTimeout(() => setLastRemoved(null), UNDO_TOAST_MS);
    return () => clearTimeout(timer);
  }, [lastRemoved]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      try {
        const data = (await fetch("/api/comments").then((r) => r.json())) as Comment[];
        if (!cancelled && Array.isArray(data)) setComments(data);
      } catch {
        /* leave empty on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const mutate = useCallback((fn: (prev: Comment[]) => Comment[]) => {
    setComments((prev) => {
      const next = fn(prev);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        fetch("/api/comments", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(next),
        }).catch(() => {});
      }, 300);
      return next;
    });
  }, []);

  const addComment = useCallback(
    (c: Comment) => mutate((prev) => (prev.some((x) => x.id === c.id) ? prev : [...prev, c])),
    [mutate],
  );
  const updateComment = useCallback(
    (id: string, updater: (c: Comment) => Comment) =>
      mutate((prev) => prev.map((c) => (c.id === id ? updater(c) : c))),
    [mutate],
  );
  const removeComment = useCallback(
    (id: string) => {
      const { removed } = removeById(commentsRef.current, id);
      mutate((prev) => removeById(prev, id).comments);
      if (removed) setLastRemoved(removed);
    },
    [mutate],
  );
  const undoRemove = useCallback(() => {
    if (lastRemoved) addComment(lastRemoved);
    setLastRemoved(null);
  }, [lastRemoved, addComment]);
  const dismissRemoved = useCallback(() => setLastRemoved(null), []);
  /** Remove every matching comment in one mutation (one debounced PUT). */
  const removeWhere = useCallback(
    (pred: (c: Comment) => boolean) => mutate((prev) => prev.filter((c) => !pred(c))),
    [mutate],
  );

  return {
    comments,
    addComment,
    updateComment,
    removeComment,
    removeWhere,
    lastRemoved,
    undoRemove,
    dismissRemoved,
  };
}

export type CommentsApi = ReturnType<typeof useComments>;
