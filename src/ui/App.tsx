import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileTree } from "./components/FileTree";
import { ChatPanel } from "./components/ChatPanel";
import { ChatSettingsMenu } from "./components/ChatSettings";
import { DiffPanel } from "./components/DiffPanel";
import { DiffStat } from "./components/DiffStat";
import { ModePicker } from "./components/ModePicker";
import { ReviewPanel } from "./components/ReviewPanel";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { findingsToComments } from "../review/transform";
import { encodeMode } from "../shared/modeQuery";
import type { ReviewSeverity } from "../shared/comments";
import { isClearableReviewComment } from "../shared/review";
import type { LensId, ReviewFinding } from "../shared/review";
import { documentOrder, nextCommentTarget } from "./commentNav";
import { isTypingTarget, shortcutFor } from "./keys";
import { drawerWidth, useLayout } from "./layout";
import { isMarkdownPath } from "./markdown";
import { isOpenFinding, openCommentsByFile, openFindingsBySeverity, viewedCount } from "./progress";
import { titleFor } from "./title";
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

/**
 * A tree click keeps scroll-spy quiet while the smooth scroll it starts is in
 * flight, so the cards flying past cannot flip the selection. The scroll's
 * `scrollend` lifts the mute (after a short settle, since the final scroll
 * event's frame is still pending); this cap covers browsers without it and
 * clicks that scroll nowhere.
 */
const SPY_MUTE_MS = 1000;
const SPY_SETTLE_MS = 100;

/** How long a jumped-to finding stays highlighted. */
const FINDING_FOCUS_MS = 1200;

/** Frames to wait for a thread that was hidden (collapsed / viewed card) to render. */
const THREAD_RENDER_FRAMES = 10;

/** Viewport width a side panel must leave to the diff column when resized (#60). */
const PANEL_RESERVE_PX = 320;

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

/**
 * The card the reader is "in": the one straddling a line just under the
 * sticky topbar (where a clicked card comes to rest, so the spy agrees with
 * the click once the scroll settles). In the gap between two cards the one
 * above still counts; above the first card (the review panel) the first one.
 */
function cardAtSpyLine(): string | null {
  const bar = document.querySelector<HTMLElement>(".topbar");
  const line = (bar?.offsetHeight ?? 0) + 8;
  const cards = document.querySelectorAll<HTMLElement>(".file-card[data-path]");
  let above: string | null = null;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (rect.top > line) break; // cards are in document order
    above = card.dataset.path!;
    if (rect.bottom > line) return above;
  }
  return above ?? cards[0]?.dataset.path ?? null;
}

/** The rendered thread for a comment, when it is on screen (not in a hidden card body). */
function visibleThread(id: string): HTMLElement | null {
  const el = document.querySelector<HTMLElement>(
    `.prv-thread[data-comment-id="${CSS.escape(id)}"]`,
  );
  return el && el.offsetParent !== null ? el : null;
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
  // Scroll-spy stays quiet until this time after a tree click (see SPY_MUTE_MS).
  const spyMutedUntilRef = useRef(0);
  // The finding ↑/↓ step from, and the one flashing after a jump.
  const [currentFindingId, setCurrentFindingId] = useState<string | null>(null);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const focusTimerRef = useRef(0);
  const [reloadKey, setReloadKey] = useState(0);
  // Below the breakpoint (#60) both side panels are overlay drawers: closed
  // to start with, one at a time, dismissed by their scrim or a tree click.
  const layout = useLayout();
  const compact = layout === "compact";
  const [sidebarOpen, setSidebarOpen] = useState(!compact);
  const [chatOpen, setChatOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // Bumped by the `f` shortcut; the sidebar filter takes focus once it is rendered.
  const [filterFocusTick, setFilterFocusTick] = useState(0);
  // The drawers are capped by CSS, so the viewport clamp only applies while
  // the panels sit inline (and the resizers, their only other source, exist).
  const viewportReserve = compact ? 0 : PANEL_RESERVE_PX;
  const sidebarResize = useResizablePanel({
    storageKey: "prv:sidebarWidth",
    defaultWidth: 296,
    minWidth: 180,
    maxWidth: 640,
    viewportReserve,
    side: "left",
  });
  const chatResize = useResizablePanel({
    storageKey: "prv:chatWidth",
    defaultWidth: 380,
    minWidth: 280,
    maxWidth: 800,
    viewportReserve,
    side: "right",
  });

  // Crossing the breakpoint resets the panels to that layout's default: the
  // tree comes back inline in wide mode, the drawers start closed in compact.
  // Toggles after that are the user's and are kept.
  useEffect(() => {
    setSidebarOpen(!compact);
    if (compact) setChatOpen(false);
  }, [compact]);

  // Only one drawer fits at a time: opening one closes the other.
  const toggleSidebar = useCallback(
    (open = !sidebarOpen) => {
      setSidebarOpen(open);
      if (open && compact) setChatOpen(false);
    },
    [sidebarOpen, compact],
  );
  const toggleChat = useCallback(() => {
    setChatOpen(!chatOpen);
    if (!chatOpen && compact) setSidebarOpen(false);
  }, [chatOpen, compact]);
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
  const openAgentCount = comments.filter(isOpenFinding).length;
  const bySeverity = useMemo(() => openFindingsBySeverity(comments), [comments]);
  const openByFile = useMemo(() => openCommentsByFile(comments), [comments]);
  const openTotal = useMemo(
    () => Object.values(openByFile).reduce((a, b) => a + b, 0),
    [openByFile],
  );
  const viewedTotal = useMemo(
    () => (filePaths ? viewedCount(filePaths, fileUi) : 0),
    [filePaths, fileUi],
  );
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

  // The tab is named after the comparison that actually loaded (#62), so a
  // rejected ref (reverted, see above) never gets into the title.
  useEffect(() => {
    document.title = titleFor(loadedMode?.mode ?? null);
  }, [loadedMode]);

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

  const onSelect = useCallback(
    (path: string) => {
      setActivePath(path);
      // The drawer covers the card it just selected; get out of the way.
      if (compact) setSidebarOpen(false);
      spyMutedUntilRef.current = performance.now() + SPY_MUTE_MS;
      document
        .getElementById(pathToAnchor(path))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [compact],
  );

  // Scroll-spy (#55): the tree selection follows the viewport. One
  // evaluation per frame at most; a tree click mutes it while its smooth
  // scroll is in flight so the clicked row is never overridden mid-way.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      if (performance.now() < spyMutedUntilRef.current) return;
      const path = cardAtSpyLine();
      if (path) setActivePath((prev) => (prev === path ? prev : path));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    // Only ever shortens the mute: a scrollend while unmuted keeps it at 0.
    const settle = () => {
      spyMutedUntilRef.current = Math.min(
        spyMutedUntilRef.current,
        performance.now() + SPY_SETTLE_MS,
      );
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("scrollend", settle);
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("scrollend", settle);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => () => window.clearTimeout(focusTimerRef.current), []);

  // Open review comments in reading order. The DOM is the authority for
  // threads that are rendered (relocation may reorder them within a card);
  // the pure helper slots in the ones hidden by a collapsed card.
  const findingOrder = useCallback((): string[] => {
    const domIds = Array.from(
      document.querySelectorAll<HTMLElement>(".prv-thread[data-comment-id]"),
      (el) => el.dataset.commentId!,
    );
    return documentOrder(filePaths ?? [], comments.filter(isOpenFinding), domIds);
  }, [filePaths, comments]);

  // Scroll a thread to the centre once it is on screen. A thread in a
  // collapsed, viewed or Markdown-Rendered card is not rendered until the card's
  // UI state changes and its diff is rebuilt, so retry over a few frames.
  const scrollToThread = useCallback((id: string, attempts = THREAD_RENDER_FRAMES) => {
    const el = visibleThread(id);
    if (el) {
      el.scrollIntoView({ block: "center" });
      return;
    }
    if (attempts > 0) window.requestAnimationFrame(() => scrollToThread(id, attempts - 1));
  }, []);

  const focusComment = useCallback(
    (id: string) => {
      const comment = comments.find((c) => c.id === id);
      if (!comment) return;
      const ui = fileUi[comment.file];
      const patch: FileUi = {};
      if (ui?.collapsed) patch.collapsed = false;
      if (ui?.viewed) patch.viewed = false;
      // A thread renders in either tab, except on a Markdown file's Rendered
      // page, which has no lines to hang it on: show its Source instead.
      if (ui?.view === "file" && isMarkdownPath(comment.file) && ui.mdView !== "source") {
        patch.mdView = "source";
      }
      if (Object.keys(patch).length > 0) setFileUi(comment.file, patch);
      setCurrentFindingId(id);
      setFocusedCommentId(id);
      window.clearTimeout(focusTimerRef.current);
      focusTimerRef.current = window.setTimeout(() => setFocusedCommentId(null), FINDING_FOCUS_MS);
      scrollToThread(id);
    },
    [comments, fileUi, setFileUi, scrollToThread],
  );

  // Step to the next / previous open finding across files (wrapping). Kept
  // as a callback so a keyboard shortcut can reuse it later.
  const jumpToComment = useCallback(
    (direction: 1 | -1) => {
      const target = nextCommentTarget(findingOrder(), currentFindingId, direction);
      if (target) focusComment(target);
    },
    [findingOrder, currentFindingId, focusComment],
  );

  // Global shortcuts (#56). Single unmodified keys, so a keydown in a text
  // field, an IME composition or a browser chord is never one (see keys.ts).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target instanceof HTMLElement ? e.target : null)) return;
      if (e.key === "Escape" && helpOpen) {
        setHelpOpen(false);
        return;
      }
      if (e.key === "Escape" && compact && (sidebarOpen || chatOpen)) {
        setSidebarOpen(false);
        setChatOpen(false);
        return;
      }
      const action = shortcutFor(e);
      if (!action) return;
      e.preventDefault();
      switch (action) {
        case "nextFile":
        case "prevFile": {
          // Same wrap-around stepping as the findings, over the file list.
          const path = filePaths
            ? nextCommentTarget(filePaths, activePath, action === "nextFile" ? 1 : -1)
            : null;
          if (path) onSelect(path);
          return;
        }
        case "nextFinding":
          return jumpToComment(1);
        case "prevFinding":
          return jumpToComment(-1);
        case "toggleViewed":
          if (activePath) setFileUi(activePath, { viewed: !fileUi[activePath]?.viewed });
          return;
        case "toggleCollapsed":
          if (activePath) setFileUi(activePath, { collapsed: !fileUi[activePath]?.collapsed });
          return;
        case "focusFilter":
          toggleSidebar(true);
          setFilterFocusTick((t) => t + 1);
          return;
        case "toggleSidebar":
          return toggleSidebar();
        case "toggleChat":
          return toggleChat();
        case "toggleHelp":
          return setHelpOpen((h) => !h);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    helpOpen,
    compact,
    sidebarOpen,
    chatOpen,
    filePaths,
    activePath,
    onSelect,
    jumpToComment,
    fileUi,
    setFileUi,
    toggleSidebar,
    toggleChat,
  ]);

  // Runs after the render that opened the sidebar, so the input exists.
  useEffect(() => {
    if (filterFocusTick === 0) return;
    document.querySelector<HTMLInputElement>(".sidebar-search input")?.focus();
  }, [filterFocusTick]);

  const jumpToFirst = useCallback(() => {
    const target = findingOrder()[0];
    if (target) focusComment(target);
  }, [findingOrder, focusComment]);

  const jumpToSeverity = useCallback(
    (severity: ReviewSeverity) => {
      const severityOf = new Map(comments.map((c) => [c.id, c.severity ?? "info"]));
      const target = findingOrder().find((id) => severityOf.get(id) === severity);
      if (target) focusComment(target);
    },
    [comments, findingOrder, focusComment],
  );

  return (
    <div className={"layout" + (compact ? " is-compact" : "")}>
      <header className="topbar">
        <div className="topbar-title">
          <button
            type="button"
            className="sidebar-toggle"
            aria-label={sidebarOpen ? "Hide file tree" : "Show file tree"}
            onClick={() => toggleSidebar()}
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
              <span className="meta-item meta-progress" title="Files marked Viewed">
                {viewedTotal}/{files.length} viewed
              </span>
              {openTotal > 0 && (
                <span className="meta-item meta-progress" title="Open comments">
                  {openTotal} open
                </span>
              )}
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
          {/* App-wide agent settings, reachable without opening Chat; they
              also govern inline threads and Review. */}
          <ChatSettingsMenu placement="below" align="end" />
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
            onClick={toggleChat}
          >
            Chat
          </button>
          <button
            type="button"
            className="help-btn"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            aria-pressed={helpOpen}
            onClick={() => setHelpOpen((h) => !h)}
          >
            ?
          </button>
        </div>
      </header>

      <div className="body">
        {compact && sidebarOpen && (
          <div className="drawer-scrim" aria-hidden="true" onClick={() => toggleSidebar(false)} />
        )}
        {sidebarOpen && (
          <>
            <aside
              className={"sidebar" + (compact ? " is-drawer" : "")}
              style={{
                width: compact ? drawerWidth(sidebarResize.width) : sidebarResize.width,
              }}
            >
              {files === null ? (
                <div className="sidebar-empty">loading…</div>
              ) : files.length === 0 ? (
                <div className="sidebar-empty">no changes</div>
              ) : (
                <FileTree
                  files={files}
                  onSelect={onSelect}
                  activePath={activePath}
                  openByFile={openByFile}
                  ui={fileUi}
                />
              )}
            </aside>
            {!compact && <PanelResizer panel={sidebarResize} label="Resize file tree" />}
          </>
        )}

        <main className="main-col">
          {(review.run !== null || hasAgentComments) && (
            <ReviewPanel
              run={review.run}
              openAgentCount={openAgentCount}
              bySeverity={bySeverity}
              clearableCount={clearableCount}
              onClear={clearAgentComments}
              onJump={jumpToComment}
              onJumpToSeverity={jumpToSeverity}
              onJumpToFirst={jumpToFirst}
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
              focusedCommentId={focusedCommentId}
            />
          ))}
        </main>

        {chatOpen && !compact && <PanelResizer panel={chatResize} label="Resize chat panel" />}
        {compact && chatOpen && (
          <div className="drawer-scrim" aria-hidden="true" onClick={toggleChat} />
        )}
        <ChatPanel
          files={files}
          open={chatOpen}
          width={chatResize.width}
          drawer={compact}
          onApplied={refreshDiff}
        />
      </div>

      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}

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
