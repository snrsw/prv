/**
 * Pure helpers for keeping an inline thread's live transcript in step with the
 * persisted one.
 *
 * The store is a thread's authority: the composer's "Add to batch" writes
 * straight to it (no agent involved), and a "Finish review" run appends the
 * agent's reply — and a resolved status — to every pending thread while the
 * cards are mounted. `useDiffChat` meanwhile keeps its own copy of the
 * transcript, seeded once on mount, because a streaming turn has to render
 * text that is not persisted yet. These two decide when the card adopts the
 * store's version.
 */

import type { StoredMessage } from "../shared/comments";

/** Append the user's typed comment, ignoring blank input. Pure. */
export function appendUserMessage(messages: StoredMessage[], text: string): StoredMessage[] {
  const trimmed = text.trim();
  if (trimmed === "") return messages;
  return [...messages, { role: "user", text: trimmed }];
}

/**
 * Split a thread into the messages before its pending tail and the tail
 * itself: the trailing run of user messages the agent has not answered yet
 * (one or more comments saved with "Add to batch"). "Send now" with an empty
 * input sends `pending` as the turn's question and `earlier` as prior
 * conversation, so the tail is neither re-added to the thread nor repeated in
 * the prompt. `pending` is "" when the thread does not end with a user
 * message. Pure.
 */
export function splitPendingTail(messages: StoredMessage[]): {
  earlier: StoredMessage[];
  pending: string;
} {
  let start = messages.length;
  while (start > 0 && messages[start - 1]?.role === "user") start--;
  const pending = messages
    .slice(start)
    .map((m) => m.text.trim())
    .filter((t) => t !== "")
    .join("\n\n");
  return { earlier: messages.slice(0, start), pending };
}

/**
 * Whether the persisted transcript holds something the live one does not, so
 * the card must adopt it.
 *
 * A live list that merely runs *ahead* of the store is not a reason to adopt:
 * that is the normal shape right after a turn ends or a comment is saved, with
 * the write on its way to the store, and adopting there would drop the very
 * message being persisted. Only extra persisted messages, or a disagreement
 * about a message both lists have, mean the store moved on without us.
 */
export function persistedIsAhead(persisted: StoredMessage[], live: StoredMessage[]): boolean {
  if (persisted.length > live.length) return true;
  return persisted.some((m, i) => {
    const mine = live[i];
    return !mine || mine.role !== m.role || mine.text !== m.text;
  });
}
