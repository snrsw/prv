import { test, expect, describe } from "bun:test";
import { fileLevelContext, isFileLevelComment, splitFindingBody } from "./reviewComments";
import type { Comment } from "../shared/comments";
import type { ChatMessage } from "./useDiffChat";

const anchored: Comment = {
  id: "r:run:correctness:0",
  file: "a.ts",
  start: { old: null, new: 2 },
  end: { old: null, new: 2 },
  anchorText: ["+x"],
  status: "open",
  messages: [],
};

describe("isFileLevelComment", () => {
  test("all-null endpoints mark a file-level finding", () => {
    const fileLevel = {
      ...anchored,
      start: { old: null, new: null },
      end: { old: null, new: null },
      anchorText: [],
    };
    expect(isFileLevelComment(fileLevel)).toBe(true);
    expect(isFileLevelComment(anchored)).toBe(false);
  });
});

describe("splitFindingBody", () => {
  test("splits a leading assistant message from the conversation", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", text: "**T**\n\nB" },
      { role: "user", text: "why?" },
    ];
    expect(splitFindingBody(messages)).toEqual({
      body: "**T**\n\nB",
      rest: [{ role: "user", text: "why?" }],
    });
  });

  test("leaves user-first transcripts (hand-made comments) untouched", () => {
    const messages: ChatMessage[] = [{ role: "user", text: "hm" }];
    expect(splitFindingBody(messages)).toEqual({ body: null, rest: messages });
    expect(splitFindingBody([])).toEqual({ body: null, rest: [] });
  });
});

describe("fileLevelContext", () => {
  test("names the file and its whole-file scope", () => {
    expect(fileLevelContext("src/a.ts")).toBe(
      "File: src/a.ts\nThis comment applies to the whole file.",
    );
  });
});
