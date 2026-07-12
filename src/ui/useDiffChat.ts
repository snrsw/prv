import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatAsk, ChatServerFrame } from "../shared/chat";
import type { StoredMessage } from "../shared/comments";

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
 * Fold a streaming text chunk into the transcript: extend the trailing
 * assistant message, or start a new one if the last entry is not an assistant
 * message (e.g. a user turn or an interleaved tool line). Pure and exported for
 * unit testing.
 */
export function appendChunk(messages: ChatMessage[], text: string): ChatMessage[] {
  const last = messages[messages.length - 1];
  if (last && last.role === "assistant") {
    return [...messages.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...messages, { role: "assistant", text }];
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
 * Drop the ephemeral activity lines (`tool` calls and `progress` narration) so
 * the persisted transcript keeps only the user's questions and the answers.
 */
export function stripEphemeral(messages: ChatMessage[]): StoredMessage[] {
  return messages.filter((m): m is StoredMessage => m.role !== "tool" && m.role !== "progress");
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

/** A compact, muted glyph shown next to a live-activity line for a tool name. */
export function toolIcon(name: string): string {
  const icons: Record<string, string> = {
    Read: "▸",
    Edit: "✎",
    Write: "✎",
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
 * maps to a single Claude session.
 *
 * Messages are seeded from `initial` (e.g. a persisted transcript) and every
 * change is reported through `onChange` so the caller can persist it. Ephemeral
 * activity (tool + progress lines) is stripped before `onChange` so only
 * user/assistant text is saved.
 * The hook starts a fresh session per mount, so the first `send` after a reload
 * re-sends `firstTurnContext`; later turns rely on `--resume`.
 */
export function useDiffChat(
  initial: ChatMessage[] = [],
  onChange?: (messages: StoredMessage[]) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [streaming, setStreaming] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const hasSessionRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const commit = useCallback((next: ChatMessage[]) => {
    onChangeRef.current?.(stripEphemeral(next));
    return next;
  }, []);

  const appendToAssistant = useCallback(
    (text: string) => {
      setMessages((msgs) => commit(appendChunk(msgs, text)));
    },
    [commit],
  );

  const handleFrame = useCallback(
    (frame: ChatServerFrame) => {
      switch (frame.type) {
        case "session":
          hasSessionRef.current = true;
          break;
        case "chunk":
          appendToAssistant(frame.text);
          break;
        case "tool":
          setMessages((m) => commit(appendTool(m, { name: frame.name, target: frame.target })));
          break;
        case "progress":
          setMessages((m) => commit(appendProgress(m, frame.text)));
          break;
        case "error":
          appendToAssistant(`⚠ ${frame.message}`);
          setStreaming(false);
          break;
        case "done":
          setMessages((m) => commit(dropEmptyPlaceholder(m)));
          setStreaming(false);
          break;
        case "busy":
          break;
      }
    },
    [appendToAssistant, commit],
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
      const diff = hasSessionRef.current ? "" : firstTurnContext;
      setMessages((m) =>
        commit([...m, { role: "user", text: q }, { role: "assistant", text: "" }]),
      );
      setStreaming(true);
      const ws = ensureSocket();
      const payload: ChatAsk = { type: "ask", question: q, diff, mode };
      const data = JSON.stringify(payload);
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
      else ws.addEventListener("open", () => ws.send(data), { once: true });
    },
    [streaming, ensureSocket, commit],
  );

  const reset = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    hasSessionRef.current = false;
    setMessages(commit([]));
    setStreaming(false);
  }, [commit]);

  useEffect(() => () => wsRef.current?.close(), []);

  return { messages, streaming, send, reset };
}
