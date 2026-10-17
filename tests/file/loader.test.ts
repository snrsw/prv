import { test, expect } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadFile } from "../../src/file/loader";
import { mkTempRepo } from "../support";

const worktreeOf = (repo: string) =>
  ({ kind: "git", cwd: repo, leftRef: "HEAD", right: { kind: "worktree" } }) as const;

test("git worktree: new side reads from working tree (covers untracked)", async () => {
  const repo = await mkTempRepo("prv-load-wt-");
  writeFileSync(join(repo, "fresh.md"), "brand new\n");

  const result = await loadFile(worktreeOf(repo), "fresh.md", "new");

  expect(result).toEqual({ kind: "text", content: "brand new\n" });
});

test("git worktree: old side reads from leftRef via git show", async () => {
  const repo = await mkTempRepo("prv-load-wt-");
  writeFileSync(join(repo, "hello.txt"), "v1\n");
  await $`git -C ${repo} add hello.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  writeFileSync(join(repo, "hello.txt"), "v2\n");

  const result = await loadFile(worktreeOf(repo), "hello.txt", "old");

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

test("git worktree: a file absent from the ref returns kind=missing on the old side", async () => {
  const repo = await mkTempRepo("prv-load-missing-");
  await $`git -C ${repo} commit -q --allow-empty -m init`.quiet();
  writeFileSync(join(repo, "fresh.md"), "brand new\n");

  const result = await loadFile(worktreeOf(repo), "fresh.md", "old");

  expect(result).toEqual({ kind: "missing" });
});

test("git worktree: a file absent from disk returns kind=missing on the new side", async () => {
  const repo = await mkTempRepo("prv-load-missing-");
  await $`git -C ${repo} commit -q --allow-empty -m init`.quiet();

  const result = await loadFile(worktreeOf(repo), "gone.txt", "new");

  expect(result).toEqual({ kind: "missing" });
});

test("binary content is reported as kind=binary", async () => {
  const repo = await mkTempRepo("prv-load-bin-");
  writeFileSync(join(repo, "img.bin"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));

  const result = await loadFile(worktreeOf(repo), "img.bin", "new");

  expect(result).toEqual({ kind: "binary" });
});

test("files mode: new side reads the file from disk, old side is missing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "prv-load-files-"));
  writeFileSync(join(dir, "plan.md"), "# plan\n");
  const mode = { kind: "files" as const, cwd: dir, paths: ["plan.md"] };

  expect(await loadFile(mode, "plan.md", "new")).toEqual({ kind: "text", content: "# plan\n" });
  expect(await loadFile(mode, "plan.md", "old")).toEqual({ kind: "missing" });
});

test("files mode: an absolute path outside cwd reads from that path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "prv-load-files-"));
  const elsewhere = mkdtempSync(join(tmpdir(), "prv-load-files-elsewhere-"));
  writeFileSync(join(elsewhere, "plan.md"), "far\n");
  const abs = join(elsewhere, "plan.md");
  const mode = { kind: "files" as const, cwd: dir, paths: [abs] };

  expect(await loadFile(mode, abs, "new")).toEqual({ kind: "text", content: "far\n" });
});
