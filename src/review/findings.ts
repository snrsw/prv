/**
 * Extraction and validation of a review lens's findings from its final reply.
 * The output contract asks for one fenced ```json block, but models drift, so
 * parsing is deliberately tolerant: try the last fenced block, fall back to
 * the outermost brace slice (rescues nested-fence corruption), then validate
 * per entry — bad entries are skipped with a reason, good siblings survive.
 */

import type { ReviewSeverity } from "../shared/comments";
import type { ReviewFinding, ReviewSide } from "../shared/review";

export const MAX_FINDINGS_PER_LENS = 8;

export type ParsedFindings = { findings: ReviewFinding[]; skipped: string[] };

/** The last fenced code block's contents, or null if the reply has none. */
function lastFencedBlock(reply: string): string | null {
  const fence = /```[^\S\n]*\w*[^\S\n]*\n([\s\S]*?)```/g;
  let last: string | null = null;
  for (const match of reply.matchAll(fence)) last = match[1] ?? null;
  return last;
}

/** The outermost `{`..`}` slice, or null when the reply has no brace pair. */
function braceSlice(reply: string): string | null {
  const open = reply.indexOf("{");
  const close = reply.lastIndexOf("}");
  return open >= 0 && close > open ? reply.slice(open, close + 1) : null;
}

/** Coerce a 1-based line number (accepts numeric strings); null when invalid. */
function toLine(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  return i >= 1 ? i : null;
}

const SEVERITIES: readonly ReviewSeverity[] = ["info", "minor", "major", "critical"];

/** Out-of-enum severities demote to "info" — an unsure model gets no alarm color. */
function clampSeverity(value: unknown): ReviewSeverity {
  return SEVERITIES.includes(value as ReviewSeverity) ? (value as ReviewSeverity) : "info";
}

function deriveTitle(title: unknown, body: string): string {
  if (typeof title === "string" && title.trim() !== "") return title.trim();
  const first = body.split("\n").find((line) => line.trim() !== "")?.trim() ?? "";
  if (first === "") return "(finding)";
  return first.length > 80 ? `${first.slice(0, 79)}…` : first;
}

/** Validate one raw entry into a ReviewFinding, or a skip reason. */
function validateEntry(entry: unknown, index: number): ReviewFinding | string {
  if (typeof entry !== "object" || entry === null) return `finding ${index}: not an object`;
  const e = entry as Record<string, unknown>;
  const file = typeof e.file === "string" && e.file.trim() !== "" ? e.file.trim() : null;
  if (file === null) return `finding ${index}: missing file`;
  const start = toLine(e.startLine);
  if (start === null) return `finding ${index}: missing or invalid startLine`;
  const end = toLine(e.endLine) ?? start;
  const side: ReviewSide = e.side === "old" ? "old" : "new";
  const body = typeof e.body === "string" ? e.body : "";
  return {
    file,
    side,
    startLine: Math.min(start, end),
    endLine: Math.max(start, end),
    severity: clampSeverity(e.severity),
    title: deriveTitle(e.title, body),
    body,
  };
}

/**
 * Parse candidate JSON into validated findings. Returns null only when the
 * candidate is unusable (unparseable, or no `findings` array) — the caller
 * should retry the turn. An empty findings array is a valid success.
 */
export function parseFindings(json: string): ParsedFindings | null {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof root !== "object" || root === null) return null;
  const list = (root as { findings?: unknown }).findings;
  if (!Array.isArray(list)) return null;

  const findings: ReviewFinding[] = [];
  const skipped: string[] = [];
  list.forEach((entry, index) => {
    const result = validateEntry(entry, index);
    if (typeof result === "string") skipped.push(result);
    else if (findings.length < MAX_FINDINGS_PER_LENS) findings.push(result);
    else skipped.push(`finding ${index}: over the ${MAX_FINDINGS_PER_LENS}-finding cap`);
  });
  return { findings, skipped };
}

/** Extract findings from a lens reply; null means "no usable block" (retry). */
export function extractFindings(reply: string): ParsedFindings | null {
  const fenced = lastFencedBlock(reply);
  if (fenced !== null) {
    const parsed = parseFindings(fenced);
    if (parsed !== null) return parsed;
  }
  const braced = braceSlice(reply);
  if (braced !== null && braced !== fenced) {
    const parsed = parseFindings(braced);
    if (parsed !== null) return parsed;
  }
  return null;
}
