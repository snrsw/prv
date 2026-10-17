import { describe, expect, test } from "bun:test";
import { gutterKeyAction, moveSelection } from "./gutterKeys";

const key = (key: string, mods: Partial<Parameters<typeof gutterKeyAction>[0]> = {}) => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("gutterKeyAction", () => {
  test("arrows move, Shift+arrows extend", () => {
    expect(gutterKeyAction(key("ArrowDown"))).toEqual({ kind: "move", delta: 1, extend: false });
    expect(gutterKeyAction(key("ArrowUp"))).toEqual({ kind: "move", delta: -1, extend: false });
    expect(gutterKeyAction(key("ArrowDown", { shiftKey: true }))).toEqual({
      kind: "move",
      delta: 1,
      extend: true,
    });
  });

  test("c and Enter open a thread, Escape clears", () => {
    expect(gutterKeyAction(key("c"))).toEqual({ kind: "open" });
    expect(gutterKeyAction(key("Enter"))).toEqual({ kind: "open" });
    expect(gutterKeyAction(key("Escape"))).toEqual({ kind: "clear" });
  });

  test("chords with Ctrl / Alt / Meta and unrelated keys are left alone", () => {
    expect(gutterKeyAction(key("ArrowDown", { ctrlKey: true }))).toBeNull();
    expect(gutterKeyAction(key("c", { metaKey: true }))).toBeNull();
    expect(gutterKeyAction(key("Enter", { altKey: true }))).toBeNull();
    expect(gutterKeyAction(key("Enter", { shiftKey: true }))).toBeNull();
    expect(gutterKeyAction(key("j"))).toBeNull();
  });
});

describe("moveSelection", () => {
  test("a plain move drops the selection", () => {
    expect(moveSelection({ startGi: 2, endGi: 4 }, 4, 5, false)).toBeNull();
    expect(moveSelection(null, 4, 5, false)).toBeNull();
  });

  test("Shift+move starts a range from the line just left", () => {
    expect(moveSelection(null, 4, 5, true)).toEqual({ startGi: 4, endGi: 5 });
  });

  test("Shift+move keeps the anchor and moves the far end, in both directions", () => {
    expect(moveSelection({ startGi: 4, endGi: 5 }, 5, 6, true)).toEqual({ startGi: 4, endGi: 6 });
    expect(moveSelection({ startGi: 4, endGi: 6 }, 6, 5, true)).toEqual({ startGi: 4, endGi: 5 });
    expect(moveSelection({ startGi: 4, endGi: 4 }, 4, 3, true)).toEqual({ startGi: 4, endGi: 3 });
  });

  test("hunk headers have no line: moving onto one keeps the range, leaving one starts fresh", () => {
    expect(moveSelection({ startGi: 4, endGi: 5 }, 5, null, true)).toEqual({
      startGi: 4,
      endGi: 5,
    });
    expect(moveSelection(null, null, 7, true)).toEqual({ startGi: 7, endGi: 7 });
  });
});
