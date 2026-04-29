import { test, expect } from "bun:test";
import type { DiffMode } from "../../src/diff/types";
import { decodeMode, encodeMode } from "../../src/shared/modeQuery";

function roundTrip(mode: DiffMode): DiffMode | null {
  const params = new URLSearchParams();
  encodeMode(mode, params);
  return decodeMode(params);
}

test("ref-vs-path mode round-trips through encode/decode", () => {
  const mode: DiffMode = {
    kind: "ref-vs-path",
    cwd: "/repo",
    ref: "HEAD",
    path: "/some/folder",
    refOnLeft: true,
  };
  expect(roundTrip(mode)).toEqual(mode);
});

test("ref-vs-path mode preserves refOnLeft=false through round-trip", () => {
  const mode: DiffMode = {
    kind: "ref-vs-path",
    cwd: "/repo",
    ref: "main",
    path: "/another/folder",
    refOnLeft: false,
  };
  expect(roundTrip(mode)).toEqual(mode);
});
