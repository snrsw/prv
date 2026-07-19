import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { html as diff2html } from "diff2html";
import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-base";
import hljs from "highlight.js";
import DOMPurify from "dompurify";
import { isMarkdownPath, markdownToHtml } from "../markdown";
import type { DiffOutputFormat, FileContent, FileDiff, FileSide, ServerMode } from "../types";
import { encodeMode } from "../../shared/modeQuery";
import type { Comment, LineKey } from "../../shared/comments";
import {
  anchorTextOf,
  buildCommentContext,
  commentId,
  flattenDiff,
  keyGi,
  keyOfRow,
  lineMaps,
  rangeLabel,
  relocateComment,
  type LineSide,
} from "../lineContext";
import { fileLevelContext, isFileLevelComment } from "../reviewComments";
import { fileTotals } from "../totals";
import { CommentThread } from "./CommentThread";
import { DiffStat } from "./DiffStat";
import { CheckIcon, ChevronDown, ChevronRight } from "./icons";

type View = "diff" | "file";

/** A comment anchored under one diff line (its range's last line). */
type Thread = { id: string; side: LineSide; endLine: number };

/** Where the floating "comment" affordance is shown while hovering a line. */
type HoverPlus = { gi: number; top: number };

/** In-progress gutter drag, as a span over the global diff-line index. */
type DragSel = { startGi: number; endGi: number };

// Must match .file-content-pre code.hljs vertical padding and var(--fs-code-lh) in styles.css.
const FILE_CODE_PADDING_TOP = 8;
const FILE_LINE_HEIGHT = 20;

export function DiffPanel({
  file,
  mode,
  anchorId,
  outputFormat,
  comments,
  addComment,
  updateComment,
  removeComment,
  onApplied,
}: {
  file: FileDiff;
  mode: ServerMode | null;
  anchorId: string;
  outputFormat: DiffOutputFormat;
  comments: Comment[];
  addComment: (c: Comment) => void;
  updateComment: (id: string, updater: (c: Comment) => Comment) => void;
  removeComment: (id: string) => void;
  onApplied: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(true);
  const [viewed, setViewed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<View>("diff");
  const [content, setContent] = useState<FileContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const totals = fileTotals(file);
  const lastFetchedKey = useRef<string | null>(null);
  const fileBodyRef = useRef<HTMLDivElement>(null);
  const scrollHintRef = useRef<{ line: number; screenY: number } | null>(null);

  const [hoverPlus, setHoverPlus] = useState<HoverPlus | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Stable portal containers (one per thread) — moved into the freshly rendered
  // diff DOM after each render so a thread's React subtree (and its WebSocket)
  // survives diff2html re-renders (e.g. unified⇄split toggles).
  const containersRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const observersRef = useRef<ResizeObserver[]>([]);
  // Bumped whenever the diff DOM is (re)built, so the anchoring effect re-runs.
  const [renderTick, setRenderTick] = useState(0);

  useEffect(() => {
    if (!expanded || !ref.current) return;
    if (view !== "diff") return;
    if (file.binary) {
      ref.current.innerHTML = `<div class="binary-notice">Binary file differs</div>`;
      return;
    }
    ref.current.innerHTML = diff2html(file.raw, {
      drawFileList: false,
      matching: "none",
      outputFormat: outputFormat === "split" ? "side-by-side" : "line-by-line",
    });
    const ui = new Diff2HtmlUI(
      ref.current,
      undefined,
      { highlightLanguages: new Map(Object.entries(LANGUAGE_BY_EXT)) },
      hljs,
    );
    ui.highlightCode();
    setRenderTick((t) => t + 1);
  }, [file.raw, file.binary, expanded, view, outputFormat]);

  // Gutter drag selection. The live drag lives in a ref (read by a window
  // mouseup listener without stale closures); `dragViz` mirrors it for render.
  const dragRef = useRef<DragSel | null>(null);
  const [dragViz, setDragViz] = useState<DragSel | null>(null);

  // Flatten the diff into a single global-index (gi) line list, so a range can
  // span deleted and added lines (and, in split, both columns).
  const rows = useMemo(() => flattenDiff(file), [file]);
  const maps = useMemo(() => lineMaps(rows), [rows]);

  const getContainer = (id: string): HTMLDivElement => {
    let c = containersRef.current.get(id);
    if (!c) {
      c = document.createElement("div");
      containersRef.current.set(id, c);
    }
    return c;
  };

  const openThread = useCallback(
    (giA: number, giB: number) => {
      const lo = Math.min(giA, giB);
      const hi = Math.max(giA, giB);
      const start = keyOfRow(rows[lo]!);
      const end = keyOfRow(rows[hi]!);
      addComment({
        id: commentId(start, end),
        file: file.path,
        start,
        end,
        anchorText: anchorTextOf(rows.slice(lo, hi + 1)),
        status: "open",
        messages: [],
      });
      setHoverPlus(null);
    },
    [file, addComment, rows],
  );

  // Place each comment in the current diff: relocated → anchored under its last
  // line; null → "orphaned" (its lines changed) and rendered below.
  const { anchored, orphaned } = useMemo(() => {
    const located = comments.map((c) => ({ comment: c, loc: relocateComment(file, c) }));
    return {
      anchored: located.flatMap(({ comment, loc }) => (loc ? [{ comment, loc }] : [])),
      orphaned: located.flatMap(({ comment, loc }) => (loc ? [] : [comment])),
    };
  }, [comments, file]);

  // The line key of a gutter cell, then its global index.
  const keyFromCell = useCallback((cell: HTMLElement): LineKey | null => {
    const root = ref.current;
    if (!root) return null;
    if (cell.classList.contains("d2h-code-linenumber")) {
      const o = cell.querySelector(".line-num1")?.textContent?.trim();
      const n = cell.querySelector(".line-num2")?.textContent?.trim();
      const old = o && /^\d+$/.test(o) ? parseInt(o, 10) : null;
      const nw = n && /^\d+$/.test(n) ? parseInt(n, 10) : null;
      return old == null && nw == null ? null : { old, new: nw };
    }
    if (cell.classList.contains("d2h-code-side-linenumber")) {
      const s = cell.textContent?.trim();
      if (!s || !/^\d+$/.test(s)) return null;
      const num = parseInt(s, 10);
      const sides = Array.from(root.querySelectorAll(".d2h-file-side-diff"));
      const isNew = sides.indexOf(cell.closest(".d2h-file-side-diff")!) === 1;
      return isNew ? { old: null, new: num } : { old: num, new: null };
    }
    return null;
  }, []);
  const giFromCell = useCallback(
    (cell: HTMLElement): number | null => {
      const key = keyFromCell(cell);
      return key ? keyGi(maps, key) : null;
    },
    [keyFromCell, maps],
  );
  const cellFromTarget = (target: HTMLElement): HTMLElement | null =>
    target
      .closest<HTMLElement>("tr")
      ?.querySelector(".d2h-code-linenumber, .d2h-code-side-linenumber") ?? null;
  const giAtPoint = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const cell =
      el?.closest<HTMLElement>(".d2h-code-linenumber, .d2h-code-side-linenumber") ??
      (el ? cellFromTarget(el) : null);
    return cell ? giFromCell(cell) : null;
  };

  // Gutter drag uses Pointer Events + pointer capture so every move/up during
  // the drag is delivered to the wrap, even outside it.
  const beginDrag = (e: React.PointerEvent, gi: number) => {
    e.preventDefault();
    wrapRef.current?.setPointerCapture(e.pointerId);
    dragRef.current = { startGi: gi, endGi: gi };
    setDragViz(dragRef.current);
    setHoverPlus(null);
  };

  const onDiffPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const cell = cellFromTarget(e.target as HTMLElement);
    const gi = cell ? giFromCell(cell) : null;
    if (gi != null) beginDrag(e, gi);
  };

  const onDiffPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const gi = giAtPoint(e.clientX, e.clientY);
    if (gi != null && gi !== drag.endGi) {
      dragRef.current = { ...drag, endGi: gi };
      setDragViz(dragRef.current);
    }
  };

  const onDiffPointerUp = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDragViz(null);
    openThread(drag.startGi, drag.endGi);
  };

  // Tint the lines covered by (a) the in-progress drag and (b) every open
  // comment's range — by global index, so deleted (left) and added (right)
  // lines of one region both highlight, in unified and split alike.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || view !== "diff") return;
    root
      .querySelectorAll(".prv-line-selected, .prv-line-commented")
      .forEach((n) => n.classList.remove("prv-line-selected", "prv-line-commented"));
    const mark = (lo: number, hi: number, cls: string) => {
      for (const cell of root.querySelectorAll<HTMLElement>(
        ".d2h-code-linenumber, .d2h-code-side-linenumber",
      )) {
        const gi = giFromCell(cell);
        if (gi != null && gi >= lo && gi <= hi) cell.closest("tr")?.classList.add(cls);
      }
    };
    for (const { loc, comment } of anchored) {
      if (comment.status === "open") mark(loc.lo, loc.hi, "prv-line-commented");
    }
    if (dragViz) {
      mark(
        Math.min(dragViz.startGi, dragViz.endGi),
        Math.max(dragViz.startGi, dragViz.endGi),
        "prv-line-selected",
      );
    }
  }, [dragViz, anchored, renderTick, view, giFromCell]);

  // Re-anchor threads into the diff DOM after every render / comment change.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || view !== "diff") return;

    observersRef.current.forEach((o) => o.disconnect());
    observersRef.current = [];
    // Detach stable containers (kept alive via the ref), then drop our wrappers.
    containersRef.current.forEach((c) => c.remove());
    root
      .querySelectorAll(".prv-thread-row, .prv-thread-spacer, .prv-thread-overlay")
      .forEach((n) => n.remove());
    // Prune containers for comments that are no longer anchored here.
    const live = new Set(anchored.map(({ comment }) => comment.id));
    for (const id of Array.from(containersRef.current.keys())) {
      if (!live.has(id)) containersRef.current.delete(id);
    }

    for (const { comment, loc } of anchored) {
      const container = containersRef.current.get(comment.id);
      if (!container) continue;
      const thread: Thread = { id: comment.id, side: loc.last.side, endLine: loc.last.line };
      if (outputFormat === "split") anchorSplit(root, thread, container, observersRef.current);
      else anchorUnified(root, thread, container);
    }
    return () => observersRef.current.forEach((o) => o.disconnect());
  }, [renderTick, anchored, outputFormat, view]);

  const onDiffMouseOver = (e: React.MouseEvent) => {
    if (dragRef.current) return; // an active drag is handled by the pointer handlers
    const wrap = wrapRef.current;
    if (!wrap) return;
    const target = e.target as HTMLElement;
    // Keep the affordance while the pointer is on it or inside an open thread.
    if (target.closest(".prv-add-comment, .prv-thread")) return;
    const cell = cellFromTarget(target);
    const gi = cell ? giFromCell(cell) : null;
    if (!cell || gi == null) {
      setHoverPlus(null);
      return;
    }
    const top = cell.getBoundingClientRect().top - wrap.getBoundingClientRect().top;
    setHoverPlus({ gi, top });
  };

  useEffect(() => {
    if (!expanded || view !== "file" || file.binary || !mode) return;
    const key = JSON.stringify({ p: file.path, s: file.status, m: mode });
    if (lastFetchedKey.current === key) return;
    lastFetchedKey.current = key;
    const controller = new AbortController();
    setContent(null);
    setContentError(null);
    setContentLoading(true);
    (async () => {
      try {
        const primary: FileSide = file.status === "deleted" ? "old" : "new";
        let result = await fetchFileContent(mode, file.path, primary, controller.signal);
        if (result.kind === "missing" && primary === "new") {
          const fallback = await fetchFileContent(mode, file.path, "old", controller.signal);
          if (fallback.kind !== "missing") result = fallback;
        }
        setContent(result);
      } catch (e) {
        if (controller.signal.aborted) return;
        setContentError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setContentLoading(false);
      }
    })();
    return () => controller.abort();
  }, [expanded, view, file.binary, file.path, file.status, mode]);

  // After file content loads, restore scroll so the line that was at the
  // top of the diff is at the same screen Y in the file view.
  useEffect(() => {
    if (!expanded || view !== "file" || !content || content.kind !== "text") return;
    const hint = scrollHintRef.current;
    if (!hint) return;
    scrollHintRef.current = null;
    // Defer one frame so the file-body DOM is committed and laid out.
    const id = window.setTimeout(() => {
      const code = fileBodyRef.current?.querySelector<HTMLElement>(".file-content-pre code.hljs");
      if (!code) return;
      const codeTop = code.getBoundingClientRect().top;
      const lineY = codeTop + FILE_CODE_PADDING_TOP + (hint.line - 1) * FILE_LINE_HEIGHT;
      window.scrollBy({ top: lineY - hint.screenY });
    }, 0);
    return () => window.clearTimeout(id);
  }, [expanded, view, content]);

  function captureScrollHintFromDiff() {
    if (!ref.current) return;
    const lines = ref.current.querySelectorAll<HTMLElement>(".d2h-code-linenumber");
    for (const el of lines) {
      const r = el.getBoundingClientRect();
      if (r.bottom < 0) continue;
      if (r.top > window.innerHeight) break;
      const num = el.querySelector(".line-num2")?.textContent?.trim();
      if (num && /^\d+$/.test(num)) {
        scrollHintRef.current = { line: parseInt(num, 10), screenY: r.top };
        return;
      }
    }
  }

  const switchToFile = () => {
    if (view !== "file") captureScrollHintFromDiff();
    setView("file");
  };

  const onCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(file.path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard not available; ignore */
    }
  };

  return (
    <section id={anchorId} className={`file-card ${viewed ? "viewed" : ""}`}>
      <header className="file-card-header">
        <button
          type="button"
          className="card-chevron"
          aria-label={expanded ? "Collapse file" : "Expand file"}
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span className="file-card-path" title={file.path}>
          {file.path}
        </span>
        <button
          type="button"
          className={`copy-path-btn ${copied ? "is-copied" : ""}`}
          aria-label="Copy file path"
          title={copied ? "Copied!" : "Copy file path"}
          onClick={onCopyPath}
        >
          {copied ? <CheckIcon size={14} /> : <CopyIcon />}
        </button>
        {!file.binary && (
          <div className="file-card-view-tabs" role="tablist" aria-label="View mode">
            <button
              type="button"
              role="tab"
              aria-selected={view === "diff"}
              className={`file-card-view-tab ${view === "diff" ? "is-active" : ""}`}
              onClick={() => setView("diff")}
            >
              Diff
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "file"}
              className={`file-card-view-tab ${view === "file" ? "is-active" : ""}`}
              onClick={switchToFile}
            >
              File
            </button>
          </div>
        )}
        <span className="file-card-spacer" />
        <span className="file-card-counts">
          {totals.adds > 0 && <span className="adds">+{totals.adds}</span>}
          {totals.dels > 0 && <span className="dels">−{totals.dels}</span>}
          <DiffStat totals={totals} />
        </span>
        <label className="viewed-toggle">
          <input type="checkbox" checked={viewed} onChange={(e) => setViewed(e.target.checked)} />
          <span>Viewed</span>
        </label>
      </header>
      {expanded && view === "diff" && (
        <div
          className={`prv-diff-wrap ${dragViz ? "prv-dragging" : ""}`}
          ref={wrapRef}
          onPointerDown={onDiffPointerDown}
          onPointerMove={onDiffPointerMove}
          onPointerUp={onDiffPointerUp}
          onMouseOver={onDiffMouseOver}
          onMouseLeave={() => setHoverPlus(null)}
        >
          <div className="file-card-body" ref={ref} />
          {hoverPlus && !file.binary && (
            <button
              type="button"
              className="prv-add-comment"
              style={{ top: hoverPlus.top }}
              title="Comment on this line (or drag to select a range)"
              onPointerDown={(e) => beginDrag(e, hoverPlus.gi)}
            >
              +
            </button>
          )}
          {anchored.map(({ comment, loc }) =>
            createPortal(
              <CommentThread
                file={file}
                comment={comment}
                placement="anchored"
                label={rangeLabel(loc.slice)}
                context={buildCommentContext(file, loc.slice)}
                onUpdate={(updater) => updateComment(comment.id, updater)}
                onRemove={() => removeComment(comment.id)}
                onApplied={onApplied}
              />,
              getContainer(comment.id),
            ),
          )}
          {orphaned.length > 0 && (
            <div className="prv-orphaned">
              {orphaned.map((comment) => {
                // Never-anchored review findings are file-level, not "moved".
                const fileLevel = isFileLevelComment(comment);
                return (
                  <CommentThread
                    key={comment.id}
                    file={file}
                    comment={comment}
                    placement={fileLevel ? "file-level" : "moved"}
                    label={fileLevel ? "" : "lines changed"}
                    context={
                      fileLevel ? fileLevelContext(file.path) : orphanContext(file.path, comment)
                    }
                    onUpdate={(updater) => updateComment(comment.id, updater)}
                    onRemove={() => removeComment(comment.id)}
                    onApplied={onApplied}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
      {expanded && view === "file" && (
        <div className="file-card-body" ref={fileBodyRef}>
          <FileContentView
            file={file}
            content={content}
            loading={contentLoading}
            error={contentError}
          />
        </div>
      )}
    </section>
  );
}

/** Map a clicked line-number cell to its (side, line), or null if it has none. */
function resolveLineFromCell(
  cell: HTMLElement,
  root: HTMLElement,
): { side: LineSide; line: number } | null {
  if (cell.classList.contains("d2h-code-linenumber")) {
    const newNum = cell.querySelector(".line-num2")?.textContent?.trim();
    if (newNum && /^\d+$/.test(newNum)) return { side: "new", line: parseInt(newNum, 10) };
    const oldNum = cell.querySelector(".line-num1")?.textContent?.trim();
    if (oldNum && /^\d+$/.test(oldNum)) return { side: "old", line: parseInt(oldNum, 10) };
    return null;
  }
  if (cell.classList.contains("d2h-code-side-linenumber")) {
    const num = cell.textContent?.trim();
    if (!num || !/^\d+$/.test(num)) return null;
    const sides = Array.from(root.querySelectorAll(".d2h-file-side-diff"));
    const side = sides.indexOf(cell.closest(".d2h-file-side-diff")!) === 1 ? "new" : "old";
    return { side, line: parseInt(num, 10) };
  }
  return null;
}

/** Fallback first-turn context for an orphaned comment (lines since changed). */
function orphanContext(path: string, comment: Comment): string {
  return [
    `File: ${path}`,
    "I'm commenting on these lines (their location in the diff has since changed):",
    "",
    ...(comment.anchorText ?? []),
  ].join("\n");
}

/** Insert a full-width thread row directly under the matching unified row. */
function anchorUnified(root: HTMLElement, thread: Thread, container: HTMLDivElement): void {
  for (const tr of root.querySelectorAll<HTMLElement>("tr")) {
    const cell = tr.querySelector<HTMLElement>(".d2h-code-linenumber");
    if (!cell) continue;
    const loc = resolveLineFromCell(cell, root);
    if (!loc || loc.side !== thread.side || loc.line !== thread.endLine) continue;
    const row = document.createElement("tr");
    row.className = "prv-thread-row";
    const td = document.createElement("td");
    td.colSpan = 2;
    td.appendChild(container);
    row.appendChild(td);
    tr.after(row);
    return;
  }
}

/**
 * Split view has two side-by-side tables that must stay row-aligned. Insert a
 * matching-height spacer row in BOTH tables and float the thread, full width,
 * over them; a ResizeObserver keeps the spacer heights equal to the thread.
 */
function anchorSplit(
  root: HTMLElement,
  thread: Thread,
  container: HTMLDivElement,
  observers: ResizeObserver[],
): void {
  const sides = Array.from(root.querySelectorAll<HTMLElement>(".d2h-file-side-diff"));
  const filesDiff = root.querySelector<HTMLElement>(".d2h-files-diff");
  if (sides.length < 2 || !filesDiff) return;
  const tbodies = sides.map((s) => s.querySelector("tbody"));
  const targetIdx = thread.side === "new" ? 1 : 0;
  const targetTbody = tbodies[targetIdx];
  if (!targetTbody) return;

  const rows = Array.from(targetTbody.querySelectorAll<HTMLElement>(":scope > tr"));
  const rowIdx = rows.findIndex((tr) => {
    const num = tr.querySelector(".d2h-code-side-linenumber")?.textContent?.trim();
    return num !== undefined && parseInt(num, 10) === thread.endLine;
  });
  if (rowIdx < 0) return;

  const cells: HTMLElement[] = [];
  for (const tb of tbodies) {
    if (!tb) continue;
    const ref = tb.querySelectorAll<HTMLElement>(":scope > tr")[rowIdx];
    const spacer = document.createElement("tr");
    spacer.className = "prv-thread-spacer";
    const td = document.createElement("td");
    td.colSpan = 2;
    spacer.appendChild(td);
    ref?.after(spacer);
    cells.push(td);
  }

  const overlay = document.createElement("div");
  overlay.className = "prv-thread-overlay";
  overlay.appendChild(container);
  filesDiff.appendChild(overlay);

  const place = () => {
    overlay.style.top = `${cells[0]!.parentElement!.offsetTop}px`;
    const h = container.offsetHeight;
    for (const td of cells) td.style.height = `${h}px`;
  };
  place();
  const ro = new ResizeObserver(place);
  ro.observe(container);
  observers.push(ro);
}

function FileContentView({
  file,
  content,
  loading,
  error,
}: {
  file: FileDiff;
  content: FileContent | null;
  loading: boolean;
  error: string | null;
}) {
  if (error) return <div className="file-content-notice">Error: {error}</div>;
  if (loading || content === null) return <div className="file-content-notice">loading…</div>;
  if (content.kind === "missing") {
    return (
      <div className="file-content-notice">File not available on either side ({file.status}).</div>
    );
  }
  if (content.kind === "binary") {
    return <div className="binary-notice">Binary file</div>;
  }
  if (isMarkdownPath(file.path)) {
    return <MarkdownFileView path={file.path} text={content.content} />;
  }
  return <FileContentCode path={file.path} text={content.content} />;
}

/**
 * Markdown files get a Rendered/Source sub-toggle in the File view. Rendered is the
 * default since the main use case is reviewing agent-written plans; Source falls back
 * to the syntax-highlighted code view.
 */
function MarkdownFileView({ path, text }: { path: string; text: string }) {
  const [md, setMd] = useState<"rendered" | "source">("rendered");
  return (
    <div className="markdown-file">
      <div className="md-view-toggle" role="tablist" aria-label="Markdown view mode">
        <button
          type="button"
          role="tab"
          aria-selected={md === "rendered"}
          className={`md-view-tab ${md === "rendered" ? "is-active" : ""}`}
          onClick={() => setMd("rendered")}
        >
          Rendered
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={md === "source"}
          className={`md-view-tab ${md === "source" ? "is-active" : ""}`}
          onClick={() => setMd("source")}
        >
          Source
        </button>
      </div>
      {md === "rendered" ? (
        <MarkdownView text={text} />
      ) : (
        <FileContentCode path={path} text={text} />
      )}
    </div>
  );
}

/** Render Markdown to sanitized HTML. Sanitization guards against scripts/handlers in file content. */
function MarkdownView({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(markdownToHtml(text)), [text]);
  return (
    <div
      className="markdown-body"
      // Sanitized via DOMPurify on the line above before injection.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function FileContentCode({ path, text }: { path: string; text: string }) {
  const codeRef = useRef<HTMLElement>(null);
  const lineNumbers = useMemo(() => {
    const count = countLines(text);
    return Array.from({ length: count }, (_, i) => i + 1).join("\n");
  }, [text]);
  // Paint plain text first, then highlight on the next idle frame so the
  // user isn't blocked on hljs parsing for large files.
  useEffect(() => {
    if (!codeRef.current) return;
    const el = codeRef.current;
    const run = () => {
      el.removeAttribute("data-highlighted");
      hljs.highlightElement(el);
    };
    const idle = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      }
    ).requestIdleCallback;
    if (idle) {
      const id = idle(run, { timeout: 200 });
      return () => {
        const cancel = (window as unknown as { cancelIdleCallback?: (id: number) => void })
          .cancelIdleCallback;
        if (cancel) cancel(id);
      };
    }
    const id = window.setTimeout(run, 0);
    return () => window.clearTimeout(id);
  }, [text]);
  return (
    <div className="file-content-wrap">
      <pre className="file-content-gutter" aria-hidden="true">
        {lineNumbers}
      </pre>
      <pre className="file-content-pre">
        <code ref={codeRef} className={`hljs language-${languageHint(path)}`}>
          {text}
        </code>
      </pre>
    </div>
  );
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  if (text.charCodeAt(text.length - 1) !== 10) n++;
  return n || 1;
}

const LANGUAGE_BY_EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  md: "markdown",
  mdx: "markdown",
  yml: "yaml",
  sh: "bash",
  zsh: "bash",
  fish: "bash",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  cs: "csharp",
  cpp: "cpp",
  hpp: "cpp",
  c: "c",
  h: "c",
};

function languageHint(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "plaintext";
  const ext = path.slice(dot + 1).toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? ext;
}

async function fetchFileContent(
  mode: ServerMode,
  filePath: string,
  side: FileSide,
  signal: AbortSignal,
): Promise<FileContent> {
  const url = new URL("/api/file", window.location.origin);
  encodeMode(mode, url.searchParams);
  url.searchParams.set("file", filePath);
  url.searchParams.set("side", side);
  const res = await fetch(url.pathname + url.search, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as FileContent;
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25z" />
      <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
    </svg>
  );
}
