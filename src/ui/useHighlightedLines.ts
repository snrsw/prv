import { useEffect, useState } from "react";
import hljs from "highlight.js";
import { splitHighlightedLines } from "./highlightLines";

type IdleWindow = {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  cancelIdleCallback?: (id: number) => void;
};

/**
 * `text` highlighted as `language`, one HTML string per line; null until it is
 * ready, or for a language highlight.js lacks (the caller paints plain text).
 * The whole file is highlighted at once on the next idle frame, so the reader
 * isn't blocked on hljs parsing for large files.
 */
export function useHighlightedLines(text: string, language: string): string[] | null {
  const [highlight, setHighlight] = useState<{ text: string; lines: string[] } | null>(null);
  useEffect(() => {
    if (!hljs.getLanguage(language)) return;
    const run = () => {
      const html = hljs.highlight(text, { language, ignoreIllegals: true }).value;
      setHighlight({ text, lines: splitHighlightedLines(html) });
    };
    const { requestIdleCallback: idle, cancelIdleCallback: cancel } = window as IdleWindow;
    if (idle && cancel) {
      const id = idle(run, { timeout: 200 });
      return () => cancel(id);
    }
    const id = window.setTimeout(run, 0);
    return () => window.clearTimeout(id);
  }, [text, language]);
  return highlight?.text === text ? highlight.lines : null;
}
