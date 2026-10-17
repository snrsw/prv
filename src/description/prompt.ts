/**
 * Prompt and reply parsing for Generate: one read-only agent turn that drafts
 * a PR-body-like description of the diff on screen.
 */

import type { FileDiff } from "../diff/types";

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

export function buildDescribePrompt(diff: string): string {
  return [
    "You are describing a set of local code changes in a strictly read-only capacity.",
    "Do not modify any files or run any mutating commands.",
    "",
    "Write the description a reviewer would want as a pull request body for the diff",
    "below. You may Read or Grep the repository for context (why the change was made,",
    "what the touched code does). Use these Markdown sections:",
    "",
    "## Summary — one or two sentences: what the change does and why.",
    "## Changes — a bullet list of what changed, grouped by area; name files or",
    "   functions where it helps.",
    "## How to verify — commands to run or steps to check the change works.",
    "",
    "Be concrete and brief. Do not invent motivation the diff and repository do not",
    "support; say what is unclear instead.",
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
