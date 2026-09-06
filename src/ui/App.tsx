import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileTree } from "./components/FileTree";
import { ChatPanel } from "./components/ChatPanel";
import { DiffPanel } from "./components/DiffPanel";
import { DiffStat } from "./components/DiffStat";
import { ModePicker } from "./components/ModePicker";
import { ReviewPanel } from "./components/ReviewPanel";
import { findingsToComments } from "../review/transform";
import { encodeMode } from "../shared/modeQuery";
import { isClearableReviewComment } from "../shared/review";
import type { LensId, ReviewFinding } from "../shared/review";
import { sumTotals } from "./totals";
import { useComments } from "./useComments";
import { useFileUiState } from "./useFileUiState";
import type { FileUi } from "./useFileUiState";
import { useResizablePanel } from "./useResizablePanel";
import type { ResizablePanel } from "./useResizablePanel";
import { useReview } from "./useReview";
import type { DiffOutputFormat, FileDiff, ServerMode } from "./types";

const DIFF_OUTPUT_FORMAT_KEY = "prv:diffOutputFormat";

function readStoredDiffOutputFormat(): DiffOutputFormat {
  try {
    return window.localStorage.getItem(DIFF_OUTPUT_FORMAT_KEY) === "split" ? "split" : "unified";
  } catch {
    return "unified";
  }
}

type ServerConfig = { mode: ServerMode | null };

/** Stable default so an untouched card gets the same props object each render. */
const EMPTY_UI: FileUi = {};

function pathToAnchor(path: string): string {
  return "file-" + path;
}

function buildDiffUrl(mode: ServerMode | null): string {
  if (!mode) return "/api/diff";
  const url = new URL("/api/diff", window.location.origin);
  encodeMode(mode, url.searchParams);
  return url.pathname + url.search;
}

function sameMode(a: ServerMode | null, b: ServerMode | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The top-most file card on screen and where its top edge sits in the viewport. */
type ScrollAnchor = { path: string; top: number };

function captureScrollAnchor(): ScrollAnchor | null {
  for (const card of document.querySelectorAll<HTMLElement>(".file-card[data-path]")) {
    const top = card.getBoundingClientRect().top;
    if (top + card.offsetHeight > 0) return { path: card.dataset.path!, top };
  }
  return null;
}

/** Scroll so the anchored card sits where it was before the diff was swapped. */
function restoreScrollAnchor(anchor: ScrollAnchor): void {
  const card = document.getElementById(pathToAnchor(anchor.path));
  if (!card) return;
  const delta = card.getBoundingClientRect().top - anchor.top;
  if (delta !== 0) window.scrollBy(0, delta);
}

export function App() {
  const [mode, setMode] = useState<ServerMode | null>(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  // `files` is null only until the first diff arrives; a reload keeps the
  // previous list on screen (so every card stays mounted) until the new one
  // lands, and `loading` is what the topbar shows in the meantime.
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [loading, setLoading] = useState(false);
  // The comparison `files` came from. A fetch that fails leaves it alone, and
  // the picker is reverted to it (#50) so it never rests on a broken ref.
  const [loadedMode, setLoadedMode] = useState<{ mode: ServerMode | null } | null>(null);
  const loadedModeRef = useRef(loadedMode);
  // Set when the mode was just reverted: that fetch must keep the error banner
  // and, should it fail too, must not revert again (there is nowhere to go).
  const revertRef = useRef(false);
  const scrollAnchorRef = useRef<ScrollAnchor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const sidebarResize = useResizablePanel({
    storageKey: "prv:sidebarWidth",
    defaultWidth: 296,
    minWidth: 180,
    maxWidth: 640,
    side: "left",
  });
  const chatResize = useResizablePanel({
    storageKey: "prv:chatWidth",
    defaultWidth: 380,
    minWidth: 280,
    maxWidth: 800,
    side: "right",
  });
  const [diffOutputFormat, setDiffOutputFormat] = useState<DiffOutputFormat>(
    readStoredDiffOutputFormat,
  );
  const {
    comments,
    addComment,
    updateComment,
    removeComment,
    removeWhere,
    lastRemoved,
    undoRemove,
    dismissRemoved,
  } = useComments(bootstrapped);
  const refreshDiff = useCallback(() => setReloadKey((k) => k + 1), []);
  const filePaths = useMemo(() => files?.map((f) => f.path) ?? null, [files]);
  const [fileUi, setFileUi] = useFileUiState(loadedMode?.mode ?? null, filePaths);

  // Findings anchor against the diff snapshot taken when Review was pressed,
  // so a mid-run refresh or mode switch can't shear the anchors (worst case
  // they render as orphaned, exactly like hand-made comments).
  const reviewFilesRef = useRef<FileDiff[]>([]);
  const handleFindings = useCallback(
    (lens: LensId, findings: ReviewFinding[], runId: string) => {
      const result = findingsToComments({
        findings,
        files: reviewFilesRef.current,
        runId,
        lens,
      });
      result.comments.forEach(addComment);
    },
    [addComment],
  );
  const review = useReview(handleFindings);
  const { start: startReviewRun, running: reviewRunning } = review;

  const startReview = useCallback(() => {
    if (reviewRunning) return;
    reviewFilesRef.current = files ?? [];
    const params = new URLSearchParams();
    if (mode) encodeMode(mode, params);
    startReviewRun(params.toString()); // empty query → the server's default mode
  }, [reviewRunning, files, mode, startReviewRun]);

  const hasAgentComments = comments.some((c) => c.source === "review");
  const clearableCount = comments.filter(isClearableReviewComment).length;
  const openAgentCount = comments.filter(
    (c) => c.source === "review" && c.status === "open",
  ).length;
  const clearAgentComments = useCallback(
    () => removeWhere(isClearableReviewComment),
    [removeWhere],
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(DIFF_OUTPUT_FORMAT_KEY, diffOutputFormat);
    } catch {
      /* localStorage unavailable; ignore */
    }
  }, [diffOutputFormat]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cfg = (await fetch("/api/config").then((r) => r.json())) as ServerConfig;
      if (cancelled) return;
      setMode(cfg.mode);
      setBootstrapped(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bootstrapped) return;
    let cancelled = false;
    const isRevert = revertRef.current;
    revertRef.current = false;
    setLoading(true);
    // A revert re-fetches the last good mode; the banner explaining why stays up.
    if (!isRevert) setError(null);
    (async () => {
      try {
        const res = await fetch(buildDiffUrl(mode));
        if (!res.ok) {
          // The server answers a bad mode (unknown ref, …) with `{ error }`.
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as FileDiff[];
        if (cancelled) return;
        scrollAnchorRef.current = captureScrollAnchor();
        setFiles(data);
        if (!loadedModeRef.current || !sameMode(loadedModeRef.current.mode, mode)) {
          loadedModeRef.current = { mode };
          setLoadedMode(loadedModeRef.current);
        }
        setActivePath((prev) =>
          prev !== null && data.some((f) => f.path === prev) ? prev : (data[0]?.path ?? null),
        );
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        // Fall back to the mode that last loaded, once: if that fails as well
        // there is nothing better to show, so just leave the error up.
        const good = loadedModeRef.current;
        if (!isRevert && good && !sameMode(good.mode, mode)) {
          revertRef.current = true;
          setMode(good.mode);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrapped, mode, reloadKey]);

  // The cards stay mounted across a reload, but diff2html rebuilds their DOM
  // from the new diff (a child effect, so it has already run here); keep the
  // card that was at the top of the viewport where it was. Deferred a frame
  // so the expander rows the cards inject on their next render are counted.
  useEffect(() => {
    const anchor = scrollAnchorRef.current;
    if (!anchor) return;
    scrollAnchorRef.current = null;
    const id = window.requestAnimationFrame(() => restoreScrollAnchor(anchor));
    return () => window.cancelAnimationFrame(id);
  }, [files]);

  const totals = useMemo(() => (files ? sumTotals(files) : { adds: 0, dels: 0 }), [files]);

  const onSelect = useCallback((path: string) => {
    setActivePath(path);
    document
      .getElementById(pathToAnchor(path))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  return (
    <div className="layout">
      <header className="topbar">
        <div className="topbar-title">
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={sidebarOpen ? "Hide file tree" : "Show file tree"}
            onClick={() => setSidebarOpen((s) => !s)}
          >
            <SidebarIcon />
          </button>
          <span className="brand">prv</span>
          {mode?.kind === "git" && <ModePicker mode={mode} onChange={setMode} />}
          {mode?.kind === "files" && (
            <span className="mode-chip" title={mode.paths.join("\n")}>
              {mode.paths.join(", ")}
            </span>
          )}
        </div>
        <div className="topbar-meta">
          {files && (
            <>
              <span className="meta-item">
                <strong>{files.length}</strong> {mode?.kind === "files" ? "files" : "changed"}
              </span>
              <span className="meta-item adds">+{totals.adds}</span>
              <span className="meta-item dels">−{totals.dels}</span>
              <DiffStat totals={totals} />
            </>
          )}
          <div className="mode-kind-toggle" role="tablist" aria-label="Diff layout">
            <button
              type="button"
              role="tab"
              aria-selected={diffOutputFormat === "unified"}
              className={diffOutputFormat === "unified" ? "is-active" : ""}
              onClick={() => setDiffOutputFormat("unified")}
            >
              Unified
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={diffOutputFormat === "split"}
              className={diffOutputFormat === "split" ? "is-active" : ""}
              onClick={() => setDiffOutputFormat("split")}
            >
              Split
            </button>
          </div>
          <button type="button" className="refresh-btn" disabled={loading} onClick={refreshDiff}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            className={"refresh-btn" + (reviewRunning ? " is-active" : "")}
            disabled={!reviewRunning && (!files || files.length === 0)}
            onClick={reviewRunning ? review.stop : startReview}
          >
            {reviewRunning
              ? review.totalCount > 0
                ? `Stop (${review.doneCount}/${review.totalCount})`
                : "Stop"
              : "Review"}
          </button>
          <button
            type="button"
            className={"refresh-btn" + (chatOpen ? " is-active" : "")}
            aria-pressed={chatOpen}
            onClick={() => setChatOpen((c) => !c)}
          >
            Chat
          </button>
        </div>
      </header>

      <div className="body">
        {sidebarOpen && (
          <>
            <aside className="sidebar" style={{ width: sidebarResize.width }}>
              {files === null ? (
                <div className="sidebar-empty">loading…</div>
              ) : files.length === 0 ? (
                <div className="sidebar-empty">no changes</div>
              ) : (
                <FileTree files={files} onSelect={onSelect} activePath={activePath} />
              )}
            </aside>
            <PanelResizer panel={sidebarResize} label="Resize file tree" />
          </>
        )}

        <main className="main-col">
          {(review.run !== null || hasAgentComments) && (
            <ReviewPanel
              run={review.run}
              openAgentCount={openAgentCount}
              clearableCount={clearableCount}
              onClear={clearAgentComments}
            />
          )}
          {error && <div className="error">Error: {error}</div>}
          {files === null && !error && <div className="placeholder">loading…</div>}
          {files !== null && files.length === 0 && !error && (
            <div className="placeholder">No changes to review.</div>
          )}
          {files?.map((file) => (
            <DiffPanel
              key={file.path}
              file={file}
              mode={mode}
              anchorId={pathToAnchor(file.path)}
              outputFormat={diffOutputFormat}
              comments={comments.filter((c) => c.file === file.path)}
              addComment={addComment}
              updateComment={updateComment}
              removeComment={removeComment}
              onApplied={refreshDiff}
              ui={fileUi[file.path] ?? EMPTY_UI}
              setUi={(patch) => setFileUi(file.path, patch)}
            />
          ))}
        </main>

        {chatOpen && <PanelResizer panel={chatResize} label="Resize chat panel" />}
        <ChatPanel files={files} open={chatOpen} width={chatResize.width} />
      </div>

      {lastRemoved && (
        <div className="undo-toast" role="status">
          <span>Comment deleted</span>
          <button type="button" className="undo-toast-btn" onClick={undoRemove}>
            Undo
          </button>
          <button
            type="button"
            className="undo-toast-dismiss"
            aria-label="Dismiss"
            onClick={dismissRemoved}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function PanelResizer({ panel, label }: { panel: ResizablePanel; label: string }) {
  return (
    <div
      className={"panel-resizer" + (panel.dragging ? " is-dragging" : "")}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      {...panel.resizerProps}
    />
  );
}

function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 2h12v12H2V2zm1 1v10h4V3H3zm5 0v10h5V3H8z" />
    </svg>
  );
}
