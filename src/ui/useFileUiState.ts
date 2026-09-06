import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeMode } from "../shared/modeQuery";
import type { ServerMode } from "./types";

/**
 * Per-file card state the reader sets by hand (Viewed, collapsed, Diff/File
 * tab, Markdown Rendered/Source). It lives in App keyed by path rather than
 * inside each DiffPanel so a Refresh — including the one a Write send
 * triggers when it finishes — does not throw it away, and it is persisted per
 * comparison so reopening the same diff picks up where the reader left off.
 */

export type FileUi = {
  viewed?: boolean;
  collapsed?: boolean;
  view?: "diff" | "file";
  mdView?: "rendered" | "source";
};

export type FileUiState = Record<string, FileUi>;

export const FILE_UI_KEY_PREFIX = "prv:fileUi:";

/** One localStorage key per comparison, so `main↔worktree` and `v1↔v2` don't share Viewed marks. */
export function fileUiStorageKey(mode: ServerMode | null): string {
  if (!mode) return FILE_UI_KEY_PREFIX + "default";
  const params = new URLSearchParams();
  encodeMode(mode, params);
  return FILE_UI_KEY_PREFIX + params.toString();
}

/**
 * Merge `patch` into the entry for `path`. Fields at their default (false,
 * "diff", "rendered") are dropped and an entry left with nothing is removed,
 * so the store only holds what the reader actually changed. Returns `state`
 * itself when nothing changed, so callers can skip a re-render. Pure.
 */
export function updateFileUi(state: FileUiState, path: string, patch: FileUi): FileUiState {
  const prev = state[path] ?? {};
  const merged: FileUi = { ...prev, ...patch };
  const next: FileUi = {};
  if (merged.viewed) next.viewed = true;
  if (merged.collapsed) next.collapsed = true;
  if (merged.view === "file") next.view = "file";
  if (merged.mdView === "source") next.mdView = "source";
  if (sameUi(prev, next)) return state;
  const out = { ...state };
  if (Object.keys(next).length === 0) delete out[path];
  else out[path] = next;
  return out;
}

/** Drop entries for files no longer in the diff. Returns `state` itself when nothing was dropped. Pure. */
export function pruneFileUi(state: FileUiState, paths: Iterable<string>): FileUiState {
  const keep = new Set(paths);
  const stale = Object.keys(state).filter((p) => !keep.has(p));
  if (stale.length === 0) return state;
  const out = { ...state };
  for (const p of stale) delete out[p];
  return out;
}

/** Decode a stored value, keeping only well-typed fields; anything malformed is `{}`. Pure. */
export function parseStoredFileUi(raw: string | null): FileUiState {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    let out: FileUiState = {};
    for (const [path, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue;
      out = updateFileUi(out, path, {
        viewed: value.viewed === true,
        collapsed: value.collapsed === true,
        view: value.view === "file" ? "file" : "diff",
        mdView: value.mdView === "source" ? "source" : "rendered",
      });
    }
    return out;
  } catch {
    return {};
  }
}

function sameUi(a: FileUi, b: FileUi): boolean {
  return (
    !!a.viewed === !!b.viewed &&
    !!a.collapsed === !!b.collapsed &&
    (a.view ?? "diff") === (b.view ?? "diff") &&
    (a.mdView ?? "rendered") === (b.mdView ?? "rendered")
  );
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function load(key: string): FileUiState {
  try {
    return parseStoredFileUi(window.localStorage.getItem(key));
  } catch {
    return {};
  }
}

function save(key: string, state: FileUiState): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* localStorage unavailable; keep the in-memory value */
  }
}

/**
 * @param mode the comparison the shown files came from (not the one being
 *   fetched — a failed fetch must not switch stores).
 * @param paths the shown files; entries for any other path are pruned so the
 *   store cannot grow without bound across reloads.
 */
export function useFileUiState(
  mode: ServerMode | null,
  paths: string[] | null,
): [FileUiState, (path: string, patch: FileUi) => void] {
  const key = useMemo(() => fileUiStorageKey(mode), [mode]);
  const [stored, setStore] = useState(() => ({ key, state: load(key) }));
  // Switch stores during render (rather than in an effect) so the new
  // comparison's files never paint with the previous comparison's marks.
  const store = stored.key === key ? stored : { key, state: load(key) };
  if (store !== stored) setStore(store);

  useEffect(() => {
    if (!paths) return;
    setStore((s) => {
      const state = pruneFileUi(s.state, paths);
      return state === s.state ? s : { ...s, state };
    });
  }, [paths]);

  // Keyed on the committed state: the render that swaps stores never commits.
  useEffect(() => {
    save(stored.key, stored.state);
  }, [stored]);

  const setFileUi = useCallback((path: string, patch: FileUi) => {
    setStore((s) => {
      const state = updateFileUi(s.state, path, patch);
      return state === s.state ? s : { ...s, state };
    });
  }, []);

  return [store.state, setFileUi];
}
