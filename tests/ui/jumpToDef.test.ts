import { test, expect } from "bun:test";
import { offsetToPosition } from "../../src/ui/jumpToDef";

test("offsetToPosition: offset 0 maps to line 0, character 0", () => {
  expect(offsetToPosition("abc\ndef\n", 0)).toEqual({ line: 0, character: 0 });
});

test("offsetToPosition: offset within first line", () => {
  expect(offsetToPosition("abc\ndef\n", 2)).toEqual({ line: 0, character: 2 });
});

test("offsetToPosition: offset on second line", () => {
  expect(offsetToPosition("abc\ndef\n", 5)).toEqual({ line: 1, character: 1 });
});

test("offsetToPosition: offset at a newline counts as end of previous line", () => {
  expect(offsetToPosition("abc\ndef", 3)).toEqual({ line: 0, character: 3 });
});
