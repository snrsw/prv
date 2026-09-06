/** Pure helpers for stepping between review findings across files (#58). */

import type { Comment } from "../shared/comments";
import { isFileLevelComment } from "./reviewComments";

/**
 * The id to jump to from `currentId` in `ordered`, wrapping at both ends.
 * With no current finding (or one that has since gone), "next" starts at the
 * first and "previous" at the last. `null` when there is nothing to visit.
 */
export function nextCommentTarget(
  ordered: string[],
  currentId: string | null,
  direction: 1 | -1,
): string | null {
  if (ordered.length === 0) return null;
  const idx = currentId === null ? -1 : ordered.indexOf(currentId);
  if (idx < 0) return direction === 1 ? ordered[0]! : ordered[ordered.length - 1]!;
  return ordered[(idx + direction + ordered.length) % ordered.length]!;
}

/** Sort key for a comment whose thread is not on screen: its last line, file-level ones last. */
function lineOf(c: Comment): number {
  if (isFileLevelComment(c)) return Number.POSITIVE_INFINITY;
  return c.end.new ?? c.end.old ?? 0;
}

/**
 * `candidates` in reading order. The cards follow `filePaths`; inside a card
 * the rendered threads (`domIds`, in DOM order — the authority, since
 * relocation may have moved a comment) come first, then any comment whose
 * thread is not rendered (collapsed card, orphaned in a hidden body), by
 * line. Ids in `domIds` that are not candidates are ignored.
 */
export function documentOrder(
  filePaths: string[],
  candidates: Comment[],
  domIds: string[],
): string[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const out: string[] = [];
  for (const path of filePaths) {
    const seen = new Set<string>();
    for (const id of domIds) {
      const c = byId.get(id);
      if (!c || c.file !== path || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    const rest = candidates
      .filter((c) => c.file === path && !seen.has(c.id))
      .sort((a, b) => lineOf(a) - lineOf(b));
    for (const c of rest) out.push(c.id);
  }
  return out;
}
