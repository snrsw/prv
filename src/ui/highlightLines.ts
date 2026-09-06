/**
 * Pure helpers for showing highlighted code one line per row.
 *
 * highlight.js colours a whole file at once and returns one HTML string whose
 * `<span>`s follow the language's grammar, not the file's lines: a block
 * comment or template string opens on one line and closes several lines
 * later. The File view needs a row per line (so a comment thread can sit
 * between two of them), so that string is cut at each newline and every span
 * still open at the cut is closed there and reopened on the next line.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

/** Plain text as HTML, the way highlight.js escapes it, for lines shown before it runs. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);
}

/**
 * Split highlighter output into per-line HTML, one entry per line of the
 * source text — the same count `splitLines` gives (a trailing newline ends
 * the last line rather than starting an empty one). The output only ever
 * contains the tags highlight.js wrote around its own escaped text, so a
 * plain tag scan is enough: no attribute may contain `>`.
 */
export function splitHighlightedLines(html: string): string[] {
  if (html.length === 0) return [];
  const lines: string[] = [];
  // Tags still unclosed at the current position, outermost first: the tag as
  // written (to reopen it) and its name (to close it).
  const open: { tag: string; name: string }[] = [];
  const closers = () =>
    open
      .map(({ name }) => `</${name}>`)
      .reverse()
      .join("");
  let line = "";
  // Whether anything but tags has been seen since the last newline; a
  // trailing newline followed only by closing tags is not another line.
  let hasText = false;
  let i = 0;
  while (i < html.length) {
    const ch = html[i]!;
    if (ch === "<") {
      const end = html.indexOf(">", i);
      if (end < 0) {
        // Not a tag after all; keep the text as it is.
        line += html.slice(i);
        hasText = true;
        break;
      }
      const tag = html.slice(i, end + 1);
      if (tag.startsWith("</")) open.pop();
      else if (!tag.endsWith("/>"))
        open.push({ tag, name: /^<([^\s>]+)/.exec(tag)?.[1] ?? "span" });
      line += tag;
      i = end + 1;
      continue;
    }
    if (ch === "\n") {
      lines.push(line + closers());
      line = open.map(({ tag }) => tag).join("");
      hasText = false;
      i++;
      continue;
    }
    line += ch;
    hasText = true;
    i++;
  }
  if (hasText) lines.push(line + closers());
  return lines;
}
