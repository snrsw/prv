import { useEffect, useRef, useState } from "react";
import { AGENT_LABELS } from "../../shared/chat";
import { summarizeChatSettings, useChatSettings } from "../chatSettings";
import { isSubmitKey } from "../keys";
import { drawerWidth } from "../layout";
import { useDiffChat } from "../useDiffChat";
import { ChatMessageList } from "./ChatMessageList";
import { ChatSettings } from "./ChatSettings";
import { GearIcon } from "./icons";
import type { FileDiff } from "../types";

function assembleDiff(files: FileDiff[] | null): string {
  return (files ?? []).map((f) => f.raw).join("\n");
}

export function ChatPanel({
  files,
  open,
  width,
  drawer,
}: {
  files: FileDiff[] | null;
  open: boolean;
  width: number;
  /** Compact layout (#60): the panel floats over the diff instead of beside it. */
  drawer: boolean;
}) {
  const { messages, streaming, stalled, send, stop, reset } = useDiffChat();
  const [settings] = useChatSettings();
  const agentLabel = AGENT_LABELS[settings.agent ?? "claude"];
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
    <aside
      className={"chat-panel" + (drawer ? " is-drawer" : "")}
      style={
        drawer
          ? { display: open ? "flex" : "none", width: drawerWidth(width) }
          : { display: open ? "flex" : "none", flexBasis: width }
      }
    >
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
            Ask questions about the changes — answers come from your local {agentLabel}, read-only.
          </div>
        )}
        <ChatMessageList messages={messages} streaming={streaming} stalled={stalled} />
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
          <ChatSettingsMenu disabled={streaming} />
          {streaming ? (
            <button type="button" className="chat-send" onClick={stop}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="chat-send"
              onClick={onSend}
              disabled={input.trim() === ""}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

/**
 * The agent / model / effort pickers behind one compact button (#62): the
 * inline row wrapped at the panel's default width and stranded Send. Opens a
 * popover above the button that closes on an outside press or Escape, the
 * way the topbar's `SidePicker` does.
 */
function ChatSettingsMenu({ disabled }: { disabled: boolean }) {
  const [settings] = useChatSettings();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const summary = summarizeChatSettings(settings);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  return (
    <div
      className="chat-settings-menu"
      ref={containerRef}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={"chat-settings-btn" + (open ? " is-active" : "")}
        aria-label="Agent settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={`Agent settings: ${summary}`}
        onClick={() => setOpen((o) => !o)}
      >
        <GearIcon />
        <span className="chat-settings-summary">{summary}</span>
      </button>
      {open && (
        <div
          className="mode-picker-popover chat-settings-popover"
          role="dialog"
          aria-label="Agent settings"
        >
          <ChatSettings disabled={disabled} />
        </div>
      )}
    </div>
  );
}
