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
  "Write an overview of the diff below for its reviewer, in Markdown. Its job is to",
  "cut review time: after reading it, the reviewer should know why the change",
  "exists, what it does, how behavior differs, and where to look closely. Lead with",
  "the aim, stay at the level of features and behavior (not every function), and",
  "keep the text under about 300 words, diagrams excluded. Sections, in order:",
  "",
  "## Aim — one or two sentences: the problem and the intended outcome. If the",
  "   diff and repository do not show why, say so instead of guessing.",
  "## What changes — three to six bullets, one per feature or area, each saying",
  "   what it now does. Name a file only when it helps find the change.",
  "## Behavior — a table with columns Where | Before | After, one row per",
  "   observable difference (UI, CLI, API, stored data, config). For a change with",
  '   no observable difference, write "No behavior change." instead of the table.',
  "## Review guide — the one to three places that carry real logic or risk and",
  "   why each needs attention; what else could be affected (callers, stored data,",
  "   other features); and which parts are mechanical (docs, tests, renames,",
  "   lockfiles) and can be skimmed.",
  "",
  "Add a diagram only when it is faster to read than the text, placed after What",
  "changes:",
  "",
  "## Data flow — a ```mermaid flowchart, when data takes a new or changed path",
  "   between components.",
  "## Dependencies — a ```mermaid graph, when module or function dependencies",
  "   change; mark new and removed edges.",
  "",
  "Keep each diagram to about 8 nodes. Do not pad: skip a sentence that adds",
  "nothing.",
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
