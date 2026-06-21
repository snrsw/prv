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

/**
 * A durable comment thread anchored to a contiguous range of diff lines
 * (between `start` and `end`, inclusive). The range may mix deleted and added
 * lines — the endpoints are line numbers, not a single side.
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
};

/** On-disk wrapper so the file is self-describing and forward-compatible. */
export type CommentsFile = {
  schema_version: "1.0";
  comments: Comment[];
};
