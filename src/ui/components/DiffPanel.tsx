import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { html as diff2html } from "diff2html";
import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-base";
import hljs from "highlight.js";
import { isMarkdownPath } from "../markdown";
import { Markdown } from "./Markdown";
import type { DiffOutputFormat, FileContent, FileDiff, FileSide, ServerMode } from "../types";
import type { FileUi } from "../useFileUiState";
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
import {
  EXPAND_STEP,
  addRange,
  expandFile,
  gapsOf,
  revealRange,
  splitLines,
  type ExpandDirection,
  type Gap,
  type LineRange,
} from "../hunkExpand";
import { splitPath } from "../paths";
import { fileTotals } from "../totals";
import { describeBlock, fileMarks, type FileMarks } from "../fileMarks";
import { gutterKeyAction, moveSelection, type GutterSel } from "../gutterKeys";
import { CommentThread } from "./CommentThread";
import { DiffStat } from "./DiffStat";
import { CheckIcon, ChevronDown, ChevronRight } from "./icons";

/** The File view's sub-mode for Markdown files. */
type MdView = NonNullable<FileUi["mdView"]>;

/** Gutter rows that carry a change, for next/previous navigation. */
const MARKED_LINE = ".file-line-num.is-marked";

/** A comment anchored under one diff line (its range's last line). */
type Thread = { id: string; side: LineSide; endLine: number };

/** Where the floating "comment" affordance is shown while hovering a line. */
type HoverPlus = { gi: number; top: number };

/** In-progress gutter drag, as a span over the global diff-line index. */
type DragSel = { startGi: number; endGi: number };

/** The gutter cells a keyboard can land on (split view's blank fillers are not lines). */
const GUTTER_CELL = ".d2h-code-linenumber, .d2h-code-side-linenumber";
const GUTTER_FILLER = ["d2h-code-side-emptyplaceholder", "d2h-emptyplaceholder"];

function gutterCells(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(GUTTER_CELL)).filter(
    (cell) => !GUTTER_FILLER.some((cls) => cell.classList.contains(cls)),
  );
}

function gutterCellOf(el: EventTarget | null): HTMLElement | null {
  return el instanceof HTMLElement ? el.closest<HTMLElement>(GUTTER_CELL) : null;
}

/**
 * Focus a gutter cell and keep it clear of the sticky topbar: `focus()`'s own
 * minimal scroll would leave a line stepped up to under the bar.
 */
function focusCell(cell: HTMLElement): void {
  cell.focus({ preventScroll: true });
  cell.scrollIntoView({ block: "nearest" });
  const bar = document.querySelector<HTMLElement>(".topbar");
  const min = (bar?.offsetHeight ?? 0) + 8;
  const top = cell.getBoundingClientRect().top;
  if (top < min) window.scrollBy(0, top - min);
}

/**
 * A path as a directory part that may be squeezed (from its left, so the
 * segments nearest the file survive) and a file name that never is. The
 * `<bdi>` keeps the slashes in reading order inside the RTL-overflow trick.
 */
function PathParts({ path }: { path: string }) {
  const { dir, name } = splitPath(path);
  return (
    <>
      {dir && (
        <span className="file-card-dir">
          <bdi>{dir}</bdi>
        </span>
      )}
      <span className="file-card-name">{name}</span>
    </>
  );
}

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
  ui,
  setUi,
  focusedCommentId,
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
  /** Viewed / collapsed / tab state, owned by App so it outlives a Refresh. */
  ui: FileUi;
  setUi: (patch: FileUi) => void;
  /** The finding a jump just landed on (App flashes it), if it is in this file. */
  focusedCommentId: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const expanded = !ui.collapsed;
  const viewed = ui.viewed ?? false;
  const [copied, setCopied] = useState(false);
  const view = ui.view ?? "diff";
  // Rendered is the default since the main use case is reviewing agent-written
  // plans; Source is the syntax-highlighted code view with the diff gutter.
  const mdView = ui.mdView ?? "rendered";
  const [content, setContent] = useState<FileContent | null>(null);
  // Which side `content` came from, so the File view's gutter can be marked
  // with the diff as it applies to that side.
  const [contentSide, setContentSide] = useState<FileSide>("new");
  const [contentLoading, setContentLoading] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const totals = fileTotals(file);
  const lastFetchedKey = useRef<string | null>(null);
  const fileBodyRef = useRef<HTMLDivElement>(null);
  const scrollHintRef = useRef<{ line: number; screenY: number } | null>(null);

  // Context the reader has asked to see, as new-side line ranges, plus the
  // file's own lines to fill them from (fetched on the first expand click).
  const [reveals, setReveals] = useState<LineRange[]>([]);
  const [source, setSource] = useState<string[] | null>(null);
  const sourceRef = useRef<Promise<string[] | null> | null>(null);
  const modeKey = useMemo(() => JSON.stringify(mode), [mode]);

  const [hoverPlus, setHoverPlus] = useState<HoverPlus | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Stable portal containers (one per thread) — moved into the freshly rendered
  // diff DOM after each render so a thread's React subtree (and its WebSocket)
  // survives diff2html re-renders (e.g. unified⇄split toggles).
  const containersRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const observersRef = useRef<ResizeObserver[]>([]);
  // Bumped whenever the diff DOM is (re)built, so the anchoring effect re-runs.
  const [renderTick, setRenderTick] = useState(0);

  // The diff as currently shown: the original one, with any revealed context
  // folded in. Everything downstream (rendering, anchoring, selection) reads
  // this, so expanded context behaves exactly like context git sent us.
  const shown = useMemo(
    () => (source ? expandFile(file, source, reveals) : file),
    [file, source, reveals],
  );
  const gaps = useMemo(
    () => (file.binary ? [] : gapsOf(shown.hunks, source?.length ?? null)),
    [shown.hunks, source, file.binary],
  );

  // A new diff (or a different comparison) hides everything again.
  useEffect(() => {
    sourceRef.current = null;
    setSource(null);
    setReveals((prev) => (prev.length === 0 ? prev : []));
  }, [file.raw, modeKey]);

  // A renamed file's old side is read from where it used to live.
  const pathOn = useCallback(
    (side: FileSide): string => (side === "old" ? (file.oldPath ?? file.path) : file.path),
    [file.path, file.oldPath],
  );

  const loadSource = useCallback(async (): Promise<string[] | null> => {
    if (!mode) return null;
    if (!sourceRef.current) {
      const side: FileSide = file.status === "deleted" ? "old" : "new";
      sourceRef.current = fetchFileContent(mode, pathOn(side), side)
        .then((res) => (res.kind === "text" ? splitLines(res.content) : null))
        .catch(() => null);
    }
    const lines = await sourceRef.current;
    if (lines) setSource(lines);
    return lines;
  }, [mode, pathOn, file.status]);

  const onExpand = useCallback(
    async (gap: Gap, direction: ExpandDirection) => {
      const range = revealRange(gap, direction);
      if (!range) return;
      if (!(await loadSource())) return;
      setReveals((prev) => addRange(prev, range));
    },
    [loadSource],
  );

  useEffect(() => {
    if (!expanded || !ref.current) return;
    if (view !== "diff") return;
    if (file.binary) {
      ref.current.innerHTML = `<div class="binary-notice">Binary file differs</div>`;
      return;
    }
    ref.current.innerHTML = diff2html(shown.raw, {
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
  }, [shown.raw, file.binary, expanded, view, outputFormat]);

  // Turn every hunk header into an expander for the lines it hides.
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || view !== "diff" || file.binary) return;
    injectExpanders(root, gaps, shown.hunks.length, outputFormat, onExpand);
  }, [renderTick, gaps, shown.hunks.length, outputFormat, view, file.binary, onExpand]);

  // Gutter drag selection. The live drag lives in a ref (read by a window
  // mouseup listener without stale closures); `dragViz` mirrors it for render.
  const dragRef = useRef<DragSel | null>(null);
  const [dragViz, setDragViz] = useState<DragSel | null>(null);
  // Keyboard range (#56): Shift+↑/↓ from a focused gutter cell. Mirrored in
  // a ref so the keydown handler never reads a stale range.
  const keySelRef = useRef<GutterSel | null>(null);
  const [keySel, setKeySel] = useState<GutterSel | null>(null);
  const setSel = (sel: GutterSel | null) => {
    keySelRef.current = sel;
    setKeySel(sel);
  };
  // The line whose gutter cell is the card's Tab stop (tabindex="0"), by
  // global index; null until the reader has focused a line here.
  const rovingGiRef = useRef<number | null>(null);
  // Where focus should go once the diff DOM settles: back to the gutter
  // after Enter rebuilt it (hunk expand), or into a thread just opened. The
  // gutter case waits for the rebuild (a new `renderTick`): the anchoring
  // effect also runs on the commit that changes `shown`, when the old cells
  // are still on screen and about to be thrown away.
  const pendingFocusRef = useRef<
    { kind: "gutter"; tick: number } | { kind: "thread"; id: string } | null
  >(null);

  // Flatten the diff into a single global-index (gi) line list, so a range can
  // span deleted and added lines (and, in split, both columns).
  const rows = useMemo(() => flattenDiff(shown), [shown]);
  const maps = useMemo(() => lineMaps(rows), [rows]);

  const getContainer = (id: string): HTMLDivElement => {
    let c = containersRef.current.get(id);
    if (!c) {
      c = document.createElement("div");
      containersRef.current.set(id, c);
    }
    return c;
  };

  /** Open (or re-open) a thread on the range; returns its comment id. */
  const openThread = useCallback(
    (giA: number, giB: number): string => {
      const lo = Math.min(giA, giB);
      const hi = Math.max(giA, giB);
      const start = keyOfRow(rows[lo]!);
      const end = keyOfRow(rows[hi]!);
      const id = commentId(start, end);
      addComment({
        id,
        file: file.path,
        start,
        end,
        anchorText: anchorTextOf(rows.slice(lo, hi + 1)),
        status: "open",
        messages: [],
      });
      setHoverPlus(null);
      return id;
    },
    [file, addComment, rows],
  );

  // Place each comment in the current diff: relocated → anchored under its last
  // line; null → "orphaned" (its lines changed) and rendered below.
  const { anchored, orphaned } = useMemo(() => {
    const located = comments.map((c) => ({ comment: c, loc: relocateComment(shown, c) }));
    return {
      anchored: located.flatMap(({ comment, loc }) => (loc ? [{ comment, loc }] : [])),
      orphaned: located.flatMap(({ comment, loc }) => (loc ? [] : [comment])),
    };
  }, [comments, shown]);

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
    const sel = dragViz ?? keySel;
    if (sel) {
      mark(Math.min(sel.startGi, sel.endGi), Math.max(sel.startGi, sel.endGi), "prv-line-selected");
    }
  }, [dragViz, keySel, anchored, renderTick, view, giFromCell]);

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

    // Roving tabindex (#56): one Tab stop per card — the line last focused,
    // else the first — and every other gutter cell reachable by ↑/↓ only.
    // diff2html rebuilt the cells on this tick, so the attributes are re-set
    // here, after the thread rows are back in place.
    const cells = gutterCells(root);
    const rovingGi = rovingGiRef.current;
    const stop =
      (rovingGi === null ? undefined : cells.find((c) => giFromCell(c) === rovingGi)) ?? cells[0];
    for (const cell of cells) cell.tabIndex = cell === stop ? 0 : -1;
    const pending = pendingFocusRef.current;
    if (pending?.kind === "gutter" && pending.tick !== renderTick) {
      pendingFocusRef.current = null;
      stop?.focus();
    } else if (pending?.kind === "thread") {
      const input = containersRef.current.get(pending.id)?.querySelector("textarea");
      if (input) {
        pendingFocusRef.current = null;
        input.focus();
      }
    }
    return () => observersRef.current.forEach((o) => o.disconnect());
  }, [renderTick, anchored, outputFormat, view, giFromCell]);

  // A gutter cell taking focus becomes the card's Tab stop, so leaving the
  // card and coming back lands on the same line.
  const onDiffFocus = (e: React.FocusEvent) => {
    const root = ref.current;
    const cell = gutterCellOf(e.target);
    if (!root || !cell) return;
    for (const other of root.querySelectorAll<HTMLElement>(GUTTER_CELL)) {
      if (other.tabIndex === 0) other.tabIndex = -1;
    }
    cell.tabIndex = 0;
    const gi = giFromCell(cell);
    if (gi != null) rovingGiRef.current = gi;
  };

  // A selection only means something while the gutter has focus.
  const onDiffBlur = (e: React.FocusEvent) => {
    if (keySelRef.current && !gutterCellOf(e.relatedTarget)) setSel(null);
  };

  const onDiffKeyDown = (e: React.KeyboardEvent) => {
    const root = ref.current;
    const cell = gutterCellOf(e.target);
    if (!root || !cell) return;
    const action = gutterKeyAction(e);
    if (!action) return;
    const gi = giFromCell(cell);
    if (action.kind === "move") {
      e.preventDefault();
      const cells = gutterCells(root);
      const next = cells[cells.indexOf(cell) + action.delta];
      if (!next) return;
      setSel(moveSelection(keySelRef.current, gi, giFromCell(next), action.extend));
      focusCell(next);
      return;
    }
    if (action.kind === "clear") {
      if (keySelRef.current) {
        e.preventDefault();
        setSel(null);
      }
      return;
    }
    if (gi == null) {
      // A hunk header offering a single expand action: Enter is its click.
      const expanders = cell.querySelectorAll<HTMLButtonElement>(".prv-expander");
      if (e.key === "Enter" && expanders.length === 1) {
        e.preventDefault();
        pendingFocusRef.current = { kind: "gutter", tick: renderTick };
        expanders[0]!.click();
      }
      return;
    }
    e.preventDefault();
    const sel = keySelRef.current;
    const id = sel ? openThread(sel.startGi, sel.endGi) : openThread(gi, gi);
    setSel(null);
    // A thread that already exists on this range is on screen now; a new one
    // is rendered and anchored on the next commit.
    const existing = containersRef.current.get(id);
    if (existing?.isConnected) existing.querySelector("textarea")?.focus();
    else pendingFocusRef.current = { kind: "thread", id };
  };

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
        let side = primary;
        let result = await fetchFileContent(mode, pathOn(primary), primary, controller.signal);
        if (result.kind === "missing" && primary === "new") {
          const fallback = await fetchFileContent(mode, pathOn("old"), "old", controller.signal);
          if (fallback.kind !== "missing") {
            result = fallback;
            side = "old";
          }
        }
        setContentSide(side);
        setContent(result);
      } catch (e) {
        if (controller.signal.aborted) return;
        setContentError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!controller.signal.aborted) setContentLoading(false);
      }
    })();
    return () => controller.abort();
  }, [expanded, view, file.binary, file.path, file.status, pathOn, mode]);

  // The diff projected onto the side the File view shows: which of its lines
  // the diff added or replaced, and where the other side's lines went.
  const marks = useMemo(
    () => (view === "file" ? fileMarks(file, contentSide) : null),
    [view, file, contentSide],
  );
  // The gutter with its marks is on screen: a code file, or a Markdown one in Source.
  const marksVisible =
    !!marks && marks.blocks.length > 0 && (!isMarkdownPath(file.path) || mdView === "source");

  // Scroll to the next (or previous) change past the middle of the viewport,
  // so the reader can hop between changes in a long file. Marked lines come
  // in runs, one per change; only a run's first line is a stop, and it wraps.
  const jumpToChange = (direction: 1 | -1) => {
    const body = fileBodyRef.current;
    if (!body) return;
    const starts = Array.from(body.querySelectorAll<HTMLElement>(MARKED_LINE)).filter(
      (r) => !r.previousElementSibling?.classList.contains("is-marked"),
    );
    if (starts.length === 0) return;
    const mid = window.innerHeight / 2;
    const isNext = (r: HTMLElement) => r.getBoundingClientRect().top > mid + FILE_LINE_HEIGHT;
    const isPrev = (r: HTMLElement) => r.getBoundingClientRect().top < mid - FILE_LINE_HEIGHT;
    const target = direction === 1 ? starts.find(isNext) : starts.slice().reverse().find(isPrev);
    (target ?? (direction === 1 ? starts[0] : starts[starts.length - 1]))?.scrollIntoView({
      block: "center",
    });
  };

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
    setUi({ view: "file" });
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
    <section id={anchorId} data-path={file.path} className={`file-card ${viewed ? "viewed" : ""}`}>
      <header className="file-card-header">
        <button
          type="button"
          className="card-chevron"
          aria-label={expanded ? "Collapse file" : "Expand file"}
          aria-expanded={expanded}
          onClick={() => setUi({ collapsed: expanded })}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <span
          className="file-card-path"
          title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
        >
          {file.oldPath && (
            <span className="file-card-renamed">
              <PathParts path={file.oldPath} /> →{" "}
            </span>
          )}
          <PathParts path={file.path} />
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
              onClick={() => setUi({ view: "diff" })}
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
        {marksVisible && (
          <span className="file-change-nav" aria-label="Changes in this file">
            <button
              type="button"
              className="file-change-nav-btn"
              title="Previous change"
              aria-label="Previous change"
              onClick={() => jumpToChange(-1)}
            >
              ↑
            </button>
            <span className="file-change-nav-count">
              {marks!.blocks.length} change{marks!.blocks.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              className="file-change-nav-btn"
              title="Next change"
              aria-label="Next change"
              onClick={() => jumpToChange(1)}
            >
              ↓
            </button>
          </span>
        )}
        <span className="file-card-spacer" />
        <span className="file-card-counts">
          {totals.adds > 0 && <span className="adds">+{totals.adds}</span>}
          {totals.dels > 0 && <span className="dels">−{totals.dels}</span>}
          <DiffStat totals={totals} />
        </span>
        <label className="viewed-toggle">
          <input
            type="checkbox"
            checked={viewed}
            onChange={(e) => setUi({ viewed: e.target.checked })}
          />
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
          onFocus={onDiffFocus}
          onBlur={onDiffBlur}
          onKeyDown={onDiffKeyDown}
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
                context={buildCommentContext(shown, loc.slice)}
                onUpdate={(updater) => updateComment(comment.id, updater)}
                onRemove={() => removeComment(comment.id)}
                onApplied={onApplied}
                focused={comment.id === focusedCommentId}
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
                    focused={comment.id === focusedCommentId}
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
            marks={marks}
            mdView={mdView}
            setMdView={(v) => setUi({ mdView: v })}
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

type ExpandAction = { direction: ExpandDirection; glyph: string; title: string };

/**
 * What a gap offers: a small one is revealed whole in a single click, a large
 * one a step at a time from whichever hunk borders it.
 */
function expandActions(gap: Gap, hunkCount: number): ExpandAction[] {
  const size = gap.end === null ? null : gap.end - gap.start + 1;
  if (size !== null && size <= EXPAND_STEP) {
    return [
      { direction: "all", glyph: "↕", title: `Expand ${size} hidden line${size === 1 ? "" : "s"}` },
    ];
  }
  const hidden = size === null ? "to the end of the file" : `${size} hidden lines`;
  const up: ExpandAction = {
    direction: "up",
    glyph: "↑",
    title: `Expand ${EXPAND_STEP} lines up (${hidden})`,
  };
  const down: ExpandAction = {
    direction: "down",
    glyph: "↓",
    title: `Expand ${EXPAND_STEP} lines down (${hidden})`,
  };
  return [...(gap.hunkIndex < hunkCount ? [up] : []), ...(gap.hunkIndex > 0 ? [down] : [])];
}

function expanderButton(
  action: ExpandAction,
  gap: Gap,
  onExpand: (gap: Gap, direction: ExpandDirection) => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "prv-expander";
  button.textContent = action.glyph;
  button.title = action.title;
  button.setAttribute("aria-label", action.title);
  // Tab moves between cards, not expanders: the gutter cell they sit in is
  // the keyboard's way in (↑/↓ to the header row, then Enter).
  button.tabIndex = -1;
  // The gutter is also the comment-selection surface; keep clicks out of it.
  button.addEventListener("pointerdown", (e) => e.stopPropagation());
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    onExpand(gap, action.direction);
  });
  return button;
}

/**
 * Fill a hunk-header gutter with its expanders. When the gap offers only one
 * move, the whole blue row takes the click too — that row is the affordance
 * readers reach for. `onclick` (not a listener) keeps re-injection idempotent.
 */
function fillExpanderCell(
  cell: HTMLElement,
  gap: Gap,
  hunkCount: number,
  onExpand: (gap: Gap, direction: ExpandDirection) => void,
): void {
  const actions = expandActions(gap, hunkCount);
  if (actions.length === 0) return;
  cell.classList.add("prv-has-expander");
  for (const action of actions) cell.appendChild(expanderButton(action, gap, onExpand));

  const row = cell.closest<HTMLElement>("tr");
  if (!row || actions.length !== 1) return;
  row.classList.add("prv-expand-clickable");
  row.onclick = (e) => {
    if ((e.target as HTMLElement).closest(".prv-expander")) return;
    onExpand(gap, actions[0]!.direction);
  };
}

/** A hunk-header-looking row for the gap below the last hunk, which has none. */
function trailingExpandRow(
  gap: Gap,
  hunkCount: number,
  split: boolean,
  onExpand: (gap: Gap, direction: ExpandDirection) => void,
): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.className = "prv-expand-row";
  const gutter = document.createElement("td");
  gutter.className = `${split ? "d2h-code-side-linenumber" : "d2h-code-linenumber"} d2h-info`;
  // Reachable by ↑/↓ like the other gutter cells even when this row is
  // rebuilt between diff renders (the roving-tabindex pass only runs on those).
  gutter.tabIndex = -1;
  const code = document.createElement("td");
  code.className = "d2h-info";
  const line = document.createElement("div");
  line.className = split ? "d2h-code-side-line" : "d2h-code-line";
  code.appendChild(line);
  row.append(gutter, code);
  fillExpanderCell(gutter, gap, hunkCount, onExpand);
  return row;
}

/**
 * Put an expander on every hunk header that hides something, and append one
 * for the gap after the last hunk. In split view both tables get the same
 * rows, so the two sides stay aligned row for row.
 */
function injectExpanders(
  root: HTMLElement,
  gaps: Gap[],
  hunkCount: number,
  outputFormat: DiffOutputFormat,
  onExpand: (gap: Gap, direction: ExpandDirection) => void,
): void {
  root.querySelectorAll(".prv-expand-row").forEach((n) => n.remove());
  root.querySelectorAll(".prv-expander").forEach((n) => n.remove());
  root.querySelectorAll(".prv-has-expander").forEach((n) => n.classList.remove("prv-has-expander"));
  root.querySelectorAll<HTMLElement>(".prv-expand-clickable").forEach((n) => {
    n.classList.remove("prv-expand-clickable");
    n.onclick = null;
  });

  const split = outputFormat === "split";
  const tbodies = root.querySelectorAll<HTMLElement>(split ? ".d2h-file-side-diff tbody" : "tbody");
  // diff2html renders one header row per hunk, so the i-th is hunk i's.
  const above = new Map(gaps.filter((g) => g.hunkIndex < hunkCount).map((g) => [g.hunkIndex, g]));
  const trailing = gaps.find((g) => g.hunkIndex === hunkCount);

  for (const tbody of tbodies) {
    const cells = tbody.querySelectorAll<HTMLElement>(
      "td.d2h-code-linenumber.d2h-info, td.d2h-code-side-linenumber.d2h-info",
    );
    cells.forEach((cell, i) => {
      const gap = above.get(i);
      if (gap) fillExpanderCell(cell, gap, hunkCount, onExpand);
    });
    if (trailing) tbody.appendChild(trailingExpandRow(trailing, hunkCount, split, onExpand));
  }
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
  marks,
  mdView,
  setMdView,
  loading,
  error,
}: {
  file: FileDiff;
  content: FileContent | null;
  marks: FileMarks | null;
  mdView: MdView;
  setMdView: (v: MdView) => void;
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
    return (
      <MarkdownFileView
        path={file.path}
        text={content.content}
        marks={marks}
        md={mdView}
        setMd={setMdView}
      />
    );
  }
  return <FileContentCode path={file.path} text={content.content} marks={marks} />;
}

/**
 * Markdown files get a Rendered/Source sub-toggle in the File view. The
 * rendered page has no gutter, so when the diff touched the file it says
 * where the marks are rather than looking untouched.
 */
function MarkdownFileView({
  path,
  text,
  marks,
  md,
  setMd,
}: {
  path: string;
  text: string;
  marks: FileMarks | null;
  md: MdView;
  setMd: (v: MdView) => void;
}) {
  const changes = marks?.blocks.length ?? 0;
  return (
    <div className="markdown-file">
      <div className="md-view-bar">
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
        {md === "rendered" && changes > 0 && (
          <span className="md-view-note">
            {changes} change{changes === 1 ? "" : "s"} in this file —{" "}
            <button type="button" className="md-view-note-link" onClick={() => setMd("source")}>
              see them in Source
            </button>
          </span>
        )}
      </div>
      {md === "rendered" ? (
        <Markdown source={text} />
      ) : (
        <FileContentCode path={path} text={text} marks={marks} />
      )}
    </div>
  );
}

function FileContentCode({
  path,
  text,
  marks,
}: {
  path: string;
  text: string;
  marks: FileMarks | null;
}) {
  const codeRef = useRef<HTMLElement>(null);
  const count = useMemo(() => countLines(text), [text]);
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
      <FileGutter count={count} marks={marks} />
      <pre className="file-content-pre">
        <code ref={codeRef} className={`hljs language-${languageHint(path)}`}>
          {text}
        </code>
      </pre>
    </div>
  );
}

/**
 * The File view's line-number column, tinted like the diff view's gutter:
 * green for lines the diff added, yellow for lines that replaced others (red
 * for every line of a deleted file), each with a bar at the left edge whose
 * pattern also tells them apart. Where lines were removed there is no row to
 * tint, so a red wedge marks the seam: on the line that follows the removal,
 * or the bottom of the last line at EOF. Every mark explains itself on hover.
 */
function FileGutter({ count, marks }: { count: number; marks: FileMarks | null }) {
  const rows = useMemo(() => {
    const out: React.ReactNode[] = [];
    for (let n = 1; n <= count; n++) {
      const block = marks?.lines.get(n);
      const gapBefore = marks?.gaps.get(n);
      const gapAfter = n === count ? marks?.gaps.get(count + 1) : undefined;
      const cls = [
        "file-line-num",
        block || gapBefore || gapAfter ? "is-marked" : "",
        block ? `is-${block.kind}` : "",
        gapBefore ? "has-gap-before" : "",
        gapAfter ? "has-gap-after" : "",
      ]
        .filter(Boolean)
        .join(" ");
      // A line inside a replacement already describes the whole block, lost
      // lines included; only a bare seam needs its own words.
      const described = block ?? gapBefore ?? gapAfter;
      const title = described && marks ? describeBlock(described, marks.side) : undefined;
      out.push(
        <span key={n} className={cls} title={title}>
          {n}
        </span>,
      );
    }
    return out;
  }, [count, marks]);
  return (
    <div className="file-content-gutter" aria-hidden="true">
      {rows}
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
  signal?: AbortSignal,
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
