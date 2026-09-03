import { describe, expect, test } from "bun:test";
import { clampWidth, parseStoredWidth } from "./useResizablePanel";

describe("clampWidth", () => {
  test("keeps a value inside the range", () => {
    expect(clampWidth(300, 180, 640)).toBe(300);
  });

  test("clamps below the minimum", () => {
    expect(clampWidth(10, 180, 640)).toBe(180);
  });

  test("clamps above the maximum", () => {
    expect(clampWidth(2000, 180, 640)).toBe(640);
  });

  test("rounds fractional pointer positions", () => {
    expect(clampWidth(300.6, 180, 640)).toBe(301);
  });
});

describe("parseStoredWidth", () => {
  test("falls back to the default when nothing is stored", () => {
    expect(parseStoredWidth(null, 296, 180, 640)).toBe(296);
  });

  test("parses a stored width", () => {
    expect(parseStoredWidth("412", 296, 180, 640)).toBe(412);
  });

  test("clamps a stored width that is out of range", () => {
    expect(parseStoredWidth("5000", 296, 180, 640)).toBe(640);
    expect(parseStoredWidth("1", 296, 180, 640)).toBe(180);
  });

  test("falls back to the default on garbage", () => {
    expect(parseStoredWidth("wide", 296, 180, 640)).toBe(296);
  });
});
