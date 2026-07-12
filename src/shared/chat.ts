/** Wire protocol for the /api/chat WebSocket (read-only "chat about the diff"). */

/** Client → server: ask a question. `diff` is used only on the first turn. */
export type ChatAsk = {
  type: "ask";
  question: string;
  diff: string;
  /** "ask" = read-only Q&A (default); "apply" = let the agent edit files. */
  mode?: "ask" | "apply";
};

/** Server → client frames. */
export type ChatServerFrame =
  | { type: "session"; sessionId: string }
  | { type: "chunk"; text: string }
  | { type: "progress"; text: string }
  | { type: "tool"; name: string; target?: string }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "busy" };

/** Per-connection state stored on the WebSocket. `kind` routes the shared
 * websocket handler (Bun.serve has a single handler for all upgraded routes). */
export type ChatWsData = {
  kind: "chat";
  sessionId: string | null;
  busy: boolean;
};
