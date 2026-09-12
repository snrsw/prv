import { useEffect, useRef } from "react";
import type { Comment } from "../../shared/comments";
import { commentLocation, commentSummary } from "../batchComments";
import { summarizeBatchResults, type BatchRun } from "../useBatch";
import { ChatMessageList } from "./ChatMessageList";

/**
 * "Finish review": the card above the diff that hands every pending thread to
 * the agent in one apply-mode turn, the way GitHub submits a review in one go.
 *
 * It has three faces — the pending list with its confirmation before a run,
 * live activity while the turn is in flight, and a one-line outcome after it.
 * Visibility is owned by App, which also folds the results into the comment
 * store; the card itself is presentational.
 */
export function BatchPanel({
  pending,
  run,
  instructions,
  onInstructionsChange,
  onSend,
  onStop,
  onClose,
  onJumpTo,
}: {
  /** The threads a Send would cover — the snapshot taken at start, while running. */
  pending: Comment[];
  run: BatchRun | null;
  instructions: string;
  onInstructionsChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onClose: () => void;
  onJumpTo: (commentId: string) => void;
}) {
  // Written out (not `run?.running ?? false`) so both branches narrow `run`.
  const running = run !== null && run.running;
  const finished = run !== null && !run.running;
  const endRef = useRef<HTMLDivElement>(null);

  // Follow the activity as it streams, like the thread transcript does.
  useEffect(() => {
    if (running) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [run?.activity, running]);

  return (
    <section className="review-card batch-card">
      <header className="review-card-header">
        <span className="review-card-title">Finish review</span>
        {running && <span className="review-card-running">running…</span>}
        {!running && pending.length > 0 && (
          <span className="batch-card-count">
            {pending.length} pending comment{pending.length === 1 ? "" : "s"}
          </span>
        )}
        <span className="review-card-spacer" />
        <button
          type="button"
          className="prv-thread-close"
          aria-label="Close Finish review"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {finished ? (
        <div className="batch-summary">
          {run.error && <span className="batch-summary-error">⚠ {run.error}</span>}
          {run.results ? (
            <span>{summarizeBatchResults(run.results)}</span>
          ) : (
            !run.error && <span>The agent reported nothing back.</span>
          )}
          <span className="review-card-spacer" />
          <button type="button" className="prv-thread-btn" onClick={onClose}>
            Close
          </button>
        </div>
      ) : running ? (
        <>
          <div className="batch-activity">
            <ChatMessageList messages={run.activity} streaming={false} />
            {run.activity.length === 0 && <span className="batch-note">starting the agent…</span>}
            <div ref={endRef} />
          </div>
          <div className="batch-actions">
            <span className="batch-note">
              Addressing {run.count} comment{run.count === 1 ? "" : "s"} in one turn.
            </span>
            <span className="review-card-spacer" />
            <button type="button" className="prv-thread-btn" onClick={onStop}>
              Stop
            </button>
          </div>
        </>
      ) : pending.length === 0 ? (
        <div className="batch-empty">
          No pending comments. Write a comment on a line — every comment still waiting for the agent
          is sent from here in one turn.
        </div>
      ) : (
        <>
          <ul className="batch-list">
            {pending.map((c) => (
              <li className="batch-item" key={`${c.file}:${c.id}`}>
                <button
                  type="button"
                  className="batch-item-loc"
                  title="Go to this comment"
                  onClick={() => onJumpTo(c.id)}
                >
                  {commentLocation(c)}
                </button>
                <span className="batch-item-text">{commentSummary(c)}</span>
              </li>
            ))}
          </ul>
          <div className="batch-form">
            <label className="batch-label" htmlFor="batch-instructions">
              Notes for the agent (optional)
            </label>
            <textarea
              id="batch-instructions"
              className="chat-input"
              rows={2}
              placeholder="Anything that applies to the whole review…"
              value={instructions}
              onChange={(e) => onInstructionsChange(e.target.value)}
            />
            <div className="prv-thread-confirm">
              <span>
                The agent will edit files in your repo. Changes are git-tracked and shown as a diff
                to review. Continue?
              </span>
              <div className="prv-thread-confirm-actions">
                <button type="button" className="chat-send" onClick={onSend}>
                  Send to agent ({pending.length})
                </button>
                <button type="button" className="prv-thread-btn" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
