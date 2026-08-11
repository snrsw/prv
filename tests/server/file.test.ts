import { test, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createServer } from "../../src/server";
import type { FileContent } from "../../src/file/loader";
import { mkTempRepo } from "../support";

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer({ port: 0 });
});

afterAll(() => {
  server.stop();
});

function fileUrl(params: Record<string, string>): URL {
  const url = new URL("/api/file", server.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

/** Query params for a HEAD-vs-worktree diff of `repo`. */
function worktreeParams(repo: string): Record<string, string> {
  return { mode: "git", cwd: repo, leftRef: "HEAD", right: "worktree" };
}

test("GET /api/file returns the new-side content for a git mode", async () => {
  const repo = await mkTempRepo("prv-srv-file-");
  writeFileSync(join(repo, "hello.txt"), "old\n");
  await $`git -C ${repo} add hello.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  writeFileSync(join(repo, "hello.txt"), "new\n");

  const res = await fetch(fileUrl({ ...worktreeParams(repo), file: "hello.txt", side: "new" }));
  expect(res.status).toBe(200);
  expect((await res.json()) as FileContent).toEqual({ kind: "text", content: "new\n" });
});

test("GET /api/file returns kind=missing for the new side of a deleted file", async () => {
  const repo = await mkTempRepo("prv-srv-file-del-");
  writeFileSync(join(repo, "gone.txt"), "bye\n");
  await $`git -C ${repo} add gone.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  await $`git -C ${repo} rm -q gone.txt`.quiet();

  const newRes = await fetch(fileUrl({ ...worktreeParams(repo), file: "gone.txt", side: "new" }));
  expect((await newRes.json()) as FileContent).toEqual({ kind: "missing" });

  const oldRes = await fetch(fileUrl({ ...worktreeParams(repo), file: "gone.txt", side: "old" }));
  expect((await oldRes.json()) as FileContent).toEqual({ kind: "text", content: "bye\n" });
});

test("GET /api/file returns kind=binary for binary content", async () => {
  const repo = await mkTempRepo("prv-srv-file-bin-");
  writeFileSync(join(repo, "img.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));

  const res = await fetch(fileUrl({ ...worktreeParams(repo), file: "img.bin", side: "new" }));
  expect((await res.json()) as FileContent).toEqual({ kind: "binary" });
});

test("GET /api/file returns 400 when side is missing or invalid", async () => {
  const repo = await mkTempRepo("prv-srv-file-bad-");
  const res = await fetch(fileUrl({ ...worktreeParams(repo), file: "x.txt", side: "left" }));
  expect(res.status).toBe(400);
});

test("GET /api/file returns 400 when file param is missing", async () => {
  const repo = await mkTempRepo("prv-srv-file-bad2-");
  const res = await fetch(fileUrl({ ...worktreeParams(repo), side: "new" }));
  expect(res.status).toBe(400);
});
