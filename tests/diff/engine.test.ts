import { test, expect } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeDiff } from "../../src/diff/engine";

test("path-vs-path: one modified file produces one FileDiff with status 'modified'", async () => {
  const root = mkdtempSync(join(tmpdir(), "prv-test-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "hello.txt"), "hello\n");
  writeFileSync(join(b, "hello.txt"), "hello world\n");

  const diffs = await computeDiff({ kind: "path-vs-path", a, b });

  expect(diffs).toHaveLength(1);
  expect(diffs[0]?.path).toBe("hello.txt");
  expect(diffs[0]?.status).toBe("modified");
  expect(diffs[0]?.binary).toBe(false);
  expect(diffs[0]?.hunks.length).toBeGreaterThan(0);
});

test("path-vs-path: identical directories produce an empty diff list", async () => {
  const root = mkdtempSync(join(tmpdir(), "prv-test-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "same.txt"), "same\n");
  writeFileSync(join(b, "same.txt"), "same\n");

  const diffs = await computeDiff({ kind: "path-vs-path", a, b });

  expect(diffs).toEqual([]);
});

test("path-vs-path: binary file diff sets binary:true with no hunks", async () => {
  const root = mkdtempSync(join(tmpdir(), "prv-test-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  // PNG signature + a null byte to ensure binary detection
  writeFileSync(join(a, "img.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));
  writeFileSync(join(b, "img.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]));

  const diffs = await computeDiff({ kind: "path-vs-path", a, b });

  expect(diffs).toHaveLength(1);
  expect(diffs[0]?.path).toBe("img.bin");
  expect(diffs[0]?.binary).toBe(true);
  expect(diffs[0]?.hunks).toEqual([]);
});

test("path-vs-path: file present only in a is reported as deleted", async () => {
  const root = mkdtempSync(join(tmpdir(), "prv-test-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "gone.txt"), "bye\n");

  const diffs = await computeDiff({ kind: "path-vs-path", a, b });

  expect(diffs).toHaveLength(1);
  expect(diffs[0]?.path).toBe("gone.txt");
  expect(diffs[0]?.status).toBe("deleted");
});

test("path-vs-path: file present only in b is reported as added", async () => {
  const root = mkdtempSync(join(tmpdir(), "prv-test-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(b, "new.txt"), "fresh\n");

  const diffs = await computeDiff({ kind: "path-vs-path", a, b });

  expect(diffs).toHaveLength(1);
  expect(diffs[0]?.path).toBe("new.txt");
  expect(diffs[0]?.status).toBe("added");
});

test("git HEAD vs worktree: untracked files are reported as added", async () => {
  const repo = mkdtempSync(join(tmpdir(), "prv-repo-"));
  await $`git -C ${repo} init -q`.quiet();
  writeFileSync(join(repo, "tracked.txt"), "first\n");
  await $`git -C ${repo} -c user.email=t@t -c user.name=T add tracked.txt`.quiet();
  await $`git -C ${repo} -c user.email=t@t -c user.name=T commit -q -m init`.quiet();
  writeFileSync(join(repo, "tracked.txt"), "first changed\n");
  writeFileSync(join(repo, "fresh.md"), "brand new\n");

  const diffs = await computeDiff({
    kind: "git",
    cwd: repo,
    leftRef: "HEAD",
    right: { kind: "worktree" },
  });

  const byPath = Object.fromEntries(diffs.map((d) => [d.path, d]));
  expect(byPath["tracked.txt"]?.status).toBe("modified");
  expect(byPath["fresh.md"]?.status).toBe("added");
});

test("git HEAD vs worktree: one modified tracked file produces one FileDiff", async () => {
  const repo = mkdtempSync(join(tmpdir(), "prv-repo-"));
  await $`git -C ${repo} init -q`.quiet();
  writeFileSync(join(repo, "hello.txt"), "hello\n");
  await $`git -C ${repo} -c user.email=t@t -c user.name=T add hello.txt`.quiet();
  await $`git -C ${repo} -c user.email=t@t -c user.name=T commit -q -m init`.quiet();
  writeFileSync(join(repo, "hello.txt"), "hello world\n");

  const diffs = await computeDiff({
    kind: "git",
    cwd: repo,
    leftRef: "HEAD",
    right: { kind: "worktree" },
  });

  expect(diffs).toHaveLength(1);
  expect(diffs[0]?.path).toBe("hello.txt");
  expect(diffs[0]?.status).toBe("modified");
  expect(diffs[0]?.hunks.length).toBeGreaterThan(0);
});

test("ref-vs-path: ref on left vs sibling folder reports modified file", async () => {
  const repo = mkdtempSync(join(tmpdir(), "prv-repo-"));
  await $`git -C ${repo} init -q`.quiet();
  writeFileSync(join(repo, "hello.txt"), "v1\n");
  await $`git -C ${repo} -c user.email=t@t -c user.name=T add hello.txt`.quiet();
  await $`git -C ${repo} -c user.email=t@t -c user.name=T commit -q -m v1`.quiet();

  const folder = mkdtempSync(join(tmpdir(), "prv-folder-"));
  writeFileSync(join(folder, "hello.txt"), "v2\n");

  const diffs = await computeDiff({
    kind: "ref-vs-path",
    cwd: repo,
    ref: "HEAD",
    path: folder,
    refOnLeft: true,
  });

  expect(diffs).toHaveLength(1);
  expect(diffs[0]?.path).toBe("hello.txt");
  expect(diffs[0]?.status).toBe("modified");
  expect(diffs[0]?.hunks.length).toBeGreaterThan(0);
});

test("ref-vs-path: refOnLeft=false places path on left, so a file present only in the ref is added", async () => {
  const repo = mkdtempSync(join(tmpdir(), "prv-repo-"));
  await $`git -C ${repo} init -q`.quiet();
  writeFileSync(join(repo, "only-in-ref.txt"), "ref-only\n");
  await $`git -C ${repo} -c user.email=t@t -c user.name=T add only-in-ref.txt`.quiet();
  await $`git -C ${repo} -c user.email=t@t -c user.name=T commit -q -m init`.quiet();

  const folder = mkdtempSync(join(tmpdir(), "prv-folder-"));

  const diffs = await computeDiff({
    kind: "ref-vs-path",
    cwd: repo,
    ref: "HEAD",
    path: folder,
    refOnLeft: false,
  });

  expect(diffs).toHaveLength(1);
  expect(diffs[0]?.path).toBe("only-in-ref.txt");
  expect(diffs[0]?.status).toBe("added");
});

test("git ref vs ref: diffs two commits", async () => {
  const repo = mkdtempSync(join(tmpdir(), "prv-repo-"));
  await $`git -C ${repo} init -q`.quiet();
  writeFileSync(join(repo, "f.txt"), "v1\n");
  await $`git -C ${repo} -c user.email=t@t -c user.name=T add f.txt`.quiet();
  await $`git -C ${repo} -c user.email=t@t -c user.name=T commit -q -m v1`.quiet();
  writeFileSync(join(repo, "f.txt"), "v2\n");
  await $`git -C ${repo} -c user.email=t@t -c user.name=T commit -aq -m v2`.quiet();

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
