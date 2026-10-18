/**
 * Prompt and reply parsing for Generate: one read-only agent turn that drafts
 * a PR-body-like description of the diff on screen.
 */

import type { FileDiff } from "../diff/types";
import { DEFAULT_DESCRIBE_INSTRUCTIONS } from "../shared/description";

/** Diff text past this many characters is cut; the agent can read the rest from the repo. */
export const MAX_DESCRIBE_DIFF_CHARS = 100_000;

/** The unified diff the prompt carries, truncated to `max` characters with a note. Pure. */
export function diffForDescribe(files: FileDiff[], max = MAX_DESCRIBE_DIFF_CHARS): string {
  const diff = files
    .map((f) => f.raw.trimEnd())
    .filter((raw) => raw !== "")
    .join("\n");
  if (diff.length <= max) return diff;
  return `${diff.slice(0, max)}\n… (diff truncated — read the changed files for the rest)`;
}

/**
 * Build the Generate prompt. The read-only rule, the diff, and the reply
 * format are fixed; `instructions` (what to write — the user can edit it in
 * the Overview pane) sits between them, and defaults to
 * DEFAULT_DESCRIBE_INSTRUCTIONS.
 */
export function buildDescribePrompt(
  diff: string,
  instructions: string = DEFAULT_DESCRIBE_INSTRUCTIONS,
): string {
  return [
    "You are describing a set of local code changes in a strictly read-only capacity.",
    "Do not modify any files or run any mutating commands. You may Read or Grep the",
    "repository for context.",
    "",
    instructions.trim(),
    "",
    "<diff>",
    diff,
    "</diff>",
    "",
    "Reply with the description only, wrapped in <description> and </description>",
    "tags, with nothing before or after it.",
  ].join("\n");
}

/**
 * The description from an agent reply: the text inside the last
 * `<description>` tags, or the whole reply when the tags are missing, with a
 * wrapping ```markdown fence removed. null when nothing is left. Pure.
 */
export function extractDescription(reply: string): string | null {
  const tagged = [...reply.matchAll(/<description>([\s\S]*?)<\/description>/g)].at(-1);
  let text = (tagged ? tagged[1]! : reply).trim();
  const fenced = /^```(?:markdown|md)?\n([\s\S]*?)\n```$/.exec(text);
  if (fenced) text = fenced[1]!.trim();
  return text === "" ? null : text;
}
