import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatAsk, ChatServerFrame } from "../../shared/chat";
import type { FileDiff } from "../types";

type Message = { role: "user" | "assistant"; text: string };

function assembleDiff(files: FileDiff[] | null): string {
  return (files ?? []).map((f) => f.raw).join("\n");
}

export function ChatPanel({ files, open }: { files: FileDiff[] | null; open: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const appendToAssistant = useCallback((text: string) => {
    setMessages((msgs) => {
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== "assistant") return msgs;
      return [...msgs.slice(0, -1), { ...last, text: last.text + text }];
    });
  }, []);

  const handleFrame = useCallback(
    (frame: ChatServerFrame) => {
      switch (frame.type) {
        case "session":
          sessionRef.current = frame.sessionId;
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

  const send = useCallback(() => {
    const question = input.trim();
    if (!question || streaming) return;
    const diff = sessionRef.current ? "" : assembleDiff(files);
    setMessages((m) => [...m, { role: "user", text: question }, { role: "assistant", text: "" }]);
    setInput("");
    setStreaming(true);
    const ws = ensureSocket();
    const payload: ChatAsk = { type: "ask", question, diff };
    const data = JSON.stringify(payload);
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
    else ws.addEventListener("open", () => ws.send(data), { once: true });
  }, [input, streaming, files, ensureSocket]);

  const reset = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    sessionRef.current = null;
    setMessages([]);
    setStreaming(false);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  useEffect(() => () => wsRef.current?.close(), []);

  return (
    <aside className="chat-panel" style={{ display: open ? "flex" : "none" }}>
      <div className="chat-header">
        <span className="chat-title">Ask about this diff</span>
        <button
          type="button"
          className="chat-reset"
          onClick={reset}
          disabled={messages.length === 0 && !streaming}
        >
          New chat
        </button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            Ask questions about the changes — answers come from your local Claude Code, read-only.
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            {m.text === "" && streaming ? <span className="chat-thinking">thinking…</span> : m.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="chat-input-row">
        <textarea
          className="chat-input"
          value={input}
          placeholder="Ask about the diff…"
          rows={2}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          className="chat-send"
          onClick={send}
          disabled={streaming || input.trim() === ""}
        >
          Send
        </button>
      </div>
    </aside>
  );
}
