import { useSyncExternalStore } from "react";

/**
 * Which action a comment thread's split send button performs (#83). One
 * app-wide choice, persisted in localStorage the way `chatSettings.ts` does,
 * so picking it in one thread applies to every thread and survives a reload.
 *
 * - "batch": save the comment as pending; "Finish review" sends it later.
 * - "now": run the agent on this thread at once; it decides whether to edit
 *   files or only answer.
 */
export type SendAction = "batch" | "now";

/** Today's Enter behaviour: saving a comment never calls the agent by surprise. */
export const DEFAULT_SEND_ACTION: SendAction = "batch";

export const SEND_ACTIONS: Record<SendAction, { label: string; description: string }> = {
  now: {
    label: "Send now",
    description: "Run the agent now; it may edit files.",
  },
  batch: {
    label: "Add to batch",
    description: "Save as pending for Finish review.",
  },
};

export const SEND_ACTION_KEY = "prv:threadSendAction";

/** Decode a stored value; anything else falls back to the default. Pure. */
export function parseStoredSendAction(raw: string | null): SendAction {
  return raw === "now" || raw === "batch" ? raw : DEFAULT_SEND_ACTION;
}

function load(): SendAction {
  try {
    return parseStoredSendAction(window.localStorage.getItem(SEND_ACTION_KEY));
  } catch {
    return DEFAULT_SEND_ACTION; // no window (tests) or localStorage unavailable
  }
}

let current: SendAction = load();
const listeners = new Set<() => void>();

export function getSendAction(): SendAction {
  return current;
}

export function setSendAction(next: SendAction): void {
  current = next;
  try {
    window.localStorage.setItem(SEND_ACTION_KEY, next);
  } catch {
    /* localStorage unavailable; keep the in-memory value */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSendAction(): [SendAction, (next: SendAction) => void] {
  const action = useSyncExternalStore(subscribe, getSendAction, getSendAction);
  return [action, setSendAction];
}
