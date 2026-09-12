import { test, expect, describe } from "bun:test";
import { extractBatchResults, parseBatchResults } from "./results";

const IDS = ["c:1_1:1_1", "c:_9:_9"];
const entry = (over: Record<string, unknown> = {}) => ({
  id: IDS[0],
  file: "a.ts",
  reply: "renamed it",
  done: true,
  ...over,
});
const fenced = (payload: unknown): string =>
  `Edited two files.\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;

describe("parseBatchResults", () => {
  test("returns null unless the root has a results array", () => {
    expect(parseBatchResults("not json", IDS)).toBeNull();
    expect(parseBatchResults("[]", IDS)).toBeNull();
    expect(parseBatchResults('{"findings": []}', IDS)).toBeNull();
    expect(parseBatchResults('{"results": {}}', IDS)).toBeNull();
  });

  test("an empty results array is a valid parse", () => {
    expect(parseBatchResults('{"results": []}', IDS)).toEqual({ results: [], skipped: [] });
  });

  test("keeps a well-formed entry verbatim", () => {
    const parsed = parseBatchResults(JSON.stringify({ results: [entry()] }), IDS);
    expect(parsed?.results).toEqual([
      { id: IDS[0]!, file: "a.ts", reply: "renamed it", done: true },
    ]);
  });

  test("skips ids that were not in the batch", () => {
    const parsed = parseBatchResults(
      JSON.stringify({ results: [entry({ id: "c:invented" }), entry()] }),
      IDS,
    );
    expect(parsed?.results.map((r) => r.id)).toEqual([IDS[0]!]);
    expect(parsed?.skipped).toEqual(["result 0: unknown id c:invented"]);
  });

  test.each([
    [{ id: 7 }, "result 0: missing id"],
    [{ id: "" }, "result 0: missing id"],
    [{ id: "  " }, "result 0: missing id"],
  ])("skips %p", (over, reason) => {
    const parsed = parseBatchResults(JSON.stringify({ results: [entry(over)] }), IDS);
    expect(parsed).toEqual({ results: [], skipped: [reason as string] });
  });

  test("skips non-object entries", () => {
    const parsed = parseBatchResults(JSON.stringify({ results: ["junk", null] }), IDS);
    expect(parsed?.skipped).toEqual(["result 0: not an object", "result 1: not an object"]);
  });

  test("missing file and reply default to empty strings", () => {
    const parsed = parseBatchResults(
      JSON.stringify({ results: [{ id: IDS[0], done: true }] }),
      IDS,
    );
    expect(parsed?.results[0]).toEqual({ id: IDS[0]!, file: "", reply: "", done: true });
  });

  test.each([
    [true, true],
    ["true", true],
    [false, false],
    ["yes", false],
    [1, false],
    [undefined, false],
  ])("coerces done %p to %p", (raw, expected) => {
    const parsed = parseBatchResults(JSON.stringify({ results: [entry({ done: raw })] }), IDS);
    expect(parsed?.results[0]?.done).toBe(expected as boolean);
  });

  test("the first entry per id wins", () => {
    const parsed = parseBatchResults(
      JSON.stringify({ results: [entry({ reply: "first" }), entry({ reply: "second" })] }),
      IDS,
    );
    expect(parsed?.results).toHaveLength(1);
    expect(parsed?.results[0]?.reply).toBe("first");
    expect(parsed?.skipped).toEqual([`result 1: duplicate id ${IDS[0]}`]);
  });

  test("the same id on two files is two results, not a duplicate", () => {
    const parsed = parseBatchResults(
      JSON.stringify({
        results: [entry({ file: "a.ts", reply: "a" }), entry({ file: "b.ts", reply: "b" })],
      }),
      IDS,
    );
    expect(parsed?.results.map((r) => r.file)).toEqual(["a.ts", "b.ts"]);
    expect(parsed?.skipped).toEqual([]);
  });
});

describe("extractBatchResults", () => {
  test("reads the fenced block out of surrounding prose", () => {
    const parsed = extractBatchResults(fenced({ results: [entry()] }), IDS);
    expect(parsed?.results.map((r) => r.id)).toEqual([IDS[0]!]);
  });

  test("the last fenced block wins", () => {
    const reply = `${fenced({ results: [entry({ reply: "old" })] })}\n${fenced({
      results: [entry({ reply: "new" })],
    })}`;
    expect(extractBatchResults(reply, IDS)?.results[0]?.reply).toBe("new");
  });

  test("falls back to the outermost brace slice when the fence is missing", () => {
    const reply = `Done.\n${JSON.stringify({ results: [entry()] })}`;
    expect(extractBatchResults(reply, IDS)?.results).toHaveLength(1);
  });

  test("a nested fence inside a reply is rescued by the brace fallback", () => {
    // The lazy fence regex truncates at the inner ``` — the brace slice still
    // spans the full object.
    const reply = `\`\`\`json\n${JSON.stringify({
      results: [entry({ reply: "ran:\n```\nbun test\n```\nall green" })],
    })}\n\`\`\``;
    expect(extractBatchResults(reply, IDS)?.results[0]?.reply).toContain("bun test");
  });

  test("no usable block at all is null (the caller retries)", () => {
    expect(extractBatchResults("I edited the files.", IDS)).toBeNull();
    expect(extractBatchResults("", IDS)).toBeNull();
    expect(extractBatchResults("```json\n{}\n```", IDS)).toBeNull();
  });
});
