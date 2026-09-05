import { useSyncExternalStore } from "react";
import { sanitizeChatSettings, type ChatSettings } from "../shared/chat";

/**
 * The model/effort the agent runs with, chosen in the chat panel and shared by
 * every conversation (the diff chat and inline comment threads, including
 * "Apply with agent"). One app-wide value, persisted in localStorage, exposed
 * as a tiny external store so any component can read or change it without
 * prop-drilling through the diff tree.
 */

export const CHAT_SETTINGS_KEY = "prv:chatSettings";

/** Decode a stored value; anything malformed falls back to CLI defaults. Pure. */
export function parseStoredChatSettings(raw: string | null): ChatSettings {
  if (raw === null) return {};
  try {
    return sanitizeChatSettings(JSON.parse(raw));
  } catch {
    return {};
  }
}

function load(): ChatSettings {
  try {
    return parseStoredChatSettings(window.localStorage.getItem(CHAT_SETTINGS_KEY));
  } catch {
    return {}; // no window (tests) or localStorage unavailable
  }
}

let current: ChatSettings = load();
const listeners = new Set<() => void>();

export function getChatSettings(): ChatSettings {
  return current;
}

export function setChatSettings(next: ChatSettings): void {
  current = sanitizeChatSettings(next);
  try {
    window.localStorage.setItem(CHAT_SETTINGS_KEY, JSON.stringify(current));
  } catch {
    /* localStorage unavailable; keep the in-memory value */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChatSettings(): [ChatSettings, (next: ChatSettings) => void] {
  const settings = useSyncExternalStore(subscribe, getChatSettings, getChatSettings);
  return [settings, setChatSettings];
}
