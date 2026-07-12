/**
 * Pure diff-line helpers shared by the UI and the headless comments CLI:
 * flattening a FileDiff into rows, mapping line numbers to rows, and deriving
 * a comment's anchor (id + anchorText) from a row range.
 */
import type { FileDiff } from "../diff/types";
import type { LineKey } from "./comments";

export type LineSide = "old" | "new";

/**
 * A single diff line, flattened across all hunks of a file and given a global
 * index `gi` in file order. `old`/`new` are its line numbers on each side (a
 * context line has both, an added line only `new`, a deleted line only `old`).
 * This single `gi` axis lets a selection span deleted and added lines, and —
 * in split view — span the two columns, since both map back to the same lines.
 */
export type DiffRow = {
  gi: number;
  old: number | null;
  new: number | null;
  marker: " " | "+" | "-";
  text: string;
};

export function flattenDiff(file: FileDiff): DiffRow[] {
  const rows: DiffRow[] = [];
  let gi = 0;
  for (const hunk of file.hunks) {
    let o = hunk.oldStart;
    let n = hunk.newStart;
    for (const raw of hunk.lines) {
      const marker = (raw[0] ?? " ") as " " | "+" | "-";
      const text = raw.slice(1);
      if (marker === "+") rows.push({ gi, old: null, new: n++, marker, text });
      else if (marker === "-") rows.push({ gi, old: o++, new: null, marker, text });
      else rows.push({ gi, old: o++, new: n++, marker, text });
      gi++;
    }
  }
  return rows;
}

export type LineMaps = { oldMap: Map<number, number>; newMap: Map<number, number> };

export function lineMaps(rows: DiffRow[]): LineMaps {
  const oldMap = new Map<number, number>();
  const newMap = new Map<number, number>();
  for (const r of rows) {
    if (r.old != null) oldMap.set(r.old, r.gi);
    if (r.new != null) newMap.set(r.new, r.gi);
  }
  return { oldMap, newMap };
}

/** Resolve a line key to its global index, preferring the new-side number. */
export function keyGi(maps: LineMaps, key: LineKey | null | undefined): number | null {
  if (!key) return null;
  if (key.new != null) {
    const gi = maps.newMap.get(key.new);
    if (gi != null) return gi;
  }
  if (key.old != null) {
    const gi = maps.oldMap.get(key.old);
    if (gi != null) return gi;
  }
  return null;
}

export function keyOfRow(row: DiffRow): LineKey {
  return { old: row.old, new: row.new };
}

export function anchorTextOf(slice: DiffRow[]): string[] {
  return slice.map((r) => r.marker + r.text);
}

/** Stable id derived from a comment's range endpoints. */
export function commentId(start: LineKey, end: LineKey): string {
  const k = (key: LineKey) => `${key.old ?? ""}_${key.new ?? ""}`;
  return `c:${k(start)}:${k(end)}`;
}
