import { useEffect, useRef, useState } from "react";
import { DEFAULT_DESCRIBE_INSTRUCTIONS, type Description } from "../../shared/description";
import { formatUpdatedAt, type DescribeRun } from "../useDescription";
import { ChatMessageList } from "./ChatMessageList";
import { ChevronDown, ChevronRight } from "./icons";
import { Markdown } from "./Markdown";

const COLLAPSED_KEY = "prv:overviewCollapsed";
const INSTRUCTIONS_KEY = "prv:describeInstructions";

function readInstructions(): string {
  try {
    return window.localStorage.getItem(INSTRUCTIONS_KEY) ?? DEFAULT_DESCRIBE_INSTRUCTIONS;
  } catch {
    return DEFAULT_DESCRIBE_INSTRUCTIONS;
  }
}

/** Remember the last prompt used; the default is stored as "nothing". */
function writeInstructions(value: string): void {
  try {
    if (value === DEFAULT_DESCRIBE_INSTRUCTIONS) window.localStorage.removeItem(INSTRUCTIONS_KEY);
    else window.localStorage.setItem(INSTRUCTIONS_KEY, value);
  } catch {
    /* localStorage unavailable; the prompt is used for this run only */
  }
}

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The Overview pane at the top of the diff: the change description rendered
 * as Markdown, like a pull request body. It has five faces — the description,
 * an empty state that explains `prv describe`, a textarea while editing, the
 * Generate prompt (editable, remembered in localStorage), and the agent's
 * activity while Generate runs. The description itself is owned
 * by useDescription; the pane only keeps its collapsed flag, the draft and the prompt.
 */
export function OverviewPanel({
  description,
  run,
  saveError,
  canGenerate,
  onGenerate,
  onStop,
  onDismissRun,
  onSave,
}: {
  description: Description | null;
  run: DescribeRun | null;
  saveError: string | null;
  /** False when there is no diff to describe. */
  canGenerate: boolean;
  /** Run Generate with these instructions (the editable part of the prompt). */
  onGenerate: (instructions: string) => void;
  onStop: () => void;
  onDismissRun: () => void;
  onSave: (markdown: string) => Promise<boolean>;
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [draft, setDraft] = useState<string | null>(null);
  // The Generate prompt while it is open for editing; null = closed.
  const [prompt, setPrompt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const running = run !== null && run.running;
  const editing = draft !== null || prompt !== null;
  const endRef = useRef<HTMLDivElement>(null);
  // Re-render once a minute so "updated 5 min ago" stays true.
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* localStorage unavailable; keep the in-memory value */
    }
  }, [collapsed]);

  // Follow the activity as it streams, like the Finish review card.
  useEffect(() => {
    if (running) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [run?.activity, running]);

  const startEdit = () => {
    setCollapsed(false);
    setDraft(description?.markdown ?? "");
  };
  const openPrompt = () => {
    setCollapsed(false);
    setPrompt(readInstructions());
  };
  const generate = () => {
    if (prompt === null || prompt.trim() === "") return;
    writeInstructions(prompt);
    setPrompt(null);
    onGenerate(prompt);
  };
  const save = async () => {
    if (draft === null || draft.trim() === "") return;
    setSaving(true);
    const saved = await onSave(draft);
    setSaving(false);
    if (saved) setDraft(null);
  };

  return (
    <section className="review-card overview-card" aria-label="Overview">
      <header className="review-card-header">
        <button
          type="button"
          className="overview-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span className="overview-chevron" aria-hidden="true">
            {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </span>
          <span className="review-card-title">Overview</span>
        </button>
        {running && <span className="review-card-running">generating…</span>}
        {!running && description && (
          <span className="overview-updated" title={description.updatedAt}>
            {formatUpdatedAt(description.updatedAt)}
          </span>
        )}
        <span className="review-card-spacer" />
        {!editing &&
          (running ? (
            <button type="button" className="prv-thread-btn" onClick={onStop}>
              Stop
            </button>
          ) : (
            <>
              <button type="button" className="prv-thread-btn" onClick={startEdit}>
                Edit
              </button>
              <button
                type="button"
                className="prv-thread-btn"
                disabled={!canGenerate}
                title="Ask the selected agent to describe the current diff"
                onClick={openPrompt}
              >
                {description ? "Regenerate" : "Generate"}
              </button>
            </>
          ))}
      </header>

      {!collapsed && (
        <>
          {run && !running && run.error && (
            <div className="batch-summary">
              <span className="batch-summary-error">⚠ {run.error}</span>
              <span className="review-card-spacer" />
              <button type="button" className="prv-thread-btn" onClick={onDismissRun}>
                Dismiss
              </button>
            </div>
          )}
          {running && (
            <div className="batch-activity">
              <ChatMessageList messages={run.activity} streaming={false} />
              {run.activity.length === 0 && <span className="batch-note">starting the agent…</span>}
              <div ref={endRef} />
            </div>
          )}
          {prompt !== null ? (
            <div className="batch-form overview-form">
              <label className="batch-note" htmlFor="overview-prompt">
                Prompt — what the agent should write. The diff and the read-only rule are added for
                you.
              </label>
              <textarea
                id="overview-prompt"
                className="chat-input overview-input"
                rows={10}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
              <div className="prv-thread-confirm-actions">
                <button
                  type="button"
                  className="chat-send"
                  disabled={prompt.trim() === ""}
                  onClick={generate}
                >
                  Generate
                </button>
                <button
                  type="button"
                  className="prv-thread-btn"
                  disabled={prompt === DEFAULT_DESCRIBE_INSTRUCTIONS}
                  onClick={() => setPrompt(DEFAULT_DESCRIBE_INSTRUCTIONS)}
                >
                  Reset to default
                </button>
                <button type="button" className="prv-thread-btn" onClick={() => setPrompt(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : draft !== null ? (
            <div className="batch-form overview-form">
              <textarea
                className="chat-input overview-input"
                aria-label="Description (Markdown)"
                rows={12}
                placeholder="## Aim&#10;&#10;## What changes&#10;&#10;## Behavior&#10;&#10;## Review guide"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              {saveError && <span className="batch-summary-error">⚠ {saveError}</span>}
              <div className="prv-thread-confirm-actions">
                <button
                  type="button"
                  className="chat-send"
                  disabled={saving || draft.trim() === ""}
                  onClick={save}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button type="button" className="prv-thread-btn" onClick={() => setDraft(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : description ? (
            <div className="overview-body">
              <Markdown source={description.markdown} mermaid />
            </div>
          ) : (
            !running && (
              <div className="batch-empty">
                No description yet. An agent writes one with <code>prv describe</code> (markdown on
                stdin, saved to <code>.prv/description.md</code>). Press Edit to write one yourself,
                or Generate to have the selected agent draft one from the current diff.
              </div>
            )
          )}
        </>
      )}
    </section>
  );
}
