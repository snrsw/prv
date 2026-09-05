import { useEffect, useRef, useState } from "react";
import { isSubmitKey } from "../keys";
import { useDiffChat } from "../useDiffChat";
import { ChatMessageList } from "./ChatMessageList";
import { ChatSettings } from "./ChatSettings";
import type { FileDiff } from "../types";

function assembleDiff(files: FileDiff[] | null): string {
  return (files ?? []).map((f) => f.raw).join("\n");
}

export function ChatPanel({
  files,
  open,
  width,
}: {
  files: FileDiff[] | null;
  open: boolean;
  width: number;
}) {
  const { messages, streaming, send, reset } = useDiffChat();
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const onSend = () => {
    if (input.trim() === "" || streaming) return;
    send(input, assembleDiff(files), "ask");
    setInput("");
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  return (
    <aside className="chat-panel" style={{ display: open ? "flex" : "none", flexBasis: width }}>
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
        <ChatMessageList messages={messages} streaming={streaming} />
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
            if (
              isSubmitKey({
                key: e.key,
                shiftKey: e.shiftKey,
                isComposing: e.nativeEvent.isComposing,
                keyCode: e.keyCode,
              })
            ) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        <div className="chat-composer-bar">
          <ChatSettings disabled={streaming} />
          <button
            type="button"
            className="chat-send"
            onClick={onSend}
            disabled={streaming || input.trim() === ""}
          >
            Send
          </button>
        </div>
      </div>
    </aside>
  );
}
