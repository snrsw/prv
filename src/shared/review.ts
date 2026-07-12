/** Wire protocol and shared types for the /api/review WebSocket (agent review panel). */

import type { Comment, ReviewSeverity } from "./comments";

export type ReviewSide = "old" | "new";

/**
 * One validated finding produced by a review lens. `startLine`/`endLine` are
 * 1-based file line numbers on `side` (normalized: present, ordered, ≥ 1).
 */
export type ReviewFinding = {
  file: string;
  side: ReviewSide;
  startLine: number;
  endLine: number;
  severity: ReviewSeverity;
  title: string;
  /** Markdown explanation (inline code only — the output contract forbids fenced blocks). */
  body: string;
};

export type LensId = "correctness" | "silent-failures" | "test-coverage";

/**
 * Client → server: review the diff identified by `modeQuery` (an `encodeMode`
 * query string; empty falls back to the server's default mode).
 */
export type ReviewStart = { type: "start"; modeQuery: string };

/**
 * Server → client frames. Ordering per accepted start: `run`, then per lens
 * `lens running` → `tool`/`progress`* → `findings` → `lens done|error` (lenses
 * interleave freely), then exactly one `done`. `busy` is a lone reply to a
 * start received while a run is in flight; no `done` follows it.
 */
export type ReviewServerFrame =
  | { type: "run"; runId: string; lenses: LensId[] }
  | { type: "lens"; lens: LensId; state: "running" | "done" | "error"; message?: string }
  | { type: "tool"; lens: LensId; name: string; target?: string }
  | { type: "progress"; lens: LensId; text: string }
  | { type: "findings"; lens: LensId; findings: ReviewFinding[]; skipped: number }
  | { type: "error"; message: string }
  | { type: "busy" }
  | { type: "done" };

/** Per-connection state stored on the /api/review WebSocket. */
export type ReviewWsData = { kind: "review"; busy: boolean };

/** "Clear agent comments" removes open review comments no human has replied to. */
export function isClearableReviewComment(c: Comment): boolean {
  return c.source === "review" && c.status === "open" && !c.messages.some((m) => m.role === "user");
}
