import type { DiffMode } from "../diff/types";

export function encodeMode(mode: DiffMode, params: URLSearchParams): void {
  params.set("mode", mode.kind);
  if (mode.kind === "path-vs-path") {
    params.set("a", mode.a);
    params.set("b", mode.b);
    return;
  }
  params.set("cwd", mode.cwd);
  params.set("leftRef", mode.leftRef);
  if (mode.right.kind === "ref") {
    params.set("right", "ref");
    params.set("rightRef", mode.right.ref);
  } else {
    params.set("right", "worktree");
  }
}

export function decodeMode(params: URLSearchParams): DiffMode | null {
  const kind = params.get("mode");
  if (kind === "path-vs-path") {
    const a = params.get("a");
    const b = params.get("b");
    if (!a || !b) return null;
    return { kind, a, b };
  }
  if (kind === "git") {
    const cwd = params.get("cwd");
    const leftRef = params.get("leftRef");
    const right = params.get("right");
    if (!cwd || !leftRef || !right) return null;
    if (right === "worktree") return { kind, cwd, leftRef, right: { kind: "worktree" } };
    if (right === "ref") {
      const rightRef = params.get("rightRef");
      if (!rightRef) return null;
      return { kind, cwd, leftRef, right: { kind: "ref", ref: rightRef } };
    }
  }
  return null;
}
