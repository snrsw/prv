import { test, expect, describe } from "bun:test";
import {
  DEFAULT_WRITE_INSTRUCTION,
  canSend,
  resolveInstruction,
  resolveWriteInstruction,
  sendButtonLabel,
  sendButtonTitle,
} from "./sendMode";

describe("sendButtonLabel / sendButtonTitle", () => {
  test("read only is plain Send; Write is spelled out", () => {
    expect(sendButtonLabel("ask")).toBe("Send");
    expect(sendButtonLabel("apply")).toBe("Send · Write");
    expect(sendButtonTitle("ask")).toContain("read only");
    expect(sendButtonTitle("apply")).toContain("edit files");
  });
});

describe("canSend", () => {
  test("read only needs a non-blank question", () => {
    expect(canSend("ask", "")).toBe(false);
    expect(canSend("ask", "   \n")).toBe(false);
    expect(canSend("ask", "why?")).toBe(true);
  });

  test("Write may go with an empty box", () => {
    expect(canSend("apply", "")).toBe(true);
    expect(canSend("apply", "rename it")).toBe(true);
  });
});

describe("resolveWriteInstruction", () => {
  const thread = [
    { role: "user", text: "Should this be a Map?" },
    { role: "assistant", text: "Yes, a Map avoids the linear scan." },
  ];

  test("typed text wins, trimmed", () => {
    expect(resolveWriteInstruction("  do it with a Map ", thread)).toBe("do it with a Map");
  });

  test("an empty box repeats the last user message", () => {
    expect(resolveWriteInstruction("", thread)).toBe("Should this be a Map?");
    expect(
      resolveWriteInstruction("", [
        ...thread,
        { role: "user", text: "Go ahead." },
        { role: "tool" },
      ]),
    ).toBe("Go ahead.");
  });

  test("skips blank user messages and falls back to the generic instruction", () => {
    expect(resolveWriteInstruction("", [])).toBe(DEFAULT_WRITE_INSTRUCTION);
    expect(resolveWriteInstruction("", [{ role: "assistant", text: "Looks fine." }])).toBe(
      DEFAULT_WRITE_INSTRUCTION,
    );
    expect(resolveWriteInstruction("", [{ role: "user", text: "  " }])).toBe(
      DEFAULT_WRITE_INSTRUCTION,
    );
  });
});

describe("resolveInstruction", () => {
  const thread = [{ role: "user", text: "Explain this." }];

  test("read only sends only what was typed", () => {
    expect(resolveInstruction("ask", " why? ", thread)).toBe("why?");
    expect(resolveInstruction("ask", "", thread)).toBeNull();
  });

  test("Write falls back like resolveWriteInstruction", () => {
    expect(resolveInstruction("apply", "", thread)).toBe("Explain this.");
    expect(resolveInstruction("apply", "", [])).toBe(DEFAULT_WRITE_INSTRUCTION);
  });
});
