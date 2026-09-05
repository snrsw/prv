/** Wire protocol for the /api/chat WebSocket (read-only "chat about the diff"). */

/** Effort levels accepted by `claude --effort`, lowest to highest. */
export const CHAT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ChatEffort = (typeof CHAT_EFFORTS)[number];

/**
 * Model aliases offered in the picker (each resolves to the latest model of
 * that family in the `claude` CLI). Any full model name is also accepted via
 * the custom input — see `isChatModel`.
 */
export const CHAT_MODEL_PRESETS = ["fable", "opus", "sonnet", "haiku"] as const;

/**
 * Per-turn agent settings chosen in the UI. Both are optional: an absent
 * field means "whatever the `claude` CLI defaults to" and no flag is passed.
 */
export type ChatSettings = {
  model?: string;
  effort?: ChatEffort;
};

export function isChatEffort(value: unknown): value is ChatEffort {
  return typeof value === "string" && (CHAT_EFFORTS as readonly string[]).includes(value);
}

/**
 * A model name is passed to `claude --model` as its own argv entry, so no
 * shell escaping is involved; still reject anything that is not a plain,
 * printable token (a leading `-` would read as another CLI flag).
 */
export function isChatModel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 100 &&
    !value.startsWith("-") &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

/**
 * Keep only the well-formed fields of an untrusted settings object (a client
 * frame, or a stale/edited localStorage entry). Invalid fields are dropped
 * rather than failing the whole turn, so the CLI default applies for them.
 */
export function sanitizeChatSettings(input: unknown): ChatSettings {
  if (typeof input !== "object" || input === null) return {};
  const { model, effort } = input as Record<string, unknown>;
  const settings: ChatSettings = {};
  if (isChatModel(model)) settings.model = model;
  if (isChatEffort(effort)) settings.effort = effort;
  return settings;
}

/** Client → server: ask a question. `diff` is used only on the first turn. */
export type ChatAsk = ChatSettings & {
  type: "ask";
  question: string;
  diff: string;
  /** "ask" = read-only Q&A (default); "apply" = let the agent edit files. */
  mode?: "ask" | "apply";
};

/** Server → client frames. */
export type ChatServerFrame =
  | { type: "session"; sessionId: string }
  | { type: "chunk"; text: string }
  | { type: "progress"; text: string }
  | { type: "tool"; name: string; target?: string }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "busy" };

/** Per-connection state stored on the WebSocket. `kind` routes the shared
 * websocket handler (Bun.serve has a single handler for all upgraded routes). */
export type ChatWsData = {
  kind: "chat";
  sessionId: string | null;
  busy: boolean;
};
