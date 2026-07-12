/**
 * Wrapper around the Claude Code CLI (`claude`) used to power the read-only
 * "chat about this diff" feature. We spawn one `claude` subprocess per turn in
 * non-interactive streaming mode and relay its events back to the caller.
 *
 * Read-only is enforced two ways: `--permission-mode plan` (no edits) plus
 * `--disallowedTools Edit,Write,Bash` (mutation tools removed entirely).
 */

/** A simplified event produced from the CLI's stream-json output. */
export type ChatEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; target?: string }
  | { kind: "done"; result: string }
  | { kind: "error"; message: string };

export type TurnMode = "ask" | "apply";

export type BuildPromptArgs = {
  diff: string;
  question: string;
  isFirstTurn: boolean;
  mode?: TurnMode;
};

/**
 * Build the prompt text sent to `claude` for a single turn.
 *
 * On the first turn the diff context is included; later turns rely on
 * `--resume` so only the new message is sent. `mode: "apply"` asks the agent
 * to edit the files rather than just explain.
 */
export function buildPrompt({
  diff,
  question,
  isFirstTurn,
  mode = "ask",
}: BuildPromptArgs): string {
  if (!isFirstTurn) return question;
  const lead =
    mode === "apply"
      ? [
          "You are addressing a code-review comment by editing the files directly.",
          "Below is the relevant diff context. Make the requested change, then",
          "briefly summarize what you edited. Keep the change minimal and focused.",
        ]
      : [
          "You are helping review a git diff in a strictly read-only capacity.",
          "Below is the relevant diff context. Answer the user's questions about it",
          "clearly and concisely. Do not modify any files or run any mutating commands.",
        ];
  const label = mode === "apply" ? "Requested change" : "Question";
  return [...lead, "", "<diff>", diff, "</diff>", "", `${label}: ${question}`].join("\n");
}

/** Extract the concatenated text of all `text` blocks in an assistant message. */
function assistantText(message: unknown): string {
  if (typeof message !== "object" || message === null) return "";
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("");
}

/**
 * Derive a short human label for a tool call from its input object. We probe a
 * small ordered set of well-known keys and return the first string value found
 * (e.g. `file_path` for Read/Edit/Write, `command` for Bash, `pattern` for
 * Grep). Returns `undefined` when nothing obvious is present.
 */
function toolTarget(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const keys = ["file_path", "notebook_path", "command", "pattern", "url", "query", "description"];
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/** Extract the `tool_use` blocks of an assistant message as name/target pairs. */
function toolUses(message: unknown): { name: string; target?: string }[] {
  if (typeof message !== "object" || message === null) return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content
    .filter(
      (block): block is { type: "tool_use"; name: string; input?: unknown } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: unknown }).type === "tool_use" &&
        typeof (block as { name?: unknown }).name === "string",
    )
    .map((block) => {
      const target = toolTarget(block.input);
      return target === undefined ? { name: block.name } : { name: block.name, target };
    });
}

/**
 * Parse one line of `claude --output-format stream-json` output into zero or
 * more `ChatEvent`s. Returns `[]` for blank lines, unparseable JSON, and event
 * types we don't surface (hooks, rate-limit notices, etc.). A single assistant
 * line can carry both a text block and one or more tool calls, so the return
 * type is an array. The parser is deliberately tolerant so CLI version drift
 * degrades gracefully.
 */
export function parseEvent(line: string): ChatEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return [];
  }

  switch (obj.type) {
    case "system": {
      if (obj.subtype === "init" && typeof obj.session_id === "string") {
        return [{ kind: "session", sessionId: obj.session_id }];
      }
      return [];
    }
    case "assistant": {
      const events: ChatEvent[] = [];
      const text = assistantText(obj.message);
      if (text) events.push({ kind: "text", text });
      for (const use of toolUses(obj.message)) {
        events.push(
          use.target === undefined
            ? { kind: "tool", name: use.name }
            : { kind: "tool", name: use.name, target: use.target },
        );
      }
      return events;
    }
    case "result": {
      const result = typeof obj.result === "string" ? obj.result : "";
      return [{ kind: "done", result }];
    }
    default:
      return [];
  }
}

export type RunTurnArgs = {
  cwd: string;
  prompt: string;
  sessionId?: string;
  mode?: TurnMode;
};

const BASE_ARGS = ["--print", "--verbose", "--output-format", "stream-json"];

/**
 * Permission profile per mode. `ask` is strictly read-only; `apply` lets the
 * agent edit files (Read/Edit/Write/Grep/Glob) but never run Bash.
 */
const PROFILE_ARGS: Record<TurnMode, string[]> = {
  ask: ["--permission-mode", "plan", "--disallowedTools", "Edit,Write,Bash"],
  apply: ["--permission-mode", "acceptEdits", "--allowedTools", "Read,Edit,Write,Grep,Glob"],
};

/** Assemble the full `claude` argument list for a turn (exported for tests). */
export function buildArgs(mode: TurnMode, sessionId?: string): string[] {
  const args = [...BASE_ARGS, ...PROFILE_ARGS[mode]];
  if (sessionId) args.push("--resume", sessionId);
  return args;
}

/**
 * Spawn `claude` for a single turn and yield `ChatEvent`s as its stream-json
 * output arrives. The prompt is fed via stdin (diffs can be large). When
 * `sessionId` is given, `--resume` continues the prior conversation.
 */
export async function* runTurn({
  cwd,
  prompt,
  sessionId,
  mode = "ask",
}: RunTurnArgs): AsyncGenerator<ChatEvent> {
  const args = buildArgs(mode, sessionId);

  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn(["claude", ...args], {
      cwd,
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    yield {
      kind: "error",
      message: "claude CLI not found — install Claude Code and run `claude` once to log in.",
    };
    return;
  }

  let sawResult = false;
  const decoder = new TextDecoder();
  let buf = "";

  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      for (const event of parseEvent(line)) {
        if (event.kind === "done") sawResult = true;
        yield event;
      }
    }
  }
  for (const event of parseEvent(buf)) {
    if (event.kind === "done") sawResult = true;
    yield event;
  }

  const exitCode = await proc.exited;
  if (!sawResult) {
    const stderr = (await new Response(proc.stderr as ReadableStream<Uint8Array>).text()).trim();
    yield {
      kind: "error",
      message: stderr || `claude exited with code ${exitCode} before producing a result.`,
    };
  }
}
