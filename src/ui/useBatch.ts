import { useCallback, useEffect, useRef, useState } from "react";
import type { BatchResult, BatchServerFrame, BatchStart } from "../shared/batch";
import type { Comment } from "../shared/comments";
import { getChatSettings } from "./chatSettings";
import type { ChatMessage } from "./useDiffChat";

/**
 * Client state for one "Finish review" batch over the /api/batch WebSocket:
 * every pending thread handed to the agent in a single apply-mode turn. The
 * frame reducer is pure and exported for unit testing; the hook below owns the
 * socket lifecycle, mirroring useReview.
 */

/** Activity lines the card keeps. Longer than the review panel's, since one
 * batch is a single long turn rather than one row per lens. */
export const BATCH_ACTIVITY_CAP = 8;

/** What the run did, once the agent's results frame parsed. */
export type BatchSummary = {
  /** Threads the agent reported as addressed (`done`). */
  applied: number;
  /** Threads the batch covered. */
  total: number;
  /** Result entries the server dropped (an id it never sent, a duplicate). */
  skipped: number;
};

export type BatchRun = {
  running: boolean;
  /** Run-level failure (agent error, no parseable results, lost connection). */
  error?: string;
  /** Threads in flight: what the client sent, then what the server confirmed. */
  count: number;
  activity: ChatMessage[];
  results?: BatchSummary;
};

/** Shown for a `busy` frame, which is a lone reply — no `done` follows it, so
 * the card would otherwise sit on "running…" forever. */
export const BUSY_MESSAGE = "the agent is busy — try again in a moment";

/** A run as it starts: `count` is the client's own tally until `run` lands. */
export function startedRun(count: number): BatchRun {
  return { running: true, count, activity: [] };
}

function failedRun(message: string): BatchRun {
  return { running: false, count: 0, activity: [], error: message };
}

function withActivity(run: BatchRun, line: ChatMessage): BatchRun {
  return { ...run, activity: [...run.activity, line].slice(-BATCH_ACTIVITY_CAP) };
}

/** Pure frame reducer. Exported for unit tests. */
export function reduceBatch(run: BatchRun | null, frame: BatchServerFrame): BatchRun | null {
  if (frame.type === "run") return startedRun(frame.count);
  if (run === null) {
    // A run-level failure can precede the run frame (nothing to send, busy).
    if (frame.type === "error") return failedRun(frame.message);
    if (frame.type === "busy") return failedRun(BUSY_MESSAGE);
    return run;
  }
  switch (frame.type) {
    case "tool":
      return withActivity(run, { role: "tool", name: frame.name, target: frame.target });
    case "progress":
      return withActivity(run, { role: "progress", text: frame.text });
    case "results":
      return {
        ...run,
        results: {
          applied: frame.results.filter((r) => r.done).length,
          // The agent may report on more threads than the server counted (a
          // duplicated id); never summarize as "5 of 4".
          total: Math.max(run.count, frame.results.length),
          skipped: frame.skipped,
        },
      };
    case "error":
      return { ...run, running: false, error: frame.message };
    case "busy":
      return { ...run, running: false, error: BUSY_MESSAGE };
    case "done":
      // A terminal frame with neither results nor a reason says so itself,
      // rather than leaving the card claiming a silent success.
      if (run.results || run.error) return { ...run, running: false };
      return { ...run, running: false, error: "ended without result" };
  }
}

/** The run's outcome as one line: "3 of 4 addressed, 1 left open". Pure. */
export function summarizeBatchResults(results: BatchSummary): string {
  const parts = [`${results.applied} of ${results.total} addressed`];
  const open = Math.max(results.total - results.applied, 0);
  if (open > 0) parts.push(`${open} left open`);
  if (results.skipped > 0) parts.push(`${results.skipped} skipped`);
  return parts.join(", ");
}

/**
 * One batch run at a time over a dedicated WebSocket. `onResults` fires on the
 * results frame (the caller folds them into the comment store — see
 * `applyBatchResults`); `onDone` fires on the terminal frame, where the caller
 * refreshes the diff. Both live in refs so inline closures don't re-wire the
 * socket.
 */
export function useBatch(onResults: (results: BatchResult[]) => void, onDone?: () => void) {
  const [run, setRun] = useState<BatchRun | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const onResultsRef = useRef(onResults);
  onResultsRef.current = onResults;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const handleFrame = useCallback((frame: BatchServerFrame) => {
    if (frame.type === "results") onResultsRef.current(frame.results);
    if (frame.type === "done") onDoneRef.current?.();
    // `done` ends the run; `busy` means the start was refused and nothing else
    // is coming. Either way the socket has no more to say — drop it, so a
    // later Send opens a fresh one.
    if (frame.type === "done" || frame.type === "busy") {
      wsRef.current?.close();
      wsRef.current = null;
    }
    setRun((r) => reduceBatch(r, frame));
  }, []);

  const start = useCallback(
    (comments: Comment[], instructions?: string) => {
      if (wsRef.current || comments.length === 0) return;
      setRun(startedRun(comments.length));
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/api/batch`);
      ws.onmessage = (e) => handleFrame(JSON.parse(e.data) as BatchServerFrame);
      ws.onclose = () => {
        // A close without `done` (server gone, network) fails the run visibly.
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        setRun((r) =>
          r && r.running ? reduceBatch(r, { type: "error", message: "connection closed" }) : r,
        );
      };
      const note = instructions?.trim();
      // The threads travel with the start: the server builds its prompt from
      // them and never reads the store. The app-wide agent/model/effort choice
      // decides which CLI runs the batch.
      const payload: BatchStart = {
        type: "start",
        comments,
        ...(note ? { instructions: note } : {}),
        ...getChatSettings(),
      };
      ws.addEventListener("open", () => ws.send(JSON.stringify(payload)), { once: true });
      wsRef.current = ws;
    },
    [handleFrame],
  );

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    // Null the ref first so onclose doesn't synthesize "connection closed";
    // the server aborts the run's agent subprocess when the socket closes.
    wsRef.current = null;
    ws.close();
    setRun((r) => (r && r.running ? reduceBatch(r, { type: "error", message: "stopped" }) : r));
  }, []);

  /** Dismiss a finished run's summary (the card's Close). A run still in
   * flight is left alone — closing the card must not lose it. */
  const clear = useCallback(() => setRun((r) => (r?.running ? r : null)), []);

  useEffect(() => () => wsRef.current?.close(), []);

  return { run, running: run?.running ?? false, start, stop, clear };
}
