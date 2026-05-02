const encoder = new TextEncoder();
const decoder = new TextDecoder();
const HEADER_TERMINATOR = "\r\n\r\n";

export function encodeMessage(message: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(message));
  const header = encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
  const out = new Uint8Array(header.byteLength + body.byteLength);
  out.set(header, 0);
  out.set(body, header.byteLength);
  return out;
}

export class MessageDecoder {
  private buffer: Uint8Array = new Uint8Array(0);

  *push(chunk: Uint8Array): Generator<unknown> {
    this.buffer = concat(this.buffer, chunk);
    while (true) {
      const message = this.tryReadMessage();
      if (message === undefined) return;
      yield message;
    }
  }

  private tryReadMessage(): unknown | undefined {
    const headerEnd = indexOfTerminator(this.buffer);
    if (headerEnd < 0) return undefined;
    const headerText = decoder.decode(this.buffer.subarray(0, headerEnd));
    const length = parseContentLength(headerText);
    const bodyStart = headerEnd + HEADER_TERMINATOR.length;
    const bodyEnd = bodyStart + length;
    if (this.buffer.byteLength < bodyEnd) return undefined;
    const bodyText = decoder.decode(this.buffer.subarray(bodyStart, bodyEnd));
    this.buffer = this.buffer.subarray(bodyEnd);
    return JSON.parse(bodyText);
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.byteLength === 0) return b;
  const out = new Uint8Array(a.byteLength + b.byteLength);
  out.set(a, 0);
  out.set(b, a.byteLength);
  return out;
}

function indexOfTerminator(buffer: Uint8Array): number {
  for (let i = 0; i + 3 < buffer.byteLength; i++) {
    if (
      buffer[i] === 0x0d &&
      buffer[i + 1] === 0x0a &&
      buffer[i + 2] === 0x0d &&
      buffer[i + 3] === 0x0a
    ) {
      return i;
    }
  }
  return -1;
}

function parseContentLength(header: string): number {
  for (const line of header.split("\r\n")) {
    const [name, value] = line.split(":");
    if (name?.trim().toLowerCase() === "content-length") {
      const n = Number(value?.trim());
      if (Number.isFinite(n) && n >= 0) return n;
    }
  }
  throw new Error(`missing Content-Length in LSP header: ${header}`);
}
