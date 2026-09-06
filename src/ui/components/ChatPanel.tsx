import { useEffect, useRef, useState } from "react";
import { AGENT_LABELS } from "../../shared/chat";
import { useChatSettings } from "../chatSettings";
import { isSubmitKey } from "../keys";
import { drawerWidth } from "../layout";
import { canSend, resolveInstruction } from "../sendMode";
import { useDiffChat } from "../useDiffChat";
import { useSendMode } from "../useSendMode";
import { ChatMessageList } from "./ChatMessageList";
import { ChatSettingsMenu } from "./ChatSettings";
import { SendButton, WriteConfirm } from "./SendButton";
import type { FileDiff } from "../types";

function assembleDiff(files: FileDiff[] | null): string {
  return (files ?? []).map((f) => f.raw).join("\n");
}

/**
 * The diff-wide conversation. Read only by default; the Send menu's Write
 * mode lets the agent edit files, after which `onApplied` refreshes the diff
 * so the edits show, exactly like an inline thread's Write send.
 */
export function ChatPanel({
  files,
  open,
  width,
  drawer,
  onApplied,
}: {
  files: FileDiff[] | null;
  open: boolean;
  width: number;
  /** Compact layout (#60): the panel floats over the diff instead of beside it. */
  drawer: boolean;
  onApplied: () => void;
}) {
  const { messages, streaming, stalled, send, stop, reset } = useDiffChat();
  const [settings] = useChatSettings();
  const agentLabel = AGENT_LABELS[settings.agent ?? "claude"];
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const sendMode = useSendMode(streaming, onApplied);

  const onSend = () => {
    if (streaming) return;
    const instruction = resolveInstruction(sendMode.mode, input, messages);
    if (instruction === null) return;
    sendMode.submit(() => {
      send(instruction, assembleDiff(files), sendMode.mode);
      setInput("");
    });
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
            {sendMode.mode === "apply"
              ? `Describe a change — your local ${agentLabel} may edit files (Write mode).`
              : `Ask questions about the changes — answers come from your local ${agentLabel}, read-only.`}
          </div>
        )}
        <ChatMessageList messages={messages} streaming={streaming} stalled={stalled} />
        <div ref={endRef} />
      </div>

      {sendMode.confirming ? (
        <div className="chat-input-row">
          <WriteConfirm onConfirm={sendMode.confirm} onCancel={sendMode.cancel} />
        </div>
      ) : (
        <div className="chat-input-row">
          <textarea
            className="chat-input"
            value={input}
            placeholder={sendMode.mode === "apply" ? "Describe the change…" : "Ask about the diff…"}
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
            <SendButton
              mode={sendMode.mode}
              onModeChange={sendMode.setMode}
              onSend={onSend}
              onStop={stop}
              streaming={streaming}
              disabled={!canSend(sendMode.mode, input)}
            />
          </div>
        </div>
      )}
    </aside>
  );
}
