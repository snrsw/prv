/**
 * Wire protocol for the /api/batch WebSocket ("Finish review": send every
 * pending comment thread to the agent in one apply-mode turn).
 *
 * Mirrors /api/review: the client sends one `start`, the server streams the
 * agent's activity, then emits exactly one `results` frame (when the reply
 * parsed) and exactly one terminal `done`. The browser stays the comment
 * store's single writer: it folds `results` into the threads itself (see
 * `applyBatchResults` in the UI) rather than the server touching the store.
 */

import type { ChatSettings } from "./chat";
import type { Comment } from "./comments";

/**
 * Client → server: address these threads. `comments` are the pending threads
 * as the client holds them (id, file, anchor lines, transcript); the server
 * builds the prompt from them and never reads the store. `instructions` is an
 * optional review-level note (like a GitHub review body) applied to the whole
 * batch. Agent/model/effort ride along like on a chat turn.
 */
export type BatchStart = ChatSettings & {
  type: "start";
  comments: Comment[];
  instructions?: string;
};

/**
 * One thread's outcome as the agent reported it. `reply` becomes an assistant
 * message on the thread; `done: true` means the agent considers the comment
 * addressed and the thread is resolved (Reopen is one click). An id the
 * client no longer holds is ignored.
 */
export type BatchResult = {
  id: string;
  file: string;
  reply: string;
  done: boolean;
};

/**
 * Server → client frames. Ordering per accepted start: `run`, then
 * `tool`/`progress`* interleaved, then at most one `results`, then exactly one
 * `done`. `error` may replace `results` (no parseable block, agent failure).
 * `busy` is a lone reply to a start received while a run is in flight; no
 * `done` follows it.
 */
export type BatchServerFrame =
  | { type: "run"; runId: string; count: number }
  | { type: "tool"; name: string; target?: string }
  | { type: "progress"; text: string }
  | { type: "results"; results: BatchResult[]; skipped: number }
  | { type: "error"; message: string }
  | { type: "busy" }
  | { type: "done" };

/** Per-connection state stored on the /api/batch WebSocket. `abort` kills the
 * in-flight turn's agent subprocess when the client disconnects. */
export type BatchWsData = { kind: "batch"; busy: boolean; abort?: AbortController };
