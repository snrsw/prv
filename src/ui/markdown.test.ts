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

// Shapes an agent reply commonly uses in the chat panel.
test("markdownToHtml: renders fenced code with the language class", () => {
  const html = markdownToHtml("```ts\nconst a = 1;\n```");
  expect(html).toContain("<pre>");
  expect(html).toContain("language-ts");
  expect(html).toContain("const a = 1;");
});

test("markdownToHtml: renders a table", () => {
  const html = markdownToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |");
  expect(html).toContain("<table>");
  expect(html).toContain("<th>a</th>");
  expect(html).toContain("<td>2</td>");
});

test("markdownToHtml: escapes HTML in an inline code span", () => {
  expect(markdownToHtml("use `<script>` here")).toContain("<code>&lt;script&gt;</code>");
});
