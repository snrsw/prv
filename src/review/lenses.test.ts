import { test, expect, describe } from "bun:test";
import { buildReviewPrompt, LENSES, RETRY_PROMPT } from "./lenses";
import { MAX_FINDINGS_PER_LENS } from "./findings";

describe("LENSES", () => {
  test("defines the three panel lenses", () => {
    expect(LENSES.map((l) => l.id)).toEqual(["correctness", "silent-failures", "test-coverage"]);
  });
});

describe("buildReviewPrompt", () => {
  const diff = "### a.ts (modified)\n1\t1\t import x;";

  for (const lens of LENSES) {
    test(`${lens.id} prompt carries the contract, the diff, and its focus`, () => {
      const prompt = buildReviewPrompt(lens, diff);
      expect(prompt).toContain("strictly read-only");
      expect(prompt).toContain(`Your single review lens: ${lens.label}.`);
      expect(prompt).toContain(lens.focus);
      expect(prompt).toContain(diff);
      expect(prompt).toContain(`Report at most ${MAX_FINDINGS_PER_LENS} findings.`);
      expect(prompt).toContain("files not in the diff will be discarded");
      expect(prompt).toContain('"findings"');
      expect(prompt).toContain("```json");
    });
  }
});

describe("RETRY_PROMPT", () => {
  test("demands only the fenced findings block", () => {
    expect(RETRY_PROMPT).toContain("ONLY");
    expect(RETRY_PROMPT).toContain('{"findings": [...]}');
  });
});
