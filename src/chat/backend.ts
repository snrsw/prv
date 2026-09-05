/**
 * The contract one agent CLI must fulfil to drive a chat/review turn. `runTurn`
 * (in `agent.ts`) owns the subprocess and the line loop; a backend only knows
 * how to build the argv for a turn and how to turn one line of the CLI's
 * streaming output into `ChatEvent`s.
 */

import type { ChatSettings } from "../shared/chat";

/** A simplified event produced from a CLI's streaming output. */
export type ChatEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "text"; text: string }
  | { kind: "progress"; text: string }
  | { kind: "tool"; name: string; target?: string }
  | { kind: "done"; result: string }
  | { kind: "error"; message: string };

export type TurnMode = "ask" | "apply";

/** Parses one line of CLI output. May keep state across lines (see Codex). */
export type LineParser = (line: string) => ChatEvent[];

export type Backend = {
  /** Executable looked up on PATH. */
  command: string;
  /** Shown when spawning fails because the CLI is not installed. */
  notFoundMessage: string;
  /** The full argv (after the command) for one turn. */
  buildArgs: (mode: TurnMode, sessionId?: string, settings?: ChatSettings) => string[];
  /** A fresh parser per turn — some formats need state across lines. */
  createParser: () => LineParser;
};
