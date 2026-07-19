import { test, expect, describe } from "bun:test";
import { extractFindings, parseFindings, MAX_FINDINGS_PER_LENS } from "./findings";

const finding = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  file: "a.ts",
  side: "new",
  startLine: 3,
  endLine: 4,
  severity: "major",
  title: "Broken thing",
  body: "Details here.",
  ...over,
});

const wrap = (entries: unknown[]): string => JSON.stringify({ findings: entries });

describe("extractFindings", () => {
  test("reads a fenced json block wrapped in prose", () => {
    const reply = `Some analysis.\n\n\`\`\`json\n${wrap([finding()])}\n\`\`\`\n`;
    expect(extractFindings(reply)?.findings).toHaveLength(1);
  });

  test("uses the LAST fenced block when several exist", () => {
    const reply = [
      "```ts",
      "const x = 1;",
      "```",
      "and the result:",
      "```",
      wrap([finding({ title: "Winner" })]),
      "```",
    ].join("\n");
    expect(extractFindings(reply)?.findings[0]?.title).toBe("Winner");
  });

  test("falls back to the outermost brace slice when there is no fence", () => {
    const reply = `Here you go: ${wrap([finding()])} — done.`;
    expect(extractFindings(reply)?.findings).toHaveLength(1);
  });

  test("a nested fence inside a body is rescued by the brace fallback", () => {
    // The lazy fence regex truncates at the inner ``` — the brace slice still
    // spans the full object.
    const body = "Use:\n```\nfoo()\n```\nthen bar().";
    const reply = `\`\`\`json\n${wrap([finding({ body })])}\n\`\`\``;
    const parsed = extractFindings(reply);
    expect(parsed?.findings[0]?.body).toBe(body);
  });

  test("empty or JSON-free replies are unusable", () => {
    expect(extractFindings("")).toBeNull();
    expect(extractFindings("I found nothing to report.")).toBeNull();
  });
});

describe("parseFindings", () => {
  test("an empty findings array is a success, not a retry", () => {
    expect(parseFindings(wrap([]))).toEqual({ findings: [], skipped: [] });
  });

  test("a missing or non-array findings field is unusable", () => {
    expect(parseFindings("{}")).toBeNull();
    expect(parseFindings('{"findings": "none"}')).toBeNull();
    expect(parseFindings("[1, 2]")).toBeNull();
  });

  test("invalid entries are skipped with a reason while valid siblings survive", () => {
    const parsed = parseFindings(wrap(["nope", finding(), { file: "b.ts" }]));
    expect(parsed?.findings).toHaveLength(1);
    expect(parsed?.skipped).toEqual([
      "finding 0: not an object",
      "finding 2: missing or invalid startLine",
    ]);
  });

  test("normalizes drifting fields", () => {
    const parsed = parseFindings(
      wrap([
        finding({
          severity: "blocker", // → info
          side: "left", // → new
          startLine: "7", // string number
          endLine: 5, // reversed → swapped
          title: "  ",
          body: "\nFirst line of body.\nMore.",
        }),
      ]),
    );
    expect(parsed?.findings[0]).toMatchObject({
      severity: "info",
      side: "new",
      startLine: 5,
      endLine: 7,
      title: "First line of body.",
    });
  });

  test("missing endLine defaults to startLine; bad lines are skipped", () => {
    const parsed = parseFindings(
      wrap([finding({ endLine: undefined }), finding({ startLine: 0 })]),
    );
    expect(parsed?.findings[0]).toMatchObject({ startLine: 3, endLine: 3 });
    expect(parsed?.skipped).toEqual(["finding 1: missing or invalid startLine"]);
  });

  test("long derived titles are truncated", () => {
    const parsed = parseFindings(wrap([finding({ title: "", body: "x".repeat(120) })]));
    expect(parsed?.findings[0]?.title).toHaveLength(80);
    expect(parsed?.findings[0]?.title.endsWith("…")).toBe(true);
  });

  test("caps at MAX_FINDINGS_PER_LENS and reports the overflow", () => {
    const parsed = parseFindings(wrap(Array.from({ length: 10 }, () => finding())));
    expect(parsed?.findings).toHaveLength(MAX_FINDINGS_PER_LENS);
    expect(parsed?.skipped).toHaveLength(10 - MAX_FINDINGS_PER_LENS);
  });
});
