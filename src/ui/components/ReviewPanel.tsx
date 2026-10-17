import type { ReviewSeverity } from "../../shared/comments";
import type { LensPhase, ReviewRun } from "../useReview";
import { ChatMessageList } from "./ChatMessageList";

const PHASE_LABEL: Record<LensPhase, string> = {
  queued: "queued",
  running: "running…",
  done: "done",
  error: "error",
};

/** Chip order: worst first, matching how a reader triages. */
const SEVERITIES: ReviewSeverity[] = ["critical", "major", "minor", "info"];

/**
 * Live status card for an agent review run: one row per lens (state pill +
 * recent activity, reusing the chat activity rendering), a run-level error
 * line, and the "Clear agent comments" action. After a reload, with no run in
 * flight, it degrades to the summary header. Visibility is owned by App.
 *
 * The header doubles as the findings navigator (#58): per-severity chips
 * (each jumps to its first open finding), the open count (jumps to the first
 * open finding of any severity) and ↑/↓ that step through them across files.
 */
export function ReviewPanel({
  run,
  openAgentCount,
  bySeverity,
  clearableCount,
  onClear,
  onJump,
  onJumpToSeverity,
  onJumpToFirst,
}: {
  run: ReviewRun | null;
  openAgentCount: number;
  bySeverity: Partial<Record<ReviewSeverity, number>>;
  clearableCount: number;
  onClear: () => void;
  onJump: (direction: 1 | -1) => void;
  onJumpToSeverity: (severity: ReviewSeverity) => void;
  onJumpToFirst: () => void;
}) {
  return (
    <section className="review-card">
      <header className="review-card-header">
        <span className="review-card-title">Agent review</span>
        {run?.running && <span className="review-card-running">running…</span>}
        {openAgentCount > 0 && (
          <button
            type="button"
            className="review-card-count"
            title="Go to the first open finding"
            onClick={onJumpToFirst}
          >
            {openAgentCount} open comment{openAgentCount === 1 ? "" : "s"}
          </button>
        )}
        {SEVERITIES.map((severity) => {
          const n = bySeverity[severity] ?? 0;
          if (n === 0) return null;
          return (
            <button
              key={severity}
              type="button"
              className={`review-severity-chip prv-severity prv-severity-${severity}`}
              title={`Go to the first open ${severity} finding`}
              onClick={() => onJumpToSeverity(severity)}
            >
              {n} {severity}
            </button>
          );
        })}
        {openAgentCount > 0 && (
          <span className="file-change-nav" aria-label="Open findings">
            <button
              type="button"
              className="file-change-nav-btn"
              title="Previous finding"
              aria-label="Previous finding"
              onClick={() => onJump(-1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="file-change-nav-btn"
              title="Next finding"
              aria-label="Next finding"
              onClick={() => onJump(1)}
            >
              ↓
            </button>
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
