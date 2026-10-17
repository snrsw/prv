import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeDiff } from "../../src/diff/engine";
import { addedFileSection, displayPath } from "../../src/diff/files";
import type { FilesMode } from "../../src/diff/types";

function mkDir(label: string): string {
  return mkdtempSync(join(tmpdir(), label));
}

test("files mode: a text file outside any repository is one added FileDiff", async () => {
  const dir = mkDir("prv-files-");
  writeFileSync(join(dir, "plan.md"), "# Plan\n\n- step one\n");
  const mode: FilesMode = { kind: "files", cwd: dir, paths: ["plan.md"] };

  const diffs = await computeDiff(mode);

  expect(diffs).toHaveLength(1);
  const file = diffs[0]!;
  expect(file.path).toBe("plan.md");
  expect(file.status).toBe("added");
  expect(file.binary).toBe(false);
  expect(file.hunks).toEqual([
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 3,
      header: "",
      lines: ["+# Plan", "+", "+- step one"],
    },
  ]);
});

test("files mode: a path outside cwd is shown absolute, one under it relative", async () => {
  const dir = mkDir("prv-files-");
  const elsewhere = mkDir("prv-files-elsewhere-");
  mkdirSync(join(dir, "sub"));
  writeFileSync(join(dir, "sub", "a.txt"), "a\n");
  writeFileSync(join(elsewhere, "b.txt"), "b\n");
  const mode: FilesMode = {
    kind: "files",
    cwd: dir,
    paths: [join(dir, "sub", "a.txt"), join(elsewhere, "b.txt")],
  };

  const diffs = await computeDiff(mode);

  expect(diffs.map((d) => d.path)).toEqual(["sub/a.txt", join(elsewhere, "b.txt")]);
});

test("files mode: a directory expands to the files under it, skipping .git and .prv", async () => {
  const dir = mkDir("prv-files-dir-");
  mkdirSync(join(dir, "plans", "nested"), { recursive: true });
  mkdirSync(join(dir, "plans", ".prv"));
  mkdirSync(join(dir, "plans", ".git"));
  writeFileSync(join(dir, "plans", "b.md"), "b\n");
  writeFileSync(join(dir, "plans", "a.md"), "a\n");
  writeFileSync(join(dir, "plans", "nested", "c.md"), "c\n");
  writeFileSync(join(dir, "plans", ".prv", "comments.json"), "[]\n");
  writeFileSync(join(dir, "plans", ".git", "HEAD"), "ref\n");
  const mode: FilesMode = { kind: "files", cwd: dir, paths: ["plans"] };

  const diffs = await computeDiff(mode);

  expect(diffs.map((d) => d.path)).toEqual(["plans/a.md", "plans/b.md", "plans/nested/c.md"]);
  expect(diffs.every((d) => d.status === "added")).toBe(true);
});

test("files mode: binary content sets binary:true with no hunks", async () => {
  const dir = mkDir("prv-files-bin-");
  writeFileSync(join(dir, "img.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  const mode: FilesMode = { kind: "files", cwd: dir, paths: ["img.png"] };

  const diffs = await computeDiff(mode);

  expect(diffs).toHaveLength(1);
  expect(diffs[0]?.path).toBe("img.png");
  expect(diffs[0]?.binary).toBe(true);
  expect(diffs[0]?.hunks).toEqual([]);
});

test("addedFileSection matches git's shape for a new file", () => {
  const raw = addedFileSection("x.txt", new TextEncoder().encode("one\ntwo\n"));
  expect(raw).toBe(
    "diff --git a/x.txt b/x.txt\n" +
      "new file mode 100644\n" +
      "--- /dev/null\n" +
      "+++ b/x.txt\n" +
      "@@ -0,0 +1,2 @@\n" +
      "+one\n" +
      "+two\n",
  );
});

test("addedFileSection marks a missing trailing newline like git does", () => {
  const raw = addedFileSection("x.txt", new TextEncoder().encode("one"));
  expect(raw.endsWith("+one\n\\ No newline at end of file\n")).toBe(true);
});

test("addedFileSection: an empty file has a header but no hunk", () => {
  const raw = addedFileSection("empty", new Uint8Array());
  expect(raw).toBe("diff --git a/empty b/empty\nnew file mode 100644\n");
});

test("displayPath is relative under cwd and absolute elsewhere", () => {
  expect(displayPath("/w", "/w/a/b.md")).toBe("a/b.md");
  expect(displayPath("/w", "/other/b.md")).toBe("/other/b.md");
  expect(displayPath("/w", "/w")).toBe("/w");
});
