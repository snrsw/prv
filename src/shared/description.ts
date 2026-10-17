/**
 * The change description (a PR-body-like overview of the local changes) and
 * the wire protocol for the /api/describe WebSocket that drafts one with the
 * agent.
 */

import type { ChatSettings } from "./chat";

/** One stored description. `updatedAt` is the file's mtime as an ISO string. */
export type Description = { markdown: string; updatedAt: string };

/**
 * Client → server: draft a description of the diff identified by `modeQuery`
 * (an `encodeMode` query string; empty falls back to the server's default
 * mode). Agent/model/effort ride along like on a chat turn.
 */
export type DescribeStart = ChatSettings & { type: "start"; modeQuery: string };

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
