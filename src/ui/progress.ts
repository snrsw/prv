/** Pure review-progress counts for the sidebar and topbar (#55). */

import type { Comment, ReviewSeverity } from "../shared/comments";
import type { FileUiState } from "./useFileUiState";

/** Open comments (any source) per file path; files without any are absent. */
export function openCommentsByFile(comments: Comment[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of comments) {
    if (c.status === "open") out[c.file] = (out[c.file] ?? 0) + 1;
  }
  return out;
}

/** How many of `paths` the reader has marked Viewed. */
export function viewedCount(paths: string[], ui: FileUiState): number {
  return paths.filter((p) => ui[p]?.viewed === true).length;
}

/**
 * Sum of `byFile` over every file under `dirPath`. The tree collapses
 * single-child directories into one row, so the row's path is the deepest
 * directory and a plain prefix match covers the whole subtree.
 */
export function subtreeOpenCount(byFile: Record<string, number>, dirPath: string): number {
  const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
  let sum = 0;
  for (const [path, n] of Object.entries(byFile)) {
    if (path.startsWith(prefix)) sum += n;
  }
  return sum;
}

/** An unresolved agent finding — what the review panel counts and navigates. */
export function isOpenFinding(c: Comment): boolean {
  return c.source === "review" && c.status === "open";
}

/** Open findings per severity, only severities that occur; missing severity counts as "info". */
export function openFindingsBySeverity(
  comments: Comment[],
): Partial<Record<ReviewSeverity, number>> {
  const out: Partial<Record<ReviewSeverity, number>> = {};
  for (const c of comments) {
    if (!isOpenFinding(c)) continue;
    const s = c.severity ?? "info";
    out[s] = (out[s] ?? 0) + 1;
  }
  return out;
}
