/**
 * The keyboard shortcut table (#56), kept as data so the help overlay renders
 * from it and a test can check that every key is actually wired up.
 */

/** What a global (window-level) shortcut does; App maps each to a handler. */
export type ShortcutAction =
  | "nextFile"
  | "prevFile"
  | "nextFinding"
  | "prevFinding"
  | "toggleViewed"
  | "toggleCollapsed"
  | "focusFilter"
  | "toggleSidebar"
  | "toggleChat"
  | "toggleHelp";

export type Shortcut = { keys: string[]; label: string; action: ShortcutAction };

/** Shortcuts that work anywhere outside a text field, as `KeyboardEvent.key` values. */
export const GLOBAL_SHORTCUTS: Shortcut[] = [
  { keys: ["]"], label: "Next file", action: "nextFile" },
  { keys: ["["], label: "Previous file", action: "prevFile" },
  { keys: ["n"], label: "Next open finding", action: "nextFinding" },
  { keys: ["p"], label: "Previous open finding", action: "prevFinding" },
  { keys: ["v"], label: "Toggle Viewed on the current file", action: "toggleViewed" },
  { keys: ["x"], label: "Collapse / expand the current file", action: "toggleCollapsed" },
  { keys: ["f"], label: "Filter files", action: "focusFilter" },
  { keys: ["s"], label: "Toggle the file tree", action: "toggleSidebar" },
  { keys: ["t"], label: "Toggle the chat panel", action: "toggleChat" },
  { keys: ["?"], label: "Keyboard shortcuts", action: "toggleHelp" },
];

/**
 * Keys that act on a focused line of the Diff or File tab (Tab into a card's
 * gutter first). They are handled by the card itself, so this list is
 * documentation only.
 */
export const DIFF_SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["↑", "↓"], label: "Move between lines" },
  { keys: ["Shift+↑", "Shift+↓"], label: "Extend the selection" },
  { keys: ["c", "Enter"], label: "Comment on the line or selection" },
  { keys: ["Esc"], label: "Clear the selection" },
];
