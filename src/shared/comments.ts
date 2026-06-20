/** Persistent inline review comments, stored in `.prv/comments.json`. */

import type { LineSide } from "../ui/lineContext";

export type CommentStatus = "open" | "resolved";

/** One message in a comment's conversation transcript. */
export type StoredMessage = { role: "user" | "assistant"; text: string };

/** A durable comment thread anchored to a line range of a diffed file. */
export type Comment = {
  id: string;
  file: string;
  side: LineSide;
  startLine: number;
  endLine: number;
  /** Text of the commented lines, used to relocate the anchor after reload. */
  anchorText: string[];
  status: CommentStatus;
  messages: StoredMessage[];
};

/** On-disk wrapper so the file is self-describing and forward-compatible. */
export type CommentsFile = {
  schema_version: "1.0";
  comments: Comment[];
};
