import { test, expect } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../../src/cli";
import { mkTempRepo } from "../support";

test("`./comments` is a path, not the comments subcommand (keyword escape hatch)", async () => {
  // The comments-CLI dispatch keys on a bare keyword; `./comments` must fall
  // through to the viewer and serve a file literally named `comments`,
  // instead of running the headless comments CLI.
  const repo = await mkTempRepo("prv-cli-escape-");
  writeFileSync(join(repo, "comments"), "i am a file\n");
  await $`git -C ${repo} add comments`.quiet();
  await $`git -C ${repo} commit -qm init`.quiet();
  writeFileSync(join(repo, "comments"), "edited\n");

  const cliPath = join(import.meta.dir, "../../src/cli.ts");
  const proc = Bun.spawn(["bun", cliPath, "./comments", "--no-open", "--port", "0"], {
    cwd: repo,
    stdout: "pipe",
    stderr: "pipe",
  });
  // The viewer path prints "prv listening at <url>"; the headless path would
  // instead print comments output and exit. Read until we see the banner.
  const reader = proc.stdout.getReader();
  let buf = "";
  const decoder = new TextDecoder();
  while (!buf.includes("listening at")) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value);
  }
  proc.kill();
  expect(buf).toContain("prv listening at");
});

test("no args → git mode HEAD vs worktree at cwd, open=true, port=0", async () => {
  const opts = await parseArgs([], "/work");
  expect(opts.mode).toEqual({
    kind: "git",
    cwd: "/work",
    leftRef: "HEAD",
    right: { kind: "worktree" },
  });
  expect(opts.open).toBe(true);
  expect(opts.port).toBe(0);
});

test("--no-open turns off browser launch", async () => {
  const opts = await parseArgs(["--no-open"], "/work");
  expect(opts.open).toBe(false);
});

test("--port 8765 sets port", async () => {
  const opts = await parseArgs(["--port", "8765"], "/work");
  expect(opts.port).toBe(8765);
});

test("diff <ref> <path>: ref classified as ref, existing dir as path → ref-vs-path with refOnLeft=true", async () => {
  const repo = await mkTempRepo("prv-cli-");
  await $`git -C ${repo} commit -q --allow-empty -m init`.quiet();
  const folder = mkdtempSync(join(tmpdir(), "prv-cli-folder-"));

  const opts = await parseArgs(["diff", "HEAD", folder], repo);

  expect(opts.mode).toEqual({
    kind: "ref-vs-path",
    cwd: repo,
    ref: "HEAD",
    path: folder,
    refOnLeft: true,
  });
});

test("diff <path> <ref>: refOnLeft=false when path comes first", async () => {
  const repo = await mkTempRepo("prv-cli-");
  await $`git -C ${repo} commit -q --allow-empty -m init`.quiet();
  const folder = mkdtempSync(join(tmpdir(), "prv-cli-folder-"));

  const opts = await parseArgs(["diff", folder, "HEAD"], repo);

  expect(opts.mode).toEqual({
    kind: "ref-vs-path",
    cwd: repo,
    ref: "HEAD",
    path: folder,
    refOnLeft: false,
  });
});

test("diff <path> <path>: both existing dirs → path-vs-path", async () => {
  const a = mkdtempSync(join(tmpdir(), "prv-cli-a-"));
  const b = mkdtempSync(join(tmpdir(), "prv-cli-b-"));

  const opts = await parseArgs(["diff", a, b], "/work");

  expect(opts.mode).toEqual({ kind: "path-vs-path", a, b });
});

test("diff <ref> <ref>: both resolve as refs → git mode with both refs", async () => {
  const repo = await mkTempRepo("prv-cli-");
  await $`git -C ${repo} commit -q --allow-empty -m init`.quiet();
  await $`git -C ${repo} branch feature`.quiet();

  const opts = await parseArgs(["diff", "main", "feature"], repo);

  expect(opts.mode).toEqual({
    kind: "git",
    cwd: repo,
    leftRef: "main",
    right: { kind: "ref", ref: "feature" },
  });
});

test("diff <neither> <neither>: throws when args are neither paths nor refs", async () => {
  const repo = await mkTempRepo("prv-cli-");
  await $`git -C ${repo} commit -q --allow-empty -m init`.quiet();

  await expect(parseArgs(["diff", "no-such-thing", "also-bogus"], repo)).rejects.toThrow();
});

test("diff: when an arg is both a valid ref and an existing dir, path interpretation wins", async () => {
  const repo = await mkTempRepo("prv-cli-");
  await $`git -C ${repo} commit -q --allow-empty -m init`.quiet();
  const ambiguous = join(repo, "main");
  mkdirSync(ambiguous);
  const opts = await parseArgs(["diff", ambiguous, "HEAD"], repo);

  expect(opts.mode).toEqual({
    kind: "ref-vs-path",
    cwd: repo,
    ref: "HEAD",
    path: ambiguous,
    refOnLeft: false,
  });
});

test("--version sets the version flag", async () => {
  const opts = await parseArgs(["--version"], "/work");
  expect(opts.version).toBe(true);
});

test("-v sets the version flag", async () => {
  const opts = await parseArgs(["-v"], "/work");
  expect(opts.version).toBe(true);
});

test("--help sets the help flag", async () => {
  const opts = await parseArgs(["--help"], "/work");
  expect(opts.help).toBe(true);
});

test("-h sets the help flag", async () => {
  const opts = await parseArgs(["-h"], "/work");
  expect(opts.help).toBe(true);
});

test("default opts have help=false and version=false", async () => {
  const opts = await parseArgs([], "/work");
  expect(opts.help).toBe(false);
  expect(opts.version).toBe(false);
});

test("unknown flag throws", async () => {
  await expect(parseArgs(["--nope"], "/work")).rejects.toThrow("unknown flag: --nope");
});

test("single file: prv <file> → git HEAD vs worktree scoped to that path", async () => {
  const repo = await mkTempRepo("prv-cli-");
  await $`git -C ${repo} commit -q --allow-empty -m init`.quiet();
  const file = join(repo, "a.txt");
  await Bun.write(file, "hi\n");

  const opts = await parseArgs([file], repo);

  expect(opts.mode).toEqual({
    kind: "git",
    cwd: repo,
    leftRef: "HEAD",
    right: { kind: "worktree" },
    paths: [file],
  });
  expect(opts.open).toBe(true);
});

test("single file: flags compose with a path argument", async () => {
  const repo = await mkTempRepo("prv-cli-");
  await $`git -C ${repo} commit -q --allow-empty -m init`.quiet();
  const file = join(repo, "a.txt");
  await Bun.write(file, "hi\n");

  const opts = await parseArgs(["--no-open", file], repo);

  expect(opts.mode).toEqual({
    kind: "git",
    cwd: repo,
    leftRef: "HEAD",
    right: { kind: "worktree" },
    paths: [file],
  });
  expect(opts.open).toBe(false);
});

test("single file: a non-existent path throws a clear error", async () => {
  await expect(parseArgs([join(tmpdir(), "prv-does-not-exist-xyz")], "/work")).rejects.toThrow(
    /does not exist/,
  );
});

test("two bare paths without `diff` throws (use `diff` to compare two)", async () => {
  const repo = await mkTempRepo("prv-cli-");
  const a = join(repo, "a.txt");
  const b = join(repo, "b.txt");
  await Bun.write(a, "a\n");
  await Bun.write(b, "b\n");

  await expect(parseArgs([a, b], repo)).rejects.toThrow();
});
