/**
 * The change description (a PR-body-like overview of the local changes) and
 * the wire protocol for the /api/describe WebSocket that drafts one with the
 * agent.
 */

import type { ChatSettings } from "./chat";

/**
 * The largest description prv stores, in UTF-8 bytes of Markdown (1 MiB). A
 * PR body is a few KB; the cap only stops a runaway writer from filling the
 * disk and the browser. Enforced by `prv describe`, PUT /api/description and
 * Generate.
 */
export const MAX_DESCRIPTION_BYTES = 1024 * 1024;

/** Size of `markdown` in UTF-8 bytes — what the cap measures. Pure. */
export function descriptionBytes(markdown: string): number {
  return new TextEncoder().encode(markdown).length;
}

/** The error every writer reports for an oversized description. Pure. */
export function descriptionTooLargeMessage(bytes: number): string {
  return `the description is ${bytes} bytes; the limit is ${MAX_DESCRIPTION_BYTES} bytes (1 MiB)`;
}

/** One stored description. `updatedAt` is the file's mtime as an ISO string. */
export type Description = { markdown: string; updatedAt: string };

/**
 * Client → server: draft a description of the diff identified by `modeQuery`
 * (an `encodeMode` query string; empty falls back to the server's default
 * mode). Agent/model/effort ride along like on a chat turn.
 */
export type DescribeStart = ChatSettings & {
  type: "start";
  modeQuery: string;
  /** Replaces DEFAULT_DESCRIBE_INSTRUCTIONS in the prompt; omitted = the default. */
  instructions?: string;
};

/**
 * What Generate asks the agent to write — the part of the prompt the user can
 * edit before running it. The read-only rule, the diff and the reply format
 * around it are fixed (see buildDescribePrompt).
 */
export const DEFAULT_DESCRIBE_INSTRUCTIONS = [
  "Write the description a reviewer would want as a pull request body for the diff",
  "below, in Markdown. Always include:",
  "",
  "## Summary — one or two sentences: what the change does and why.",
  "## Changes — a bullet list of what changed, grouped by area; name files or",
  "   functions where it helps.",
  "",
  "Then include each of these sections only when the diff warrants it; omit the",
  "rest, without a placeholder:",
  "",
  "## Data flow — when the change adds or reroutes data between components (a new",
  "   endpoint, store, message, or pipeline step): a ```mermaid flowchart of how the",
  "   data moves, plus a sentence on what changed in that path.",
  "## Dependencies — when the change adds, removes, or rewires module or function",
  "   dependencies: a ```mermaid graph of the affected modules/functions and their",
  "   edges, marking new and removed edges.",
  "## Blast radius — when the change touches shared code, a public interface,",
  "   persisted data, or configuration: what else is affected (callers, consumers,",
  "   stored files, other features) and the risk to each.",
  "",
  "Keep diagrams small (at most about 10 nodes). Be concrete and brief. Do not",
  "invent motivation the diff and repository do not support; say what is unclear",
  "instead.",
].join("\n");

/** Custom instructions longer than this are refused by the server. */
export const MAX_DESCRIBE_INSTRUCTIONS_CHARS = 20_000;

/**
 * The custom instructions from an untrusted start frame: a non-blank string
 * within the length cap, else undefined (use the default). Pure.
 */
export function sanitizeDescribeInstructions(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_DESCRIBE_INSTRUCTIONS_CHARS) return undefined;
  return trimmed;
}

/**
 * Server → client frames. Ordering per accepted start: `tool`/`progress`*,
 * then at most one `description` (the saved result) or an `error`, then
 * exactly one `done`. `busy` is a lone reply to a start received while a run
 * is in flight; no `done` follows it.
 */
export type DescribeServerFrame =
  | { type: "tool"; name: string; target?: string }
  | { type: "progress"; text: string }
  | { type: "description"; description: Description }
  | { type: "error"; message: string }
  | { type: "busy" }
  | { type: "done" };

/** Per-connection state stored on the /api/describe WebSocket. `abort` kills
 * the in-flight turn's agent subprocess when the client disconnects. */
export type DescribeWsData = { kind: "describe"; busy: boolean; abort?: AbortController };
