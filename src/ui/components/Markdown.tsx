import { useEffect, useMemo, useRef, useSyncExternalStore, type MouseEvent } from "react";
import DOMPurify from "dompurify";
import { markdownToHtml } from "../markdown";
import {
  DARK_SCHEME_QUERY,
  isMermaidCodeClass,
  mermaidSource,
  mermaidTheme,
  renderMermaid,
  type MermaidTheme,
} from "../mermaid";

/**
 * Render Markdown to sanitized HTML. Sanitization guards against scripts and
 * event handlers reaching the DOM — the source can be file content, an agent
 * reply, or a review finding, none of which are trusted markup.
 *
 * ```mermaid fences become diagrams once the HTML is in the DOM (see
 * `renderMermaidBlocks`). `live` marks a block still streaming in: an open
 * fence would fail to render on every chunk, so diagrams wait until the
 * message is complete and the code block shows as text meanwhile.
 *
 * `className` is appended to `markdown-body`; pass a modifier when the block
 * needs tighter spacing than the standalone file view (see `.chat-markdown`).
 */
export function Markdown({
  source,
  className,
  live = false,
}: {
  source: string;
  className?: string;
  live?: boolean;
}) {
  const html = useMemo(() => DOMPurify.sanitize(markdownToHtml(source)), [source]);
  const root = useRef<HTMLDivElement>(null);
  const theme = mermaidTheme(usePrefersDark());

  // React only rewrites `innerHTML` when `html` changes, so the diagrams this
  // effect swaps in survive unrelated re-renders; a new `html` (or theme)
  // starts over from the fresh code blocks.
  useEffect(() => {
    if (live || !root.current) return;
    let cancelled = false;
    void renderMermaidBlocks(root.current, theme, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [html, live, theme]);

  return (
    <div
      ref={root}
      className={className === undefined ? "markdown-body" : `markdown-body ${className}`}
      onClick={onDiagramToggle}
      // Sanitized via DOMPurify in the useMemo above before injection.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** The dark-scheme flag the stylesheet keys on; diagrams follow the same query. */
function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(DARK_SCHEME_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(DARK_SCHEME_QUERY).matches,
    () => false,
  );
}

/**
 * Replace every mermaid code block under `root` with its diagram. Each block
 * is wrapped in `.mermaid-diagram` holding the SVG, the original `<pre>` (so
 * the source stays readable and copyable behind a toggle) and a footer with
 * the toggle or, when rendering failed, a muted note under the still-visible
 * code. The wrapper is idempotent: a theme change re-renders in place.
 */
async function renderMermaidBlocks(
  root: HTMLElement,
  theme: MermaidTheme,
  cancelled: () => boolean,
): Promise<void> {
  const blocks = [...root.querySelectorAll("pre > code")].filter((code) =>
    isMermaidCodeClass(code.getAttribute("class")),
  );
  await Promise.all(
    blocks.map(async (code) => {
      const pre = code.parentElement as HTMLPreElement;
      const wrapper = wrapDiagram(pre);
      if (wrapper.dataset.theme === theme) return;
      const result = await renderMermaid(theme, mermaidSource(code.textContent ?? ""));
      if (cancelled() || !wrapper.isConnected) return;
      wrapper.dataset.theme = theme;
      const holder = wrapper.querySelector(".mermaid-diagram-svg") as HTMLElement;
      const footer = wrapper.querySelector(".mermaid-diagram-bar") as HTMLElement;
      holder.replaceChildren();
      footer.replaceChildren();
      if (result.ok) {
        holder.innerHTML = result.svg; // sanitized by renderMermaid
        keepNaturalWidth(holder);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "mermaid-diagram-toggle";
        toggle.textContent = wrapper.classList.contains("is-source") ? "Diagram" : "Source";
        footer.append(toggle);
        wrapper.dataset.state = "ok";
      } else {
        const note = document.createElement("span");
        note.className = "mermaid-diagram-error";
        note.textContent = `mermaid: ${result.error}`;
        footer.append(note);
        wrapper.dataset.state = "error";
      }
    }),
  );
}

/** Wrap a `<pre>` in the diagram shell (once); returns the existing shell on re-runs. */
function wrapDiagram(pre: HTMLPreElement): HTMLElement {
  const existing = pre.parentElement;
  if (existing?.classList.contains("mermaid-diagram")) return existing;
  const wrapper = document.createElement("div");
  wrapper.className = "mermaid-diagram";
  wrapper.dataset.state = "pending";
  const holder = document.createElement("div");
  holder.className = "mermaid-diagram-svg";
  const footer = document.createElement("div");
  footer.className = "mermaid-diagram-bar";
  pre.replaceWith(wrapper);
  wrapper.append(holder, pre, footer);
  return wrapper;
}

/**
 * Mermaid sizes its SVG to `width: 100%` capped at the drawn width, which
 * shrinks a wide diagram (and its labels) to whatever the chat bubble allows.
 * Pin the drawn width instead so the holder scrolls sideways and the text
 * stays legible.
 */
function keepNaturalWidth(holder: HTMLElement): void {
  const svg = holder.querySelector("svg");
  if (!svg) return;
  const drawn = svg.style.maxWidth;
  if (drawn) {
    svg.style.width = drawn;
    svg.style.maxWidth = "none";
  }
}

/** Delegated click handler: the Source/Diagram toggle lives in injected HTML. */
function onDiagramToggle(e: MouseEvent<HTMLDivElement>): void {
  const target = e.target as Element;
  const toggle = target.closest(".mermaid-diagram-toggle");
  if (!toggle || !e.currentTarget.contains(toggle)) return;
  const wrapper = toggle.closest(".mermaid-diagram");
  if (!wrapper) return;
  const showingSource = wrapper.classList.toggle("is-source");
  toggle.textContent = showingSource ? "Diagram" : "Source";
}
