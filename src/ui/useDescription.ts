import { useCallback, useEffect, useRef, useState } from "react";
import {
  descriptionBytes,
  descriptionTooLargeMessage,
  MAX_DESCRIPTION_BYTES,
  type Description,
  type DescribeServerFrame,
  type DescribeStart,
} from "../shared/description";
import { getChatSettings } from "./chatSettings";
import type { ChatMessage } from "./useDiffChat";

/**
 * Client state for the change description shown in the Overview pane: the
 * stored description (re-read from /api/description), edits saved back to it,
 * and Generate runs over the /api/describe WebSocket. The frame reducer and
 * the time formatter are pure and exported for unit testing; the socket
 * lifecycle mirrors useBatch.
 */

/** Activity lines the pane keeps while Generate runs. */
export const DESCRIBE_ACTIVITY_CAP = 6;

export type DescribeRun = {
  running: boolean;
  /** Run-level failure (agent error, empty reply, lost connection, stopped). */
  error?: string;
  activity: ChatMessage[];
};

/** Shown for a `busy` frame, which is a lone reply — no `done` follows it. */
export const DESCRIBE_BUSY_MESSAGE = "the agent is busy — try again in a moment";

/** Pure frame reducer. Exported for unit tests. */
export function reduceDescribe(
  run: DescribeRun | null,
  frame: DescribeServerFrame,
): DescribeRun | null {
  if (run === null) return run;
  const withActivity = (line: ChatMessage): DescribeRun => ({
    ...run,
    activity: [...run.activity, line].slice(-DESCRIBE_ACTIVITY_CAP),
  });
  switch (frame.type) {
    case "tool":
      return withActivity({ role: "tool", name: frame.name, target: frame.target });
    case "progress":
      return withActivity({ role: "progress", text: frame.text });
    case "description":
      // Success: the pane shows the new description, so the run has nothing left to say.
      return null;
    case "error":
      return { ...run, running: false, error: frame.message };
    case "busy":
      return { ...run, running: false, error: DESCRIBE_BUSY_MESSAGE };
    case "done":
      if (!run.running) return run;
      return { ...run, running: false, error: run.error ?? "ended without a description" };
  }
}

/**
 * "updated 5 min ago" for the pane header; an absolute date past a week.
 * `now` is injectable for tests. Pure.
 */
export function formatUpdatedAt(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "updated just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `updated ${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `updated ${days} d ago`;
  return `updated ${new Date(then).toLocaleDateString()}`;
}

/**
 * The description store as the UI sees it. `ready` gates the first fetch
 * (like useComments); `reloadKey` re-reads it whenever the diff is refreshed,
 * and so does the tab regaining focus — `prv describe` writes the same file
 * from outside the browser.
 */
export function useDescription(ready: boolean, reloadKey: number) {
  const [description, setDescription] = useState<Description | null>(null);
  const [run, setRun] = useState<DescribeRun | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/description");
      if (!res.ok) return;
      setDescription((await res.json()) as Description | null);
    } catch {
      /* keep what is on screen */
    }
  }, []);

  useEffect(() => {
    if (ready) void reload();
  }, [ready, reloadKey, reload]);

  useEffect(() => {
    if (!ready) return;
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ready, reload]);

  /** Save an edit. Resolves true when the server stored it. */
  const save = useCallback(async (markdown: string): Promise<boolean> => {
    // The server enforces the same cap (413); checking here skips the upload.
    const bytes = descriptionBytes(markdown);
    if (bytes > MAX_DESCRIPTION_BYTES) {
      setSaveError(descriptionTooLargeMessage(bytes));
      return false;
    }
    try {
      const res = await fetch("/api/description", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown }),
      });
      const body = (await res.json()) as Description | { error: string };
      if (!res.ok || "error" in body) {
        setSaveError("error" in body ? body.error : `HTTP ${res.status}`);
        return false;
      }
      setSaveError(null);
      setDescription(body);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  const handleFrame = useCallback((frame: DescribeServerFrame) => {
    if (frame.type === "description") setDescription(frame.description);
    if (frame.type === "done" || frame.type === "busy") {
      wsRef.current?.close();
      wsRef.current = null;
    }
    setRun((r) => reduceDescribe(r, frame));
  }, []);

  /** Draft a description of the diff identified by `modeQuery` with the selected agent. */
  const generate = useCallback(
    (modeQuery: string) => {
      if (wsRef.current) return;
      setRun({ running: true, activity: [] });
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/api/describe`);
      ws.onmessage = (e) => handleFrame(JSON.parse(e.data) as DescribeServerFrame);
      ws.onclose = () => {
        // A close without `done` (server gone, network) fails the run visibly.
        if (wsRef.current !== ws) return;
        wsRef.current = null;
        setRun((r) =>
          r && r.running ? reduceDescribe(r, { type: "error", message: "connection closed" }) : r,
        );
      };
      // The app-wide agent/model/effort choice decides which CLI drafts it.
      const start: DescribeStart = { type: "start", modeQuery, ...getChatSettings() };
      ws.addEventListener("open", () => ws.send(JSON.stringify(start)), { once: true });
      wsRef.current = ws;
    },
    [handleFrame],
  );

  const stop = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    // Null the ref first so onclose doesn't synthesize "connection closed";
    // the server aborts the agent subprocess when the socket closes.
    wsRef.current = null;
    ws.close();
    setRun((r) => (r && r.running ? reduceDescribe(r, { type: "error", message: "stopped" }) : r));
  }, []);

  /** Dismiss a finished run's error line. */
  const dismissRun = useCallback(() => setRun((r) => (r?.running ? r : null)), []);

  useEffect(() => () => wsRef.current?.close(), []);

  return {
    description,
    run,
    running: run?.running ?? false,
    saveError,
    save,
    generate,
    stop,
    dismissRun,
  };
}

export type DescriptionApi = ReturnType<typeof useDescription>;
