import { test, expect } from "bun:test";
import { LspGateway, type Spawner, type SpawnedProcess } from "../../src/lsp/gateway";
import type { Transport } from "../../src/lsp/client";
import { encodeMessage, MessageDecoder } from "../../src/lsp/framing";

class FakeTransport implements Transport {
  readonly written: unknown[] = [];
  private decoder = new MessageDecoder();
  closed = false;
  async write(bytes: Uint8Array): Promise<void> {
    for (const m of this.decoder.push(bytes)) this.written.push(m);
    this.maybeAutoReply();
  }
  async *read(): AsyncIterable<Uint8Array> {
    while (!this.closed) {
      yield await new Promise<Uint8Array>((resolve) => {
        this.flushResolve = resolve;
      });
    }
  }
  close(): void {
    this.closed = true;
    this.flushResolve?.(new Uint8Array(0));
  }
  private flushResolve: ((b: Uint8Array) => void) | null = null;

  // Auto-reply to initialize/shutdown so getClient() can complete.
  private maybeAutoReply(): void {
    const last = this.written[this.written.length - 1];
    if (!isObject(last)) return;
    if (last.method === "initialize" && typeof last.id === "number") {
      this.send({ jsonrpc: "2.0", id: last.id, result: { capabilities: {} } });
    } else if (last.method === "shutdown" && typeof last.id === "number") {
      this.send({ jsonrpc: "2.0", id: last.id, result: null });
    }
  }
  private send(message: unknown): void {
    const bytes = encodeMessage(message);
    if (this.flushResolve) {
      const r = this.flushResolve;
      this.flushResolve = null;
      r(bytes);
    }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function fakeSpawner(): {
  spawner: Spawner;
  calls: { command: string; args: string[] }[];
  transports: FakeTransport[];
} {
  const calls: { command: string; args: string[] }[] = [];
  const transports: FakeTransport[] = [];
  const spawner: Spawner = (command, args) => {
    calls.push({ command, args });
    const transport = new FakeTransport();
    transports.push(transport);
    const proc: SpawnedProcess = { transport, pid: 999, kill: () => transport.close() };
    return proc;
  };
  return { spawner, calls, transports };
}

test("getClient spawns the configured binary exactly once across two calls", async () => {
  const { spawner, calls } = fakeSpawner();
  const gateway = new LspGateway({ spawner, rootUri: "file:///r" });
  const a = await gateway.getClient("typescript");
  const b = await gateway.getClient("typescript");
  expect(a.kind).toBe("ready");
  expect(b.kind).toBe("ready");
  if (a.kind === "ready" && b.kind === "ready") expect(a.client).toBe(b.client);
  expect(calls).toEqual([{ command: "typescript-language-server", args: ["--stdio"] }]);
  await gateway.shutdown();
});

test("getClient returns 'unsupported' for languages with no server config", async () => {
  const { spawner } = fakeSpawner();
  const gateway = new LspGateway({ spawner, rootUri: "file:///r" });
  const result = await gateway.getClient(null);
  expect(result).toEqual({ kind: "unsupported" });
  await gateway.shutdown();
});

test("getClient returns 'missing-binary' when the spawner reports ENOENT", async () => {
  const failing: Spawner = (command) => {
    const error = new Error("not found") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    (error as unknown as { binary: string }).binary = command;
    throw error;
  };
  const gateway = new LspGateway({ spawner: failing, rootUri: "file:///r" });
  const result = await gateway.getClient("typescript");
  expect(result).toEqual({ kind: "missing-binary", binary: "typescript-language-server" });
  await gateway.shutdown();
});

test("shutdown sends shutdown+exit to every spawned client and clears the registry", async () => {
  const { spawner, calls, transports } = fakeSpawner();
  const gateway = new LspGateway({ spawner, rootUri: "file:///r" });
  await gateway.getClient("typescript");
  await gateway.getClient("python");
  expect(calls.length).toBe(2);
  await gateway.shutdown();

  for (const t of transports) {
    const methods = t.written
      .filter((m): m is Record<string, unknown> => isObject(m))
      .map((m) => m.method);
    expect(methods).toContain("shutdown");
    expect(methods).toContain("exit");
    const shutdownIdx = methods.indexOf("shutdown");
    const exitIdx = methods.indexOf("exit");
    expect(shutdownIdx).toBeLessThan(exitIdx);
  }

  // After shutdown, getClient must spawn a fresh one.
  await gateway.getClient("typescript");
  expect(calls.length).toBe(3);
  await gateway.shutdown();
});
