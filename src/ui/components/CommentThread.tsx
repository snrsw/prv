import { useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { markdownToHtml } from "../markdown";
import { useDiffChat } from "../useDiffChat";
import { buildThreadContext } from "../lineContext";
import { splitFindingBody } from "../reviewComments";
import { ChatMessageList } from "./ChatMessageList";
import type { Comment, StoredMessage } from "../../shared/comments";
import type { FileDiff } from "../types";

/** How the parent placed this thread in the diff. */
export type ThreadPlacement = "anchored" | "moved" | "file-level";

/**
 * An inline GitHub-style comment thread for a (possibly multi-line, mixed +/-)
 * diff range, backed by a persisted Comment. Read-only Q&A by default; "Apply
 * with agent" (after confirmation) lets the agent edit files, then refreshes
 * the diff. `label` and `context` are computed by the parent from the diff.
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
}: {
  file: FileDiff;
  comment: Comment;
  placement: ThreadPlacement;
  label: string;
  context: string;
  onUpdate: (updater: (c: Comment) => Comment) => void;
  onRemove: () => void;
  onApplied: () => void;
}) {
  const persist = (messages: StoredMessage[]) => onUpdate((c) => ({ ...c, messages }));
  const { messages, streaming, send } = useDiffChat(comment.messages, persist);
  const [input, setInput] = useState("");
  const [confirmingApply, setConfirmingApply] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const applyPendingRef = useRef(false);

  const resolved = comment.status === "resolved";
  const isReview = comment.source === "review";
  // A fresh session's first turn carries the persisted transcript, so replies
  // to a review finding (or to any thread after a reload) keep their context.
  const threadContext = buildThreadContext(context, comment.messages);

  const { body, rest } = isReview ? splitFindingBody(messages) : { body: null, rest: messages };
  const bodyHtml = useMemo(
    () => (body === null ? "" : DOMPurify.sanitize(markdownToHtml(body))),
    [body],
  );

  const onSend = () => {
    if (input.trim() === "" || streaming) return;
    send(input, threadContext, "ask");
    setInput("");
  };

  const runApply = () => {
    setConfirmingApply(false);
    const lastUser = [...comment.messages, ...messages]
      .filter((m): m is StoredMessage => m.role === "user")
      .pop();
    const instruction = input.trim() || lastUser?.text || "Make the change discussed above.";
    applyPendingRef.current = true;
    send(instruction, threadContext, "apply");
    setInput("");
  };

  // When an apply turn finishes, refresh the diff so the edits show.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !streaming && applyPendingRef.current) {
      applyPendingRef.current = false;
      onApplied();
    }
    wasStreaming.current = streaming;
  }, [streaming, onApplied]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);

  const setStatus = (status: Comment["status"]) => onUpdate((c) => ({ ...c, status }));

  return (
    <div className={`prv-thread ${resolved ? "prv-thread-resolved" : ""}`}>
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
          {body !== null && (
            <div
              className="markdown-body prv-finding-body"
              // Sanitized via DOMPurify in the useMemo above before injection.
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          )}
          {rest.length > 0 && (
            <div className="prv-thread-messages">
              <ChatMessageList messages={rest} streaming={streaming} />
              <div ref={endRef} />
            </div>
          )}

          {confirmingApply ? (
            <div className="prv-thread-confirm">
              <span>
                The agent will edit files in your repo. Changes are git-tracked and shown as a diff
                to review. Continue?
              </span>
              <div className="prv-thread-confirm-actions">
                <button type="button" className="chat-send" onClick={runApply}>
                  Yes, apply
                </button>
                <button
                  type="button"
                  className="prv-thread-btn"
                  onClick={() => setConfirmingApply(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="chat-input-row prv-thread-input">
              <textarea
                className="chat-input"
                value={input}
                placeholder={messages.length === 0 ? "Comment on these lines…" : "Reply…"}
                rows={2}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSend();
                  }
                }}
              />
              <div className="prv-thread-send-row">
                <button
                  type="button"
                  className="prv-thread-btn"
                  disabled={streaming}
                  onClick={() => setConfirmingApply(true)}
                >
                  Apply with agent
                </button>
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
          )}
        </>
      )}
    </div>
  );
}
