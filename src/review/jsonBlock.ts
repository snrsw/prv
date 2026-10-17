/**
 * Tolerant location of a JSON payload inside an agent's free-form reply.
 *
 * Every output contract in prv asks the agent to end its reply with exactly
 * one fenced ```json block, but models drift — they add prose after the
 * block, nest fences, or drop the fence entirely. These two helpers are the
 * shared first and second guesses (used by the review lenses and the batch
 * runner alike); the caller decides what a valid payload looks like.
 */

/** The last fenced code block's contents, or null if the reply has none. */
export function lastFencedBlock(reply: string): string | null {
  const fence = /```[^\S\n]*\w*[^\S\n]*\n([\s\S]*?)```/g;
  let last: string | null = null;
  for (const match of reply.matchAll(fence)) last = match[1] ?? null;
  return last;
}

/** The outermost `{`..`}` slice, or null when the reply has no brace pair. */
export function braceSlice(reply: string): string | null {
  const open = reply.indexOf("{");
  const close = reply.lastIndexOf("}");
  return open >= 0 && close > open ? reply.slice(open, close + 1) : null;
}
