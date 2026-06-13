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
  | { kind: "done"; result: string }
  | { kind: "error"; message: string };

export type BuildPromptArgs = {
  diff: string;
  question: string;
  isFirstTurn: boolean;
};

/**
 * Build the prompt text sent to `claude` for a single turn.
 *
 * On the first turn the whole diff is included as context. On later turns we
 * rely on `--resume` to carry the diff (already in the session history), so we
 * send only the new question.
 */
export function buildPrompt({ diff, question, isFirstTurn }: BuildPromptArgs): string {
  if (!isFirstTurn) return question;
  return [
    "You are helping review a git diff in a strictly read-only capacity.",
    "Below is the full diff. Answer the user's questions about it clearly and",
    "concisely. Do not modify any files or run any mutating commands.",
    "",
    "<diff>",
    diff,
    "</diff>",
    "",
    `Question: ${question}`,
  ].join("\n");
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
 * Parse one line of `claude --output-format stream-json` output into a
 * `ChatEvent`. Returns `null` for blank lines, unparseable JSON, and event
 * types we don't surface (hooks, rate-limit notices, tool calls, etc.). The
 * parser is deliberately tolerant so CLI version drift degrades gracefully.
 */
export function parseEvent(line: string): ChatEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }

  switch (obj.type) {
    case "system": {
      if (obj.subtype === "init" && typeof obj.session_id === "string") {
        return { kind: "session", sessionId: obj.session_id };
      }
      return null;
    }
    case "assistant": {
      const text = assistantText(obj.message);
      return text ? { kind: "text", text } : null;
    }
    case "result": {
      const result = typeof obj.result === "string" ? obj.result : "";
      return { kind: "done", result };
    }
    default:
      return null;
  }
}

export type RunTurnArgs = {
  cwd: string;
  prompt: string;
  sessionId?: string;
};

const READONLY_ARGS = [
  "--print",
  "--verbose",
  "--output-format",
  "stream-json",
  "--permission-mode",
  "plan",
  "--disallowedTools",
  "Edit,Write,Bash",
];

/**
 * Spawn `claude` for a single turn and yield `ChatEvent`s as its stream-json
 * output arrives. The prompt is fed via stdin (diffs can be large). When
 * `sessionId` is given, `--resume` continues the prior conversation.
 */
export async function* runTurn({ cwd, prompt, sessionId }: RunTurnArgs): AsyncGenerator<ChatEvent> {
  const args = [...READONLY_ARGS];
  if (sessionId) args.push("--resume", sessionId);

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
      const event = parseEvent(line);
      if (!event) continue;
      if (event.kind === "done") sawResult = true;
      yield event;
    }
  }
  const lastEvent = parseEvent(buf);
  if (lastEvent) {
    if (lastEvent.kind === "done") sawResult = true;
    yield lastEvent;
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
