import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

import { createServer } from "../../src/server";
import type { ReferencesResolver } from "../../src/lsp/resolver";
import { mkTempRepo } from "../support";

function makeServer(resolver?: ReferencesResolver) {
  return createServer({ port: 0, resolveReferences: resolver });
}

function refsUrl(server: ReturnType<typeof createServer>, params: Record<string, string>): URL {
  const url = new URL("/api/references", server.url);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

async function makeWorkspace(label: string): Promise<{ a: string; b: string }> {
  const root = mkdtempSync(join(tmpdir(), label));
  const a = join(root, "a");
  const b = join(root, "b");
  mkdirSync(a);
  mkdirSync(b);
  return { a, b };
}

test("/api/references returns unsupported-language for unknown extensions", async () => {
  const server = makeServer();
  try {
    const { a, b } = await makeWorkspace("prv-refs-unsup-");
    writeFileSync(join(b, "x.unknown"), "hi\n");
    const res = await fetch(
      refsUrl(server, {
        mode: "path-vs-path",
        a,
        b,
        file: "x.unknown",
        side: "new",
        line: "0",
        character: "0",
      }),
    );
    expect(await res.json()).toEqual({ kind: "unsupported-language" });
  } finally {
    server.stop();
  }
});

test("/api/references returns unsupported-source for git-ref sources", async () => {
  const server = makeServer();
  try {
    const repo = await mkTempRepo("prv-refs-gitsrc-");
    writeFileSync(join(repo, "a.ts"), "x\n");
    await $`git -C ${repo} add a.ts`.quiet();
    await $`git -C ${repo} commit -q -m init`.quiet();
    const res = await fetch(
      refsUrl(server, {
        mode: "git",
        cwd: repo,
        leftRef: "HEAD",
        right: "worktree",
        file: "a.ts",
        side: "old",
        line: "0",
        character: "0",
      }),
    );
    expect(await res.json()).toEqual({ kind: "unsupported-source" });
  } finally {
    server.stop();
  }
});

test("/api/references returns grouped result with snippets", async () => {
  const { a, b } = await makeWorkspace("prv-refs-ok-");
  writeFileSync(join(b, "use.ts"), "import {x} from './lib';\nx();\n");
  writeFileSync(join(b, "lib.ts"), "export function x() {}\n// later: x()\n");

  const stub: ReferencesResolver = async () => ({
    kind: "found",
    locations: [
      { uri: `file://${join(b, "use.ts")}`, line: 1, character: 0 },
      { uri: `file://${join(b, "lib.ts")}`, line: 0, character: 16 },
      { uri: "file:///somewhere/dist.d.ts", line: 4, character: 0 },
    ],
  });

  const server = makeServer(stub);
  try {
    const res = await fetch(
      refsUrl(server, {
        mode: "path-vs-path",
        a,
        b,
        file: "use.ts",
        side: "new",
        line: "0",
        character: "9",
      }),
    );
    const body = (await res.json()) as {
      kind: string;
      groups: {
        inFile: { line: number; character: number; snippet: string }[];
        local: { path: string; refs: { line: number; character: number; snippet: string }[] }[];
        external: number;
      };
    };
    expect(body.kind).toBe("ok");
    expect(body.groups.inFile).toEqual([{ line: 1, character: 0, snippet: "x();" }]);
    expect(body.groups.local).toEqual([
      {
        path: "lib.ts",
        refs: [{ line: 0, character: 16, snippet: "export function x() {}" }],
      },
    ]);
    expect(body.groups.external).toBe(1);
  } finally {
    server.stop();
  }
});

test("/api/references surfaces missing-binary as a UI-displayable hint", async () => {
  const { a, b } = await makeWorkspace("prv-refs-mb-");
  writeFileSync(join(b, "use.ts"), "x\n");

  const stub: ReferencesResolver = async () => ({
    kind: "missing-binary",
    binary: "typescript-language-server",
  });

  const server = makeServer(stub);
  try {
    const res = await fetch(
      refsUrl(server, {
        mode: "path-vs-path",
        a,
        b,
        file: "use.ts",
        side: "new",
        line: "0",
        character: "0",
      }),
    );
    expect(await res.json()).toEqual({
      kind: "missing-binary",
      binary: "typescript-language-server",
    });
  } finally {
    server.stop();
  }
});
