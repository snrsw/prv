import { test, expect } from "bun:test";
import { parseArgs } from "../../src/cli";

test("no args → git mode HEAD vs worktree at cwd, open=true, port=0", () => {
  const opts = parseArgs([], "/work");
  expect(opts.mode).toEqual({
    kind: "git",
    cwd: "/work",
    leftRef: "HEAD",
    right: { kind: "worktree" },
  });
  expect(opts.open).toBe(true);
  expect(opts.port).toBe(0);
});

test("diff <a> <b> → path-vs-path", () => {
  const opts = parseArgs(["diff", "/x", "/y"], "/work");
  expect(opts.mode).toEqual({ kind: "path-vs-path", a: "/x", b: "/y" });
});

test("--no-open turns off browser launch", () => {
  const opts = parseArgs(["--no-open"], "/work");
  expect(opts.open).toBe(false);
});

test("--port 8765 sets port", () => {
  const opts = parseArgs(["--port", "8765"], "/work");
  expect(opts.port).toBe(8765);
});
