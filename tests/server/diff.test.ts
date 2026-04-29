import { test, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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

test("GET /api/diff?mode=path-vs-path returns FileDiff[] for two dirs", async () => {
  const root = mkdtempSync(join(tmpdir(), "prv-srv-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "hello.txt"), "hello\n");
  writeFileSync(join(b, "hello.txt"), "hello world\n");

  const url = new URL("/api/diff", server.url);
  url.searchParams.set("mode", "path-vs-path");
  url.searchParams.set("a", a);
  url.searchParams.set("b", b);

  const res = await fetch(url);
  expect(res.status).toBe(200);
  const body = (await res.json()) as FileDiff[];
  expect(body).toHaveLength(1);
  expect(body[0]?.path).toBe("hello.txt");
  expect(body[0]?.status).toBe("modified");
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
