import { test, expect } from "bun:test";
import { shouldAutoOpen } from "../../src/cli";

test("open=false always means no auto-open", () => {
  expect(shouldAutoOpen(false, "linux", { DISPLAY: ":0" })).toBe(false);
});

test("darwin auto-opens regardless of DISPLAY", () => {
  expect(shouldAutoOpen(true, "darwin", {})).toBe(true);
});

test("linux with DISPLAY auto-opens", () => {
  expect(shouldAutoOpen(true, "linux", { DISPLAY: ":0" })).toBe(true);
});

test("linux with WAYLAND_DISPLAY auto-opens", () => {
  expect(shouldAutoOpen(true, "linux", { WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
});

test("linux headless (no DISPLAY/WAYLAND) does not auto-open", () => {
  expect(shouldAutoOpen(true, "linux", {})).toBe(false);
});
