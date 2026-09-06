import { useEffect, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { useDiffChat } from "../useDiffChat";
import { isSubmitKey } from "../keys";
import { buildThreadContext } from "../lineContext";
import { splitFindingBody } from "../reviewComments";
import { canSend, resolveInstruction } from "../sendMode";
import { useSendMode } from "../useSendMode";
import { ChatMessageList } from "./ChatMessageList";
import { ChatSettingsMenu } from "./ChatSettings";
import { SendButton, WriteConfirm } from "./SendButton";
import type { Comment, StoredMessage } from "../../shared/comments";
import type { FileDiff } from "../types";

/** How the parent placed this thread in the diff. */
export type ThreadPlacement = "anchored" | "moved" | "file-level";

/**
 * An inline GitHub-style comment thread for a (possibly multi-line, mixed +/-)
 * diff range, backed by a persisted Comment. Read-only Q&A by default; the
 * Send menu's Write mode (confirmed once per thread) lets the agent edit
 * files, then refreshes the diff. `label` and `context` are computed by the
 * parent from the diff.
 * Agent-review comments additionally render a badge row and their finding
 * body as markdown.
 */
export function CommentThread({
  file,
  comment,
  placement,
  label,
  context,
  onUpdate,
  onRemove,
  onApplied,
  focused = false,
}: {
  file: FileDiff;
  comment: Comment;
  placement: ThreadPlacement;
  label: string;
  context: string;
  onUpdate: (updater: (c: Comment) => Comment) => void;
  onRemove: () => void;
  onApplied: () => void;
  /** Briefly true after a finding jump landed here, for the highlight flash. */
  focused?: boolean;
}) {
  const persist = (messages: StoredMessage[]) => onUpdate((c) => ({ ...c, messages }));
  const { messages, streaming, stalled, send, stop } = useDiffChat(comment.messages, persist);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const sendMode = useSendMode(streaming, onApplied);

  const resolved = comment.status === "resolved";
  const isReview = comment.source === "review";
  // A fresh session's first turn carries the persisted transcript, so replies
  // to a review finding (or to any thread after a reload) keep their context.
  const threadContext = buildThreadContext(context, comment.messages);

  const { body, rest } = isReview ? splitFindingBody(messages) : { body: null, rest: messages };

  const onSend = () => {
    if (streaming) return;
    // A Write send with an empty box repeats what the thread already asked for.
    const instruction = resolveInstruction(sendMode.mode, input, [
      ...comment.messages,
      ...messages,
    ]);
    if (instruction === null) return;
    sendMode.submit(() => {
      send(instruction, threadContext, sendMode.mode);
      setInput("");
    });
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  const setStatus = (status: Comment["status"]) => onUpdate((c) => ({ ...c, status }));

  return (
    <div
      className={`prv-thread ${resolved ? "prv-thread-resolved" : ""} ${focused ? "prv-thread-focus" : ""}`}
      data-comment-id={comment.id}
    >
      <div className="prv-thread-head">
        <span className="prv-thread-title">
          <span className="prv-thread-loc">
            {label ? `${file.path}:${label}` : file.path}
            {resolved && <span className="prv-thread-badge"> resolved</span>}
          </span>
          {isReview && (
            <span className="prv-thread-chips">
              <span className="prv-agent-badge">agent review</span>
              <span className={`prv-severity prv-severity-${comment.severity ?? "info"}`}>
                {comment.severity ?? "info"}
              </span>
              {comment.lens && <span className="prv-lens-tag">{comment.lens}</span>}
            </span>
          )}
        </span>
        <span className="prv-thread-actions">
          <button
            type="button"
            className="prv-thread-btn"
            onClick={() => setStatus(resolved ? "open" : "resolved")}
          >
            {resolved ? "Reopen" : "Resolve"}
          </button>
          <button
            type="button"
            className="prv-thread-close"
            aria-label="Delete comment"
            onClick={onRemove}
          >
            ×
          </button>
        </span>
      </div>

      {placement === "moved" && (
        <div className="prv-thread-banner">
          The lines this comment was on have changed; showing it here without an anchor.
        </div>
      )}
      {placement === "file-level" && (
        <div className="prv-thread-banner prv-thread-banner-info">
          File-level finding — not tied to specific lines.
        </div>
      )}

      {!resolved && (
        <>
          {body !== null && <Markdown source={body} className="prv-finding-body" />}
          {rest.length > 0 && (
            <div className="prv-thread-messages">
              <ChatMessageList messages={rest} streaming={streaming} stalled={stalled} />
              <div ref={endRef} />
            </div>
          )}

          {sendMode.confirming ? (
            <WriteConfirm onConfirm={sendMode.confirm} onCancel={sendMode.cancel} />
          ) : (
            <div className="chat-input-row prv-thread-input">
              <textarea
                className="chat-input"
                value={input}
                placeholder={messages.length === 0 ? "Comment on these lines…" : "Reply…"}
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
              <div className="prv-thread-send-row">
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
        </>
      )}
    </div>
  );
}
