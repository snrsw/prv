import { test, expect, beforeAll, afterAll } from "bun:test";
import { $ } from "bun";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createServer } from "../../src/server";
import { mkTempRepo } from "../support";

// #63: prv serves `src/ui/index.html` via Bun's HTML import while its cwd is the
// repository under review, not the prv checkout. Bun's production bundler
// emits asset URLs relative to `process.cwd()` at bundle time, so from any
// other directory they came out as `/../../../<cwd>/chunk-xxx.css` (404).
// This test therefore chdirs into a temp repo before the first request.
let server: ReturnType<typeof createServer>;
let repo: string;
const originalCwd = process.cwd();

beforeAll(async () => {
  repo = await mkTempRepo("prv-srv-assets-");
  writeFileSync(join(repo, "a.txt"), "a\n");
  await $`git -C ${repo} add a.txt`.quiet();
  await $`git -C ${repo} commit -q -m init`.quiet();
  writeFileSync(join(repo, "a.txt"), "a\nb\n");
  process.chdir(repo);
  server = createServer({
    port: 0,
    defaultMode: { kind: "git", cwd: repo, leftRef: "HEAD", right: { kind: "worktree" } },
  });
});

afterAll(() => {
  server.stop();
  process.chdir(originalCwd);
});

test("GET / from a foreign cwd links only same-server assets without `..` segments", async () => {
  const res = await fetch(new URL("/", server.url));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  const html = await res.text();

  const urls = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]!);
  expect(urls.some((u) => u.endsWith(".css"))).toBe(true);
  expect(urls.some((u) => u.endsWith(".js"))).toBe(true);

  for (const u of urls) {
    // `fetch` would normalize `/../x` to `/x`, hiding the bug; check the raw href.
    expect(u.split("/")).not.toContain("..");
    expect(u.startsWith("/")).toBe(true);
    const asset = await fetch(new URL(u, server.url));
    expect(`${u} -> ${asset.status}`).toBe(`${u} -> 200`);
  }
});
