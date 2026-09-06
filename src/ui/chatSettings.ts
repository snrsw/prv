import { useSyncExternalStore } from "react";
import {
  AGENT_SHORT_LABELS,
  DEFAULT_CHAT_AGENT,
  sanitizeChatSettings,
  type ChatSettings,
} from "../shared/chat";

/**
 * The agent/model/effort every conversation runs with — the diff chat, inline
 * comment threads (Read only and Write alike) and agent reviews. One app-wide
 * value, persisted in localStorage, exposed as a tiny external store so the
 * settings menu can sit in the topbar and in every composer without
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

/** What the composer's settings button shows: `Claude · default`, `Codex · gpt-5 · high`. Pure. */
export function summarizeChatSettings(settings: ChatSettings): string {
  const parts = [
    AGENT_SHORT_LABELS[settings.agent ?? DEFAULT_CHAT_AGENT],
    settings.model ?? "default",
  ];
  if (settings.effort) parts.push(settings.effort);
  return parts.join(" · ");
}
