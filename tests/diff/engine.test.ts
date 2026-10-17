import { test, expect } from "bun:test";
import { $ } from "bun";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { computeDiff } from "../../src/diff/engine";
import { mkTempRepo } from "../support";

const worktreeOf = (repo: string) =>
  ({ kind: "git", cwd: repo, leftRef: "HEAD", right: { kind: "worktree" } }) as const;

test("git HEAD vs worktree: untracked files are reported as added", async () => {
  const repo = await mkTempRepo("prv-repo-");
  writeFileSync(join(repo, "tracked.txt"), "first\n");
  await $`git -C ${repo} add tracked.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  writeFileSync(join(repo, "tracked.txt"), "first changed\n");
  writeFileSync(join(repo, "fresh.md"), "brand new\n");

  const diffs = await computeDiff(worktreeOf(repo));

  const byPath = Object.fromEntries(diffs.map((d) => [d.path, d]));
  expect(byPath["tracked.txt"]?.status).toBe("modified");
  expect(byPath["fresh.md"]?.status).toBe("added");
});

test("git HEAD vs worktree: one modified tracked file produces one FileDiff", async () => {
  const repo = await mkTempRepo("prv-repo-");
  writeFileSync(join(repo, "hello.txt"), "hello\n");
  await $`git -C ${repo} add hello.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  writeFileSync(join(repo, "hello.txt"), "hello world\n");

  const diffs = await computeDiff(worktreeOf(repo));

  expect(diffs).toHaveLength(1);
  expect(diffs[0]?.path).toBe("hello.txt");
  expect(diffs[0]?.status).toBe("modified");
  expect(diffs[0]?.binary).toBe(false);
  expect(diffs[0]?.hunks.length).toBeGreaterThan(0);
});

test("git HEAD vs worktree: a clean tree produces an empty diff list", async () => {
  const repo = await mkTempRepo("prv-repo-");
  writeFileSync(join(repo, "same.txt"), "same\n");
  await $`git -C ${repo} add same.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();

  const diffs = await computeDiff(worktreeOf(repo));

  expect(diffs).toEqual([]);
});

test("git HEAD vs worktree: a deleted tracked file is reported as deleted", async () => {
  const repo = await mkTempRepo("prv-repo-");
  writeFileSync(join(repo, "gone.txt"), "bye\n");
  await $`git -C ${repo} add gone.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  rmSync(join(repo, "gone.txt"));

  const diffs = await computeDiff(worktreeOf(repo));

  expect(diffs).toHaveLength(1);
  expect(diffs[0]?.path).toBe("gone.txt");
  expect(diffs[0]?.status).toBe("deleted");
});

test("git HEAD vs worktree: binary file diff sets binary:true with no hunks", async () => {
  const repo = await mkTempRepo("prv-repo-");
  // PNG signature + a null byte to ensure binary detection
  writeFileSync(join(repo, "img.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
  await $`git -C ${repo} add img.bin`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  writeFileSync(join(repo, "img.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]));

  const diffs = await computeDiff(worktreeOf(repo));

  expect(diffs).toHaveLength(1);
  expect(diffs[0]?.path).toBe("img.bin");
  expect(diffs[0]?.binary).toBe(true);
  expect(diffs[0]?.hunks).toEqual([]);
});

test("git HEAD vs worktree: a nested file keeps its repo-relative path", async () => {
  const repo = await mkTempRepo("prv-repo-");
  mkdirSync(join(repo, "src", "deep"), { recursive: true });
  writeFileSync(join(repo, "src", "deep", "f.txt"), "v1\n");
  await $`git -C ${repo} add src/deep/f.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  writeFileSync(join(repo, "src", "deep", "f.txt"), "v2\n");

  const diffs = await computeDiff(worktreeOf(repo));

  expect(diffs).toHaveLength(1);
  expect(diffs[0]?.path).toBe("src/deep/f.txt");
});

test("git ref vs ref: diffs two commits", async () => {
  const repo = await mkTempRepo("prv-repo-");
  writeFileSync(join(repo, "f.txt"), "v1\n");
  await $`git -C ${repo} add f.txt`.quiet();
  await $`git -C ${repo} commit -q -m v1`.quiet();
  writeFileSync(join(repo, "f.txt"), "v2\n");
  await $`git -C ${repo} commit -aq -m v2`.quiet();

  const diffs = await computeDiff({
    kind: "git",
    cwd: repo,
    leftRef: "HEAD~1",
    right: { kind: "ref", ref: "HEAD" },
  });

  expect(diffs).toHaveLength(1);
  expect(diffs[0]?.path).toBe("f.txt");
  expect(diffs[0]?.status).toBe("modified");
});

test("git HEAD vs worktree: an unknown ref rejects with git's message", async () => {
  const repo = await mkTempRepo("prv-repo-");
  writeFileSync(join(repo, "f.txt"), "x\n");
  await $`git -C ${repo} add f.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();

  const mode = { ...worktreeOf(repo), leftRef: "does-not-exist" };

  await expect(computeDiff(mode)).rejects.toThrow("does-not-exist");
});
