import { useCallback, useEffect, useRef, useState } from "react";
import type { Comment } from "../shared/comments";

/**
 * App-level store for persistent review comments. Loads from `/api/comments`
 * once `ready`, and debounces a whole-store `PUT` on every change.
 */
export function useComments(ready: boolean) {
  const [comments, setComments] = useState<Comment[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    (id: string) => mutate((prev) => prev.filter((c) => c.id !== id)),
    [mutate],
  );

  return { comments, addComment, updateComment, removeComment };
}

export type CommentsApi = ReturnType<typeof useComments>;
