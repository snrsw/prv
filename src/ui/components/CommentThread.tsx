import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { dropEmptyAssistants, stripEphemeral, useDiffChat } from "../useDiffChat";
import { isSubmitKey } from "../keys";
import { buildThreadContext } from "../lineContext";
import { splitFindingBody } from "../reviewComments";
import { appendUserMessage, persistedIsAhead } from "../threadTranscript";
import { ChatMessageList } from "./ChatMessageList";
import { isPendingComment, type Comment, type StoredMessage } from "../../shared/comments";
import type { FileDiff } from "../types";

/** How the parent placed this thread in the diff. */
export type ThreadPlacement = "anchored" | "moved" | "file-level";

/** Why the per-thread agent buttons are off while a batch runs. */
const BATCH_BUSY_HINT = "A “Finish review” run is addressing this comment";

/**
 * An inline GitHub-style comment thread for a (possibly multi-line, mixed +/-)
 * diff range, backed by a persisted Comment.
 *
 * Saving a comment is just a write to the store — like GitHub, the agent is
 * not called per comment; the pending threads go out together from the
 * "Finish review" card. "Ask agent" is read-only Q&A on this thread alone, and
 * "Apply with agent" (after confirmation) lets the agent edit files for it,
 * then refreshes the diff. `label` and `context` are computed by the parent
 * from the diff. Agent-review comments additionally render a badge row and
 * their finding body as markdown.
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
  batchRunning = false,
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
  /** A "Finish review" batch is in flight; it will answer the pending threads. */
  batchRunning?: boolean;
}) {
  const persist = (messages: StoredMessage[]) => onUpdate((c) => ({ ...c, messages }));
  const { messages, streaming, stalled, send, stop, seed } = useDiffChat(comment.messages, persist);
  const [input, setInput] = useState("");
  const [confirmingApply, setConfirmingApply] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const applyPendingRef = useRef(false);

  const resolved = comment.status === "resolved";
  const isReview = comment.source === "review";
  const pending = isPendingComment(comment);
  // The batch is about to answer this thread; a second agent turn on it would
  // race that one and answer it twice.
  const claimedByBatch = batchRunning && pending;

  // The store is this thread's authority: the Comment button writes to it
  // without going through the agent, and a "Finish review" run appends the
  // agent's reply to every pending thread while these cards are mounted. Adopt
  // the persisted transcript whenever it holds something the live one doesn't
  // — never mid-turn, where the live list carries the streaming tail that is
  // not persisted yet.
  // Both sides are healed the same way (`useDiffChat` drops an empty assistant
  // placeholder a crashed turn left in the store, and never writes the healed
  // list back), so a store holding one does not read as forever ahead.
  const stored = useMemo(() => dropEmptyAssistants(comment.messages), [comment.messages]);
  const live = useMemo(() => stripEphemeral(messages), [messages]);
  useEffect(() => {
    if (streaming) return;
    if (persistedIsAhead(stored, live)) seed(stored);
  }, [stored, live, streaming, seed]);
  // A fresh session's first turn carries the persisted transcript, so replies
  // to a review finding (or to any thread after a reload) keep their context.
  const threadContext = buildThreadContext(context, comment.messages);

  const { body, rest } = isReview ? splitFindingBody(messages) : { body: null, rest: messages };

  /**
   * Save the comment: append it to the persisted thread and let the effect
   * above pull it into the live transcript, so the message has exactly one
   * writer (the store) and cannot be persisted twice or lost.
   */
  const onComment = () => {
    if (input.trim() === "" || streaming) return;
    onUpdate((c) => ({ ...c, messages: appendUserMessage(c.messages, input) }));
    setInput("");
  };

  const onAsk = () => {
    if (input.trim() === "" || streaming || claimedByBatch) return;
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

  // Follow the answer while this thread's own turn streams. A transcript that
  // changed from outside the card (a "Finish review" reply landing on several
  // threads at once) must not pull the page around, so it is not followed.
  useEffect(() => {
    if (streaming) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, streaming]);

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
            {pending && (
              <span
                className="prv-thread-badge prv-thread-badge-pending"
                title="Waiting for the agent — Finish review sends it"
              >
                {" "}
                pending
              </span>
            )}
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
                  if (
                    isSubmitKey({
                      key: e.key,
                      shiftKey: e.shiftKey,
                      isComposing: e.nativeEvent.isComposing,
                      keyCode: e.keyCode,
                    })
                  ) {
                    e.preventDefault();
                    onComment();
                  }
                }}
              />
              <div className="prv-thread-send-row">
                <button
                  type="button"
                  className="prv-thread-btn"
                  disabled={streaming || claimedByBatch || input.trim() === ""}
                  title={claimedByBatch ? BATCH_BUSY_HINT : "Answer here without editing files"}
                  onClick={onAsk}
                >
                  Ask agent
                </button>
                <button
                  type="button"
                  className="prv-thread-btn"
                  disabled={streaming || claimedByBatch}
                  title={claimedByBatch ? BATCH_BUSY_HINT : undefined}
                  onClick={() => setConfirmingApply(true)}
                >
                  Apply with agent
                </button>
                {streaming ? (
                  <button type="button" className="chat-send" onClick={stop}>
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    className="chat-send"
                    onClick={onComment}
                    disabled={input.trim() === ""}
                  >
                    Comment
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
