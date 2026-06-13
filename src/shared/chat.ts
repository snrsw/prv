/** Wire protocol for the /api/chat WebSocket (read-only "chat about the diff"). */

/** Client → server: ask a question. `diff` is used only on the first turn. */
export type ChatAsk = {
  type: "ask";
  question: string;
  diff: string;
};

/** Server → client frames. */
export type ChatServerFrame =
  | { type: "session"; sessionId: string }
  | { type: "chunk"; text: string }
  | { type: "done" }
  | { type: "error"; message: string }
  | { type: "busy" };

/** Per-connection state stored on the WebSocket. */
export type ChatWsData = {
  sessionId: string | null;
  busy: boolean;
};
