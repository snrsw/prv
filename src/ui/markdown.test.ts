import { test, expect } from "bun:test";
import { isMarkdownPath, markdownToHtml } from "./markdown";

test("isMarkdownPath: .md and .mdx are markdown (case-insensitive)", () => {
  expect(isMarkdownPath("plan.md")).toBe(true);
  expect(isMarkdownPath("docs/README.md")).toBe(true);
  expect(isMarkdownPath("notes.mdx")).toBe(true);
  expect(isMarkdownPath("CHANGES.MD")).toBe(true);
});

test("isMarkdownPath: non-markdown files are not markdown", () => {
  expect(isMarkdownPath("src/cli.ts")).toBe(false);
  expect(isMarkdownPath("styles.css")).toBe(false);
  expect(isMarkdownPath("Makefile")).toBe(false);
  expect(isMarkdownPath("notes.markdown.bak")).toBe(false);
});

test("markdownToHtml: renders a heading", () => {
  expect(markdownToHtml("# Title")).toContain("<h1");
  expect(markdownToHtml("# Title")).toContain("Title");
});

test("markdownToHtml: renders list items and emphasis", () => {
  const html = markdownToHtml("- one\n- two\n\n**bold**");
  expect(html).toContain("<li>");
  expect(html).toContain("<strong>bold</strong>");
});
