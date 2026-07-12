import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileTree } from "./components/FileTree";
import { ChatPanel } from "./components/ChatPanel";
import { DiffPanel } from "./components/DiffPanel";
import { DiffStat } from "./components/DiffStat";
import { ModePicker } from "./components/ModePicker";
import { PathPicker } from "./components/PathPicker";
import { RefPathPicker } from "./components/RefPathPicker";
import { ReviewPanel } from "./components/ReviewPanel";
import { findingsToComments } from "../review/transform";
import { encodeMode } from "../shared/modeQuery";
import { isClearableReviewComment } from "../shared/review";
import type { LensId, ReviewFinding } from "../shared/review";
import { sumTotals } from "./totals";
import { useComments } from "./useComments";
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

type ServerConfig = { mode: ServerMode | null; serverCwd: string };

function pathToAnchor(path: string): string {
  return "file-" + path;
}

function buildDiffUrl(mode: ServerMode | null): string {
  if (!mode) return "/api/diff";
  const url = new URL("/api/diff", window.location.origin);
  encodeMode(mode, url.searchParams);
  return url.pathname + url.search;
}

export function App() {
  const [mode, setMode] = useState<ServerMode | null>(null);
  const [serverCwd, setServerCwd] = useState<string>("");
  const [bootstrapped, setBootstrapped] = useState(false);
  const [files, setFiles] = useState<FileDiff[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [diffOutputFormat, setDiffOutputFormat] = useState<DiffOutputFormat>(
    readStoredDiffOutputFormat,
  );
  const { comments, addComment, updateComment, removeComment, removeWhere } =
    useComments(bootstrapped);
  const refreshDiff = useCallback(() => setReloadKey((k) => k + 1), []);

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
      setServerCwd(cfg.serverCwd);
      setBootstrapped(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cwdOf = (m: ServerMode | null): string => {
    if (!m) return serverCwd;
    if (m.kind === "path-vs-path") return m.a;
    return m.cwd;
  };
  const switchToGit = () => {
    if (mode?.kind === "git") return;
    setMode({ kind: "git", cwd: cwdOf(mode), leftRef: "HEAD", right: { kind: "worktree" } });
  };
  const switchToPaths = () => {
    if (mode?.kind === "path-vs-path") return;
    const a = mode?.kind === "ref-vs-path" ? mode.path : (mode?.cwd ?? serverCwd);
    setMode({ kind: "path-vs-path", a, b: a });
  };
  const switchToRefPath = () => {
    if (mode?.kind === "ref-vs-path") return;
    const cwd = cwdOf(mode);
    const ref = mode?.kind === "git" ? mode.leftRef : "HEAD";
    const path = mode?.kind === "path-vs-path" ? mode.b : cwd;
    setMode({ kind: "ref-vs-path", cwd, ref, path, refOnLeft: true });
  };

  useEffect(() => {
    if (!bootstrapped) return;
    let cancelled = false;
    setFiles(null);
    setError(null);
    (async () => {
      try {
        const data = (await fetch(buildDiffUrl(mode)).then((r) => r.json())) as FileDiff[];
        if (cancelled) return;
        setFiles(data);
        setActivePath(data[0]?.path ?? null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrapped, mode, reloadKey]);

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
          {mode && (
            <div className="mode-kind-toggle" role="tablist" aria-label="Comparison kind">
              <button
                type="button"
                role="tab"
                aria-selected={mode.kind === "git"}
                className={mode.kind === "git" ? "is-active" : ""}
                onClick={switchToGit}
              >
                Refs
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode.kind === "path-vs-path"}
                className={mode.kind === "path-vs-path" ? "is-active" : ""}
                onClick={switchToPaths}
              >
                Dirs
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode.kind === "ref-vs-path"}
                className={mode.kind === "ref-vs-path" ? "is-active" : ""}
                onClick={switchToRefPath}
              >
                Ref ↔ Dir
              </button>
            </div>
          )}
          {mode?.kind === "git" && <ModePicker mode={mode} onChange={setMode} />}
          {mode?.kind === "path-vs-path" && <PathPicker mode={mode} onChange={setMode} />}
          {mode?.kind === "ref-vs-path" && <RefPathPicker mode={mode} onChange={setMode} />}
        </div>
        <div className="topbar-meta">
          {files && (
            <>
              <span className="meta-item">
                <strong>{files.length}</strong> changed
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
          <button type="button" className="refresh-btn" onClick={() => setReloadKey((k) => k + 1)}>
            Refresh
          </button>
          <button
            type="button"
            className={"refresh-btn" + (reviewRunning ? " is-active" : "")}
            disabled={reviewRunning || !files || files.length === 0}
            onClick={startReview}
          >
            {reviewRunning
              ? review.totalCount > 0
                ? `Reviewing… ${review.doneCount}/${review.totalCount}`
                : "Reviewing…"
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
          <aside className="sidebar">
            {files === null ? (
              <div className="sidebar-empty">loading…</div>
            ) : files.length === 0 ? (
              <div className="sidebar-empty">no changes</div>
            ) : (
              <FileTree files={files} onSelect={onSelect} activePath={activePath} />
            )}
          </aside>
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
            />
          ))}
        </main>

        <ChatPanel files={files} open={chatOpen} />
      </div>
    </div>
  );
}

function SidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 2h12v12H2V2zm1 1v10h4V3H3zm5 0v10h5V3H8z" />
    </svg>
  );
}
