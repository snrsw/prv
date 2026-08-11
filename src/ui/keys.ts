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
