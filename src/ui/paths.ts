/**
 * Path helpers for display. Paths here are the "/"-separated ones git and the
 * server hand out, never OS-specific.
 */

/** Trailing separators do not count as a segment (`prv plans/` names the directory). */
function trimTrailingSlashes(path: string): string {
  return path.replace(/\/+$/, "");
}

/** The last path segment; "" for an empty path. */
export function basename(path: string): string {
  const trimmed = trimTrailingSlashes(path);
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

/**
 * Split a path for rendering as a shrinkable directory part and a file name
 * that is never truncated. `dir` keeps its trailing slash (or is "" for a
 * root-level file) so the two halves concatenate back to the path.
 */
export function splitPath(path: string): { dir: string; name: string } {
  const trimmed = trimTrailingSlashes(path);
  const cut = trimmed.lastIndexOf("/") + 1;
  return { dir: trimmed.slice(0, cut), name: trimmed.slice(cut) };
}
