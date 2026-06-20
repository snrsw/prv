import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatAsk, ChatServerFrame } from "../shared/chat";

export type ChatMessage = { role: "user" | "assistant"; text: string };

/**
 * One read-only-or-apply chat conversation with the agent over the `/api/chat`
 * WebSocket. Each hook instance owns a single connection, which on the server
 * maps to a single Claude session.
 *
 * Messages are seeded from `initial` (e.g. a persisted transcript) and every
 * change is reported through `onChange` so the caller can persist it. The hook
 * starts a fresh session per mount, so the first `send` after a reload re-sends
 * `firstTurnContext`; later turns rely on `--resume`.
 */
export function useDiffChat(
  initial: ChatMessage[] = [],
  onChange?: (messages: ChatMessage[]) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>(initial);
  const [streaming, setStreaming] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const hasSessionRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const commit = useCallback((next: ChatMessage[]) => {
    onChangeRef.current?.(next);
    return next;
  }, []);

  const appendToAssistant = useCallback(
    (text: string) => {
      setMessages((msgs) => {
        const last = msgs[msgs.length - 1];
        if (!last || last.role !== "assistant") return msgs;
        return commit([...msgs.slice(0, -1), { ...last, text: last.text + text }]);
      });
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
        case "error":
          appendToAssistant(`⚠ ${frame.message}`);
          setStreaming(false);
          break;
        case "done":
          setStreaming(false);
          break;
        case "busy":
          break;
      }
    },
    [appendToAssistant],
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
