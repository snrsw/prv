/**
 * Review lens definitions and their prompts. Each lens is one read-only agent
 * run over the same annotated diff, focused on a single class of problems; the
 * panel runs all lenses in parallel and tags each comment with its lens.
 */

import type { LensId } from "../shared/review";
import { MAX_FINDINGS_PER_LENS } from "./findings";

export type Lens = { id: LensId; label: string; focus: string };

export const LENSES: readonly Lens[] = [
  {
    id: "correctness",
    label: "Correctness",
    focus:
      "Hunt for logic errors introduced or exposed by this change: wrong conditions, " +
      "off-by-one and boundary errors, broken invariants, misused APIs, unsound type " +
      "assertions, and unhandled null/empty/unicode/concurrency edge cases. Ignore " +
      "style, naming, and test files.",
  },
  {
    id: "silent-failures",
    label: "Silent failures",
    focus:
      "Hunt for places where this change can fail without anyone noticing: swallowed " +
      "exceptions (empty catch, `.catch(() => {})`), ignored return values or exit " +
      "codes, error paths that log instead of propagating, fallbacks or defaults that " +
      "mask bugs, and timeouts or aborts with no signal to the caller.",
  },
  {
    id: "test-coverage",
    label: "Test coverage",
    focus:
      "Hunt for behavior this change adds or alters that no test pins down: new " +
      "branches, error paths, and edge cases without coverage, plus existing tests the " +
      "change silently weakens. Anchor each finding to the changed source lines whose " +
      "behavior is untested, and name the missing test in the body.",
  },
];

/** The full prompt for one lens turn over the annotated diff. */
export function buildReviewPrompt(lens: Lens, annotatedDiff: string): string {
  return [
    "You are performing a focused code review of a diff in a strictly read-only capacity.",
    "Do not modify any files or run any mutating commands.",
    "",
    `Your single review lens: ${lens.label}.`,
    lens.focus,
    "",
    'The diff below is annotated. Each file starts with "### <path> (<status>)".',
    "Each line is: <old line number> TAB <new line number> TAB <marker><content>,",
    'where the marker is "+" (added), "-" (removed) or " " (unchanged). A missing',
    "number means the line does not exist on that side.",
    "",
    "<annotated-diff>",
    annotatedDiff,
    "</annotated-diff>",
    "",
    "You may Read or Grep the surrounding repository for context before concluding.",
    "",
    `Report at most ${MAX_FINDINGS_PER_LENS} findings. Prefer high-confidence, high-impact`,
    "findings over volume; skip style nits. Anchor every finding to lines shown in the",
    "annotated diff — findings for files not in the diff will be discarded. Use",
    '"new"-side numbers for added or unchanged lines and "old"-side numbers only for',
    "removed lines. If there is nothing to report, return an empty findings array.",
    "",
    "End your reply with exactly one fenced code block and nothing after it:",
    "```json",
    '{"findings": [{"file": "<path exactly as in a file header>", "side": "new",',
    '  "startLine": 1, "endLine": 1, "severity": "info|minor|major|critical",',
    '  "title": "<short imperative summary>",',
    '  "body": "<explanation, evidence, suggested fix — markdown, inline code with single backticks only, never fenced blocks>"}]}',
    "```",
  ].join("\n");
}

/** Follow-up turn (via --resume) when a lens reply had no parseable findings block. */
export const RETRY_PROMPT =
  "Your previous reply did not end with a valid findings block. Reply now with ONLY " +
  'the fenced ```json block — {"findings": [...]} exactly matching the schema you ' +
  "were given — and no other text.";
