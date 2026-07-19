import { useCallback, useEffect, useRef, useState } from "react";
import type { LensId, ReviewFinding, ReviewServerFrame } from "../shared/review";
import type { ChatMessage } from "./useDiffChat";

/**
 * Client state for one agent review run over the /api/review WebSocket. The
 * frame reducer is pure and exported for unit testing; the hook below owns the
 * socket lifecycle, mirroring useDiffChat.
 */

export type LensPhase = "queued" | "running" | "done" | "error";

export type LensState = {
  phase: LensPhase;
  /** Findings received so far (accumulates per findings frame). */
  findings: number;
  /** Recent activity lines, in ChatMessage shape so ChatMessageList renders them. */
  activity: ChatMessage[];
  error?: string;
};

export type ReviewRun = {
  running: boolean;
  /** Run-level failure (bad mode, diff error, lost connection). */
  error?: string;
  lenses: Record<string, LensState>;
};

export const ACTIVITY_CAP = 4;

const emptyLens = (): LensState => ({ phase: "queued", findings: 0, activity: [] });

export function initialRun(lenses: readonly string[]): ReviewRun {
  return { running: true, lenses: Object.fromEntries(lenses.map((id) => [id, emptyLens()])) };
}

/** The lens row for a frame, created on demand so unknown lenses are tolerated. */
function lensOf(run: ReviewRun, id: string): LensState {
  return run.lenses[id] ?? emptyLens();
}

function withLens(run: ReviewRun, id: string, lens: LensState): ReviewRun {
  return { ...run, lenses: { ...run.lenses, [id]: lens } };
}

function withActivity(run: ReviewRun, id: string, line: ChatMessage): ReviewRun {
  const lens = lensOf(run, id);
  return withLens(run, id, { ...lens, activity: [...lens.activity, line].slice(-ACTIVITY_CAP) });
}

/** Fail every lens that has not finished; `done` lenses keep their result. */
function failUnfinished(run: ReviewRun, message: string, keepErrors: boolean): ReviewRun {
  const lenses = Object.fromEntries(
    Object.entries(run.lenses).map(([id, lens]) => {
      const finished = lens.phase === "done" || (keepErrors && lens.phase === "error");
      return [
        id,
        finished ? lens : { ...lens, phase: "error" as const, error: lens.error ?? message },
      ];
    }),
  );
  return { ...run, running: false, lenses };
}

/** Pure frame reducer. Exported for unit tests. */
export function reduceReview(run: ReviewRun | null, frame: ReviewServerFrame): ReviewRun | null {
  if (frame.type === "run") return initialRun(frame.lenses);
  if (frame.type === "busy") return run;
  if (run === null) {
    // A run-level error can precede the run frame (bad mode, empty diff).
    if (frame.type === "error") return { running: false, error: frame.message, lenses: {} };
    return run;
  }
  switch (frame.type) {
    case "lens": {
      const lens = lensOf(run, frame.lens);
      if (frame.state === "error") {
        return withLens(run, frame.lens, {
          ...lens,
          phase: "error",
          error: frame.message ?? "error",
        });
      }
      return withLens(run, frame.lens, { ...lens, phase: frame.state });
    }
    case "tool":
      return withActivity(run, frame.lens, {
        role: "tool",
        name: frame.name,
        target: frame.target,
      });
    case "progress":
      return withActivity(run, frame.lens, { role: "progress", text: frame.text });
    case "findings": {
      const lens = lensOf(run, frame.lens);
      return withLens(run, frame.lens, {
        ...lens,
        findings: lens.findings + frame.findings.length,
      });
    }
    case "error":
      return { ...failUnfinished(run, frame.message, false), error: frame.message };
    case "done":
      return failUnfinished(run, "ended without result", true);
  }
}

/**
 * One review run at a time over a dedicated WebSocket. `onFindings` fires per
 * findings frame (the caller transforms and persists them); `onDone` fires on
 * the terminal frame. Both live in refs so inline closures don't re-wire the
 * socket.
 */
export function useReview(
  onFindings: (lens: LensId, findings: ReviewFinding[], runId: string) => void,
  onDone?: () => void,
) {
  const [run, setRun] = useState<ReviewRun | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const runIdRef = useRef("");
  const onFindingsRef = useRef(onFindings);
  onFindingsRef.current = onFindings;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const handleFrame = useCallback((frame: ReviewServerFrame) => {
    if (frame.type === "run") runIdRef.current = frame.runId;
    if (frame.type === "findings") {
      onFindingsRef.current(frame.lens, frame.findings, runIdRef.current);
    }
    if (frame.type === "done") {
      onDoneRef.current?.();
      wsRef.current?.close();
      wsRef.current = null;
    }
    setRun((r) => reduceReview(r, frame));
  }, []);

  const start = useCallback(
    (modeQuery: string) => {
      if (wsRef.current) return;
      setRun({ running: true, lenses: {} });
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/api/review`);
      ws.onmessage = (e) => handleFrame(JSON.parse(e.data) as ReviewServerFrame);
      ws.onclose = () => {
        // A close without `done` (server gone, network) fails the run visibly.
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        setRun((r) =>
          r && r.running ? reduceReview(r, { type: "error", message: "connection closed" }) : r,
        );
      };
      ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "start", modeQuery })), {
        once: true,
      });
      wsRef.current = ws;
    },
    [handleFrame],
  );

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    // Null the ref first so onclose doesn't synthesize "connection closed";
    // the server aborts the run's claude subprocesses when the socket closes.
    wsRef.current = null;
    ws.close();
    setRun((r) => (r && r.running ? reduceReview(r, { type: "error", message: "stopped" }) : r));
  }, []);

  useEffect(() => () => wsRef.current?.close(), []);

  const lenses = run ? Object.values(run.lenses) : [];
  return {
    run,
    running: run?.running ?? false,
    doneCount: lenses.filter((l) => l.phase === "done" || l.phase === "error").length,
    totalCount: lenses.length,
    start,
    stop,
  };
}
