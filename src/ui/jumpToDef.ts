export function offsetToPosition(
  text: string,
  offset: number,
): { line: number; character: number } {
  const limit = Math.min(offset, text.length);
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < limit; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: limit - lineStart };
}
