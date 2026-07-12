/**
 * Transform validated review findings into persisted review comments, anchored
 * exactly like hand-made ones so relocation and rendering are inherited. Pure:
 * it runs in the browser today (the client owns the comment store) and stays
 * importable server-side for a future findings-import endpoint.
 */

import type { FileDiff } from "../diff/types";
import type { Comment } from "../shared/comments";
import {
  anchorTextOf,
  flattenDiff,
  keyOfRow,
  lineMaps,
  type DiffRow,
  type LineMaps,
} from "../shared/diffLines";
import type { LensId, ReviewFinding } from "../shared/review";

export type TransformArgs = {
  findings: ReviewFinding[];
  files: FileDiff[];
  runId: string;
  lens: LensId;
};

export type TransformResult = {
  comments: Comment[];
  /** Files cited by findings but absent from the diff (those findings are dropped). */
  droppedFiles: string[];
};

/** Resolve a finding's file against the diff, tolerating `./`, `a/`/`b/`, and absolute prefixes. */
export function resolveFindingFile(files: FileDiff[], path: string): FileDiff | undefined {
  const exact = files.find((f) => f.path === path);
  if (exact) return exact;
  const stripped = path.replace(/^\.\//, "").replace(/^[ab]\//, "");
  const restripped = files.find((f) => f.path === stripped);
  if (restripped) return restripped;
  // Suffix match rescues absolute paths; the longest diff path wins ties.
  return files
    .filter((f) => path.endsWith(`/${f.path}`))
    .sort((x, y) => y.path.length - x.path.length)[0];
}

type Flattened = { rows: DiffRow[]; maps: LineMaps };

/** The finding's message as stored in the thread: bold title, then the body. */
function findingText(finding: ReviewFinding): string {
  return finding.body === ""
    ? `**${finding.title}**`
    : `**${finding.title}**\n\n${finding.body}`;
}

/**
 * Build one comment for a finding. Endpoints resolve on the finding's side
 * first, then the other side; if only one endpoint lands, anchor that single
 * line; if neither does, fall back to a file-level comment (null endpoints,
 * empty anchorText) that renders through the existing orphaned path.
 */
function findingToComment(
  finding: ReviewFinding,
  file: FileDiff,
  { rows, maps }: Flattened,
  id: string,
  lens: LensId,
  runId: string,
): Comment {
  const giOf = (line: number): number | null => {
    const primary = finding.side === "old" ? maps.oldMap : maps.newMap;
    const secondary = finding.side === "old" ? maps.newMap : maps.oldMap;
    return primary.get(line) ?? secondary.get(line) ?? null;
  };
  const a = giOf(finding.startLine);
  const b = giOf(finding.endLine);
  const gis = [a, b].filter((gi): gi is number => gi !== null);

  const anchor =
    gis.length === 0
      ? { start: { old: null, new: null }, end: { old: null, new: null }, anchorText: [] }
      : (() => {
          const lo = Math.min(...gis);
          const hi = Math.max(...gis);
          const slice = rows.slice(lo, hi + 1);
          return { start: keyOfRow(rows[lo]!), end: keyOfRow(rows[hi]!), anchorText: anchorTextOf(slice) };
        })();

  return {
    id,
    file: file.path,
    ...anchor,
    status: "open",
    messages: [{ role: "assistant", text: findingText(finding) }],
    source: "review",
    severity: finding.severity,
    title: finding.title,
    lens,
    runId,
  };
}

/** Transform one lens's findings into comments against the given diff snapshot. */
export function findingsToComments({
  findings,
  files,
  runId,
  lens,
}: TransformArgs): TransformResult {
  const flattened = new Map<string, Flattened>();
  const flatten = (file: FileDiff): Flattened => {
    let entry = flattened.get(file.path);
    if (!entry) {
      const rows = flattenDiff(file);
      entry = { rows, maps: lineMaps(rows) };
      flattened.set(file.path, entry);
    }
    return entry;
  };

  const comments: Comment[] = [];
  const dropped = new Set<string>();
  findings.forEach((finding, i) => {
    const file = resolveFindingFile(files, finding.file);
    if (!file) {
      dropped.add(finding.file);
      return;
    }
    comments.push(
      findingToComment(finding, file, flatten(file), `r:${runId}:${lens}:${i}`, lens, runId),
    );
  });
  return { comments, droppedFiles: [...dropped] };
}
