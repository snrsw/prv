import { test, expect } from "bun:test";
import hljs from "highlight.js";
import { splitHighlightedLines } from "./highlightLines";
import { splitLines } from "./hunkExpand";

test("plain lines split on newlines", () => {
  expect(splitHighlightedLines("a\nb")).toEqual(["a", "b"]);
});

test("a span crossing a line break is closed and reopened", () => {
  expect(splitHighlightedLines('x <span class="c">/* a\nb */</span> y')).toEqual([
    'x <span class="c">/* a</span>',
    '<span class="c">b */</span> y',
  ]);
});

test("nested spans reopen in order", () => {
  expect(splitHighlightedLines('<span class="a"><span class="b">1\n2</span>3</span>')).toEqual([
    '<span class="a"><span class="b">1</span></span>',
    '<span class="a"><span class="b">2</span>3</span>',
  ]);
});

test("line count matches splitLines, trailing newline included", () => {
  for (const text of ["", "\n", "a\n", "a\n\n", "a\nb", "/* x\ny */\n"]) {
    const html = hljs.highlight(text, { language: "typescript" }).value;
    expect(splitHighlightedLines(html)).toHaveLength(splitLines(text).length);
  }
});

test("escaped text stays escaped", () => {
  expect(splitHighlightedLines("a &lt; b\n&amp;")).toEqual(["a &lt; b", "&amp;"]);
});
