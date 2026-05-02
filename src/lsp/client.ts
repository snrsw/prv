import { encodeMessage, MessageDecoder } from "./framing";

export interface Transport {
  write(bytes: Uint8Array): Promise<void>;
  read(): AsyncIterable<Uint8Array>;
  close(): void;
}

export type Location = {
  uri: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export class LspClient {
  private nextId = 1;
  private nextDocVersion = 1;
  private pending = new Map<number, PendingRequest>();
  private decoder = new MessageDecoder();
  private readLoop: Promise<void>;
  private disposed = false;

  constructor(private transport: Transport) {
    this.readLoop = this.startReading();
  }

  async initialize(params: { rootUri: string }): Promise<unknown> {
    const result = (await this.request("initialize", {
      processId: process.pid,
      rootUri: params.rootUri,
      capabilities: {},
    })) as { capabilities: unknown };
    await this.notify("initialized", {});
    return result.capabilities;
  }

  async didOpen(params: { uri: string; languageId: string; text: string }): Promise<void> {
    await this.notify("textDocument/didOpen", {
      textDocument: {
        uri: params.uri,
        languageId: params.languageId,
        version: this.nextDocVersion++,
        text: params.text,
      },
    });
  }

  async definition(params: { uri: string; line: number; character: number }): Promise<Location[]> {
    const result = await this.request("textDocument/definition", {
      textDocument: { uri: params.uri },
      position: { line: params.line, character: params.character },
    });
    if (result == null) return [];
    return Array.isArray(result) ? (result as Location[]) : [result as Location];
  }

  async references(params: {
    uri: string;
    line: number;
    character: number;
    includeDeclaration: boolean;
  }): Promise<Location[]> {
    const result = await this.request("textDocument/references", {
      textDocument: { uri: params.uri },
      position: { line: params.line, character: params.character },
      context: { includeDeclaration: params.includeDeclaration },
    });
    if (result == null) return [];
    return Array.isArray(result) ? (result as Location[]) : [result as Location];
  }

  async shutdown(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.request("shutdown", null);
    } catch {
      // Server may have died already; proceed to exit regardless.
    }
    await this.notify("exit", null);
  }

  dispose(): void {
    this.disposed = true;
    this.transport.close();
    for (const { reject } of this.pending.values()) {
      reject(new Error("LSP client disposed"));
    }
    this.pending.clear();
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const message = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    await this.transport.write(encodeMessage(message));
    return promise;
  }

  private async notify(method: string, params: unknown): Promise<void> {
    await this.transport.write(encodeMessage({ jsonrpc: "2.0", method, params }));
  }

  private async startReading(): Promise<void> {
    for await (const chunk of this.transport.read()) {
      if (this.disposed || chunk.byteLength === 0) continue;
      for (const message of this.decoder.push(chunk)) {
        this.handleIncoming(message);
      }
    }
  }

  private handleIncoming(message: unknown): void {
    if (!isObject(message)) return;
    const id = message.id;
    if (typeof id !== "number") return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if ("error" in message && message.error) {
      pending.reject(message.error);
    } else {
      pending.resolve(message.result);
    }
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
