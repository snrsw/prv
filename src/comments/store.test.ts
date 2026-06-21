import { test, expect, describe, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readComments, writeComments, commentsPath } from "./store";
import type { Comment } from "../shared/comments";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "prv-store-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sample: Comment = {
  id: "c:2_:_3",
  file: "greet.ts",
  start: { old: 2, new: null },
  end: { old: null, new: 3 },
  anchorText: ["-const a = 1;", "+const a = 2;", "+const b = 3;"],
  status: "open",
  messages: [{ role: "user", text: "why?" }],
};

describe("comment store", () => {
  test("write then read round-trips the comments", async () => {
    const dir = tmp();
    await writeComments([sample], dir);
    expect(await readComments(dir)).toEqual([sample]);
  });

  test("missing file reads as empty", async () => {
    expect(await readComments(tmp())).toEqual([]);
  });

  test("corrupt file reads as empty", async () => {
    const dir = tmp();
    mkdirSync(join(dir, ".prv"));
    writeFileSync(commentsPath(dir), "{ not json");
    expect(await readComments(dir)).toEqual([]);
  });

  test("accepts a bare array on disk", async () => {
    const dir = tmp();
    mkdirSync(join(dir, ".prv"));
    writeFileSync(commentsPath(dir), JSON.stringify([sample]));
    expect(await readComments(dir)).toEqual([sample]);
  });
});
