import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_CHAT_AGENT,
  type ChatAgent,
  type ChatAsk,
  type ChatServerFrame,
  type ChatStop,
} from "../shared/chat";
import type { StoredMessage } from "../shared/comments";
import { getChatSettings } from "./chatSettings";

/**
 * A message shown in the live transcript. `user`/`assistant` carry text and are
 * persisted; `tool` and `progress` lines surface live agent activity and are rendered but
 * never saved (stripped at the persist boundary — see `stripEphemeral`).
 */
export type ChatMessage =
  | { role: "user" | "assistant"; text: string }
  | { role: "tool"; name: string; target?: string }
  | { role: "progress"; text: string };

/**
 * Demote the most recent non-empty assistant message to `progress` narration.
 * Called when a new answer bubble starts after activity: the agent often emits
 * its "I'll read X" preamble as a standalone text message before the tool call,
 * so once a *later* answer arrives the earlier text is revealed as narration —
 * only the latest assistant text should read as the answer. Pure.
 */
function demotePriorAnswer(messages: ChatMessage[]): ChatMessage[] {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== "assistant") continue;
    if (m.text === "") return messages;
    const next = messages.slice();
    next[i] = { role: "progress", text: m.text };
    return next;
  }
  return messages;
}

/**
 * Fold a streaming text chunk into the transcript: extend the trailing
 * assistant message, or start a new one if the last entry is not an assistant
 * message (e.g. a user turn or an interleaved tool line). When it starts a new
 * bubble after activity, any earlier answer bubble is demoted to narration so
 * only the latest text reads as the answer. Pure and exported for unit testing.
 */
export function appendChunk(messages: ChatMessage[], text: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant") {
    return [...messages.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...demotePriorAnswer(messages), { role: "assistant", text }];
}

/**
 * Insert a non-answer activity line (a `tool` call or `progress` narration).
 * `send` seeds an empty assistant placeholder that renders as "thinking…"; when
 * activity arrives before the answer (the norm on turns where the agent
 * reads/edits/narrates before speaking), splice it in just *before* that
 * placeholder so the placeholder stays trailing — the next answer chunk then
 * fills it via `appendChunk` instead of stranding an empty bubble above the
 * activity.
 */
function insertActivity(messages: ChatMessage[], line: ChatMessage): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && last.text === "") {
    return [...messages.slice(0, -1), line, last];
  }
  return [...messages, line];
}

/** Insert a live-activity tool line. Pure and exported for unit testing. */
export function appendTool(
  messages: ChatMessage[],
  tool: { name: string; target?: string },
): ChatMessage[] {
  return insertActivity(messages, { role: "tool", name: tool.name, target: tool.target });
}

/**
 * Insert a progress-narration line — assistant text the agent emits alongside a
 * tool call ("I'll read X"), shown muted so it doesn't compete with the answer.
 * Pure and exported for unit testing.
 */
export function appendProgress(messages: ChatMessage[], text: string): ChatMessage[] {
  return insertActivity(messages, { role: "progress", text });
}

/**
 * Drop empty assistant messages: the "thinking…" placeholder `send` seeds is
 * only meaningful while a turn is in flight. Applied at the persist boundary
 * (a turn that never completes must not save an empty bubble) and to a
 * persisted transcript on load (so stores that already hold one self-heal).
 * Pure and exported for unit testing.
 */
export function dropEmptyAssistants<T extends ChatMessage>(messages: T[]): T[] {
  return messages.filter((m) => !(m.role === "assistant" && m.text === ""));
}

/**
 * Drop the ephemeral activity lines (`tool` calls and `progress` narration)
 * and any empty assistant placeholder, so the persisted transcript keeps only
 * the user's questions and the answers.
 */
export function stripEphemeral(messages: ChatMessage[]): StoredMessage[] {
  return dropEmptyAssistants(messages).filter(
    (m): m is StoredMessage => m.role !== "tool" && m.role !== "progress",
  );
}

/**
 * Remove a trailing empty assistant placeholder. Called on turn end so a turn
 * that produced only activity (no text answer) leaves no stray empty bubble.
 * Pure and exported for unit testing.
 */
export function dropEmptyPlaceholder(messages: ChatMessage[]): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant" && last.text === "") return messages.slice(0, -1);
  return messages;
}

/**
 * End a turn the user stopped: drop the placeholder (the answer never came)
 * and leave a muted "stopped" line so the transcript says why the turn has
 * no answer. Pure and exported for unit testing.
 */
export function stopTurn(messages: ChatMessage[]): ChatMessage[] {
  return [...dropEmptyPlaceholder(messages), { role: "progress", text: "stopped" }];
}

/**
 * Fold one server frame into the transcript. Pure: the hook applies it inside
 * a state updater, so it must not touch anything but its arguments (React
 * may run updaters twice, and side effects there update other components
 * mid-render).
 */
export function applyFrame(messages: ChatMessage[], frame: ChatServerFrame): ChatMessage[] {
  switch (frame.type) {
    case "chunk":
      return appendChunk(messages, frame.text);
    case "tool":
      return appendTool(messages, { name: frame.name, target: frame.target });
    case "progress":
      return appendProgress(messages, frame.text);
    case "error":
      return appendChunk(messages, `⚠ ${frame.message}`);
    case "done":
      return dropEmptyPlaceholder(messages);
    case "busy":
      // The server is still finishing a stopped turn; the ask was not accepted
      // and no `done` will follow it, so the turn must not hang on "thinking…".
      return appendChunk(messages, "⚠ The agent is still busy — try again in a moment.");
    case "session":
      return messages;
  }
}

/** How long a turn may go without a frame before the UI hints at a stuck CLI. */
export const STALL_MS = 30_000;

/** A compact, muted glyph shown next to a live-activity line for a tool name. */
export function toolIcon(name: string): string {
  const icons: Record<string, string> = {
    Read: "▸",
    Edit: "✎",
    Write: "✎",
    Delete: "✕",
    WebSearch: "⌕",
    MCP: "⚙",
    Bash: "$",
    Grep: "⌕",
    Glob: "⌕",
    TodoWrite: "☑",
    ExitPlanMode: "✓",
  };
  return icons[name] ?? "•";
}

/**
 * One read-only-or-apply chat conversation with the agent over the `/api/chat`
 * WebSocket. Each hook instance owns a single connection, which on the server
 * maps to a single agent-CLI session.
 *
 * Messages are seeded from `initial` (e.g. a persisted transcript) and every
 * change is reported through `onChange` so the caller can persist it. Ephemeral
 * activity (tool + progress lines, the empty placeholder) is stripped before
 * `onChange` so only user/assistant text is saved. `onChange` runs from an
 * effect, never from inside a state updater: updaters must stay pure, and
 * persisting from one would update the caller's state mid-render.
 * The hook starts a fresh session per mount, so the first `send` after a reload
 * re-sends `firstTurnContext`; later turns resume the CLI's session. Every turn
 * also carries the app-wide agent/model/effort choice (see `chatSettings`);
 * switching the agent mid-conversation starts a new session (the other CLI
 * cannot resume it), so the diff is sent again.
 *
 * `stop` aborts the in-flight turn (the server keeps the session, so the next
 * question still resumes it); `stalled` turns on after `STALL_MS` of streaming
 * with no frame, for a "check the CLI" hint.
 */
export function useDiffChat(
  initial: ChatMessage[] = [],
  onChange?: (messages: StoredMessage[]) => void,
) {
  // Heal a persisted transcript that holds an empty placeholder (a turn that
  // never completed before a reload) instead of rendering it as an empty bubble.
  const [messages, setMessages] = useState<ChatMessage[]>(() => dropEmptyAssistants(initial));
  const [streaming, setStreaming] = useState(false);
  const [stalled, setStalled] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const hasSessionRef = useRef(false);
  const sessionAgentRef = useRef<ChatAgent | null>(null);
  // Frames that arrive after the user stopped a turn (a last buffered chunk,
  // the server's `done`) must not reopen the transcript.
  const turnActiveRef = useRef(false);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Persist every transcript change. The seeded state is skipped by identity
  // (not by "first run"), so StrictMode's re-run of the effect and unrelated
  // re-renders do not re-persist what was just loaded.
  const lastPersistedRef = useRef(messages);
  useEffect(() => {
    if (messages === lastPersistedRef.current) return;
    lastPersistedRef.current = messages;
    onChangeRef.current?.(stripEphemeral(messages));
  }, [messages]);

  const clearStall = useCallback(() => {
    if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    stallTimerRef.current = null;
    setStalled(false);
  }, []);

  // (Re)arm the stall hint: it fires only if nothing arrives for STALL_MS.
  const armStall = useCallback(() => {
    clearStall();
    stallTimerRef.current = setTimeout(() => setStalled(true), STALL_MS);
  }, [clearStall]);

  const endTurn = useCallback(() => {
    turnActiveRef.current = false;
    setStreaming(false);
    clearStall();
  }, [clearStall]);

  const handleFrame = useCallback(
    (frame: ChatServerFrame) => {
      if (frame.type === "session") hasSessionRef.current = true;
      if (!turnActiveRef.current) return;
      armStall();
      setMessages((m) => applyFrame(m, frame));
      if (frame.type === "error" || frame.type === "done" || frame.type === "busy") endTurn();
    },
    [armStall, endTurn],
  );

  const ensureSocket = useCallback((): WebSocket => {
    const existing = wsRef.current;
    if (existing && existing.readyState <= WebSocket.OPEN) return existing;
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/api/chat`);
    ws.onmessage = (e) => handleFrame(JSON.parse(e.data) as ChatServerFrame);
    ws.onclose = () => {
      if (wsRef.current === ws) wsRef.current = null;
    };
    wsRef.current = ws;
    return ws;
  }, [handleFrame]);

  const send = useCallback(
    (question: string, firstTurnContext: string, mode: ChatAsk["mode"] = "ask") => {
      const q = question.trim();
      if (!q || streaming) return;
      const settings = getChatSettings();
      const agent = settings.agent ?? DEFAULT_CHAT_AGENT;
      const resumes = hasSessionRef.current && sessionAgentRef.current === agent;
      const diff = resumes ? "" : firstTurnContext;
      sessionAgentRef.current = agent;
      setMessages((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "" }]);
      turnActiveRef.current = true;
      setStreaming(true);
      armStall();
      const ws = ensureSocket();
      // The app-wide agent/model/effort choice rides along on every turn so a
      // change made mid-conversation applies from the next question.
      const payload: ChatAsk = { type: "ask", question: q, diff, mode, ...settings };
      const data = JSON.stringify(payload);
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
      else ws.addEventListener("open", () => ws.send(data), { once: true });
    },
    [streaming, ensureSocket, armStall],
  );

  const stop = useCallback(() => {
    if (!turnActiveRef.current) return;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      // The server aborts the turn but keeps the socket and its session.
      const payload: ChatStop = { type: "stop" };
      ws.send(JSON.stringify(payload));
    } else {
      // Not connected yet: dropping the socket cancels the queued ask, and the
      // server-side session with it, so the next question starts over.
      ws?.close();
      wsRef.current = null;
      hasSessionRef.current = false;
    }
    setMessages(stopTurn);
    endTurn();
  }, [endTurn]);

  const reset = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    hasSessionRef.current = false;
    sessionAgentRef.current = null;
    setMessages([]);
    endTurn();
  }, [endTurn]);

  useEffect(
    () => () => {
      wsRef.current?.close();
      if (stallTimerRef.current) clearTimeout(stallTimerRef.current);
    },
    [],
  );

  return { messages, streaming, stalled, send, stop, reset };
}
