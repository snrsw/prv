import { test, expect } from "bun:test";
import { LspClient, type Transport } from "../../src/lsp/client";
import { encodeMessage, MessageDecoder } from "../../src/lsp/framing";

class FakeTransport implements Transport {
  readonly written: unknown[] = [];
  private decoder = new MessageDecoder();
  private resolveNext: ((bytes: Uint8Array) => void) | null = null;
  private pending: Uint8Array[] = [];
  closed = false;

  async write(bytes: Uint8Array): Promise<void> {
    for (const message of this.decoder.push(bytes)) this.written.push(message);
  }

  async *read(): AsyncIterable<Uint8Array> {
    while (!this.closed) {
      const next = this.pending.shift();
      if (next) {
        yield next;
        continue;
      }
      yield await new Promise<Uint8Array>((resolve) => {
        this.resolveNext = resolve;
      });
    }
  }

  close(): void {
    this.closed = true;
    this.resolveNext?.(new Uint8Array(0));
  }

  reply(message: unknown): void {
    const bytes = encodeMessage(message);
    if (this.resolveNext) {
      const r = this.resolveNext;
      this.resolveNext = null;
      r(bytes);
    } else {
      this.pending.push(bytes);
    }
  }

  async waitForRequest(method: string): Promise<{ id: number; params: unknown }> {
    for (let i = 0; i < 100; i++) {
      const found = this.written.find(
        (m) => isObject(m) && m.method === method && typeof m.id === "number",
      );
      if (found && isObject(found)) {
        return { id: found.id as number, params: found.params };
      }
      await Bun.sleep(1);
    }
    throw new Error(`timeout waiting for request ${method}`);
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

test("initialize writes a single LSP initialize request with rootUri", async () => {
  const transport = new FakeTransport();
  const client = new LspClient(transport);
  const initPromise = client.initialize({ rootUri: "file:///workspace" });
  const req = await transport.waitForRequest("initialize");
  expect(isObject(req.params)).toBe(true);
  expect((req.params as { rootUri: string }).rootUri).toBe("file:///workspace");
  transport.reply({ jsonrpc: "2.0", id: req.id, result: { capabilities: {} } });
  await initPromise;
  const initRequests = transport.written.filter((m) => isObject(m) && m.method === "initialize");
  expect(initRequests.length).toBe(1);
  client.dispose();
});

test("initialize resolves with the server's capabilities", async () => {
  const transport = new FakeTransport();
  const client = new LspClient(transport);
  const initPromise = client.initialize({ rootUri: "file:///x" });
  const req = await transport.waitForRequest("initialize");
  transport.reply({
    jsonrpc: "2.0",
    id: req.id,
    result: { capabilities: { definitionProvider: true } },
  });
  const capabilities = await initPromise;
  expect(capabilities).toEqual({ definitionProvider: true });
  client.dispose();
});

test("didOpen writes a notification (no id) with the correct params", async () => {
  const transport = new FakeTransport();
  const client = new LspClient(transport);
  await client.didOpen({ uri: "file:///a.ts", languageId: "typescript", text: "x" });
  const notifications = transport.written.filter(
    (m) => isObject(m) && m.method === "textDocument/didOpen",
  );
  expect(notifications.length).toBe(1);
  const note = notifications[0] as Record<string, unknown>;
  expect(note.id).toBeUndefined();
  expect(note.params).toEqual({
    textDocument: { uri: "file:///a.ts", languageId: "typescript", version: 1, text: "x" },
  });
  client.dispose();
});

test("definition writes a request and resolves with the Location array", async () => {
  const transport = new FakeTransport();
  const client = new LspClient(transport);
  const defPromise = client.definition({ uri: "file:///a.ts", line: 3, character: 5 });
  const req = await transport.waitForRequest("textDocument/definition");
  expect(req.params).toEqual({
    textDocument: { uri: "file:///a.ts" },
    position: { line: 3, character: 5 },
  });
  const location = {
    uri: "file:///b.ts",
    range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
  };
  transport.reply({ jsonrpc: "2.0", id: req.id, result: [location] });
  expect(await defPromise).toEqual([location]);
  client.dispose();
});

test("definition resolves with [] when the server replies null", async () => {
  const transport = new FakeTransport();
  const client = new LspClient(transport);
  const defPromise = client.definition({ uri: "file:///a.ts", line: 0, character: 0 });
  const req = await transport.waitForRequest("textDocument/definition");
  transport.reply({ jsonrpc: "2.0", id: req.id, result: null });
  expect(await defPromise).toEqual([]);
  client.dispose();
});

test("references writes a textDocument/references request and resolves with the array", async () => {
  const transport = new FakeTransport();
  const client = new LspClient(transport);
  const refsPromise = client.references({
    uri: "file:///a.ts",
    line: 1,
    character: 2,
    includeDeclaration: true,
  });
  const req = await transport.waitForRequest("textDocument/references");
  expect(req.params).toEqual({
    textDocument: { uri: "file:///a.ts" },
    position: { line: 1, character: 2 },
    context: { includeDeclaration: true },
  });
  const locations = [
    {
      uri: "file:///a.ts",
      range: { start: { line: 5, character: 0 }, end: { line: 5, character: 4 } },
    },
    {
      uri: "file:///b.ts",
      range: { start: { line: 9, character: 0 }, end: { line: 9, character: 4 } },
    },
  ];
  transport.reply({ jsonrpc: "2.0", id: req.id, result: locations });
  expect(await refsPromise).toEqual(locations);
  client.dispose();
});

test("references resolves with [] when the server replies null", async () => {
  const transport = new FakeTransport();
  const client = new LspClient(transport);
  const refsPromise = client.references({
    uri: "file:///a.ts",
    line: 0,
    character: 0,
    includeDeclaration: false,
  });
  const req = await transport.waitForRequest("textDocument/references");
  transport.reply({ jsonrpc: "2.0", id: req.id, result: null });
  expect(await refsPromise).toEqual([]);
  client.dispose();
});

test("concurrent definition calls each resolve with their matching response", async () => {
  const transport = new FakeTransport();
  const client = new LspClient(transport);
  const aPromise = client.definition({ uri: "file:///a.ts", line: 0, character: 0 });
  const bPromise = client.definition({ uri: "file:///b.ts", line: 1, character: 1 });
  const requests: { id: number; uri: string }[] = [];
  for (let i = 0; i < 100 && requests.length < 2; i++) {
    requests.length = 0;
    for (const m of transport.written) {
      if (isObject(m) && m.method === "textDocument/definition") {
        const params = m.params as { textDocument: { uri: string } };
        requests.push({ id: m.id as number, uri: params.textDocument.uri });
      }
    }
    if (requests.length < 2) await Bun.sleep(1);
  }
  expect(requests.length).toBe(2);
  const aReq = requests.find((r) => r.uri === "file:///a.ts")!;
  const bReq = requests.find((r) => r.uri === "file:///b.ts")!;
  const aLoc = {
    uri: "file:///a.ts",
    range: { start: { line: 9, character: 0 }, end: { line: 9, character: 1 } },
  };
  const bLoc = {
    uri: "file:///b.ts",
    range: { start: { line: 7, character: 0 }, end: { line: 7, character: 1 } },
  };
  // Reply out of order on purpose.
  transport.reply({ jsonrpc: "2.0", id: bReq.id, result: [bLoc] });
  transport.reply({ jsonrpc: "2.0", id: aReq.id, result: [aLoc] });
  expect(await aPromise).toEqual([aLoc]);
  expect(await bPromise).toEqual([bLoc]);
  client.dispose();
});
