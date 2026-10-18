/**
 * Render ```mermaid code blocks inside an already-sanitized Markdown element
 * as diagrams. mermaid is large, so it is imported only when a block exists.
 * `securityLevel: "strict"` makes mermaid sanitize labels and drop click
 * handlers, and its SVG is sanitized again with DOMPurify's SVG profile before
 * it replaces the code block — the source is agent or file text. Labels are
 * plain SVG text (`htmlLabels: false`), since that profile drops the
 * <foreignObject> HTML labels would need.
 */

import DOMPurify from "dompurify";

type Mermaid = (typeof import("mermaid"))["default"];

let loaded: Promise<Mermaid> | null = null;
let seq = 0;

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

function load(): Promise<Mermaid> {
  loaded ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
      theme: prefersDark() ? "dark" : "default",
    });
    return mermaid;
  });
  return loaded;
}

/** The ```mermaid blocks marked emitted under `root`. */
function mermaidBlocks(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("pre > code.language-mermaid")];
}

/**
 * Replace each mermaid block under `root` with its diagram. A block that fails
 * to parse stays as code with the error below it. Resolves when all are done;
 * `isCurrent` lets the caller drop results for a root it has since re-rendered.
 */
export async function renderMermaidBlocks(
  root: HTMLElement,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const blocks = mermaidBlocks(root);
  if (blocks.length === 0) return;
  const mermaid = await load();
  for (const code of blocks) {
    if (!isCurrent()) return;
    const pre = code.parentElement!;
    const source = code.textContent ?? "";
    try {
      const { svg } = await mermaid.render(`prv-mermaid-${++seq}`, source);
      if (!isCurrent()) return;
      const figure = document.createElement("div");
      figure.className = "mermaid-diagram";
      figure.innerHTML = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });
      pre.replaceWith(figure);
    } catch (err) {
      if (!isCurrent()) return;
      const note = document.createElement("div");
      note.className = "mermaid-error";
      note.textContent = `mermaid: ${err instanceof Error ? err.message : String(err)}`;
      pre.after(note);
    }
  }
}
