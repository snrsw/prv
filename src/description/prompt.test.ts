import { test, expect, describe } from "bun:test";
import type { FileDiff } from "../diff/types";
import {
  MAX_DESCRIBE_INSTRUCTIONS_CHARS,
  sanitizeDescribeInstructions,
} from "../shared/description";
import { buildDescribePrompt, diffForDescribe, extractDescription } from "./prompt";

const file = (path: string, raw: string): FileDiff => ({
  path,
  status: "modified",
  hunks: [],
  binary: false,
  raw,
});

describe("diffForDescribe", () => {
  test("joins each file's raw diff, skipping empty ones", () => {
    const files = [file("a.ts", "diff --git a/a.ts\n+a\n"), file("b.png", ""), file("c.ts", "+c")];
    expect(diffForDescribe(files)).toBe("diff --git a/a.ts\n+a\n+c");
  });

  test("truncates a long diff with a note", () => {
    const out = diffForDescribe([file("a.ts", "x".repeat(50))], 10);
    expect(out.startsWith("xxxxxxxxxx\n")).toBe(true);
    expect(out).toContain("diff truncated");
  });
});

test("the prompt is read-only, asks for the PR-body sections, and carries the diff", () => {
  const prompt = buildDescribePrompt("+added line");
  expect(prompt).toContain("strictly read-only");
  for (const section of [
    "Aim",
    "What changes",
    "Behavior",
    "Review guide",
    "Data flow",
    "Dependencies",
  ]) {
    expect(prompt).toContain(`## ${section}`);
  }
  expect(prompt).toContain("Use diagrams actively");
  expect(prompt).toContain("sequenceDiagram");
  expect(prompt).toContain("<diff>\n+added line\n</diff>");
  expect(prompt).toContain("<description>");
});

test("custom instructions replace the default sections but keep the fixed frame", () => {
  const prompt = buildDescribePrompt("+x", "  Write a haiku about the change.  ");
  expect(prompt).toContain("Write a haiku about the change.");
  expect(prompt).not.toContain("## Review guide");
  expect(prompt).toContain("Do not modify any files");
  expect(prompt).toContain("<diff>\n+x\n</diff>");
  expect(prompt).toContain("<description>");
});

describe("sanitizeDescribeInstructions", () => {
  test("keeps a trimmed non-blank string", () => {
    expect(sanitizeDescribeInstructions("  be brief ")).toBe("be brief");
  });

  test("drops blanks, non-strings and over-long text", () => {
    expect(sanitizeDescribeInstructions("   ")).toBeUndefined();
    expect(sanitizeDescribeInstructions(42)).toBeUndefined();
    expect(sanitizeDescribeInstructions(undefined)).toBeUndefined();
    expect(
      sanitizeDescribeInstructions("x".repeat(MAX_DESCRIBE_INSTRUCTIONS_CHARS + 1)),
    ).toBeUndefined();
  });
});

describe("extractDescription", () => {
  test("takes the text inside the last description tags", () => {
    const reply =
      "Looking…\n<description>draft</description>\n<description>\n## Summary\nfinal\n</description>";
    expect(extractDescription(reply)).toBe("## Summary\nfinal");
  });

  test("falls back to the whole reply without tags", () => {
    expect(extractDescription("  ## Summary\nX  \n")).toBe("## Summary\nX");
  });

  test("unwraps a markdown fence around the description", () => {
    expect(extractDescription("<description>```markdown\n## Summary\nX\n```</description>")).toBe(
      "## Summary\nX",
    );
    expect(extractDescription("```\n## Summary\n```")).toBe("## Summary");
  });

  test("keeps fenced code blocks inside the description", () => {
    const body = "## How to verify\n```sh\nbun test\n```";
    expect(extractDescription(`<description>${body}</description>`)).toBe(body);
  });

  test("an empty reply is null", () => {
    expect(extractDescription("<description>  </description>")).toBeNull();
    expect(extractDescription("")).toBeNull();
  });
});
