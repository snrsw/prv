import { useEffect, useRef, useState } from "react";
import { html as diff2html } from "diff2html";
import hljs from "highlight.js";
import type { FileDiff } from "../types";
import { fileTotals } from "../totals";
import { DiffStat } from "./DiffStat";
import { CheckIcon, ChevronDown, ChevronRight } from "./icons";

export function DiffPanel({ file, anchorId }: { file: FileDiff; anchorId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(true);
  const [viewed, setViewed] = useState(false);
  const [copied, setCopied] = useState(false);
  const totals = fileTotals(file);

  useEffect(() => {
    if (!expanded || !ref.current) return;
    if (file.binary) {
      ref.current.innerHTML = `<div class="binary-notice">Binary file differs</div>`;
      return;
    }
    ref.current.innerHTML = diff2html(file.raw, {
      drawFileList: false,
      matching: "none",
      outputFormat: "line-by-line",
    });
    ref.current.querySelectorAll("pre code").forEach((el) => {
      hljs.highlightElement(el as HTMLElement);
    });
  }, [file.raw, file.binary, expanded]);

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
      {expanded && <div className="file-card-body" ref={ref} />}
    </section>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25z" />
      <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z" />
    </svg>
  );
}
