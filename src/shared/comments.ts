/** Persistent inline review comments, stored in `.prv/comments.json`. */

export type CommentStatus = "open" | "resolved";

/** One message in a comment's conversation transcript. */
export type StoredMessage = { role: "user" | "assistant"; text: string };

/**
 * Identifies a single diff line by its old and/or new line number. A context
 * line has both; an added line only `new`; a deleted line only `old`. Used as
 * the resilient anchor for a comment's range endpoints.
 */
export type LineKey = { old: number | null; new: number | null };

/** Severity a review lens assigned to a finding. */
export type ReviewSeverity = "info" | "minor" | "major" | "critical";

/**
 * A durable comment thread anchored to a contiguous range of diff lines
 * (between `start` and `end`, inclusive). The range may mix deleted and added
 * lines — the endpoints are line numbers, not a single side.
 *
 * The optional `source`/`severity`/`title`/`lens`/`runId` fields are present
 * only on comments created by the agent review panel; hand-made comments omit
 * them. All additive, so `schema_version` stays "1.0".
 */
export type Comment = {
  id: string;
  file: string;
  start: LineKey;
  end: LineKey;
  /** Each selected diff line as `marker + content` (" "/"+"/"-"), for relocation. */
  anchorText: string[];
  status: CommentStatus;
  messages: StoredMessage[];
  source?: "review";
  severity?: ReviewSeverity;
  title?: string;
  /** Review lens that produced this comment (e.g. "correctness"). */
  lens?: string;
  /** Groups the comments of one review run; also namespaces their ids. */
  runId?: string;
};

/** On-disk wrapper so the file is self-describing and forward-compatible. */
export type CommentsFile = {
  schema_version: "1.0";
  comments: Comment[];
};
