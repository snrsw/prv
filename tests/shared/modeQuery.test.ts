import { test, expect } from "bun:test";
import type { DiffMode } from "../../src/diff/types";
import { decodeMode, encodeMode } from "../../src/shared/modeQuery";

function roundTrip(mode: DiffMode): DiffMode | null {
  const params = new URLSearchParams();
  encodeMode(mode, params);
  return decodeMode(params);
}

test("git mode against the working tree round-trips through encode/decode", () => {
  const mode: DiffMode = {
    kind: "git",
    cwd: "/repo",
    leftRef: "HEAD",
    right: { kind: "worktree" },
  };
  expect(roundTrip(mode)).toEqual(mode);
});

test("git mode against a ref round-trips through encode/decode", () => {
  const mode: DiffMode = {
    kind: "git",
    cwd: "/repo",
    leftRef: "main",
    right: { kind: "ref", ref: "feature" },
  };
  expect(roundTrip(mode)).toEqual(mode);
});

test("decode returns null when a required param is absent", () => {
  const params = new URLSearchParams({ mode: "git", leftRef: "HEAD", right: "worktree" });
  expect(decodeMode(params)).toBeNull();
});

test("decode returns null for an unknown mode kind", () => {
  const params = new URLSearchParams({ mode: "path-vs-path", a: "/x", b: "/y" });
  expect(decodeMode(params)).toBeNull();
});

test("files mode round-trips through encode/decode, keeping path order", () => {
  const mode: DiffMode = { kind: "files", cwd: "/home/me", paths: ["b.md", "/abs/a.md"] };
  expect(roundTrip(mode)).toEqual(mode);
});

test("decode returns null for files mode without a path", () => {
  const params = new URLSearchParams({ mode: "files", cwd: "/home/me" });
  expect(decodeMode(params)).toBeNull();
});
