import { test, expect } from "bun:test";
import { version } from "../../src/version";

test("version falls back to a dev string when PRV_VERSION is not defined", () => {
  // In plain `bun test` (no --define), PRV_VERSION is undefined,
  // so version must be the fallback, never the literal "undefined".
  expect(typeof version).toBe("string");
  expect(version.length).toBeGreaterThan(0);
  expect(version).not.toBe("undefined");
});
