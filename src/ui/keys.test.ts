import { describe, expect, test } from "bun:test";
import { isSubmitKey, isTypingTarget, shortcutFor, type ShortcutKeyEvent } from "./keys";
import { GLOBAL_SHORTCUTS } from "./shortcuts";

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

describe("shortcutFor", () => {
  const press = (key: string, mods: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 0,
    ...mods,
  });

  test("every key in the shortcut table maps to its action", () => {
    for (const shortcut of GLOBAL_SHORTCUTS) {
      for (const key of shortcut.keys) expect(shortcutFor(press(key))).toBe(shortcut.action);
    }
  });

  test("the table has no duplicate keys and no unused actions", () => {
    const keys = GLOBAL_SHORTCUTS.flatMap((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
    const actions = GLOBAL_SHORTCUTS.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
  });

  test("unbound keys are null", () => {
    expect(shortcutFor(press("q"))).toBeNull();
    expect(shortcutFor(press("Enter"))).toBeNull();
    expect(shortcutFor(press("N"))).toBeNull(); // Shift+n is not n
  });

  test("Ctrl / Alt / Meta chords are left to the browser", () => {
    expect(shortcutFor(press("f", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(press("t", { metaKey: true }))).toBeNull();
    expect(shortcutFor(press("n", { altKey: true }))).toBeNull();
  });

  test("keys typed through an IME composition are not shortcuts", () => {
    expect(shortcutFor(press("n", { isComposing: true }))).toBeNull();
    expect(shortcutFor(press("n", { keyCode: 229 }))).toBeNull();
  });
});

describe("isTypingTarget", () => {
  test("text fields and editable regions are typing targets", () => {
    expect(isTypingTarget({ tagName: "INPUT", isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: "textarea", isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: "SELECT", isContentEditable: false })).toBe(true);
    expect(isTypingTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  test("buttons, gutter cells and the window itself are not", () => {
    expect(isTypingTarget({ tagName: "BUTTON", isContentEditable: false })).toBe(false);
    expect(isTypingTarget({ tagName: "TD", isContentEditable: false })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
