import DOMPurify from "dompurify";
import type { Config as DOMPurifyConfig } from "dompurify";
import type { MermaidConfig } from "mermaid";

/**
 * Mermaid diagrams inside rendered Markdown. A ```mermaid fence reaches the
 * DOM as `<pre><code class="language-mermaid">` (see `markdownToHtml`); the
 * Markdown component swaps such blocks for the SVG mermaid renders from them.
 *
 * The pure helpers here decide *which* blocks are diagrams, how the diagram is
 * themed, and how its SVG is sanitized; `renderMermaid` does the DOM work
 * behind a cache so a transcript re-render never redraws a diagram.
 */

export type MermaidTheme = "default" | "dark";

/** Mermaid ships its own palettes; pick the one matching the page's scheme. */
export function mermaidTheme(dark: boolean): MermaidTheme {
  return dark ? "dark" : "default";
}

/** The media query the stylesheet keys its dark palette on. */
export const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

/**
 * True for a `<code>` class list marking a mermaid fence. `marked` emits
 * `language-<lang>` with the fence's info string; the comparison is exact so
 * `language-mermaidjs` or `language-mermaid-notes` stay ordinary code.
 */
export function isMermaidCodeClass(className: string | null | undefined): boolean {
  if (!className) return false;
  return className.split(/\s+/).includes("language-mermaid");
}

/**
 * `marked` closes a fence's content with a newline, and `<pre>` shows it as
 * a trailing blank line; mermaid does not care, but the cache key should not
 * treat "same diagram, one more newline" as a different diagram.
 */
export function mermaidSource(codeText: string): string {
  return codeText.replace(/\n+$/, "");
}

/** Cache key: the same source renders differently per theme, never otherwise. */
export function mermaidCacheKey(theme: MermaidTheme, source: string): string {
  return `${theme}\n${source}`;
}

/**
 * Mermaid's own settings. `strict` makes mermaid escape label text itself;
 * `htmlLabels: false` keeps labels as SVG `<text>` — HTML labels would sit in
 * a `<foreignObject>`, which the SVG sanitizer profile below drops, and whose
 * `<p>`/`<span>` children would pick up `.markdown-body` margins anyway.
 * `suppressErrorRendering` stops mermaid from drawing its bomb-icon error
 * SVG into `document.body` on a parse failure (the Markdown component shows
 * the failing block's source plus a note instead).
 */
export function mermaidConfig(theme: MermaidTheme): MermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme,
    htmlLabels: false,
    suppressErrorRendering: true,
    flowchart: { htmlLabels: false },
  };
}

/**
 * Sanitizer profile for the rendered SVG. Mermaid already escapes labels in
 * strict mode, but its output is still markup produced from untrusted text,
 * so it goes through DOMPurify like the surrounding Markdown. The SVG
 * profiles keep everything a diagram needs — `<style>`, `<marker>` arrowheads,
 * gradients, filters — and drop `<script>`, `<foreignObject>` and event
 * handlers; `class`/`style` carry mermaid's theming, so they are kept.
 */
export const MERMAID_SVG_SANITIZE: DOMPurifyConfig = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_ATTR: ["class", "style"],
};

export function sanitizeMermaidSvg(svg: string): string {
  return DOMPurify.sanitize(svg, MERMAID_SVG_SANITIZE);
}

/**
 * The one line worth showing under a failed block. Mermaid's parse errors
 * run several lines ("Parse error on line 2:\n<source>\n----^\nExpecting …");
 * the first line names the problem, the rest is the caret diagram.
 */
export function mermaidErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const line =
    raw
      .split("\n")
      .find((l) => l.trim() !== "")
      ?.trim() ?? "render failed";
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}

export type MermaidRender = { ok: true; svg: string } | { ok: false; error: string };

type MermaidModule = typeof import("mermaid").default;

const cache = new Map<string, Promise<MermaidRender>>();
let mermaidModule: Promise<MermaidModule> | null = null;
let initializedTheme: MermaidTheme | null = null;
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;

/**
 * The mermaid bundle is large, so it loads on the first diagram only;
 * `import()` makes the bundler split it into its own chunk.
 */
function loadMermaid(): Promise<MermaidModule> {
  mermaidModule ??= import("mermaid").then((m) => m.default);
  return mermaidModule;
}

/**
 * Render one diagram to sanitized SVG, memoized per (theme, source) so a
 * re-render of the surrounding component (a new chat chunk elsewhere, a
 * scroll) reuses the SVG instead of redrawing and flickering. Failures are
 * cached too: the same source fails the same way every time.
 *
 * Renders are serialized because `initialize` is global state — a theme
 * switch must not re-initialize mermaid under a render already in flight.
 */
export function renderMermaid(theme: MermaidTheme, source: string): Promise<MermaidRender> {
  const key = mermaidCacheKey(theme, source);
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = queue.then(() => renderUncached(theme, source));
  queue = pending.catch(() => undefined);
  cache.set(key, pending);
  return pending;
}

async function renderUncached(theme: MermaidTheme, source: string): Promise<MermaidRender> {
  const id = `prv-mermaid-${nextId++}`;
  try {
    const mermaid = await loadMermaid();
    if (initializedTheme !== theme) {
      mermaid.initialize(mermaidConfig(theme));
      initializedTheme = theme;
    }
    const { svg } = await mermaid.render(id, source);
    return { ok: true, svg: sanitizeMermaidSvg(svg) };
  } catch (err) {
    return { ok: false, error: mermaidErrorMessage(err) };
  } finally {
    // Mermaid measures text in a scratch `<div id="d<id>">` under <body> and
    // removes it itself on success; make sure nothing survives a failure.
    document.getElementById(`d${id}`)?.remove();
    document.getElementById(id)?.remove();
  }
}
