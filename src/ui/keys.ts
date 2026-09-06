import { GLOBAL_SHORTCUTS, type ShortcutAction } from "./shortcuts";

/** The parts of a keydown event that decide whether it submits a chat input. */
export type SubmitKeyEvent = {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
};

/**
 * Whether a keydown should send the message: plain Enter, but never Shift+Enter
 * (newline) and never an Enter that belongs to an IME composition.
 *
 * The IME guard matters because the Enter that confirms a conversion candidate
 * arrives as a normal `Enter` keydown. Sending on it fires the message and
 * clears the box, and the IME then commits the composed text back into the
 * textarea — so the sent text reappears. `isComposing` covers modern browsers;
 * `keyCode === 229` is the legacy signal some still send instead. Pure.
 */
export function isSubmitKey(event: SubmitKeyEvent): boolean {
  if (event.key !== "Enter" || event.shiftKey) return false;
  return !event.isComposing && event.keyCode !== 229;
}

/** The parts of a window-level keydown that decide whether it is a shortcut. */
export type ShortcutKeyEvent = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
  keyCode: number;
};

/** The parts of an event target that say whether the reader is typing into it. */
export type TypingTarget = { tagName: string; isContentEditable: boolean };

/**
 * Whether a keydown landed in a text field, where single-letter shortcuts
 * must stay ordinary characters. `null` (a keydown on the window itself)
 * counts as not typing. Pure.
 */
export function isTypingTarget(target: TypingTarget | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * The global action a keydown triggers, or null. Shift is allowed (it is how
 * `?` is typed) but any other modifier makes the key a browser chord, and an
 * IME-composition keydown is never a shortcut (see `isSubmitKey`). Pure.
 */
export function shortcutFor(event: ShortcutKeyEvent): ShortcutAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.isComposing || event.keyCode === 229) return null;
  for (const shortcut of GLOBAL_SHORTCUTS) {
    if (shortcut.keys.includes(event.key)) return shortcut.action;
  }
  return null;
}
