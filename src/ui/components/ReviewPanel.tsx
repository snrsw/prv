import type { LensPhase, ReviewRun } from "../useReview";
import { ChatMessageList } from "./ChatMessageList";

const PHASE_LABEL: Record<LensPhase, string> = {
  queued: "queued",
  running: "running…",
  done: "done",
  error: "error",
};

/**
 * Live status card for an agent review run: one row per lens (state pill +
 * recent activity, reusing the chat activity rendering), a run-level error
 * line, and the "Clear agent comments" action. After a reload, with no run in
 * flight, it degrades to the summary header. Visibility is owned by App.
 */
export function ReviewPanel({
  run,
  openAgentCount,
  clearableCount,
  onClear,
}: {
  run: ReviewRun | null;
  openAgentCount: number;
  clearableCount: number;
  onClear: () => void;
}) {
  return (
    <section className="review-card">
      <header className="review-card-header">
        <span className="review-card-title">Agent review</span>
        {run?.running && <span className="review-card-running">running…</span>}
        {openAgentCount > 0 && (
          <span className="review-card-count">
            {openAgentCount} open comment{openAgentCount === 1 ? "" : "s"}
          </span>
        )}
        <span className="review-card-spacer" />
        {clearableCount > 0 && (
          <button type="button" className="prv-thread-btn" onClick={onClear}>
            Clear agent comments ({clearableCount})
          </button>
        )}
      </header>
      {run?.error && <div className="review-run-error">⚠ {run.error}</div>}
      {run &&
        Object.entries(run.lenses).map(([id, lens]) => (
          <div className="review-lens" key={id}>
            <span className="review-lens-name">{id}</span>
            <span className={`review-lens-state review-lens-state-${lens.phase}`}>
              {lens.phase === "done"
                ? `${lens.findings} finding${lens.findings === 1 ? "" : "s"}`
                : PHASE_LABEL[lens.phase]}
            </span>
            <div className="review-lens-activity">
              <ChatMessageList messages={lens.activity} streaming={false} />
              {lens.error && <div className="review-lens-error">⚠ {lens.error}</div>}
            </div>
          </div>
        ))}
    </section>
  );
}
