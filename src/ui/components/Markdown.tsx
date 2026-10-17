import { useEffect, useMemo, useRef } from "react";
import DOMPurify from "dompurify";
import { markdownToHtml } from "../markdown";
import { renderMermaidBlocks } from "../mermaid";

/**
 * Render Markdown to sanitized HTML. Sanitization guards against scripts and
 * event handlers reaching the DOM — the source can be file content, an agent
 * reply, or a review finding, none of which are trusted markup.
 *
 * `className` is appended to `markdown-body`; pass a modifier when the block
 * needs tighter spacing than the standalone file view (see `.chat-markdown`).
 * `mermaid` turns ```mermaid code blocks into diagrams after the HTML lands;
 * it is opt-in because streaming chat text would re-render them every frame.
 */
export function Markdown({
  source,
  className,
  mermaid = false,
}: {
  source: string;
  className?: string;
  mermaid?: boolean;
}) {
  // One object per html string: React rewrites innerHTML whenever it receives a
  // new `__html` object, which would wipe the diagrams mermaid swapped in.
  const inner = useMemo(() => ({ __html: DOMPurify.sanitize(markdownToHtml(source)) }), [source]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!mermaid || !root) return;
    let current = true;
    void renderMermaidBlocks(root, () => current);
    return () => {
      current = false;
    };
  }, [inner, mermaid]);

  return (
    <div
      ref={ref}
      className={className === undefined ? "markdown-body" : `markdown-body ${className}`}
      // Sanitized via DOMPurify in the useMemo above before injection.
      dangerouslySetInnerHTML={inner}
    />
  );
}
