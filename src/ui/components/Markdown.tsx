import { useMemo } from "react";
import DOMPurify from "dompurify";
import { markdownToHtml } from "../markdown";

/**
 * Render Markdown to sanitized HTML. Sanitization guards against scripts and
 * event handlers reaching the DOM — the source can be file content, an agent
 * reply, or a review finding, none of which are trusted markup.
 *
 * `className` is appended to `markdown-body`; pass a modifier when the block
 * needs tighter spacing than the standalone file view (see `.chat-markdown`).
 */
export function Markdown({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(markdownToHtml(source)), [source]);
  return (
    <div
      className={className === undefined ? "markdown-body" : `markdown-body ${className}`}
      // Sanitized via DOMPurify in the useMemo above before injection.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
