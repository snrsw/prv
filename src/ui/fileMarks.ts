import type { FileDiff, FileSide } from "./types";

/**
 * How the diff touched a line of the file as shown in the File view: it was
 * added, it replaced something ("mod": a block that both removed and added
 * lines), or — when the old side is shown — it was deleted.
 */
export type LineChange = "add" | "mod" | "del";

export type FileMarks = {
  /** Changed lines of the shown side, by 1-based line number. */
  lines: Map<number, LineChange>;
  /**
   * Lines the *other* side had that the shown side lacks (deletions when the
   * new side is shown), keyed by the shown-side line they sit before, with
   * their count. A key one past the last line means "at the end of the file".
   */
  gaps: Map<number, number>;
};

const EMPTY: FileMarks = { lines: new Map(), gaps: new Map() };

/**
 * Project a file's hunks onto one side of it, so the File view can colour its
 * gutter the way the diff view does. Each run of non-context lines is one
 * change block: git already groups a replaced region as its `-` lines followed
 * by its `+` lines, so a block with both is a modification, a block with only
 * this side's lines an addition (or a deletion, on the old side), and a block
 * with only the other side's lines a gap.
 */
export function fileMarks(file: FileDiff, side: FileSide): FileMarks {
  if (file.binary || file.hunks.length === 0) return EMPTY;
  const here = side === "new" ? "+" : "-";
  const lines = new Map<number, LineChange>();
  const gaps = new Map<number, number>();
  const present: LineChange = side === "new" ? "add" : "del";

  for (const hunk of file.hunks) {
    let n = side === "new" ? hunk.newStart : hunk.oldStart;
    let block: number[] = [];
    let missing = 0;
    const flush = () => {
      if (block.length > 0 && missing > 0) for (const ln of block) lines.set(ln, "mod");
      else if (block.length > 0) for (const ln of block) lines.set(ln, present);
      else if (missing > 0) gaps.set(n, (gaps.get(n) ?? 0) + missing);
      block = [];
      missing = 0;
    };
    for (const raw of hunk.lines) {
      const marker = raw[0] ?? " ";
      if (marker === " ") {
        flush();
        n++;
      } else if (marker === here) {
        block.push(n++);
      } else {
        missing++;
      }
    }
    flush();
  }
  return { lines, gaps };
}
