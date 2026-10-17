import { describe, expect, test } from "bun:test";
import { fileUiStorageKey, parseStoredFileUi, pruneFileUi, updateFileUi } from "./useFileUiState";

describe("updateFileUi", () => {
  test("records a change for a path", () => {
    expect(updateFileUi({}, "a.ts", { viewed: true })).toEqual({ "a.ts": { viewed: true } });
  });

  test("merges a patch into an existing entry", () => {
    const state = updateFileUi({ "a.ts": { viewed: true } }, "a.ts", { view: "file" });
    expect(state).toEqual({ "a.ts": { viewed: true, view: "file" } });
  });

  test("drops fields back at their default and empty entries", () => {
    const state = updateFileUi({ "a.ts": { viewed: true, view: "file" } }, "a.ts", {
      viewed: false,
    });
    expect(state).toEqual({ "a.ts": { view: "file" } });
    expect(updateFileUi(state, "a.ts", { view: "diff" })).toEqual({});
  });

  test("returns the same object when nothing changes", () => {
    const state = { "a.ts": { collapsed: true } };
    expect(updateFileUi(state, "a.ts", { collapsed: true })).toBe(state);
    expect(updateFileUi(state, "b.ts", { viewed: false, mdView: "rendered" })).toBe(state);
  });

  test("leaves other paths untouched", () => {
    const state = updateFileUi({ "a.ts": { viewed: true } }, "b.ts", { mdView: "source" });
    expect(state).toEqual({ "a.ts": { viewed: true }, "b.ts": { mdView: "source" } });
  });
});

describe("pruneFileUi", () => {
  test("drops entries for paths no longer in the diff", () => {
    const state = { "a.ts": { viewed: true }, "gone.ts": { collapsed: true } };
    expect(pruneFileUi(state, ["a.ts", "new.ts"])).toEqual({ "a.ts": { viewed: true } });
  });

  test("returns the same object when every path is still present", () => {
    const state = { "a.ts": { viewed: true } };
    expect(pruneFileUi(state, ["a.ts", "b.ts"])).toBe(state);
  });
});

describe("parseStoredFileUi", () => {
  test("is empty when nothing is stored or the value is garbage", () => {
    expect(parseStoredFileUi(null)).toEqual({});
    expect(parseStoredFileUi("{")).toEqual({});
    expect(parseStoredFileUi("[1]")).toEqual({});
  });

  test("keeps well-typed fields and discards the rest", () => {
    const raw = JSON.stringify({
      "a.ts": { viewed: true, view: "file", mdView: "bogus", extra: 1 },
      "b.ts": "nope",
      "c.md": { collapsed: "yes", mdView: "source" },
    });
    expect(parseStoredFileUi(raw)).toEqual({
      "a.ts": { viewed: true, view: "file" },
      "c.md": { mdView: "source" },
    });
  });
});

describe("fileUiStorageKey", () => {
  test("differs per comparison and is stable for the same one", () => {
    const worktree = {
      kind: "git" as const,
      cwd: "/repo",
      leftRef: "main",
      right: { kind: "worktree" as const },
    };
    const tagged = { ...worktree, right: { kind: "ref" as const, ref: "v1" } };
    expect(fileUiStorageKey(worktree)).toStartWith("prv:fileUi:");
    expect(fileUiStorageKey(worktree)).toBe(fileUiStorageKey({ ...worktree }));
    expect(fileUiStorageKey(worktree)).not.toBe(fileUiStorageKey(tagged));
    expect(fileUiStorageKey(null)).toBe("prv:fileUi:default");
  });
});
