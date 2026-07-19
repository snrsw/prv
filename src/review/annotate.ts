/**
 * Line-number-annotated diff text for review prompts. Each diff line carries
 * its old/new numbers explicitly (`old⇥new⇥marker+content`), so the reviewer
 * cites exact locations instead of deriving them from `@@` hunk headers.
 */

import type { FileDiff } from "../diff/types";
import { flattenDiff } from "../shared/diffLines";

/** Annotate one file: header + one line per diff row; "" for binary/hunkless files. */
export function annotateFile(file: FileDiff): string {
  if (file.binary || file.hunks.length === 0) return "";
  const lines = flattenDiff(file).map(
    (r) => `${r.old ?? ""}\t${r.new ?? ""}\t${r.marker}${r.text}`,
  );
  return [`### ${file.path} (${file.status})`, ...lines].join("\n");
}

/** Annotate a whole diff; annotatable files joined by blank lines ("" if none). */
export function annotateDiff(files: FileDiff[]): string {
  return files
    .map(annotateFile)
    .filter((s) => s !== "")
    .join("\n\n");
}
