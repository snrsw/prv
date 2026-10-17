/**
 * Split highlight.js output into one HTML string per line, so a file can be
 * highlighted as a whole (multi-line strings and comments keep their colour)
 * yet rendered a line at a time. A `<span>` that crosses a line break is
 * closed at the end of the line and reopened at the start of the next.
 *
 * Lines follow `splitLines`: a trailing newline does not start an extra line.
 */
export function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const open: string[] = [];
  let line = "";
  let hasText = false;
  for (const [token] of html.matchAll(/<[^>]*>|\n|[^<\n]+/g)) {
    if (token === "\n") {
      lines.push(line + "</span>".repeat(open.length));
      line = open.join("");
      hasText = false;
    } else if (token.startsWith("</")) {
      open.pop();
      line += token;
    } else if (token.startsWith("<")) {
      open.push(token);
      line += token;
    } else {
      line += token;
      hasText = true;
    }
  }
  if (hasText) lines.push(line + "</span>".repeat(open.length));
  return lines;
}
