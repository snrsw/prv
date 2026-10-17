import { test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "../../src/server";
import { descriptionPath } from "../../src/description/store";
import { MAX_DESCRIPTION_BYTES, type Description } from "../../src/shared/description";

let server: ReturnType<typeof createServer>;
let storeDir: string;

beforeAll(() => {
  storeDir = mkdtempSync(join(tmpdir(), "prv-srv-description-"));
  server = createServer({ port: 0, storeDir });
});

afterAll(() => {
  server.stop();
  rmSync(storeDir, { recursive: true, force: true });
});

const url = () => new URL("/api/description", server.url);
const put = (body: BodyInit, headers: Record<string, string> = {}) =>
  fetch(url(), {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body,
  });

test("GET/PUT/DELETE /api/description round-trip through .prv/description.md", async () => {
  expect(await (await fetch(url())).json()).toBeNull();

  const saved = await put(JSON.stringify({ markdown: "## Summary\nHi" }));
  expect(saved.status).toBe(200);
  const description = (await saved.json()) as Description;
  expect(description.markdown).toBe("## Summary\nHi\n");
  expect(Number.isNaN(Date.parse(description.updatedAt))).toBe(false);
  expect(await Bun.file(descriptionPath(storeDir)).text()).toBe("## Summary\nHi\n");

  expect(await (await fetch(url())).json()).toEqual(description);

  const deleted = await fetch(url(), { method: "DELETE" });
  expect(await deleted.json()).toEqual({ ok: true });
  expect(await (await fetch(url())).json()).toBeNull();
});

test("PUT rejects a blank, missing, or malformed description with 400", async () => {
  for (const body of [JSON.stringify({ markdown: "  \n" }), JSON.stringify({}), "not json"]) {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toHaveProperty("error");
  }
  expect(await Bun.file(descriptionPath(storeDir)).exists()).toBe(false);
});

test("PUT rejects Markdown over the limit with 413 and keeps the old description", async () => {
  await put(JSON.stringify({ markdown: "keep me" }));
  const res = await put(JSON.stringify({ markdown: "x".repeat(MAX_DESCRIPTION_BYTES + 1) }));
  expect(res.status).toBe(413);
  expect(((await res.json()) as { error: string }).error).toContain("limit");
  expect(await Bun.file(descriptionPath(storeDir)).text()).toBe("keep me\n");
});

test("PUT rejects a body far over the limit with 413 without storing it", async () => {
  // 30 MB, the size that used to be written whole.
  const res = await put(JSON.stringify({ markdown: "y".repeat(30 * 1024 * 1024) }));
  expect(res.status).toBe(413);
  expect(await Bun.file(descriptionPath(storeDir)).text()).toBe("keep me\n");
});

test("Markdown exactly at the limit is accepted", async () => {
  const res = await put(JSON.stringify({ markdown: "z".repeat(MAX_DESCRIPTION_BYTES) }));
  expect(res.status).toBe(200);
});
