import { useEffect, useMemo, useRef, useState } from "react";
import type { DirsResponse, ServerMode } from "../types";
import { ChevronDown } from "./icons";

type PathMode = Extract<ServerMode, { kind: "path-vs-path" }>;

export function PathPicker({
  mode,
  onChange,
}: {
  mode: PathMode;
  onChange: (next: PathMode) => void;
}) {
  return (
    <div className="mode-picker">
      <PathSide label="base" value={mode.a} onChange={(a) => onChange({ ...mode, a })} />
      <span className="mode-picker-sep" aria-hidden="true">
        ↔
      </span>
      <PathSide label="compare" value={mode.b} onChange={(b) => onChange({ ...mode, b })} />
    </div>
  );
}

function parentOf(path: string): string {
  if (path.endsWith("/") && path.length > 1) return path.slice(0, -1);
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return "/";
  return path.slice(0, idx);
}

function basenameOf(path: string): string {
  if (path.endsWith("/")) return "";
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function abbreviatePath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 2) return path;
  return `…/${segments.slice(-2).join("/")}`;
}

function PathSide({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [activeIndex, setActiveIndex] = useState(0);
  const [siblings, setSiblings] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.select());
  }, [open]);

  const parent = useMemo(() => parentOf(draft || "/"), [draft]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const url = new URL("/api/list-dirs", window.location.origin);
    url.searchParams.set("path", parent);
    fetch(url)
      .then((r) => r.json() as Promise<DirsResponse>)
      .then((data) => {
        if (!cancelled) setSiblings(data.dirs);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [open, parent]);

  const filtered = useMemo(() => {
    const base = basenameOf(draft).toLowerCase();
    if (!base) return siblings.slice(0, 50);
    return siblings
      .filter((d) =>
        d
          .slice(parent === "/" ? 1 : parent.length + 1)
          .toLowerCase()
          .startsWith(base),
      )
      .slice(0, 50);
  }, [siblings, draft, parent]);

  const clampedActive = filtered.length === 0 ? 0 : Math.min(activeIndex, filtered.length - 1);

  const commit = (path?: string) => {
    const next = (path ?? draft).trim();
    if (next && next !== value) onChange(next);
    setOpen(false);
  };

  const completeTo = (path: string) => {
    setDraft(path);
    setActiveIndex(0);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        const len = path.length;
        el.setSelectionRange(len, len);
      }
    });
  };

  return (
    <div className="mode-picker-side" ref={containerRef}>
      <button
        type="button"
        className="mode-picker-trigger"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="mode-picker-label">{label}</span>
        <span className="mode-picker-value" title={value}>
          {abbreviatePath(value)}
        </span>
        <ChevronDown />
      </button>
      {open && (
        <div className="mode-picker-popover mode-picker-popover-path">
          <div className="mode-picker-path-field">
            <FolderIcon />
            <input
              ref={inputRef}
              className="mode-picker-path-input"
              type="text"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              placeholder="/path/to/dir"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (filtered.length > 0) setActiveIndex((i) => (i + 1) % filtered.length);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  if (filtered.length > 0)
                    setActiveIndex((i) => (i - 1 + filtered.length) % filtered.length);
                } else if (e.key === "Tab") {
                  if (filtered.length > 0) {
                    e.preventDefault();
                    completeTo(filtered[clampedActive] ?? draft);
                  }
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (
                    filtered.length > 0 &&
                    filtered[clampedActive] &&
                    filtered[clampedActive] !== draft
                  ) {
                    completeTo(filtered[clampedActive]!);
                  } else {
                    commit();
                  }
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setDraft(value);
                  setOpen(false);
                }
              }}
            />
          </div>
          {filtered.length > 0 && (
            <ul className="mode-picker-path-list">
              {filtered.map((dir, i) => {
                const display = parent === "/" ? dir.slice(1) : dir.slice(parent.length + 1);
                return (
                  <li
                    key={dir}
                    className={`mode-picker-path-item ${i === clampedActive ? "is-active" : ""}`}
                    onPointerEnter={() => setActiveIndex(i)}
                    onClick={() => completeTo(dir)}
                  >
                    <FolderIcon />
                    <span>{display}</span>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mode-picker-path-hint">
            <kbd>tab</kbd> complete <span>·</span> <kbd>↵</kbd> save <span>·</span> <kbd>esc</kbd>{" "}
            cancel
          </div>
        </div>
      )}
    </div>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25V4.75A1.75 1.75 0 0 0 14.25 3h-6.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 5.25 1Z" />
    </svg>
  );
}
