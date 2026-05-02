import { test, expect } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

import { createServer } from "../../src/server";
import type { DefinitionResolver, DefinitionResolution } from "../../src/lsp/resolver";
import { mkTempRepo } from "../support";

function makeServer(resolver?: DefinitionResolver) {
  return createServer({ port: 0, resolveDefinition: resolver });
}

function defUrl(server: ReturnType<typeof createServer>, params: Record<string, string>): URL {
  const url = new URL("/api/definition", server.url);
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

test("/api/definition returns unsupported-language for unknown extensions", async () => {
  const server = makeServer();
  try {
    const { a, b } = await makeWorkspace("prv-def-unsup-");
    writeFileSync(join(b, "notes.unknown"), "hi\n");
    const res = await fetch(
      defUrl(server, {
        mode: "path-vs-path",
        a,
        b,
        file: "notes.unknown",
        side: "new",
        line: "0",
        character: "0",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "unsupported-language" });
  } finally {
    server.stop();
  }
});

test("/api/definition returns unsupported-source for git-ref sources", async () => {
  const server = makeServer();
  try {
    const repo = await mkTempRepo("prv-def-gitsrc-");
    writeFileSync(join(repo, "a.ts"), "export const x = 1;\n");
    await $`git -C ${repo} add a.ts`.quiet();
    await $`git -C ${repo} commit -q -m init`.quiet();
    const res = await fetch(
      defUrl(server, {
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

test("/api/definition returns hit with workspace-relative path", async () => {
  const { a, b } = await makeWorkspace("prv-def-hit-");
  writeFileSync(join(b, "use.ts"), "import {x} from './lib'; console.log(x)\n");
  writeFileSync(join(b, "lib.ts"), "export const x = 1;\n");

  const stub: DefinitionResolver = async (req) => {
    expect(req.language).toBe("typescript");
    return {
      kind: "found",
      uri: `file://${join(b, "lib.ts")}`,
      line: 0,
      character: 13,
    };
  };

  const server = makeServer(stub);
  try {
    const res = await fetch(
      defUrl(server, {
        mode: "path-vs-path",
        a,
        b,
        file: "use.ts",
        side: "new",
        line: "0",
        character: "10",
      }),
    );
    expect(await res.json()).toEqual({
      kind: "hit",
      path: "lib.ts",
      line: 0,
      character: 13,
    });
  } finally {
    server.stop();
  }
});

test("/api/definition returns hit-external for locations outside the workspace", async () => {
  const { a, b } = await makeWorkspace("prv-def-ext-");
  writeFileSync(join(b, "use.ts"), "x\n");

  const stub: DefinitionResolver = async () => ({
    kind: "found",
    uri: "file:///somewhere/else/dist.d.ts",
    line: 5,
    character: 2,
  });

  const server = makeServer(stub);
  try {
    const res = await fetch(
      defUrl(server, {
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
      kind: "hit-external",
      uri: "file:///somewhere/else/dist.d.ts",
      line: 5,
      character: 2,
    });
  } finally {
    server.stop();
  }
});

test("/api/definition surfaces missing-binary as a UI-displayable hint", async () => {
  const { a, b } = await makeWorkspace("prv-def-mb-");
  writeFileSync(join(b, "use.ts"), "x\n");

  const stub: DefinitionResolver = async () =>
    ({ kind: "missing-binary", binary: "typescript-language-server" }) as DefinitionResolution;

  const server = makeServer(stub);
  try {
    const res = await fetch(
      defUrl(server, {
        mode: "path-vs-path",
        a,
        b,
        file: "use.ts",
        side: "new",
        line: "0",
        character: "0",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: "missing-binary",
      binary: "typescript-language-server",
    });
  } finally {
    server.stop();
  }
});
