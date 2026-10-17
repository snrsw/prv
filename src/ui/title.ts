import { basename } from "./paths";
import type { ServerMode } from "./types";

/**
 * The browser tab title for a loaded comparison, so a window full of prv tabs
 * can be told apart: `repo: base ↔ compare` (scoped paths appended) in git
 * mode, the first file (`+N` more) in files mode, and plain "prv" otherwise.
 */
export function titleFor(mode: ServerMode | null): string {
  if (!mode) return "prv";
  if (mode.kind === "files") {
    const [first = "", ...rest] = mode.paths;
    const more = rest.length > 0 ? ` +${rest.length}` : "";
    return `${basename(first)}${more} · prv`;
  }
  const right = mode.right.kind === "worktree" ? "Working tree" : mode.right.ref;
  const scope = mode.paths && mode.paths.length > 0 ? ` · ${mode.paths.join(", ")}` : "";
  return `${basename(mode.cwd)}: ${mode.leftRef} ↔ ${right}${scope}`;
}
