import { marked } from "marked";

const MARKDOWN_EXTS = new Set(["md", "mdx"]);

/** True for files prv should be able to render as Markdown (.md / .mdx). */
export function isMarkdownPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return MARKDOWN_EXTS.has(path.slice(dot + 1).toLowerCase());
}

/**
 * Render Markdown source to an HTML string. The output is NOT sanitized — callers
 * that inject it into the DOM must sanitize first (see `sanitizeHtml` usage in the
 * file view). GitHub-flavored breaks are enabled to match how plans are usually written.
 */
export function markdownToHtml(source: string): string {
  return marked.parse(source, { async: false, gfm: true, breaks: true }) as string;
}
