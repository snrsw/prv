import { useEffect, useMemo, useRef, useState } from "react";
import type { GitRight, ServerMode } from "../types";
import { useBranches } from "../useBranches";
import { CheckIcon, ChevronDown } from "./icons";

type GitMode = Extract<ServerMode, { kind: "git" }>;

export function ModePicker({
  mode,
  onChange,
}: {
  mode: GitMode;
  onChange: (next: GitMode) => void;
}) {
  const branches = useBranches(mode.cwd);

  return (
    <div className="mode-picker">
      <SidePicker
        label="base"
        branches={branches}
        value={{ kind: "ref", ref: mode.leftRef }}
        allowWorktree={false}
        onChange={(side) => {
          if (side.kind === "ref") onChange({ ...mode, leftRef: side.ref });
        }}
      />
      <span className="mode-picker-sep" aria-hidden="true">
        ↔
      </span>
      <SidePicker
        label="compare"
        branches={branches}
        value={mode.right}
        allowWorktree={true}
        onChange={(side) => onChange({ ...mode, right: side })}
      />
    </div>
  );
}

function describeSide(side: GitRight): string {
  return side.kind === "worktree" ? "Working tree" : side.ref;
}

export function SidePicker({
  label,
  branches,
  value,
  allowWorktree,
  onChange,
}: {
  label: string;
  branches: string[];
  value: GitRight;
  allowWorktree: boolean;
  onChange: (side: GitRight) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const items = useMemo(() => {
    const refList: { kind: "ref"; ref: string }[] = [];
    if (!branches.includes("HEAD")) refList.push({ kind: "ref", ref: "HEAD" });
    for (const b of branches) refList.push({ kind: "ref", ref: b });

    const sides: GitRight[] = allowWorktree ? [{ kind: "worktree" }, ...refList] : refList;
    const q = query.trim().toLowerCase();
    if (!q) return sides;
    return sides.filter((s) => describeSide(s).toLowerCase().includes(q));
  }, [branches, allowWorktree, query]);

  const showCustomItem =
    query.trim().length > 0 && !items.some((s) => s.kind === "ref" && s.ref === query.trim());

  const totalCount = items.length + (showCustomItem ? 1 : 0);
  const clampedActive = totalCount === 0 ? 0 : Math.min(activeIndex, totalCount - 1);

  const select = (side: GitRight) => {
    onChange(side);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (totalCount === 0 ? 0 : (i + 1) % totalCount));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (totalCount === 0 ? 0 : (i - 1 + totalCount) % totalCount));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (clampedActive < items.length) {
        const picked = items[clampedActive];
        if (picked) select(picked);
      } else if (showCustomItem) {
        select({ kind: "ref", ref: query.trim() });
      }
    }
  };

  const isSelected = (side: GitRight): boolean => {
    if (side.kind === "worktree") return value.kind === "worktree";
    return value.kind === "ref" && value.ref === side.ref;
  };

  return (
    <div className="mode-picker-side" ref={containerRef}>
      <button
        type="button"
        className="mode-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="mode-picker-label">{label}</span>
        <span className="mode-picker-value">{describeSide(value)}</span>
        <ChevronDown />
      </button>
      {open && (
        <div className="mode-picker-popover" role="listbox">
          <input
            ref={inputRef}
            className="mode-picker-search"
            type="text"
            placeholder="Find or type a ref…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
          <ul className="mode-picker-list">
            {items.map((side, i) => (
              <li
                key={side.kind === "worktree" ? "__worktree__" : `ref:${side.ref}`}
                className={`mode-picker-item ${i === clampedActive ? "is-active" : ""} ${isSelected(side) ? "is-selected" : ""}`}
                role="option"
                aria-selected={isSelected(side)}
                onPointerEnter={() => setActiveIndex(i)}
                onClick={() => select(side)}
              >
                <span className="mode-picker-item-icon" aria-hidden="true">
                  {side.kind === "worktree" ? <WorktreeIcon /> : <BranchIcon />}
                </span>
                <span className="mode-picker-item-label">{describeSide(side)}</span>
                {isSelected(side) && (
                  <span className="mode-picker-item-check" aria-hidden="true">
                    <CheckIcon />
                  </span>
                )}
              </li>
            ))}
            {showCustomItem && (
              <li
                className={`mode-picker-item mode-picker-item-custom ${
                  clampedActive === items.length ? "is-active" : ""
                }`}
                role="option"
                onPointerEnter={() => setActiveIndex(items.length)}
                onClick={() => select({ kind: "ref", ref: query.trim() })}
              >
                <span className="mode-picker-item-icon" aria-hidden="true">
                  <CommitIcon />
                </span>
                <span className="mode-picker-item-label">
                  Use <code>{query.trim()}</code> as ref
                </span>
              </li>
            )}
            {items.length === 0 && !showCustomItem && (
              <li className="mode-picker-empty">No matches</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function BranchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.49 2.49 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
    </svg>
  );
}

function WorktreeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M2 2.75A1.75 1.75 0 0 1 3.75 1h8.5A1.75 1.75 0 0 1 14 2.75v10.5A1.75 1.75 0 0 1 12.25 15h-8.5A1.75 1.75 0 0 1 2 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V2.75a.25.25 0 0 0-.25-.25ZM5 5.25A.75.75 0 0 1 5.75 4.5h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 5.25Zm0 3a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-4.5A.75.75 0 0 1 5 8.25Zm0 3a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 0 1.5h-2.5a.75.75 0 0 1-.75-.75Z" />
    </svg>
  );
}

function CommitIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z" />
    </svg>
  );
}
