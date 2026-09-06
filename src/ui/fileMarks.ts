import type { FileDiff, FileSide } from "./types";

/**
 * How one run of non-context diff lines shows up on the side of the file the
 * File view displays. `here` lines exist on that side (`+` lines when the new
 * side is shown, `-` lines on the old), `other` lines only on the other side.
 *
 * - "add"/"del": only this side's lines — an insertion (new side) or, on the
 *   old side, a deletion.
 * - "mod": lines on both sides — a replacement.
 * - "gap": only the other side's lines — nothing to tint here, just a seam
 *   where lines were removed (new side) or inserted (old side).
 */
export type BlockKind = "add" | "del" | "mod" | "gap";

export type ChangeBlock = {
  kind: BlockKind;
  /** First line of this side in the block; for a gap, the line it sits before. */
  start: number;
  here: number;
  other: number;
};

export type FileMarks = {
  side: FileSide;
  /** Change blocks in file order. */
  blocks: ChangeBlock[];
  /** This side's changed lines, by 1-based line number, to their block. */
  lines: Map<number, ChangeBlock>;
  /**
   * Seams where the other side had lines this side lacks, keyed by the line
   * they sit before — one past the last line means "at the end of the file".
   * A replacement that shrank the file counts too, so its lost lines show.
   */
  gaps: Map<number, ChangeBlock>;
};

/**
 * Project a file's hunks onto one side of it, so the File view can colour its
 * gutter the way the diff view does. Each run of non-context lines is one
 * change block: git already groups a replaced region as its `-` lines followed
 * by its `+` lines, so a block with both is a modification, a block with only
 * this side's lines an addition (or a deletion, on the old side), and a block
 * with only the other side's lines a gap.
 */
export function fileMarks(file: FileDiff, side: FileSide): FileMarks {
  const marks: FileMarks = { side, blocks: [], lines: new Map(), gaps: new Map() };
  if (file.binary) return marks;
  const hereMarker = side === "new" ? "+" : "-";
  const presentKind: BlockKind = side === "new" ? "add" : "del";

  for (const hunk of file.hunks) {
    let n = side === "new" ? hunk.newStart : hunk.oldStart;
    let start = n;
    let here = 0;
    let other = 0;
    const flush = () => {
      if (here === 0 && other === 0) return;
      const kind: BlockKind = here === 0 ? "gap" : other === 0 ? presentKind : "mod";
      const block: ChangeBlock = { kind, start, here, other };
      marks.blocks.push(block);
      for (let ln = start; ln < start + here; ln++) marks.lines.set(ln, block);
      if (other > here) marks.gaps.set(start, block);
      here = 0;
      other = 0;
    };
    for (const raw of hunk.lines) {
      const marker = raw[0] ?? " ";
      if (marker === " ") {
        flush();
        n++;
        start = n;
      } else if (marker === hereMarker) {
        if (here === 0 && other === 0) start = n;
        here++;
        n++;
      } else {
        if (here === 0 && other === 0) start = n;
        other++;
      }
    }
    flush();
  }
  return marks;
}

/**
 * The gutter line each change starts on, in file order, for hopping between
 * changes: a block's first line, or the line a gap sits before — clamped to
 * the last line for a gap at the end of the file, which that line wears.
 */
export function changeStarts(marks: FileMarks, lineCount: number): number[] {
  const starts = new Set(marks.blocks.map((b) => Math.min(b.start, lineCount)));
  return [...starts].filter((n) => n >= 1).sort((a, b) => a - b);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What a block did, for the gutter tooltip; `side` says which text is shown. */
export function describeBlock(block: ChangeBlock, side: FileSide): string {
  const { kind, here, other } = block;
  if (kind === "add") return `Added ${plural(here, "line")}`;
  if (kind === "del") return `Deleted ${plural(here, "line")}`;
  if (kind === "mod") {
    return side === "new"
      ? `Replaced ${plural(other, "line")} with ${here}`
      : `${plural(here, "line")} replaced by ${other}`;
  }
  return side === "new"
    ? `${plural(other, "line")} removed here`
    : `${plural(other, "line")} inserted here`;
}
