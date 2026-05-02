import { test, expect } from "bun:test";
import { detectLanguage } from "../../src/lsp/language";

test("detectLanguage maps .ts to typescript", () => {
  expect(detectLanguage("foo.ts")).toBe("typescript");
});

test("detectLanguage covers tsx/js/jsx/py/go/rs", () => {
  expect(detectLanguage("foo.tsx")).toBe("typescriptreact");
  expect(detectLanguage("foo.js")).toBe("javascript");
  expect(detectLanguage("foo.jsx")).toBe("javascriptreact");
  expect(detectLanguage("foo.py")).toBe("python");
  expect(detectLanguage("foo.go")).toBe("go");
  expect(detectLanguage("foo.rs")).toBe("rust");
});

test("detectLanguage returns null for unknown extension", () => {
  expect(detectLanguage("foo.unknown")).toBe(null);
});
