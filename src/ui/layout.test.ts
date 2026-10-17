import { describe, expect, test } from "bun:test";
import { COMPACT_MAX, COMPACT_QUERY, drawerWidth, layoutFor } from "./layout";

describe("layoutFor", () => {
  test("a desktop viewport is wide", () => {
    expect(layoutFor(1440)).toBe("wide");
  });

  test("the breakpoint itself is compact, one pixel above it is wide", () => {
    expect(layoutFor(COMPACT_MAX)).toBe("compact");
    expect(layoutFor(COMPACT_MAX + 1)).toBe("wide");
  });

  test("tablet and phone widths are compact", () => {
    expect(layoutFor(900)).toBe("compact");
    expect(layoutFor(640)).toBe("compact");
  });

  test("the media query matches the breakpoint", () => {
    expect(COMPACT_QUERY).toBe("(max-width: 1000px)");
  });
});

describe("drawerWidth", () => {
  test("caps the panel width at the viewport minus an edge", () => {
    expect(drawerWidth(380)).toBe("min(380px, calc(100vw - 16px))");
  });
});
