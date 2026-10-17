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
/** One-word names for tight spots (the composer's settings button). */
export const AGENT_SHORT_LABELS: Record<ChatAgent, string> = { claude: "Claude", codex: "Codex" };

/** Effort levels per agent, lowest to highest: `claude --effort` and Codex's
 * `model_reasoning_effort` config value. The picker falls back to these when
 * the CLI does not report a model's own levels. */
export const CHAT_EFFORTS_BY_AGENT = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["minimal", "low", "medium", "high", "xhigh", "max"],
} as const satisfies Record<ChatAgent, readonly string[]>;

/**
 * Whether the agent's CLI reports effort levels per model (Codex's model
 * catalogue does; Claude Code has a fixed `--effort` set). Such an agent
 * accepts any safe level token, since its CLI may add levels prv does not
 * know — see `isChatEffort`.
 */
const EFFORTS_FROM_CLI: Record<ChatAgent, boolean> = { claude: false, codex: true };

/** An effort level: one of `CHAT_EFFORTS_BY_AGENT`, or a level the CLI reports. */
export type ChatEffort = string;

/** One entry of the model picker, as the server reads it from the agent's CLI. */
export type ChatModelOption = {
  /** The value passed as `--model`. */
  id: string;
  label: string;
  description?: string;
  /** Effort levels this model supports, lowest to highest; absent = the agent's list. */
  efforts?: string[];
  /** The effort the CLI uses for this model when none is configured. */
  defaultEffort?: string;
};

/** GET /api/agents/models response: the models one agent's CLI offers. */
export type ChatModelList = {
  models: ChatModelOption[];
  /** The model the CLI runs when no `--model` is passed, when configured. */
  defaultModel?: string;
  /** The effort the CLI's configuration applies to every model, when set. */
  defaultEffort?: string;
};

/**
 * Model aliases offered in the picker per agent. The `claude` entries resolve
 * to the latest model of that family in the CLI. Codex has no stable aliases:
 * its list comes from the CLI's model catalogue (`src/chat/models.ts`), and
 * this empty preset is the fallback when the catalogue cannot be read.
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

/**
 * Whether `value` is an effort level the given agent's CLI accepts: one of its
 * known levels or, for an agent whose CLI reports levels per model (Codex), a
 * short lowercase token. Codex receives the level inside a `-c key="value"`
 * argument, so the charset excludes quotes, spaces and a leading `-`.
 */
export function isChatEffort(value: unknown, agent: ChatAgent = DEFAULT_CHAT_AGENT): boolean {
  if (typeof value !== "string") return false;
  if ((CHAT_EFFORTS_BY_AGENT[agent] as readonly string[]).includes(value)) return true;
  return EFFORTS_FROM_CLI[agent] && /^[a-z][a-z0-9_]{0,19}$/.test(value);
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
    settings.effort = effort as string;
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

/** Client → server: abort the in-flight turn. The socket (and its session)
 * stays open, and the server still answers the aborted ask with `done`. */
export type ChatStop = { type: "stop" };

export type ChatClientFrame = ChatAsk | ChatStop;

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
 * other's. `abort` kills the in-flight turn's agent subprocess on a `stop`
 * frame or when the client disconnects. */
export type ChatWsData = {
  kind: "chat";
  sessionId: string | null;
  agent: ChatAgent | null;
  busy: boolean;
  abort?: AbortController;
};
