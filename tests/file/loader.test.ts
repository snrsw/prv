import { test, expect } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadFile } from "../../src/file/loader";
import { mkTempRepo } from "../support";

test("path-vs-path: new side returns content from b", async () => {
  const root = mkdtempSync(join(tmpdir(), "prv-load-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "hello.txt"), "old\n");
  writeFileSync(join(b, "hello.txt"), "new\n");

  const result = await loadFile({ kind: "path-vs-path", a, b }, "hello.txt", "new");

  expect(result).toEqual({ kind: "text", content: "new\n" });
});

test("path-vs-path: old side returns content from a", async () => {
  const root = mkdtempSync(join(tmpdir(), "prv-load-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "hello.txt"), "old\n");
  writeFileSync(join(b, "hello.txt"), "new\n");

  const result = await loadFile({ kind: "path-vs-path", a, b }, "hello.txt", "old");

  expect(result).toEqual({ kind: "text", content: "old\n" });
});

test("path-vs-path: missing on the requested side returns kind=missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "prv-load-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "gone.txt"), "bye\n");

  const result = await loadFile({ kind: "path-vs-path", a, b }, "gone.txt", "new");

  expect(result).toEqual({ kind: "missing" });
});

test("git worktree: new side reads from working tree (covers untracked)", async () => {
  const repo = await mkTempRepo("prv-load-wt-");
  writeFileSync(join(repo, "fresh.md"), "brand new\n");

  const result = await loadFile(
    { kind: "git", cwd: repo, leftRef: "HEAD", right: { kind: "worktree" } },
    "fresh.md",
    "new",
  );

  expect(result).toEqual({ kind: "text", content: "brand new\n" });
});

test("git worktree: old side reads from leftRef via git show", async () => {
  const repo = await mkTempRepo("prv-load-wt-");
  writeFileSync(join(repo, "hello.txt"), "v1\n");
  await $`git -C ${repo} add hello.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  writeFileSync(join(repo, "hello.txt"), "v2\n");

  const result = await loadFile(
    { kind: "git", cwd: repo, leftRef: "HEAD", right: { kind: "worktree" } },
    "hello.txt",
    "old",
  );

  expect(result).toEqual({ kind: "text", content: "v1\n" });
});

test("git ref-vs-ref: each side reads its own ref", async () => {
  const repo = await mkTempRepo("prv-load-rr-");
  writeFileSync(join(repo, "f.txt"), "v1\n");
  await $`git -C ${repo} add f.txt`.quiet();
  await $`git -C ${repo} commit -q -m v1`.quiet();
  writeFileSync(join(repo, "f.txt"), "v2\n");
  await $`git -C ${repo} commit -aq -m v2`.quiet();

  const mode = {
    kind: "git" as const,
    cwd: repo,
    leftRef: "HEAD~1",
    right: { kind: "ref" as const, ref: "HEAD" },
  };

  expect(await loadFile(mode, "f.txt", "old")).toEqual({ kind: "text", content: "v1\n" });
  expect(await loadFile(mode, "f.txt", "new")).toEqual({ kind: "text", content: "v2\n" });
});

test("ref-vs-path refOnLeft=true: new side reads from path, old side reads from ref", async () => {
  const repo = await mkTempRepo("prv-load-rp-");
  writeFileSync(join(repo, "hello.txt"), "v1\n");
  await $`git -C ${repo} add hello.txt`.quiet();
  await $`git -C ${repo} commit -q -m v1`.quiet();

  const folder = mkdtempSync(join(tmpdir(), "prv-folder-"));
  writeFileSync(join(folder, "hello.txt"), "v2\n");

  const mode = {
    kind: "ref-vs-path" as const,
    cwd: repo,
    ref: "HEAD",
    path: folder,
    refOnLeft: true,
  };

  expect(await loadFile(mode, "hello.txt", "new")).toEqual({ kind: "text", content: "v2\n" });
  expect(await loadFile(mode, "hello.txt", "old")).toEqual({ kind: "text", content: "v1\n" });
});

test("ref-vs-path refOnLeft=false: new side reads from ref, old side reads from path", async () => {
  const repo = await mkTempRepo("prv-load-rp2-");
  writeFileSync(join(repo, "hello.txt"), "v2\n");
  await $`git -C ${repo} add hello.txt`.quiet();
  await $`git -C ${repo} commit -q -m v2`.quiet();

  const folder = mkdtempSync(join(tmpdir(), "prv-folder-"));
  writeFileSync(join(folder, "hello.txt"), "v1\n");

  const mode = {
    kind: "ref-vs-path" as const,
    cwd: repo,
    ref: "HEAD",
    path: folder,
    refOnLeft: false,
  };

  expect(await loadFile(mode, "hello.txt", "new")).toEqual({ kind: "text", content: "v2\n" });
  expect(await loadFile(mode, "hello.txt", "old")).toEqual({ kind: "text", content: "v1\n" });
});

test("binary content is reported as kind=binary", async () => {
  const root = mkdtempSync(join(tmpdir(), "prv-load-bin-"));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(b, "img.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));

  const result = await loadFile({ kind: "path-vs-path", a, b }, "img.bin", "new");

  expect(result).toEqual({ kind: "binary" });
});
