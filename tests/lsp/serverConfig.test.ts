import { test, expect } from "bun:test";
import { serverConfigFor } from "../../src/lsp/serverConfig";

test("serverConfigFor typescript runs typescript-language-server --stdio", () => {
  expect(serverConfigFor("typescript")).toEqual({
    command: "typescript-language-server",
    args: ["--stdio"],
  });
});

test("serverConfigFor covers python/go/rust", () => {
  expect(serverConfigFor("python")).toEqual({
    command: "pyright-langserver",
    args: ["--stdio"],
  });
  expect(serverConfigFor("go")).toEqual({ command: "gopls", args: [] });
  expect(serverConfigFor("rust")).toEqual({ command: "rust-analyzer", args: [] });
});

test("serverConfigFor returns null for unsupported language", () => {
  // @ts-expect-error verifying runtime behavior for unknown id
  expect(serverConfigFor("cobol")).toBe(null);
  expect(serverConfigFor(null)).toBe(null);
});
