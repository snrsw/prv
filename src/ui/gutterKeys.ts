/** Pure helpers behind keyboard navigation in a card's diff gutter (#56). */

/** A keyboard-made line range, as a span over the global diff-line index. */
export type GutterSel = { startGi: number; endGi: number };

/** The parts of a keydown on a gutter cell that decide what it does. */
export type GutterKeyEvent = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

export type GutterKeyAction =
  | { kind: "move"; delta: 1 | -1; extend: boolean }
  | { kind: "open" }
  | { kind: "clear" };

/**
 * What a key does on a focused gutter cell: ↑/↓ step between lines (with
 * Shift, growing the selection), `c` / Enter comment on the line or the
 * selection, Escape drops the selection. Other keys, and any chord with a
 * modifier beyond Shift, are left to the browser. Pure.
 */
export function gutterKeyAction(event: GutterKeyEvent): GutterKeyAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  switch (event.key) {
    case "ArrowDown":
      return { kind: "move", delta: 1, extend: event.shiftKey };
    case "ArrowUp":
      return { kind: "move", delta: -1, extend: event.shiftKey };
    case "c":
    case "Enter":
      return event.shiftKey ? null : { kind: "open" };
    case "Escape":
      return { kind: "clear" };
    default:
      return null;
  }
}

/**
 * The selection after the focus moves from `fromGi` to `toGi`. Extending
 * keeps the anchor (the line the selection started on, or the line just
 * left) and moves the far end; a plain move drops the selection. A hunk
 * header has no line index (`null`): moving onto one keeps the selection
 * as it was, and starting from one selects just the destination. Pure.
 */
export function moveSelection(
  sel: GutterSel | null,
  fromGi: number | null,
  toGi: number | null,
  extend: boolean,
): GutterSel | null {
  if (!extend) return null;
  if (toGi === null) return sel;
  const startGi = sel?.startGi ?? fromGi ?? toGi;
  return { startGi, endGi: toGi };
}
