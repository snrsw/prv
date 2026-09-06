import { describe, expect, test } from "bun:test";
import { titleFor } from "./title";

describe("titleFor", () => {
  test("no mode is just the app name", () => {
    expect(titleFor(null)).toBe("prv");
  });

  test("git mode against the working tree", () => {
    expect(
      titleFor({ kind: "git", cwd: "/home/me/prv", leftRef: "HEAD", right: { kind: "worktree" } }),
    ).toBe("prv: HEAD ↔ Working tree");
  });

  test("git mode between two refs", () => {
    expect(
      titleFor({
        kind: "git",
        cwd: "/home/me/prv/",
        leftRef: "main",
        right: { kind: "ref", ref: "feature/x" },
      }),
    ).toBe("prv: main ↔ feature/x");
  });

  test("git mode scoped to paths lists them", () => {
    expect(
      titleFor({
        kind: "git",
        cwd: "/home/me/prv",
        leftRef: "HEAD",
        right: { kind: "worktree" },
        paths: ["src/ui", "README.md"],
      }),
    ).toBe("prv: HEAD ↔ Working tree · src/ui, README.md");
    // An empty scope reads like no scope.
    expect(
      titleFor({
        kind: "git",
        cwd: "/home/me/prv",
        leftRef: "HEAD",
        right: { kind: "worktree" },
        paths: [],
      }),
    ).toBe("prv: HEAD ↔ Working tree");
  });

  test("files mode shows the first basename and how many more", () => {
    expect(titleFor({ kind: "files", cwd: "/x", paths: ["/home/me/.claude/plans/a.md"] })).toBe(
      "a.md · prv",
    );
    expect(titleFor({ kind: "files", cwd: "/x", paths: ["docs/plan.md", "b.md", "c.md"] })).toBe(
      "plan.md +2 · prv",
    );
  });
});
