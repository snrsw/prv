import { expect, test } from "bun:test";
import { isSubmitKey } from "./keys";

test("plain Enter submits", () => {
  expect(isSubmitKey({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 13 })).toBe(
    true,
  );
});

test("Shift+Enter inserts a newline instead of submitting", () => {
  expect(isSubmitKey({ key: "Enter", shiftKey: true, isComposing: false, keyCode: 13 })).toBe(
    false,
  );
});

test("other keys never submit", () => {
  expect(isSubmitKey({ key: "a", shiftKey: false, isComposing: false, keyCode: 65 })).toBe(false);
});

test("Enter that confirms an IME conversion does not submit", () => {
  expect(isSubmitKey({ key: "Enter", shiftKey: false, isComposing: true, keyCode: 229 })).toBe(
    false,
  );
});

test("Enter with the legacy IME keyCode does not submit", () => {
  // Some browsers report keyCode 229 without setting isComposing.
  expect(isSubmitKey({ key: "Enter", shiftKey: false, isComposing: false, keyCode: 229 })).toBe(
    false,
  );
});
