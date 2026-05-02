import { test, expect } from "bun:test";
import { encodeMessage, MessageDecoder } from "../../src/lsp/framing";

const encoder = new TextEncoder();

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

test("encodeMessage produces Content-Length header with byte length and JSON body", () => {
  const message = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
  const out = encodeMessage(message);
  const json = JSON.stringify(message);
  const expectedLength = encoder.encode(json).byteLength;
  expect(bytesToString(out)).toBe(`Content-Length: ${expectedLength}\r\n\r\n${json}`);
});

test("encodeMessage uses UTF-8 byte length, not character count, for non-ASCII", () => {
  const message = { jsonrpc: "2.0", id: 2, method: "log", params: { text: "üé" } };
  const out = encodeMessage(message);
  const json = JSON.stringify(message);
  const headerEnd = bytesToString(out).indexOf("\r\n\r\n");
  const header = bytesToString(out).slice(0, headerEnd);
  const declared = Number(header.replace("Content-Length: ", ""));
  expect(declared).toBe(encoder.encode(json).byteLength);
});

test("MessageDecoder yields one message for a single-chunk frame", () => {
  const decoder = new MessageDecoder();
  const message = { jsonrpc: "2.0", id: 1, result: { ok: true } };
  const messages = [...decoder.push(encodeMessage(message))];
  expect(messages).toEqual([message]);
});

test("MessageDecoder reassembles a frame split across two pushes", () => {
  const decoder = new MessageDecoder();
  const message = { jsonrpc: "2.0", id: 7, result: 42 };
  const full = encodeMessage(message);
  const half = Math.floor(full.length / 2);
  const first = [...decoder.push(full.subarray(0, half))];
  const second = [...decoder.push(full.subarray(half))];
  expect(first).toEqual([]);
  expect(second).toEqual([message]);
});

test("MessageDecoder yields multiple messages and buffers a trailing partial", () => {
  const decoder = new MessageDecoder();
  const a = { jsonrpc: "2.0", id: 1, result: "a" };
  const b = { jsonrpc: "2.0", id: 2, result: "b" };
  const c = { jsonrpc: "2.0", id: 3, result: "c" };
  const buf = new Uint8Array([...encodeMessage(a), ...encodeMessage(b), ...encodeMessage(c)]);
  const cutoff = encodeMessage(a).length + encodeMessage(b).length + 4;
  const first = [...decoder.push(buf.subarray(0, cutoff))];
  const second = [...decoder.push(buf.subarray(cutoff))];
  expect(first).toEqual([a, b]);
  expect(second).toEqual([c]);
});
