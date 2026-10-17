import { test, expect, describe } from "bun:test";
import { getSendAction, parseStoredSendAction, setSendAction } from "./sendAction";

describe("parseStoredSendAction", () => {
  test("missing entry defaults to Add to batch", () => {
    expect(parseStoredSendAction(null)).toBe("batch");
  });

  test("round-trips both actions", () => {
    expect(parseStoredSendAction("now")).toBe("now");
    expect(parseStoredSendAction("batch")).toBe("batch");
  });

  test("unknown or malformed values fall back to the default", () => {
    expect(parseStoredSendAction("")).toBe("batch");
    expect(parseStoredSendAction("apply")).toBe("batch");
    expect(parseStoredSendAction('"now"')).toBe("batch");
  });
});

describe("store", () => {
  test("setSendAction is reflected by getSendAction (no window needed)", () => {
    setSendAction("now");
    expect(getSendAction()).toBe("now");
    setSendAction("batch");
    expect(getSendAction()).toBe("batch");
  });
});
