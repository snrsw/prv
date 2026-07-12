import { toolIcon, type ChatMessage } from "../useDiffChat";

/**
 * Renders the chat transcript: user/assistant text bubbles, muted `tool`
 * activity lines, and muted `progress` narration. Shared by ChatPanel and
 * CommentThread so the per-message rendering lives in one place. Callers own the
 * surrounding scroll container and trailing scroll anchor.
 */
export function ChatMessageList({
  messages,
  streaming,
}: {
  messages: ChatMessage[];
  streaming: boolean;
}) {
  return (
    <>
      {messages.map((m, i) => {
        if (m.role === "tool") {
          return (
            <div key={i} className="chat-activity" title={m.target}>
              <span className="chat-activity-icon">{toolIcon(m.name)}</span>
              {m.name}
              {m.target ? ` ${m.target}` : ""}
            </div>
          );
        }
        if (m.role === "progress") {
          return (
            <div key={i} className="chat-progress">
              <span className="chat-progress-icon">›</span>
              {m.text}
            </div>
          );
        }
        return (
          <div key={i} className={`chat-msg chat-msg-${m.role}`}>
            {m.text === "" && streaming ? <span className="chat-thinking">thinking…</span> : m.text}
          </div>
        );
      })}
    </>
  );
}
