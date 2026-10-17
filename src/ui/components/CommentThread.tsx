import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "./Markdown";
import { dropEmptyAssistants, stripEphemeral, useDiffChat } from "../useDiffChat";
import { isSubmitKey } from "../keys";
import { buildThreadContext } from "../lineContext";
import { splitFindingBody } from "../reviewComments";
import { appendUserMessage, persistedIsAhead } from "../threadTranscript";
import { ChatMessageList } from "./ChatMessageList";
import { isPendingComment, type Comment, type StoredMessage } from "../../shared/comments";
import { SEND_ACTIONS, setSendAction, useSendAction, type SendAction } from "../sendAction";
import type { FileDiff } from "../types";

/** How the parent placed this thread in the diff. */
export type ThreadPlacement = "anchored" | "moved" | "file-level";

/** Why "Send now" is off while a batch runs. */
const BATCH_BUSY_HINT = "A “Finish review” run is addressing this comment";

/**
 * An inline GitHub-style comment thread for a (possibly multi-line, mixed +/-)
 * diff range, backed by a persisted Comment.
 *
 * The composer has one split send button (#83) whose caret picks its action,
 * remembered app-wide. "Add to batch" is just a write to the store — like
 * GitHub, the agent is not called per comment; the pending threads go out
 * together from the "Finish review" card. "Send now" runs the agent on this
 * thread at once: it decides whether the comment asks for a file edit or only
 * an answer, and the diff refreshes when the turn ends. `label` and `context`
 * are computed by the parent from the diff. Agent-review comments additionally render a badge row and
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
  const [action] = useSendAction();
  const endRef = useRef<HTMLDivElement>(null);
  const refreshPendingRef = useRef(false);

  const resolved = comment.status === "resolved";
  const isReview = comment.source === "review";
  const pending = isPendingComment(comment);
  // The batch is about to answer this thread; a second agent turn on it would
  // race that one and answer it twice.
  const claimedByBatch = batchRunning && pending;

  // The store is this thread's authority: "Add to batch" writes to it
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
  const addToBatch = () => {
    if (input.trim() === "" || streaming) return;
    onUpdate((c) => ({ ...c, messages: appendUserMessage(c.messages, input) }));
    setInput("");
  };

  /** Run the agent on this thread now; it may edit files, so refresh after. */
  const sendNow = () => {
    if (input.trim() === "" || streaming || claimedByBatch) return;
    refreshPendingRef.current = true;
    send(input, threadContext, "auto");
    setInput("");
  };

  const submit = action === "now" ? sendNow : addToBatch;
  const submitDisabled = input.trim() === "" || (action === "now" && claimedByBatch);

  // When a "Send now" turn finishes, refresh the diff so any edits show.
  const wasStreaming = useRef(false);
  useEffect(() => {
    if (wasStreaming.current && !streaming && refreshPendingRef.current) {
      refreshPendingRef.current = false;
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
                  submit();
                }
              }}
            />
            <div className="prv-thread-send-row">
              {streaming ? (
                <button type="button" className="chat-send" onClick={stop}>
                  Stop
                </button>
              ) : (
                <SendSplitButton
                  action={action}
                  disabled={submitDisabled}
                  title={action === "now" && claimedByBatch ? BATCH_BUSY_HINT : undefined}
                  onSubmit={submit}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The composer's split button: the main part runs the selected action, the
 * caret opens a two-item menu that changes it. The menu closes on an outside
 * press or Escape, like the chat panel's settings popover.
 */
function SendSplitButton({
  action,
  disabled,
  title,
  onSubmit,
}: {
  action: SendAction;
  disabled: boolean;
  title?: string;
  onSubmit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const caretRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  const choose = (next: SendAction) => {
    setSendAction(next);
    setOpen(false);
    caretRef.current?.focus();
  };

  return (
    <div
      className="prv-split-send"
      ref={containerRef}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        setOpen(false);
        caretRef.current?.focus();
      }}
    >
      <button
        type="button"
        className="chat-send prv-split-send-main"
        disabled={disabled}
        title={title ?? SEND_ACTIONS[action].description}
        onClick={onSubmit}
      >
        {SEND_ACTIONS[action].label}
      </button>
      <button
        ref={caretRef}
        type="button"
        className="chat-send prv-split-send-caret"
        aria-label="Choose send action"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ▾
      </button>
      {open && (
        <div className="prv-split-send-menu" role="menu" aria-label="Send action">
          {(["now", "batch"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === action}
              className={"prv-split-send-item" + (option === action ? " is-selected" : "")}
              onClick={() => choose(option)}
            >
              <span className="prv-split-send-check" aria-hidden="true">
                {option === action ? "✓" : ""}
              </span>
              <span className="prv-split-send-text">
                <span className="prv-split-send-label">{SEND_ACTIONS[option].label}</span>
                <span className="prv-split-send-desc">{SEND_ACTIONS[option].description}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
