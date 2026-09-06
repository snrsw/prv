import { test, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "../../src/server";
import type { FileDiff } from "../../src/diff/engine";
import { mkTempRepo } from "../support";

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer({ port: 0 });
});

afterAll(() => {
  server.stop();
});

test("GET /api/diff?mode=git&right=worktree returns FileDiff[] of HEAD vs worktree", async () => {
  const repo = await mkTempRepo("prv-srv-git-");
  writeFileSync(join(repo, "hello.txt"), "hello\n");
  await $`git -C ${repo} add hello.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  writeFileSync(join(repo, "hello.txt"), "hello world\n");

  const url = new URL("/api/diff", server.url);
  url.searchParams.set("mode", "git");
  url.searchParams.set("cwd", repo);
  url.searchParams.set("leftRef", "HEAD");
  url.searchParams.set("right", "worktree");

  const res = await fetch(url);
  expect(res.status).toBe(200);
  const body = (await res.json()) as FileDiff[];
  expect(body).toHaveLength(1);
  expect(body[0]?.path).toBe("hello.txt");
  expect(body[0]?.status).toBe("modified");
});

/** /api/diff URL for a HEAD-vs-worktree diff of `repo`. */
function worktreeDiffUrl(repo: string, leftRef = "HEAD"): URL {
  const url = new URL("/api/diff", server.url);
  url.searchParams.set("mode", "git");
  url.searchParams.set("cwd", repo);
  url.searchParams.set("leftRef", leftRef);
  url.searchParams.set("right", "worktree");
  return url;
}

test("GET /api/diff omits prv's own untracked .prv/ store but keeps other untracked files", async () => {
  const repo = await mkTempRepo("prv-srv-prvdir-");
  writeFileSync(join(repo, "base.txt"), "base\n");
  await $`git -C ${repo} add base.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  mkdirSync(join(repo, ".prv"));
  writeFileSync(join(repo, ".prv", "comments.json"), "[]\n");
  writeFileSync(join(repo, "fresh.md"), "brand new\n");

  const res = await fetch(worktreeDiffUrl(repo));
  expect(res.status).toBe(200);
  const paths = ((await res.json()) as FileDiff[]).map((d) => d.path);
  expect(paths).toEqual(["fresh.md"]);
});

test("GET /api/diff reports a pure rename as renamed with old and new paths", async () => {
  const repo = await mkTempRepo("prv-srv-rename-");
  writeFileSync(join(repo, "old.txt"), "same content\n");
  await $`git -C ${repo} add old.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  // git only pairs a delete/add into a rename once both sides are in the index.
  await $`git -C ${repo} mv old.txt new.txt`.quiet();
  await $`git -C ${repo} add -A`.quiet();

  const res = await fetch(worktreeDiffUrl(repo));
  expect(res.status).toBe(200);
  const body = (await res.json()) as FileDiff[];
  expect(body).toHaveLength(1);
  expect(body[0]?.status).toBe("renamed");
  expect(body[0]?.path).toBe("new.txt");
  expect(body[0]?.oldPath).toBe("old.txt");
  expect(body[0]?.hunks).toEqual([]);
});

test("GET /api/diff reports a rename with edits as renamed and keeps its hunks", async () => {
  const repo = await mkTempRepo("prv-srv-rename-mod-");
  const body10 = Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n") + "\n";
  writeFileSync(join(repo, "old.txt"), body10);
  await $`git -C ${repo} add old.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  await $`git -C ${repo} mv old.txt new.txt`.quiet();
  writeFileSync(join(repo, "new.txt"), body10 + "extra\n");
  await $`git -C ${repo} add -A`.quiet();

  const res = await fetch(worktreeDiffUrl(repo));
  expect(res.status).toBe(200);
  const body = (await res.json()) as FileDiff[];
  expect(body).toHaveLength(1);
  expect(body[0]?.status).toBe("renamed");
  expect(body[0]?.path).toBe("new.txt");
  expect(body[0]?.oldPath).toBe("old.txt");
  expect(body[0]?.hunks).toHaveLength(1);
  expect(body[0]?.hunks[0]?.lines).toContain("+extra");
});

test("GET /api/diff answers 400 with git's message for an unknown ref", async () => {
  const repo = await mkTempRepo("prv-srv-badref-");
  writeFileSync(join(repo, "f.txt"), "x\n");
  await $`git -C ${repo} add f.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();

  const res = await fetch(worktreeDiffUrl(repo, "does-not-exist"));
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("does-not-exist");
});

test("GET /api/refs returns local branch names", async () => {
  const repo = await mkTempRepo("prv-srv-refs-");
  writeFileSync(join(repo, "f.txt"), "x\n");
  await $`git -C ${repo} add f.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  await $`git -C ${repo} branch feature`.quiet();

  const url = new URL("/api/refs", server.url);
  url.searchParams.set("cwd", repo);

  const res = await fetch(url);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { branches: string[] };
  expect(body.branches.sort()).toEqual(["feature", "main"]);
});

test("GET /api/refs includes remote-tracking branches and excludes */HEAD", async () => {
  const repo = mkdtempSync(join(tmpdir(), "prv-srv-refs-remote-"));
  await $`git -C ${repo} init -q -b main`.quiet();
  writeFileSync(join(repo, "f.txt"), "x\n");
  await $`git -C ${repo} -c user.email=t@t -c user.name=T add f.txt`.quiet();
  await $`git -C ${repo} -c user.email=t@t -c user.name=T commit -q -m init`.quiet();
  await $`git -C ${repo} update-ref refs/remotes/origin/main HEAD`.quiet();
  await $`git -C ${repo} update-ref refs/remotes/origin/topic HEAD`.quiet();
  await $`git -C ${repo} symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`.quiet();

  const url = new URL("/api/refs", server.url);
  url.searchParams.set("cwd", repo);

  const res = await fetch(url);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { branches: string[] };
  expect(body.branches.sort()).toEqual(["main", "origin/main", "origin/topic"]);
});

test("GET /api/diff?mode=files returns the file whole as an added FileDiff", async () => {
  const dir = mkdtempSync(join(tmpdir(), "prv-srv-files-"));
  writeFileSync(join(dir, "plan.md"), "# plan\n");

  const url = new URL("/api/diff", server.url);
  url.searchParams.set("mode", "files");
  url.searchParams.set("cwd", dir);
  url.searchParams.append("path", "plan.md");

  const res = await fetch(url);
  expect(res.status).toBe(200);
  const body = (await res.json()) as FileDiff[];
  expect(body).toHaveLength(1);
  expect(body[0]?.path).toBe("plan.md");
  expect(body[0]?.status).toBe("added");
  expect(body[0]?.hunks[0]?.lines).toEqual(["+# plan"]);
});
