import { test, expect } from "bun:test";
import {
  MERMAID_SVG_SANITIZE,
  isMermaidCodeClass,
  mermaidCacheKey,
  mermaidConfig,
  mermaidErrorMessage,
  mermaidSource,
  mermaidTheme,
} from "./mermaid";
import { markdownToHtml } from "./markdown";

test("mermaidTheme: follows the page's colour scheme", () => {
  expect(mermaidTheme(false)).toBe("default");
  expect(mermaidTheme(true)).toBe("dark");
});

test("isMermaidCodeClass: only the exact language-mermaid token", () => {
  expect(isMermaidCodeClass("language-mermaid")).toBe(true);
  expect(isMermaidCodeClass("hljs language-mermaid")).toBe(true);
  expect(isMermaidCodeClass("language-mermaidjs")).toBe(false);
  expect(isMermaidCodeClass("language-ts")).toBe(false);
  expect(isMermaidCodeClass("")).toBe(false);
  expect(isMermaidCodeClass(null)).toBe(false);
  expect(isMermaidCodeClass(undefined)).toBe(false);
});

// What `marked` emits for a ```mermaid fence is what the component looks for.
test("markdownToHtml: a mermaid fence becomes pre > code.language-mermaid", () => {
  const html = markdownToHtml("```mermaid\ngraph TD\n  A --> B\n```");
  expect(html).toMatch(/<pre><code class="language-mermaid">/);
  expect(html).toContain("A --&gt; B");
});

test("mermaidSource: drops the trailing newline marked adds, keeps inner ones", () => {
  expect(mermaidSource("graph TD\n  A --> B\n")).toBe("graph TD\n  A --> B");
  expect(mermaidSource("graph TD\n\n")).toBe("graph TD");
  expect(mermaidSource("graph TD")).toBe("graph TD");
});

test("mermaidCacheKey: distinct per theme and per source", () => {
  const a = mermaidCacheKey("default", "graph TD");
  expect(mermaidCacheKey("default", "graph TD")).toBe(a);
  expect(mermaidCacheKey("dark", "graph TD")).not.toBe(a);
  expect(mermaidCacheKey("default", "graph LR")).not.toBe(a);
});

test("mermaidConfig: strict, manual start, themed, no HTML labels, no error SVG", () => {
  const c = mermaidConfig("dark");
  expect(c.startOnLoad).toBe(false);
  expect(c.securityLevel).toBe("strict");
  expect(c.theme).toBe("dark");
  expect(c.htmlLabels).toBe(false);
  expect(c.suppressErrorRendering).toBe(true);
  expect(mermaidConfig("default").theme).toBe("default");
});

test("MERMAID_SVG_SANITIZE: SVG profiles only, keeping class and style", () => {
  expect(MERMAID_SVG_SANITIZE.USE_PROFILES).toEqual({ svg: true, svgFilters: true });
  expect(MERMAID_SVG_SANITIZE.ADD_ATTR).toContain("class");
  expect(MERMAID_SVG_SANITIZE.ADD_ATTR).toContain("style");
  expect(MERMAID_SVG_SANITIZE.ADD_TAGS ?? []).not.toContain("script");
});

test("mermaidErrorMessage: first line of a mermaid parse error, trimmed", () => {
  const err = new Error(
    "Parse error on line 2:\ngraph TD  A -> B\n----------^\nExpecting 'SEMI', got 'MINUS'",
  );
  expect(mermaidErrorMessage(err)).toBe("Parse error on line 2:");
  expect(mermaidErrorMessage("boom")).toBe("boom");
  expect(mermaidErrorMessage(new Error("\n  spaced  \n"))).toBe("spaced");
  expect(mermaidErrorMessage(new Error(""))).toBe("render failed");
});

test("mermaidErrorMessage: caps a runaway message", () => {
  const msg = mermaidErrorMessage(new Error("x".repeat(500)));
  expect(msg.length).toBe(200);
  expect(msg.endsWith("…")).toBe(true);
});
