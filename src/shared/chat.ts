/** Wire protocol for the /api/chat WebSocket (read-only "chat about the diff"). */

/**
 * The local coding-agent CLIs prv can drive. `claude` is Claude Code (the
 * `claude` CLI, the default); `codex` is OpenAI's Codex CLI (`codex exec`).
 */
export const CHAT_AGENTS = ["claude", "codex"] as const;
export type ChatAgent = (typeof CHAT_AGENTS)[number];
export const DEFAULT_CHAT_AGENT: ChatAgent = "claude";

/** Human names for the picker and UI copy. */
export const AGENT_LABELS: Record<ChatAgent, string> = { claude: "Claude Code", codex: "Codex" };

/** Effort levels per agent, lowest to highest: `claude --effort` and Codex's
 * `model_reasoning_effort` config value. */
export const CHAT_EFFORTS_BY_AGENT = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh", "max"],
} as const satisfies Record<ChatAgent, readonly string[]>;

export type ChatEffort = (typeof CHAT_EFFORTS_BY_AGENT)[ChatAgent][number];

/**
 * Model aliases offered in the picker per agent. The `claude` entries resolve
 * to the latest model of that family in the CLI; Codex has no stable aliases,
 * so its picker only offers the CLI default and a custom full model name —
 * see `isChatModel`.
 */
export const CHAT_MODEL_PRESETS_BY_AGENT = {
  claude: ["fable", "opus", "sonnet", "haiku"],
  codex: [],
} as const satisfies Record<ChatAgent, readonly string[]>;

/**
 * Per-turn agent settings chosen in the UI. Every field is optional: an absent
 * `agent` means Claude Code, and an absent `model`/`effort` means "whatever the
 * CLI defaults to" and no flag is passed.
 */
export type ChatSettings = {
  agent?: ChatAgent;
  model?: string;
  effort?: ChatEffort;
};

export function isChatAgent(value: unknown): value is ChatAgent {
  return typeof value === "string" && (CHAT_AGENTS as readonly string[]).includes(value);
}

/** Whether `value` is an effort level the given agent's CLI accepts. */
export function isChatEffort(value: unknown, agent: ChatAgent = DEFAULT_CHAT_AGENT): boolean {
  return (
    typeof value === "string" && (CHAT_EFFORTS_BY_AGENT[agent] as readonly string[]).includes(value)
  );
}

/**
 * A model name is passed to the CLI as its own argv entry, so no shell
 * escaping is involved; still reject anything that is not a plain, printable
 * token (a leading `-` would read as another CLI flag).
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
 * `effort` is validated against the (sanitized) agent's own levels, so a
 * Claude-only level never reaches Codex and vice versa.
 */
export function sanitizeChatSettings(input: unknown): ChatSettings {
  if (typeof input !== "object" || input === null) return {};
  const { agent, model, effort } = input as Record<string, unknown>;
  const settings: ChatSettings = {};
  if (isChatAgent(agent)) settings.agent = agent;
  if (isChatModel(model)) settings.model = model;
  if (isChatEffort(effort, settings.agent ?? DEFAULT_CHAT_AGENT)) {
    settings.effort = effort as ChatEffort;
  }
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
 * websocket handler (Bun.serve has a single handler for all upgraded routes).
 * A session belongs to the agent that created it (`agent`): switching agents
 * mid-conversation starts a fresh session, since neither CLI can resume the
 * other's. */
export type ChatWsData = {
  kind: "chat";
  sessionId: string | null;
  agent: ChatAgent | null;
  busy: boolean;
};
