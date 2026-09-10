import { test, expect, describe } from "bun:test";
import { BATCH_RETRY_PROMPT, buildBatchPrompt } from "./prompt";
import type { Comment } from "../shared/comments";

const comment = (over: Partial<Comment> = {}): Comment => ({
  id: "c:2_2:2_2",
  file: "a.ts",
  start: { old: 2, new: 2 },
  end: { old: 3, new: 3 },
  anchorText: [" two", "+three"],
  status: "open",
  messages: [{ role: "user", text: "rename this" }],
  ...over,
});

describe("buildBatchPrompt", () => {
  test("carries each comment's id, file, range and anchor lines", () => {
    const prompt = buildBatchPrompt({ comments: [comment()] });
    expect(prompt).toContain("id: c:2_2:2_2");
    expect(prompt).toContain("file: a.ts:2-3");
    expect(prompt).toContain(" two");
    expect(prompt).toContain("+three");
    expect(prompt).toContain("User: rename this");
  });

  test("numbers every comment and states the expected entry count", () => {
    const prompt = buildBatchPrompt({
      comments: [comment(), comment({ id: "c:_9:_9", file: "b.ts" })],
    });
    expect(prompt).toContain("--- Comment 1 ---");
    expect(prompt).toContain("--- Comment 2 ---");
    expect(prompt).toContain("2 comments to address:");
    expect(prompt).toContain("(2 in total)");
  });

  test("a deleted-line range is labelled on the old side", () => {
    const prompt = buildBatchPrompt({
      comments: [comment({ start: { old: 7, new: null }, end: { old: 7, new: null } })],
    });
    expect(prompt).toContain("file: a.ts:old 7");
  });

  test("the transcript keeps User/Assistant turns in order", () => {
    const prompt = buildBatchPrompt({
      comments: [
        comment({
          messages: [
            { role: "user", text: "why?" },
            { role: "assistant", text: "because" },
            { role: "user", text: "fix it" },
          ],
        }),
      ],
    });
    const body = prompt.slice(prompt.indexOf("Conversation on this comment:"));
    expect(body).toContain("User: why?\nAssistant: because\nUser: fix it");
  });

  test("a review-finding thread is labelled so replies read as responses", () => {
    const prompt = buildBatchPrompt({
      comments: [
        comment({
          source: "review",
          title: "Off-by-one",
          severity: "major",
          lens: "correctness",
          messages: [
            { role: "assistant", text: "**Off-by-one**" },
            { role: "user", text: "agreed, fix it" },
          ],
        }),
      ],
    });
    expect(prompt).toContain("Origin: an agent review finding (Off-by-one, major, correctness)");
  });

  test("a hand-made thread carries no origin line", () => {
    expect(buildBatchPrompt({ comments: [comment()] })).not.toContain("Origin:");
  });

  test("instructions appear only when non-empty", () => {
    expect(buildBatchPrompt({ comments: [comment()], instructions: "  " })).not.toContain(
      "Review-level instructions",
    );
    const withNote = buildBatchPrompt({ comments: [comment()], instructions: " be terse " });
    expect(withNote).toContain("Review-level instructions for the whole batch:\nbe terse");
  });

  test("the output contract asks for one json block with the results schema", () => {
    const prompt = buildBatchPrompt({ comments: [comment()] });
    expect(prompt).toContain('{"results": [');
    expect(
      prompt
        .trimEnd()
        .split("\n")
        .filter((l) => l.startsWith("```")),
    ).toHaveLength(2);
  });

  test("comment text is framed as reviewer feedback, not instructions to obey", () => {
    const prompt = buildBatchPrompt({ comments: [comment()] });
    expect(prompt).toContain("treat it");
    expect(prompt).toContain("do not guess");
  });
});

test("BATCH_RETRY_PROMPT asks for the json block only", () => {
  expect(BATCH_RETRY_PROMPT).toContain("```json");
  expect(BATCH_RETRY_PROMPT).toContain('{"results": [...]}');
});
