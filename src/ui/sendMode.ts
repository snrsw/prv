import type { ChatAsk } from "../shared/chat";

/**
 * How a composer sends its next turn. `ask` is read-only Q&A (the default);
 * `apply` lets the agent edit files in the repo. Mirrors the wire `mode` so a
 * composer's choice is sent as-is.
 */
export type SendMode = NonNullable<ChatAsk["mode"]>;

export const DEFAULT_SEND_MODE: SendMode = "ask";

/** What the mode menu calls each mode. */
export const SEND_MODE_LABELS: Record<SendMode, string> = { ask: "Read only", apply: "Write" };

/** One-line explanation shown under each menu entry. */
export const SEND_MODE_HINTS: Record<SendMode, string> = {
  ask: "The agent answers without changing files.",
  apply: "The agent may edit files in your repo.",
};

/** The primary Send button's text: plain "Send" reads as the safe default,
 * Write mode is spelled out so the mode is visible without opening the menu. */
export function sendButtonLabel(mode: SendMode): string {
  return mode === "apply" ? "Send · Write" : "Send";
}

/** The primary Send button's tooltip. */
export function sendButtonTitle(mode: SendMode): string {
  return mode === "apply"
    ? "Send in Write mode — the agent may edit files"
    : "Send (read only — the agent will not edit files)";
}

/**
 * Whether the primary button is enabled. Read only needs a question; Write
 * may go with an empty box, because a thread can already say what to do (see
 * `resolveWriteInstruction`) and "just do it" is the common case.
 */
export function canSend(mode: SendMode, input: string): boolean {
  return mode === "apply" || input.trim() !== "";
}

/** The fallback instruction for a Write send when the thread has no user message to repeat. */
export const DEFAULT_WRITE_INSTRUCTION = "Make the change discussed above.";

/**
 * The instruction a Write send carries: what was typed, else the most recent
 * user message (the thread already discussed the change and the user wants it
 * done), else a generic "do it". Pure.
 */
export function resolveWriteInstruction(
  input: string,
  messages: readonly { role: string; text?: string }[],
): string {
  const typed = input.trim();
  if (typed !== "") return typed;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role === "user" && m.text && m.text.trim() !== "") return m.text;
  }
  return DEFAULT_WRITE_INSTRUCTION;
}

/**
 * The instruction a send carries in either mode, or null when there is
 * nothing to send. Read only sends the typed text only. Pure.
 */
export function resolveInstruction(
  mode: SendMode,
  input: string,
  messages: readonly { role: string; text?: string }[],
): string | null {
  if (mode === "apply") return resolveWriteInstruction(input, messages);
  const typed = input.trim();
  return typed === "" ? null : typed;
}
