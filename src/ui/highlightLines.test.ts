import { describe, expect, test } from "bun:test";
import hljs from "highlight.js";
import { escapeHtml, splitHighlightedLines } from "./highlightLines";
import { splitLines } from "./hunkExpand";

describe("splitHighlightedLines", () => {
  test("plain text splits like splitLines: a trailing newline ends the last line", () => {
    expect(splitHighlightedLines("")).toEqual([]);
    expect(splitHighlightedLines("a")).toEqual(["a"]);
    expect(splitHighlightedLines("a\nb")).toEqual(["a", "b"]);
    expect(splitHighlightedLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitHighlightedLines("a\n\n")).toEqual(["a", ""]);
    expect(splitHighlightedLines("\n")).toEqual([""]);
  });

  test("a span crossing a line boundary is closed and reopened", () => {
    const html = '<span class="hljs-comment">/* one\ntwo */</span> x';
    expect(splitHighlightedLines(html)).toEqual([
      '<span class="hljs-comment">/* one</span>',
      '<span class="hljs-comment">two */</span> x',
    ]);
  });

  test("nested spans are reopened outermost first", () => {
    const html = '<span class="a">1<span class="b">2\n3</span>4\n5</span>';
    expect(splitHighlightedLines(html)).toEqual([
      '<span class="a">1<span class="b">2</span></span>',
      '<span class="a"><span class="b">3</span>4</span>',
      '<span class="a">5</span>',
    ]);
  });

  test("a span left open at the end (unterminated comment) is closed on every line", () => {
    const html = '<span class="hljs-comment">/* open\n';
    expect(splitHighlightedLines(html)).toEqual(['<span class="hljs-comment">/* open</span>']);
    // A closer after the final newline does not add a line.
    expect(splitHighlightedLines('<span class="x">a\n</span>')).toEqual([
      '<span class="x">a</span>',
    ]);
  });

  test("an empty line inside a span is still a line", () => {
    expect(splitHighlightedLines('<span class="x">a\n\nb</span>')).toEqual([
      '<span class="x">a</span>',
      '<span class="x"></span>',
      '<span class="x">b</span>',
    ]);
  });

  test("closers use the open tag's name", () => {
    expect(splitHighlightedLines("<b>a\nb</b>")).toEqual(["<b>a</b>", "<b>b</b>"]);
    expect(splitHighlightedLines("a<br/>\nb")).toEqual(["a<br/>", "b"]);
  });

  test("real highlighter output keeps one entry per source line", () => {
    const text = [
      "/** doc",
      " * comment */",
      "const s = `template",
      "spanning lines ${1 + 1}`;",
      'if (a < b && c > "d") {}',
      "",
    ].join("\n");
    const html = hljs.highlight(text, { language: "typescript" }).value;
    const lines = splitHighlightedLines(html);
    expect(lines).toHaveLength(splitLines(text).length);
    // Every line is balanced on its own and its text survives intact.
    for (const [i, line] of lines.entries()) {
      const opens = (line.match(/<span/g) ?? []).length;
      const closes = (line.match(/<\/span>/g) ?? []).length;
      expect(opens).toBe(closes);
      const textOnly = line
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#x27;/g, "'");
      expect(textOnly).toBe(splitLines(text)[i]!);
    }
  });
});

describe("escapeHtml", () => {
  test("escapes the characters highlight.js escapes", () => {
    expect(escapeHtml(`a < b && c > "d" 'e'`)).toBe(
      "a &lt; b &amp;&amp; c &gt; &quot;d&quot; &#x27;e&#x27;",
    );
    expect(escapeHtml("plain")).toBe("plain");
  });
});
