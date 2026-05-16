import { useEffect, useMemo, useRef, useState } from "react";
import { html as diff2html } from "diff2html";
import { Diff2HtmlUI } from "diff2html/lib/ui/js/diff2html-ui-base";
import hljs from "highlight.js";
import type { DiffOutputFormat, FileContent, FileDiff, FileSide, ServerMode } from "../types";
import { encodeMode } from "../../shared/modeQuery";
import { fileTotals } from "../totals";
import { DiffStat } from "./DiffStat";
import { CheckIcon, ChevronDown, ChevronRight } from "./icons";

type View = "diff" | "file";

// Must match .file-content-pre code.hljs vertical padding and var(--fs-code-lh) in styles.css.
const FILE_CODE_PADDING_TOP = 8;
const FILE_LINE_HEIGHT = 20;

export function DiffPanel({
  file,
  mode,
  anchorId,
  outputFormat,
}: {
  file: FileDiff;
  mode: ServerMode | null;
  anchorId: string;
  outputFormat: DiffOutputFormat;
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
  }, [file.raw, file.binary, expanded, view, outputFormat]);

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
      {expanded && view === "diff" && <div className="file-card-body" ref={ref} />}
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
  return <FileContentCode path={file.path} text={content.content} />;
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
