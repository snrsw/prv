/**
 * Runs one agent turn for the "chat about this diff" and review features. We
 * spawn one CLI subprocess per turn in non-interactive streaming mode and
 * relay its events back to the caller. Which CLI — Claude Code (`claude`) or
 * Codex (`codex`) — is chosen per turn by `agent` in the settings; each
 * backend lives in its own module and only knows argv + line parsing.
 */

import { type ChatAgent, type ChatEffort, DEFAULT_CHAT_AGENT } from "../shared/chat";
import type { Backend, ChatEvent, TurnMode } from "./backend";
import { claudeBackend } from "./claude";
import { codexBackend } from "./codex";

export type { ChatEvent, TurnMode } from "./backend";

export const BACKENDS: Record<ChatAgent, Backend> = {
  claude: claudeBackend,
  codex: codexBackend,
};

export type BuildPromptArgs = {
  diff: string;
  question: string;
  isFirstTurn: boolean;
  mode?: TurnMode;
};

/**
 * Build the prompt text sent to the agent for a single turn.
 *
 * On the first turn the diff context is included; later turns resume the
 * CLI's session so only the new message is sent. `mode: "apply"` asks the
 * agent to edit the files rather than just explain.
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

/**
 * Shorten a tool target for display by making an absolute path under `cwd`
 * repo-relative (the agent runs in `cwd`, so its file operations live there).
 * A plain prefix strip — not `path.relative` — so non-path targets (a Bash
 * command, a Grep pattern) and paths outside `cwd` are returned untouched.
 */
export function relativizeTarget(target: string | undefined, cwd: string): string | undefined {
  if (target === undefined) return undefined;
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return target.startsWith(prefix) ? target.slice(prefix.length) : target;
}

export type RunTurnArgs = {
  cwd: string;
  prompt: string;
  sessionId?: string;
  mode?: TurnMode;
  /** Which CLI runs the turn; omitted = Claude Code. */
  agent?: ChatAgent;
  /** Passed as the CLI's model flag; omitted = the CLI's configured default. */
  model?: string;
  /** Passed as the CLI's effort setting; omitted = the CLI's configured default. */
  effort?: ChatEffort;
  /** Aborting kills the subprocess; the turn ends without a result. */
  signal?: AbortSignal;
};

/** Keep a failed CLI's stderr readable: the tail carries the actual error. */
const STDERR_TAIL = 2000;

/**
 * Spawn the agent CLI for a single turn and yield `ChatEvent`s as its
 * streaming output arrives. The prompt is fed via stdin (diffs can be large).
 * When `sessionId` is given, the CLI resumes the prior conversation.
 */
export async function* runTurn({
  cwd,
  prompt,
  sessionId,
  mode = "ask",
  agent = DEFAULT_CHAT_AGENT,
  model,
  effort,
  signal,
}: RunTurnArgs): AsyncGenerator<ChatEvent> {
  const backend = BACKENDS[agent];
  const args = backend.buildArgs(mode, sessionId, { model, effort });
  const parse = backend.createParser();

  let proc: Bun.Subprocess;
  try {
    proc = Bun.spawn([backend.command, ...args], {
      cwd,
      // Resolve the CLI against the current PATH (not the one cached at startup).
      env: process.env,
      stdin: new TextEncoder().encode(prompt),
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    yield { kind: "error", message: backend.notFoundMessage };
    return;
  }

  const onAbort = (): void => {
    proc.kill();
  };
  if (signal?.aborted) onAbort();
  else signal?.addEventListener("abort", onAbort, { once: true });

  let sawResult = false;
  const decoder = new TextDecoder();
  let buf = "";

  try {
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        for (const event of parse(line)) {
          if (event.kind === "done") sawResult = true;
          yield event;
        }
      }
    }
    for (const event of parse(buf)) {
      if (event.kind === "done") sawResult = true;
      yield event;
    }
  } finally {
    // Reaps the subprocess when the consumer stops iterating early; a no-op
    // after normal exit.
    signal?.removeEventListener("abort", onAbort);
    proc.kill();
  }

  if (signal?.aborted) return; // killed on purpose — not an error

  const exitCode = await proc.exited;
  if (!sawResult) {
    const stderr = (await new Response(proc.stderr as ReadableStream<Uint8Array>).text()).trim();
    yield {
      kind: "error",
      message:
        stderr.slice(-STDERR_TAIL) ||
        `${backend.command} exited with code ${exitCode} before producing a result.`,
    };
  }
}
