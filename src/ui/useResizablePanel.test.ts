import { describe, expect, test } from "bun:test";
import { clampWidth, parseStoredWidth } from "./useResizablePanel";

// A wide viewport where only the panel's own range matters.
const VIEWPORT = 1440;
const RESERVE = 320;

describe("clampWidth", () => {
  test("keeps a value inside the range", () => {
    expect(clampWidth(300, 180, 640, VIEWPORT, RESERVE)).toBe(300);
  });

  test("clamps below the minimum", () => {
    expect(clampWidth(10, 180, 640, VIEWPORT, RESERVE)).toBe(180);
  });

  test("clamps above the maximum", () => {
    expect(clampWidth(2000, 180, 640, VIEWPORT, RESERVE)).toBe(640);
  });

  test("rounds fractional pointer positions", () => {
    expect(clampWidth(300.6, 180, 640, VIEWPORT, RESERVE)).toBe(301);
  });

  test("leaves the reserve free on a narrow viewport", () => {
    // 900 - 320 = 580 beats the 800 maximum.
    expect(clampWidth(700, 280, 800, 900, RESERVE)).toBe(580);
  });

  test("the minimum wins over the reserve when both cannot fit", () => {
    expect(clampWidth(300, 280, 800, 500, RESERVE)).toBe(280);
  });
});

describe("parseStoredWidth", () => {
  test("falls back to the default when nothing is stored", () => {
    expect(parseStoredWidth(null, 296, 180, 640, VIEWPORT, RESERVE)).toBe(296);
  });

  test("parses a stored width", () => {
    expect(parseStoredWidth("412", 296, 180, 640, VIEWPORT, RESERVE)).toBe(412);
  });

  test("clamps a stored width that is out of range", () => {
    expect(parseStoredWidth("5000", 296, 180, 640, VIEWPORT, RESERVE)).toBe(640);
    expect(parseStoredWidth("1", 296, 180, 640, VIEWPORT, RESERVE)).toBe(180);
  });

  test("clamps a stored width to the viewport", () => {
    expect(parseStoredWidth("600", 296, 180, 640, 800, RESERVE)).toBe(480);
  });

  test("falls back to the default on garbage", () => {
    expect(parseStoredWidth("wide", 296, 180, 640, VIEWPORT, RESERVE)).toBe(296);
  });
});
