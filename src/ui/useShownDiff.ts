import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Comment } from "../shared/comments";
import { planReveals, withRanges } from "./fileLineComments";
import {
  addRange,
  expandFile,
  gapsOf,
  revealRange,
  type ExpandDirection,
  type Gap,
  type LineRange,
} from "./hunkExpand";
import { relocateComment } from "./lineContext";
import { isFileLevelComment } from "./reviewComments";
import type { FileDiff } from "./types";

/**
 * The diff as the Diff view shows it, and where its comments go. `shown` is
 * the original diff with any revealed context folded in: lines the reader
 * expanded, and lines a comment sits on that the diff hides (one made in the
 * File view on an unchanged line). Everything downstream reads `shown`, so
 * revealed context behaves exactly like context git sent us.
 *
 * Placement: a comment that relocates against `shown` is `anchored`. One that
 * does not is pending until the file's source is in: shown nowhere. Then it
 * is revealed (its lines are added to the shown context, and it anchors on
 * the next render) or listed as `orphaned` (its lines changed). File-level
 * comments are always listed. A new diff (`resetKey`) hides everything again.
 */
export function useShownDiff({
  file,
  comments,
  expanded,
  resetKey,
  fetchSource,
}: {
  file: FileDiff;
  comments: Comment[];
  /** The card is open; pending comments only load the source while it is. */
  expanded: boolean;
  /** Changes when the comparison changes, so revealed context resets. */
  resetKey: string;
  /** Fetch the file's lines (its new side, or old for a deleted file). */
  fetchSource: () => Promise<string[] | null>;
}) {
  // Context to show, as new-side line ranges, plus the file's own lines to
  // fill them from (fetched on the first expand click, or once a comment
  // needs its hidden lines revealed).
  const [reveals, setReveals] = useState<LineRange[]>([]);
  const [source, setSource] = useState<string[] | null>(null);
  const [sourceFailed, setSourceFailed] = useState(false);
  const sourceRef = useRef<Promise<string[] | null> | null>(null);

  const shown = useMemo(
    () => (source ? expandFile(file, source, reveals) : file),
    [file, source, reveals],
  );
  const gaps = useMemo(
    () => (file.binary ? [] : gapsOf(shown.hunks, source?.length ?? null)),
    [shown.hunks, source, file.binary],
  );

  useEffect(() => {
    sourceRef.current = null;
    setSource(null);
    setSourceFailed(false);
    setReveals((prev) => (prev.length === 0 ? prev : []));
  }, [file.raw, resetKey]);

  const loadSource = useCallback(async (): Promise<string[] | null> => {
    if (!sourceRef.current) sourceRef.current = fetchSource().catch(() => null);
    const lines = await sourceRef.current;
    if (lines) setSource(lines);
    return lines;
  }, [fetchSource]);

  const onExpand = useCallback(
    async (gap: Gap, direction: ExpandDirection) => {
      const range = revealRange(gap, direction);
      if (!range) return;
      if (!(await loadSource())) return;
      setReveals((prev) => addRange(prev, range));
    },
    [loadSource],
  );

  const { anchored, unlocated } = useMemo(() => {
    const located = comments.map((c) => ({ comment: c, loc: relocateComment(shown, c) }));
    return {
      anchored: located.flatMap(({ comment, loc }) => (loc ? [{ comment, loc }] : [])),
      unlocated: located.flatMap(({ comment, loc }) => (loc ? [] : [comment])),
    };
  }, [comments, shown]);

  const hiddenCandidates = useMemo(
    () => unlocated.filter((c) => !isFileLevelComment(c)),
    [unlocated],
  );
  const revealPlan = useMemo(
    () => planReveals(file, hiddenCandidates, sourceFailed ? "failed" : source, reveals),
    [file, hiddenCandidates, sourceFailed, source, reveals],
  );
  const orphaned = useMemo(
    () => unlocated.filter((c) => isFileLevelComment(c) || revealPlan.listed.includes(c)),
    [unlocated, revealPlan],
  );

  const needsSource = expanded && !file.binary && hiddenCandidates.length > 0;
  useEffect(() => {
    if (!needsSource || source || sourceFailed) return;
    let cancelled = false;
    loadSource().then((lines) => {
      if (!lines && !cancelled) setSourceFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [needsSource, source, sourceFailed, loadSource]);
  useEffect(() => {
    if (revealPlan.reveal.length > 0) setReveals((prev) => withRanges(prev, revealPlan.reveal));
  }, [revealPlan]);

  return { shown, gaps, onExpand, anchored, orphaned };
}
