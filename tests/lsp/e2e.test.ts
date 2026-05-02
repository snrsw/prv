import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGatewayResolver } from "../../src/lsp/createResolver";

const tssAvailable = Bun.which("typescript-language-server") !== null;
const itTss = tssAvailable ? test : test.skip;

itTss(
  "[e2e] resolves a same-file definition with typescript-language-server",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "prv-e2e-tss-same-"));
    const file = join(root, "a.ts");
    writeFileSync(
      file,
      ["function greet(name: string) { return name; }", "greet('hi');", ""].join("\n"),
    );
    const text = (await Bun.file(file).text()) as string;

    const { resolver, shutdown } = createGatewayResolver({
      rootUri: `file://${root}`,
    });
    try {
      // Click on the call to greet, line 1, around character 0..4.
      const result = await resolver({
        rootDir: root,
        fileUri: `file://${file}`,
        language: "typescript",
        text,
        line: 1,
        character: 0,
      });
      expect(result.kind).toBe("found");
      if (result.kind === "found") {
        expect(result.uri).toBe(`file://${file}`);
        expect(result.line).toBe(0);
      }
    } finally {
      await shutdown();
    }
  },
  20_000,
);

// V1 behavior: textDocument/definition on an imported TS symbol returns the
// import binding in the *same* file, not the source file. Following through
// to the actual source requires _typescript.goToSourceDefinition; out of v1
// scope. The test pins the current behavior so we notice if we change it.
itTss(
  "[e2e] cross-file: clicking an imported usage goes to the import binding",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "prv-e2e-tss-cross-"));
    const lib = join(root, "lib.ts");
    const use = join(root, "use.ts");
    writeFileSync(lib, "export function lib() { return 1; }\n");
    writeFileSync(use, "import { lib } from './lib';\nlib();\n");
    const useText = (await Bun.file(use).text()) as string;

    const { resolver, shutdown } = createGatewayResolver({
      rootUri: `file://${root}`,
    });
    try {
      const result = await resolver({
        rootDir: root,
        fileUri: `file://${use}`,
        language: "typescript",
        text: useText,
        line: 1,
        character: 0,
      });
      expect(result.kind).toBe("found");
      if (result.kind === "found") {
        expect(result.uri).toBe(`file://${use}`);
        expect(result.line).toBe(0);
      }
    } finally {
      await shutdown();
    }
  },
  20_000,
);
