/**
 * Extraction and validation of a batch turn's results from its final reply.
 * Same tolerance as the review lenses (last fenced block, then the outermost
 * brace slice), plus one extra rule: an id the client did not ask about is
 * skipped rather than trusted — the client folds results into its comment
 * store by id, so an invented id would write to the wrong thread (or none).
 */

import type { BatchResult } from "../shared/batch";
import { braceSlice, lastFencedBlock } from "../review/jsonBlock";

export type ParsedBatchResults = { results: BatchResult[]; skipped: string[] };

/** Only `true` and `"true"` mean done; an unsure model leaves the thread open. */
function toDone(value: unknown): boolean {
  return value === true || value === "true";
}

/** Validate one raw entry against the ids we asked about, or a skip reason. */
function validateEntry(entry: unknown, index: number, expected: Set<string>): BatchResult | string {
  if (typeof entry !== "object" || entry === null) return `result ${index}: not an object`;
  const e = entry as Record<string, unknown>;
  const id = typeof e.id === "string" ? e.id.trim() : "";
  if (id === "") return `result ${index}: missing id`;
  if (!expected.has(id)) return `result ${index}: unknown id ${id}`;
  return {
    id,
    file: typeof e.file === "string" ? e.file : "",
    reply: typeof e.reply === "string" ? e.reply : "",
    done: toDone(e.done),
  };
}

/**
 * Parse candidate JSON into validated results. Returns null only when the
 * candidate is unusable (unparseable, or no `results` array) — the caller
 * should retry the turn. Duplicate ids keep the first entry, so a model that
 * repeats itself cannot overwrite its own earlier verdict.
 */
export function parseBatchResults(
  json: string,
  expectedIds: readonly string[],
): ParsedBatchResults | null {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof root !== "object" || root === null) return null;
  const list = (root as { results?: unknown }).results;
  if (!Array.isArray(list)) return null;

  const expected = new Set(expectedIds);
  const results: BatchResult[] = [];
  const skipped: string[] = [];
  // Ids are derived from line numbers, so the same id can name threads in two
  // files of one batch; dedupe on id + file so both keep their own verdict.
  const seen = new Set<string>();
  list.forEach((entry, index) => {
    const result = validateEntry(entry, index, expected);
    if (typeof result === "string") skipped.push(result);
    else if (seen.has(`${result.id}\0${result.file}`))
      skipped.push(`result ${index}: duplicate id ${result.id}`);
    else {
      seen.add(`${result.id}\0${result.file}`);
      results.push(result);
    }
  });
  return { results, skipped };
}

/** Extract results from a batch reply; null means "no usable block" (retry). */
export function extractBatchResults(
  reply: string,
  expectedIds: readonly string[],
): ParsedBatchResults | null {
  const fenced = lastFencedBlock(reply);
  if (fenced !== null) {
    const parsed = parseBatchResults(fenced, expectedIds);
    if (parsed !== null) return parsed;
  }
  const braced = braceSlice(reply);
  if (braced !== null && braced !== fenced) {
    const parsed = parseBatchResults(braced, expectedIds);
    if (parsed !== null) return parsed;
  }
  return null;
}
