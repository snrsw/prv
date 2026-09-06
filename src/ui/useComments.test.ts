import { test, expect, describe } from "bun:test";
import { removeById } from "./useComments";
import type { Comment } from "../shared/comments";

const comment = (id: string): Comment => ({
  id,
  file: "a.ts",
  start: { old: null, new: 1 },
  end: { old: null, new: 1 },
  anchorText: ["+x"],
  status: "open",
  messages: [{ role: "user", text: "q" }],
});

describe("removeById", () => {
  test("returns the store without the comment, and the comment for undo", () => {
    const a = comment("a");
    const b = comment("b");
    const { comments, removed } = removeById([a, b], "a");
    expect(comments).toEqual([b]);
    // The very object, so an undo re-adds the thread with its conversation intact.
    expect(removed).toBe(a);
  });

  test("an unknown id leaves the store as-is with nothing to undo", () => {
    const store = [comment("a")];
    const { comments, removed } = removeById(store, "zzz");
    expect(comments).toBe(store);
    expect(removed).toBeNull();
  });
});
