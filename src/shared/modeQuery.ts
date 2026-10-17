import type { DiffMode } from "../diff/types";

export function encodeMode(mode: DiffMode, params: URLSearchParams): void {
  params.set("mode", mode.kind);
  params.set("cwd", mode.cwd);
  if (mode.kind === "files") {
    for (const p of mode.paths) params.append("path", p);
    return;
  }
  params.set("leftRef", mode.leftRef);
  for (const p of mode.paths ?? []) params.append("path", p);
  if (mode.right.kind === "ref") {
    params.set("right", "ref");
    params.set("rightRef", mode.right.ref);
  } else {
    params.set("right", "worktree");
  }
}

export function decodeMode(params: URLSearchParams): DiffMode | null {
  const kind = params.get("mode");
  const cwd = params.get("cwd");
  if (!cwd) return null;
  if (kind === "files") {
    const paths = params.getAll("path");
    return paths.length > 0 ? { kind, cwd, paths } : null;
  }
  if (kind === "git") {
    const leftRef = params.get("leftRef");
    const right = params.get("right");
    if (!leftRef || !right) return null;
    // `paths` is omitted (not `[]`) when absent so an unscoped mode round-trips as-is.
    const paths = params.getAll("path");
    const scope = paths.length > 0 ? { paths } : {};
    if (right === "worktree") return { kind, cwd, leftRef, right: { kind: "worktree" }, ...scope };
    if (right === "ref") {
      const rightRef = params.get("rightRef");
      if (!rightRef) return null;
      return { kind, cwd, leftRef, right: { kind: "ref", ref: rightRef }, ...scope };
    }
  }
  return null;
}
